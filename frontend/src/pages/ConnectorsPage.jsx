import { useState, useEffect } from "react";
import { Icons } from "../components/Icons";

export function ConnectorsPage({ connectors, loadingConnectors }) {
  const [selectedConnector, setSelectedConnector] = useState(null);

  // Close modal on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setSelectedConnector(null);
      }
    }
    if (selectedConnector) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedConnector]);

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">SAP S/4HANA Connectors</h2>
        <p className="page-description">
          Independent connector modules managing OData V2/V4 calls, pagination, batching, and quota resilience.
        </p>
      </div>

      {loadingConnectors ? (
        <div className="empty-box">
          <div className="spinner" />
          <span>Loading connector definitions...</span>
        </div>
      ) : (
        <div className="connector-card-grid">
          {connectors.map((c) => (
            <div key={c.id} className="connector-card">
              {/* Card Top: Icon, Title & Status */}
              <div className="connector-header">
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div className="metric-icon-box blue" style={{ width: "34px", height: "34px", minWidth: "34px" }}>
                    <Icons.Connectors />
                  </div>
                  <div>
                    <span className="connector-title">{c.name}</span>
                    <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                      <span className="tag-badge blue">{c.protocol}</span>
                      <span className="tag-badge">{c.format}</span>
                    </div>
                  </div>
                </div>
                <span className="tag-badge" style={{ background: "#dcfce7", color: "#166534", fontWeight: 700 }}>
                  ACTIVE
                </span>
              </div>

              {/* Brief Purpose Description (Clean & Readable) */}
              <p className="connector-desc">
                {c.data_fetched || c.description}
              </p>

              
              {/* Action Button: Know More */}
              <div className="connector-card-footer">
                <button
                  className="btn btn-secondary connector-know-more-btn"
                  onClick={() => setSelectedConnector(c)}
                  title={`View architecture and capabilities of ${c.name}`}
                >
                  <Icons.Info />
                  <span>Know More</span>
                  <Icons.ArrowRight />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Connector Details Modal ("Know More") */}
      {selectedConnector && (
        <div className="modal-backdrop" onClick={() => setSelectedConnector(null)}>
          <div
            className="modal-container"
            style={{ maxWidth: "680px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className="metric-icon-box blue" style={{ width: "36px", height: "36px" }}>
                  <Icons.Connectors />
                </div>
                <div>
                  <h3 style={{ fontSize: "17px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                    {selectedConnector.name}
                  </h3>
                  <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                    <span className="tag-badge blue">{selectedConnector.protocol}</span>
                    <span className="tag-badge">{selectedConnector.format}</span>
                    <span className="tag-badge" style={{ background: "#dcfce7", color: "#166534" }}>
                      ACTIVE
                    </span>
                  </div>
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setSelectedConnector(null)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Overview Section */}
              <div className="connector-modal-section">
                <div className="connector-modal-section-title">Overview &amp; Purpose</div>
                <p style={{ fontSize: "13.5px", color: "#334155", lineHeight: 1.6, margin: 0 }}>
                  {selectedConnector.description}
                </p>
              </div>


              {/* Resilience & Key Capabilities */}
              <div className="connector-modal-section">
                <div className="connector-modal-section-title">
                  Key Capabilities &amp; Resilience Policies
                </div>
                <div className="connector-capabilities-grid">
                  {selectedConnector.capabilities?.map((cap, i) => (
                    <div key={i} className="connector-capability-row">
                      <span className="connector-cap-check">
                        <Icons.Check />
                      </span>
                      <span className="connector-cap-text">{cap}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="modal-footer" style={{ justifyContent: "flex-end" }}>
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedConnector(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
