"""
Purchase order connector — fetches purchase order headers and
line items from the SAP Purchase Order API (OData V4 / JSON).

Call-count strategy
-------------------
Instead of 1 call per supplier to find its POs, supplier IDs are chunked
and combined into a single OR-filter:
  ``Supplier eq '1000' or Supplier eq '1001' or ...``
-> chunked by ``SAP_FILTER_CHUNK`` (default 20) -> ~40 calls for 800 suppliers.
Line items are fetched the same way, grouped by PurchaseOrder number.
"""

from datetime import datetime

import requests

from app.odata import (
    and_filter,
    chunked,
    iter_v4_rows,
    keyset_filter,
    or_filter,
    watermark_filter,
)
from app.sap_client import SAPClient, SAPQuotaExceeded

PO_PATH = "/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrder"
PO_ITEM_PATH = "/sap/opu/odata4/sap/api_purchaseorder_2/srvd_a2x/sap/purchaseorder/0001/PurchaseOrderItem"


def fetch_purchase_orders(
    client: SAPClient,
    supplier_ids: list[str],
    top: int = 5000,
    page_size: int = 100,
    chunk_size: int = 20,
    watermark: datetime | None = None,
    date_field: str = "LastChangeDateTime",
    date_type: str = "datetimeoffset",
    stats: dict | None = None,
    selected_fields: list[str] | None = None,
) -> list[dict]:
    """Fetch purchase order headers for a list of supplier IDs."""
    from app.mapping.mappers import build_sap_select

    select_str = build_sap_select("purchase_order", selected_fields)
    orders: list[dict] = []
    use_wm = watermark is not None
    filter_dropped = False
    complete = True

    try:
        for chunk in chunked(sorted(set(supplier_ids)), chunk_size):
            if len(orders) >= top:
                complete = False
                break
            while True:
                base = or_filter("Supplier", chunk)
                if use_wm:
                    flt = and_filter(base, watermark_filter(date_field, date_type, watermark, odata_version=4))
                    params = {"$filter": flt, "$orderby": f"{date_field} asc, PurchaseOrder asc"}
                else:
                    params = {"$filter": base}
                if select_str:
                    params["$select"] = select_str
                try:
                    orders.extend(
                        iter_v4_rows(client, PO_PATH, params, page_size, top - len(orders))
                    )
                    if len(orders) >= top:
                        complete = False
                except requests.HTTPError as exc:
                    if use_wm:
                        print(f"  [WARN] SAP rejected the PO date filter on '{date_field}' ({exc}); "
                              f"falling back to a full fetch (no incremental saving for POs).")
                        use_wm, filter_dropped = False, True
                        continue
                    print(f"  [WARN] Could not fetch POs for suppliers {chunk[0]}..{chunk[-1]}: {exc}")
                    complete = False
                break
    except SAPQuotaExceeded as exc:
        exc.partial = orders
        raise
    finally:
        if stats is not None:
            stats["complete"] = complete
            stats["filter_dropped"] = filter_dropped
    return orders


def fetch_po_batch(
    client: SAPClient,
    supplier_ids: list[str],
    cursor: tuple | None,
    batch: int,
    page_size: int = 100,
    date_field: str = "LastChangeDateTime",
    date_type: str = "datetimeoffset",
    selected_fields: list[str] | None = None,
) -> list[dict]:
    """The next ``batch`` POs of ``supplier_ids`` after ``cursor`` (resumable paging)."""
    from app.mapping.mappers import build_sap_select

    flt = or_filter("Supplier", supplier_ids)
    if cursor is not None:
        value, key = cursor
        flt = and_filter(flt, keyset_filter(date_field, date_type, value, 4, "PurchaseOrder", key))
    params = {"$filter": flt, "$orderby": f"{date_field} asc, PurchaseOrder asc"}
    select_str = build_sap_select("purchase_order", selected_fields)
    if select_str:
        params["$select"] = select_str
    return list(iter_v4_rows(client, PO_PATH, params, page_size, batch))


def fetch_purchase_order_items(
    client: SAPClient,
    purchase_orders: list[str],
    top: int = 20000,
    page_size: int = 100,
    chunk_size: int = 20,
    selected_fields: list[str] | None = None,
) -> list[dict]:
    """Fetch line items for a group of purchase orders."""
    from app.mapping.mappers import build_sap_select

    items: list[dict] = []
    select_str = build_sap_select("purchase_order_item", selected_fields)
    try:
        for chunk in chunked(sorted(set(purchase_orders)), chunk_size):
            if len(items) >= top:
                break
            params = {"$filter": or_filter("PurchaseOrder", chunk)}
            if select_str:
                params["$select"] = select_str
            try:
                items.extend(
                    iter_v4_rows(client, PO_ITEM_PATH, params, page_size, top - len(items))
                )
            except requests.HTTPError as exc:
                print(f"  [WARN] Could not fetch items for POs {chunk[0]}..{chunk[-1]}: {exc}")
    except SAPQuotaExceeded as exc:
        exc.partial = items
        raise
    return items


def fetch_all_pos_with_items(
    client: SAPClient,
    supplier_ids: list[str],
    top: int = 5000,
    item_top: int = 20000,
    page_size: int = 100,
    chunk_size: int = 20,
    watermark: datetime | None = None,
    date_field: str = "LastChangeDateTime",
    date_type: str = "datetimeoffset",
    selected_po_fields: list[str] | None = None,
    selected_item_fields: list[str] | None = None,
) -> dict:
    """Return {'orders': [...], 'items': [...], 'complete': bool, 'filter_dropped': bool}."""
    stats: dict = {}
    try:
        orders = fetch_purchase_orders(
            client, supplier_ids, top, page_size, chunk_size,
            watermark=watermark, date_field=date_field, date_type=date_type, stats=stats,
            selected_fields=selected_po_fields,
        )
    except SAPQuotaExceeded as exc:
        exc.partial = {"orders": exc.partial, "items": [], **stats}
        raise
    po_numbers = [po["PurchaseOrder"] for po in orders if po.get("PurchaseOrder")]
    try:
        items = fetch_purchase_order_items(
            client, po_numbers, item_top, page_size, chunk_size,
            selected_fields=selected_item_fields,
        )
    except SAPQuotaExceeded as exc:
        exc.partial = {"orders": orders, "items": exc.partial, **stats, "complete": False}
        raise
    return {"orders": orders, "items": items, **stats}
