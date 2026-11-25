# Selective Field Extraction (OData `$select` Integration)

## 1. Overview & Objective

By default, the SAP S/4HANA connector extracts all known attributes for each entity. While comprehensive, this consumes unnecessary network bandwidth and SAP sandbox API quota when users only care about specific fields (e.g., Supplier Name and Tax Number, or PO Net Amount).

This specification describes how **Selective Field Extraction** works end-to-end:
1. The user selects specific columns for each entity in the web dashboard.
2. The UI sends this selection (`selected_fields`) to the backend API (`POST /api/extract`).
3. The connector translates field names into SAP OData PascalCase properties and appends `$select` to SAP HTTP queries.
4. Essential system fields (Primary Keys, Foreign Keys, Watermarks) are automatically preserved behind the scenes so database integrity and incremental cursor advancement never break.
5. In PostgreSQL, omitted columns remain `NULL` for new rows, and existing data is preserved via `COALESCE` in `UPSERT` queries.

---

## 2. System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   React Web Dashboard                  │
│  - User selects entities & specific optional columns   │
│  - System fields (PKs, FKs, watermarks) locked & badge │
└───────────────────────────┬────────────────────────────┘
                            │ POST /api/extract
                            │ { entities: [...], selected_fields: { ... } }
                            ▼
┌────────────────────────────────────────────────────────┐
│                   FastAPI Backend                      │
│  - Validates requested entities & columns              │
│  - Injects mandatory keys & cursor fields per entity   │
│  - Spawns background pipeline runner                   │
└───────────────────────────┬────────────────────────────┘
                            │ app.main.run(selected_fields=...)
                            ▼
┌────────────────────────────────────────────────────────┐
│              Python Connector Pipeline                 │
│  - Converts snake_case DB columns to SAP PascalCase   │
│  - Constructs OData queries with $select parameters    │
│  - Preserves navigation properties for OData V2 $expand│
└───────────────┬────────────────────────┬───────────────┘
                │ OData GET with $select │
                ▼                        ▼
