"""
Invoice connector — fetches supplier invoice headers and
invoice-to-PO-item references from the SAP Supplier Invoice
Process API (OData V2 / XML-Atom).

NOTE on invoice headers
-----------------------
``A_SuplrInvcItemPurOrdRef`` returns *invoice item -> PO item references*,
not invoice headers.  Headers come from ``A_SupplierInvoice`` of the same
service.  If a header cannot be fetched the connector reports it; the
integrity step in ``main`` then drops the dangling references so the
foreign keys stay valid.

Call-count strategy
-------------------
References are fetched per *group of POs* (OR-filter) and headers per *group
of invoice keys*, both paged - instead of one call per PO and per invoice.
"""

import requests

from app.odata import chunked, entry_properties, iter_v2_entries, parse_feed, quote, or_filter
from app.sap_client import SAPClient, SAPQuotaExceeded

INVOICE_SRV = "/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV"
INV_HEADER_PATH = f"{INVOICE_SRV}/A_SupplierInvoice"
INV_PO_REF_PATH = f"{INVOICE_SRV}/A_SuplrInvcItemPurOrdRef"


def fetch_invoice_po_refs(
    client: SAPClient,
    purchase_orders: list[str],
    top: int = 5000,
    page_size: int = 100,
    chunk_size: int = 20,
    selected_fields: list[str] | None = None,
) -> list[dict]:
    """Fetch invoice-to-PO-item references for a list of PO numbers."""
    from app.mapping.mappers import build_sap_select

    refs: list[dict] = []
    select_str = build_sap_select("invoice_po_reference", selected_fields)

    for chunk in chunked(sorted(set(purchase_orders)), chunk_size):
        if len(refs) >= top:
            break
        params = {"$filter": or_filter("PurchaseOrder", chunk)}
        if select_str:
            params["$select"] = select_str
        try:
            for entry in iter_v2_entries(client, INV_PO_REF_PATH, params, page_size, top - len(refs)):
                refs.append(entry_properties(entry))
        except requests.HTTPError as exc:
            print(f"  [WARN] Could not fetch invoice refs for POs {chunk[0]}..{chunk[-1]}: {exc}")
    return refs


def fetch_invoice_header(
    client: SAPClient,
    supplier_invoice: str,
    fiscal_year: str,
    selected_fields: list[str] | None = None,
) -> dict | None:
    """Fetch a single invoice header by its composite key (1 call)."""
    from app.mapping.mappers import build_sap_select

    select_str = build_sap_select("supplier_invoice", selected_fields)
    path = (
        f"{INV_HEADER_PATH}"
        f"(SupplierInvoice={quote(supplier_invoice)},FiscalYear={quote(fiscal_year)})"
    )
    if select_str:
        path = f"{path}?$select={select_str}"
    try:
        entries = parse_feed(client.get_xml(path))
        return entries[0] if entries else None
    except requests.HTTPError as exc:
        print(f"  [WARN] Could not fetch invoice header {supplier_invoice}/{fiscal_year}: {exc}")
        return None


def fetch_invoice_headers(
    client: SAPClient,
    keys: set[tuple[str, str]],
    top: int = 5000,
    page_size: int = 100,
    chunk_size: int = 10,
    selected_fields: list[str] | None = None,
) -> list[dict]:
    """Fetch invoice headers for (SupplierInvoice, FiscalYear) keys."""
    from app.mapping.mappers import build_sap_select

    headers: list[dict] = []
    select_str = build_sap_select("supplier_invoice", selected_fields)

    try:
        for chunk in chunked(sorted(keys), chunk_size):
            if len(headers) >= top:
                break
            flt = " or ".join(
                f"(SupplierInvoice eq {quote(inv)} and FiscalYear eq {quote(fy)})" for inv, fy in chunk
            )
            params = {"$filter": flt}
            if select_str:
                params["$select"] = select_str
            try:
                for entry in iter_v2_entries(client, INV_HEADER_PATH, params, page_size, top - len(headers)):
                    headers.append(entry_properties(entry))
            except requests.HTTPError as exc:
                print(f"  [WARN] Combined invoice filter failed ({exc}); fetching {len(chunk)} headers one by one.")
                for inv, fy in chunk:
                    hdr = fetch_invoice_header(client, inv, fy, selected_fields=selected_fields)
                    if hdr:
                        headers.append(hdr)
    except SAPQuotaExceeded as exc:
        exc.partial = headers
        raise
    return headers


def fetch_all_invoices_and_refs(
    client: SAPClient,
    purchase_orders: list[str],
    top: int = 5000,
    page_size: int = 100,
    chunk_size: int = 20,
    selected_ref_fields: list[str] | None = None,
    selected_header_fields: list[str] | None = None,
) -> dict:
    """Return {'invoice_headers': [...], 'po_refs': [...]} for the given POs."""
    refs = fetch_invoice_po_refs(
        client, purchase_orders, top, page_size, chunk_size, selected_fields=selected_ref_fields
    )
    keys = {
        (r["SupplierInvoice"], r["FiscalYear"])
        for r in refs
        if r.get("SupplierInvoice") and r.get("FiscalYear")
    }
    try:
        headers = fetch_invoice_headers(
            client, keys, top, page_size, max(1, chunk_size // 2), selected_fields=selected_header_fields
        )
    except SAPQuotaExceeded as exc:
        exc.partial = {"invoice_headers": exc.partial, "po_refs": refs}
        raise
    return {"invoice_headers": headers, "po_refs": refs}
