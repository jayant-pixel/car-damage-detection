import React from "react";
import { Inspection } from "../lib/types";
import { PageHeader, RiskPill, EmptyState } from "../components/common";
import { formatDate } from "../lib/utils";

export interface ReportsPageProps {
  inspections: Inspection[];
  onOpenSession: (inspectionId: string) => void;
}

export function ReportsPage({
  inspections,
  onOpenSession
}: ReportsPageProps) {
  const completedInspections = inspections.filter((i) => i.status === "done");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Reports"
        title="Vehicle Evidence Audit Reports"
      />

      <section className="surface reports-list-section">
        <div className="surface-title">
          <h2>Report Library</h2>
          <span>{completedInspections.length} ready</span>
        </div>

        {completedInspections.length === 0 ? (
          <EmptyState
            title="No reports ready"
            text="Completed vehicle audits will appear here. Go back to Dashboard or create a new session, upload photos, and run the analysis."
          />
        ) : (
          <div className="report-list">
            {completedInspections.map((item) => {
              // Determine overall risk
              const hasFail = item.totalDamageCount > 5;
              const overallRiskLevel = hasFail ? "high" : item.totalDamageCount > 2 ? "medium" : "low";
              const riskScore = item.totalDamageCount * 15;

              return (
                <div
                  className="report-card"
                  key={item._id}
                  onClick={() => onOpenSession(item._id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      onOpenSession(item._id);
                    }
                  }}
                >
                  <div className="report-card-details">
                    <strong>{item.customerName}</strong>
                    <span>
                      {item.carModel} · {item.totalImages} images · {formatDate(item.completedAt || item.createdAt)}
                    </span>
                  </div>
                  
                  <div className="report-card-plate">
                    <span>{item.vehicleNumber}</span>
                  </div>

                  <div className="report-card-risk">
                    <RiskPill level={overallRiskLevel} score={riskScore} />
                  </div>

                  <span className="report-open-indicator">Open Results →</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
