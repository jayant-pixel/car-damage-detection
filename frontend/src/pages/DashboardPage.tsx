import React from "react";
import { Inspection } from "../lib/types";
import { PageHeader, Metric, EmptyState } from "../components/common";
import { formatDate } from "../lib/utils";

export interface DashboardPageProps {
  dashboardData?: {
    inspections: Inspection[];
    stats: {
      totalCount: number;
      doneCount: number;
      analyzingCount: number;
      failedCount: number;
      totalDamages: number;
    };
  };
  onNew: () => void;
  onOpen: (inspectionId: string) => void;
  onDelete: (inspectionId: string, event: React.MouseEvent) => void;
}

export function DashboardPage({
  dashboardData,
  onNew,
  onOpen,
  onDelete
}: DashboardPageProps) {
  const inspections = dashboardData?.inspections || [];
  const stats = dashboardData?.stats || {
    totalCount: 0,
    doneCount: 0,
    analyzingCount: 0,
    failedCount: 0,
    totalDamages: 0
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Dashboard"
        title="Claim Audits Overview"
        action={
          <button className="primary-action" onClick={onNew}>
            New Session
          </button>
        }
      />

      <div className="metric-row">
        <Metric label="Total Sessions" value={stats.totalCount} />
        <Metric label="Done / Audited" value={stats.doneCount} tone="success" />
        <Metric label="Analyzing" value={stats.analyzingCount} tone="warning" />
        <Metric label="Failed Runs" value={stats.failedCount} tone="danger" />
        <Metric label="Total Damages Found" value={stats.totalDamages} tone={stats.totalDamages > 0 ? "warning" : ""} />
      </div>

      <section className="surface recent-inspections-section">
        <div className="surface-title">
          <h2>Recent Audit Sessions</h2>
          <span>{inspections.length} total</span>
        </div>

        {inspections.length === 0 ? (
          <EmptyState
            title="No audit sessions found"
            text="Get started by creating a vehicle inspection session and uploading damage evidence photos."
            action={
              <button className="primary-action" onClick={onNew}>
                Start New Session
              </button>
            }
          />
        ) : (
          <div className="session-table">
            <div className="session-row head">
              <span>Customer</span>
              <span>Vehicle Plate</span>
              <span>Model</span>
              <span>Images</span>
              <span>Damages</span>
              <span>Status</span>
              <span>Created At</span>
              <span>Actions</span>
            </div>
            
            {inspections.map((item) => (
              <div
                className="session-row"
                key={item._id}
                onClick={() => onOpen(item._id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onOpen(item._id);
                  }
                }}
              >
                <span className="customer-cell">{item.customerName}</span>
                <span className="plate-cell">{item.vehicleNumber}</span>
                <span>{item.carModel}</span>
                <span>{item.totalImages}/20</span>
                <span>{item.totalDamageCount}</span>
                <span>
                  <span className={`status-pill ${item.status}`}>
                    {item.status}
                  </span>
                </span>
                <span>{formatDate(item.createdAt)}</span>
                <span className="actions-cell">
                  <button
                    className="delete-row-btn"
                    onClick={(e) => onDelete(item._id, e)}
                    aria-label="Delete session"
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