┌───────────────────────────┐    ┌──────────────────────────────────┐
│  SAP S/4HANA OData APIs   │    │      PostgreSQL Relational DB     │
│  - A_Supplier (V2)        │    │  - INSERT ... ON CONFLICT        │
│  - PurchaseOrder (V4)     │    │  - SET c = COALESCE(EXCLUDED.c,  │
│  - A_SupplierInvoice (V2) │    │            table.c)              │
│  Returns stripped payload │    │  - Preserves previously saved data│
└───────────────────────────┘    └──────────────────────────────────┘
```

---

## 3. Mandatory System Fields (The "Golden Rules")

Even if a user unchecks all optional fields, the backend **must always fetch mandatory system fields**:

| Entity / Table | Mandatory Columns | Why Required |
|---|---|---|
| `supplier` | `supplier`, `creation_date`, `last_change_date_time` | PK identifier and Keyset incremental watermark |
| `supplier_company` | `supplier`, `company_code` | Composite PK and FK to parent `supplier` |
| `supplier_purchasing_org` | `supplier`, `purchasing_organization` | Composite PK and FK to parent `supplier` |
| `supplier_text` | `supplier`, `language`, `text_type` | Composite PK and FK to parent `supplier` |
| `purchase_order` | `purchase_order`, `supplier`, `last_change_date_time`, `creation_date` | PK, FK link to `supplier`, and PO batch cursor |
| `purchase_order_item` | `purchase_order`, `purchase_order_item` | Composite PK and FK to parent `purchase_order` |
| `supplier_invoice` | `supplier_invoice`, `fiscal_year`, `purchase_order`, `supplier` | Composite PK, FK to `purchase_order` and `supplier` |
| `invoice_po_reference` | `supplier_invoice`, `fiscal_year`, `purchase_order`, `purchase_order_item`, `supplier_invoice_item` | Composite PK and FK to both invoice and PO line item |

---

## 4. OData Protocol Nuances

### OData V4 (JSON) — `PurchaseOrder` & `PurchaseOrderItem`
- Straightforward `$select` projection:
  ```http
  GET /PurchaseOrder?$select=PurchaseOrder,Supplier,CreationDate,LastChangeDateTime,PurchaseOrderType
  GET /PurchaseOrderItem?$select=PurchaseOrder,PurchaseOrderItem,NetPriceAmount,DocumentCurrency
  ```

### OData V2 (XML/Atom) — `A_Supplier` with `$expand`
- When `$expand=to_SupplierCompany,to_SupplierPurchasingOrg,to_SupplierText` is used, SAP requires that the navigation property names themselves are included in `$select`:
  ```http
  GET /A_Supplier?$select=Supplier,SupplierName,CreationDate,to_SupplierCompany,to_SupplierPurchasingOrg,to_SupplierText&$expand=to_SupplierCompany,...
  ```
- Sub-entity collections inherit their own field filtering during mapping.

### OData V2 (XML/Atom) — `A_SupplierInvoice` & `A_SuplrInvcItemPurOrdRef`
- When querying invoice headers and references, `$select` includes the composite keys and the user-selected amount/date fields:
  ```http
  GET /A_SupplierInvoice?$select=SupplierInvoice,FiscalYear,Supplier,PurchaseOrder,InvoiceGrossAmount,PostingDate
  ```

---

## 5. PostgreSQL Upsert Preservation (`COALESCE`)

When updating records in PostgreSQL, selective extractions must not overwrite existing data with `NULL`:

```sql
INSERT INTO supplier (supplier, supplier_name, authorization_group, ...)
VALUES (%(supplier)s, %(supplier_name)s, %(authorization_group)s, ...)
ON CONFLICT (supplier) DO UPDATE SET
    supplier_name = COALESCE(EXCLUDED.supplier_name, supplier.supplier_name),
    authorization_group = COALESCE(EXCLUDED.authorization_group, supplier.authorization_group),
    last_change_date_time = COALESCE(EXCLUDED.last_change_date_time, supplier.last_change_date_time)
WHERE (supplier.supplier_name, ...) IS DISTINCT FROM (EXCLUDED.supplier_name, ...);
```

- If `EXCLUDED.supplier_name` is non-null (because the user selected it), it updates the column.
- If `EXCLUDED.supplier_name` is `NULL` (because it wasn't extracted in this run), `COALESCE` keeps the existing database value.

---

## 6. Implementation Changes

### Backend Changes:
1. **`app/mapping/mappers.py`**:
   - Define reverse property lookup dictionaries mapping database `snake_case` column names to SAP `PascalCase` OData properties.
2. **`app/connectors/*`**:
   - Add optional `selected_fields: Optional[list[str]] = None` argument to:
     - `fetch_all_suppliers_with_related`
     - `fetch_all_pos_with_items` and `fetch_po_batch`
     - `fetch_all_invoices_and_refs`
   - Build `$select` query parameter by merging mandatory system fields with requested fields.
3. **`app/main.py`**:
   - Accept `selected_fields: Optional[dict[str, list[str]]] = None` in `run()`.
4. **`api.py`**:
   - Pass `req.selected_fields` to `_run_extraction()` and into `app.main.run()`.
5. **`app/repositories/repositories.py`**:
   - Update `_upsert()` to use `COALESCE(EXCLUDED.{col}, {table}.{col})` for non-conflict columns so partial loads never erase prior data.

### Frontend Changes:
1. **`frontend/src/pages/ExtractionPage.jsx`**:
   - Provide an entity selector tab (Supplier, PO, Invoice).
   - Display checkboxes for all fields, clearly badge **"PK · Required"** or **"Locked System Field"**.
   - Send `selected_fields: { [entity]: [fields] }` when triggering the extraction.
   - Display a visual summary of the fields being sent to the SAP `$select` query.
