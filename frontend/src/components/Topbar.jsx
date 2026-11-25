import { Icons } from "./Icons";

export function Topbar({ activeTab, health, onSyncClick }) {
  const tabTitles = {
    overview: "System Overview",
    explore: "Database Explorer",
    extract: "Data Extraction & Pipeline",
    connectors: "Active Connectors",
    history: "Extraction History & Watermarks",
    lineage: "End-to-End Data Lineage",
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="breadcrumbs">
          <span className="breadcrumb-root">Enable</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{tabTitles[activeTab] || activeTab}</span>
        </div>
      </div>

    </header>
  );
}
