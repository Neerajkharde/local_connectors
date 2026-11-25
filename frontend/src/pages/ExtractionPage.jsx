import { useState } from "react";
import { Icons } from "../components/Icons";
import { escapeCSV } from "../utils/formatters";

// Mandatory fields per entity that cannot be omitted in OData $select
const MANDATORY_COLS = {
  supplier: ["supplier", "creation_date", "last_change_date_time"],
  purchase_order: ["purchase_order", "supplier", "creation_date", "last_change_date_time"],
  purchase_order_item: ["purchase_order", "purchase_order_item"],
  supplier_invoice: ["supplier_invoice", "fiscal_year", "supplier", "purchase_order"],
  invoice_po_reference: ["supplier_invoice", "fiscal_year", "purchase_order", "purchase_order_item", "supplier_invoice_item"],
};

export function ExtractionPage({
  entities,
  selectedEntity,
  onSelectEntity,
  fields,
  records,
  onTriggerExtraction,
  extracting,
  extractionTask,
  onShowAlert,
}) {
  const [fullRefresh, setFullRefresh] = useState(false);
  const [extractionMode, setExtractionMode] = useState("all"); // "all" | "selective"
  const [selectedFields, setSelectedFields] = useState([]);
  const [fieldSearch, setFieldSearch] = useState("");

  const mandatoryForCurrent = MANDATORY_COLS[selectedEntity] || [];

  const filteredFields = fields.filter(
    (f) =>
      f.name.toLowerCase().includes(fieldSearch.toLowerCase()) ||
      (f.description && f.description.toLowerCase().includes(fieldSearch.toLowerCase()))
  );

  function isMandatory(fieldName) {
    return mandatoryForCurrent.includes(fieldName);
  }

  function toggleField(fieldName) {
    if (isMandatory(fieldName)) return; // Locked
    setSelectedFields((prev) =>
      prev.includes(fieldName) ? prev.filter((n) => n !== fieldName) : [...prev, fieldName]
    );
  }

  function selectAllFields() {
    setSelectedFields(fields.map((f) => f.name));
  }

  function selectKeysOnly() {
    const keys = fields
      .filter((f) => f.primary_key || f.foreign_key || isMandatory(f.name))
      .map((f) => f.name);
    setSelectedFields(keys);
  }

  function resetFields() {
    setSelectedFields(mandatoryForCurrent);
  }

  // Handle entity change
  function handleEntityChange(entityName) {
    onSelectEntity(entityName);
    const mandatory = MANDATORY_COLS[entityName] || [];
    setSelectedFields(mandatory);
  }

  // Run Extraction (either Full or Selective with $select)
  function handleRunSync() {
    let payload = null;
    if (extractionMode === "selective") {
      if (!selectedEntity) {
        onShowAlert("error", "Please choose an entity to configure selective $select fields.");
        return;
      }
      // Combine mandatory fields with user-selected fields
      const effectiveFields = Array.from(new Set([...mandatoryForCurrent, ...selectedFields]));
      payload = { [selectedEntity]: effectiveFields };
      onShowAlert(
        "success",
        `Triggering sync with OData $select: requesting ${effectiveFields.length} attributes for ${selectedEntity}.`
      );
    }
    onTriggerExtraction(fullRefresh, payload);
  }

  // CSV Export
  function handleExportCSV() {
    if (!selectedEntity) {
      onShowAlert("error", "Please choose an entity first.");
      return;
    }
    if (selectedFields.length === 0) {
      onShowAlert("error", "Please select at least one field to export.");
      return;
    }

    const header = selectedFields.map(escapeCSV).join(",");
    const rows = records.map((row) =>
      selectedFields.map((f) => escapeCSV(row[f])).join(",")
    );

    const csvContent = "\uFEFF" + [header, ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedEntity}_export.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    onShowAlert("success", `${records.length} records exported to ${selectedEntity}_export.csv`);
  }

  return (
    <div>
      {/* Live SAP Pipeline Runner */}
      <div className="sync-panel-card">
        <div className="sync-panel-header">
          <div>
            <h3 className="card-section-title">SAP S/4HANA Extraction Pipeline</h3>
            <p className="card-section-subtitle">
              Executes the extraction workflow with checkpoint commits. Supports full schema or selective field projection ($select).
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "14px", marginBottom: "16px", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
            <input
              type="radio"
              name="extractionMode"
              checked={extractionMode === "all"}
              onChange={() => setExtractionMode("all")}
              style={{ accentColor: "#0284c7" }}
            />
            <span><strong>Full Schema Extraction</strong> (fetch all known SAP fields)</span>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
            <input
              type="radio"
              name="extractionMode"
              checked={extractionMode === "selective"}
              onChange={() => setExtractionMode("selective")}
              style={{ accentColor: "#0284c7" }}
            />
            <span><strong>Selective Field Extraction</strong> (uses OData <code>$select</code> to save bandwidth & quota)</span>
          </label>
        </div>

        <div className="sync-actions-row">
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={fullRefresh}
              onChange={(e) => setFullRefresh(e.target.checked)}
              style={{ accentColor: "#0284c7" }}
            />
            <span>Full Refresh (ignore saved incremental watermarks)</span>
          </label>

          <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
            <button
              className="btn btn-primary"
              onClick={handleRunSync}
              disabled={extracting}
            >
              {extracting ? <div className="spinner" /> : <Icons.Extract />}
              <span>
                {extracting
                  ? "Extraction in Progress..."
                  : extractionMode === "selective"
                  ? "Trigger Sync ($select)"
                  : "Trigger Sync"}
              </span>
            </button>
          </div>
        </div>

        {extractionMode === "selective" && selectedEntity && (
          <div style={{ marginTop: "12px", fontSize: "12.5px", color: "#0369a1", background: "#f0f9ff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #bae6fd" }}>
            💡 <strong>Selective Mode Active:</strong> SAP will only be asked to return the {selectedFields.length} checked fields for <code>{selectedEntity}</code>.
          </div>
        )}

        {extractionTask && (
          <div className="progress-banner">
            <div className="spinner" />
            <span>{extractionTask.message}</span>
          </div>
        )}
      </div>

      {/* Field Selection & CSV Export */}
      <div className="card-section">
        <div className="card-section-header">
          <div>
            <h3 className="card-section-title">
              {extractionMode === "selective" ? "Configure Selective Fields ($select)" : "Column Selection & CSV Export"}
            </h3>
            <p className="card-section-subtitle">
              {extractionMode === "selective"
                ? "Choose the exact fields to request from SAP S/4HANA via OData $select."
                : "Select specific entity fields to preview and download as CSV from PostgreSQL."}
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <select
              value={selectedEntity}
              onChange={(e) => handleEntityChange(e.target.value)}
              style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
            >
              <option value="">-- Choose Entity --</option>
              {entities.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.label} ({e.name})
                </option>
              ))}
            </select>

            <button
              className="btn btn-secondary btn-sm"
              onClick={handleExportCSV}
              disabled={!selectedEntity || selectedFields.length === 0}
            >
              <Icons.Extract />
              <span>Download CSV</span>
            </button>
          </div>
        </div>

        {!selectedEntity ? (
          <div className="empty-box">
            <p>Please select an entity from the dropdown above to inspect or configure its fields.</p>
          </div>
        ) : (
          <div style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
              <div className="search-input-wrapper" style={{ width: "240px" }}>
                <span className="search-icon-svg"><Icons.Search /></span>
                <input
                  className="search-box"
                  type="text"
                  placeholder="Search fields..."
                  value={fieldSearch}
                  onChange={(e) => setFieldSearch(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn btn-secondary btn-sm" onClick={selectAllFields}>
                  Select All
                </button>
                <button className="btn btn-secondary btn-sm" onClick={selectKeysOnly}>
                  Keys Only
                </button>
                <button className="btn btn-secondary btn-sm" onClick={resetFields}>
                  Reset to Required
                </button>
              </div>
            </div>

            <div className="field-grid-list">
              {filteredFields.map((f) => {
                const required = isMandatory(f.name);
                const checked = selectedFields.includes(f.name) || required;

                return (
                  <label
                    key={f.name}
                    className="field-checkbox-item"
                    style={{
                      backgroundColor: required ? "#f8fafc" : "#ffffff",
                      cursor: required ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={required}
                      onChange={() => toggleField(f.name)}
                    />
                    <span style={{ fontWeight: required ? 600 : 500, color: required ? "#0369a1" : "inherit" }}>
                      {f.name}
                    </span>
                    {required ? (
                      <span className="pill-key pk" style={{ marginLeft: "auto", fontSize: "10px" }}>
                        Required
                      </span>
                    ) : f.foreign_key ? (
                      <span className="pill-key fk" style={{ marginLeft: "auto", fontSize: "10px" }}>
                        FK
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>

            <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "16px" }}>
              Selected <strong>{selectedFields.length}</strong> of <strong>{fields.length}</strong> columns for <code>{selectedEntity}</code>
            </div>

            {/* Data Preview */}
            <div className="card-section-title" style={{ fontSize: "14px", marginBottom: "8px" }}>
              Current PostgreSQL Data Preview ({records.length} records)
            </div>
            {records.length === 0 ? (
              <div className="empty-box" style={{ padding: "24px" }}>
                No records currently stored in this table. You can trigger the extraction above.
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {selectedFields.map((f) => (
                        <th key={f}>{f}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        {selectedFields.map((f) => (
                          <td key={f}>
                            {r[f] === null || r[f] === undefined ? "—" : String(r[f])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
