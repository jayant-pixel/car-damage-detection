import React from "react";
import logoUrl from "../assets/surens-infotek-logo.png";

export interface SidebarProps {
  currentPage: string;
  onPageChange: (page: any) => void;
  onNewInspection: () => void;
  profileName: string;
  onLogout: () => void;
}

export function Sidebar({
  currentPage,
  onPageChange,
  onNewInspection,
  profileName,
  onLogout
}: SidebarProps) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <img src={logoUrl} alt="Surensinfotek Logo" />
        <div>
          <strong>AutoVision</strong>
          <span>by Surensinfotek</span>
        </div>
      </div>
      
      <nav className="page-nav">
        <button
          className={currentPage === "dashboard" ? "active" : ""}
          onClick={() => onPageChange("dashboard")}
        >
          <span>⌘</span>
          <b>Dashboard</b>
        </button>
        <button
          className="emphasis"
          onClick={onNewInspection}
        >
          <span>⊕</span>
          <b>New Session</b>
        </button>
        <button
          className={currentPage === "reports" ? "active" : ""}
          onClick={() => onPageChange("reports")}
        >
          <span>▥</span>
          <b>Reports</b>
        </button>
      </nav>
      
      <div className="profile-block">
        <div>
          <strong>{profileName}</strong>
        </div>
        <button onClick={onLogout}>
          <span>↪</span> Sign out
        </button>
        <small>© 2026 Surensinfotek</small>
      </div>
    </aside>
  );
}
