import React from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import logoUrl from "../assets/surens-infotek-logo.png";
import { DamageCard } from "../components/DamageCard";
import { EmptyState, Metric, RiskPill } from "../components/common";
import { PartCoverage } from "../lib/types";
import { formatDate, labelize } from "../lib/utils";

export interface ReportPrintPageProps {
  inspectionId: string;
  onBack: () => void;
}

export function ReportPrintPage({ inspectionId, onBack }: ReportPrintPageProps) {
  const inspection = useQuery(api.inspections.getInspection, { inspectionId: inspectionId as any });
  const results = useQuery(api.results.getInspectionResults, { inspectionId: inspectionId as any });

  if (!inspection || !results) {
    return (
      <div className="print-report-page">
        <div className="empty-workspace">
          <h2>Preparing report...</h2>
        </div>
      </div>
    );
  }

  const damages = results.damages || [];
  const integrityChecks = results.integrityChecks || [];
  const partCoverage = results.partCoverage || [];
  const vehicleCheck = integrityChecks.find((c: any) => c.checkType === "vehicle_consistency");
  const authenticityCheck = integrityChecks.find((c: any) => c.checkType === "image_authenticity");
  const hasFail = integrityChecks.some((c: any) => c.status === "fail") || damages.some((d: any) => d.severity === "severe");
  const overallRiskLevel = hasFail ? "high" : damages.length > 3 ? "medium" : "low";
  const riskScore = hasFail ? 95 : damages.length * 15;
  const totalPartTargets = partCoverage.reduce((count: number, item: PartCoverage) => count + item.mappedParts.length, 0);

  return (
    <div className="print-report-page">
      <div className="print-actions results-actions">
        <button className="secondary-action" onClick={onBack}>Back to Results</button>
        <button className="primary-action" onClick={() => window.print()}>Download PDF</button>
      </div>

      <section className="print-report-header surface">
        <div className="branded-header">
          <img src={logoUrl} alt="Surensinfotek Logo" className="results-brand-logo" />
          <div className="header-meta">
            <span className="eyebrow">Surensinfotek Vehicle Claim Audit</span>
            <h1>Vehicle Claim Audit Report</h1>
            <p className="report-subtitle">Printable vehicle evidence, part coverage, anomaly analysis, and integrity summary.</p>
          </div>
        </div>

        <div className="report-info-grid">
          <div className="info-item">
            <span>Customer Name</span>
            <strong>{inspection.customerName}</strong>
          </div>
          <div className="info-item">
            <span>Vehicle Plate</span>
            <strong>{inspection.vehicleNumber}</strong>
          </div>
          <div className="info-item">
            <span>Car Model</span>
            <strong>{inspection.carModel}</strong>
          </div>
          <div className="info-item">
            <span>Audit Date</span>
            <strong>{formatDate(inspection.completedAt || inspection.createdAt)}</strong>
          </div>
          <div className="info-item">
            <span>Overall Session Risk</span>
            <RiskPill level={overallRiskLevel} score={riskScore} />
          </div>
        </div>
      </section>

      <div className="results-metrics-row">
        <Metric label="Total Damages Found" value={damages.length} tone={damages.length > 0 ? "warning" : "success"} />
        <Metric label="Vehicle Consistency" value={vehicleCheck?.status ? vehicleCheck.status.toUpperCase() : "PASS"} />
        <Metric label="Image Authenticity" value={authenticityCheck?.status ? authenticityCheck.status.toUpperCase() : "PASS"} />
      </div>

      <section className="surface results-section">
        <h2>Integrity Verification</h2>
        <div className="integrity-cards-grid">
          <div className={`integrity-card ${vehicleCheck?.status || "pass"}`}>
            <div className="card-top">
              <strong>Same-Vehicle Panel Check</strong>
              <span className={`status-pill ${vehicleCheck?.status || "pass"}`}>{vehicleCheck?.status || "pass"}</span>
            </div>
            <p className="card-summary">{vehicleCheck?.summary || "Vehicle visual markers are consistent across uploaded images."}</p>
            {vehicleCheck?.details && (
              <div className="integrity-mismatch-flags">
                {vehicleCheck.details.brandMismatch && (
                  <span className="mismatch-badge danger">⚠ Brand Mismatch</span>
                )}
                {vehicleCheck.details.licensePlateMismatch && (
                  <span className="mismatch-badge danger">⚠ Plate Mismatch</span>
                )}
                {vehicleCheck.details.wheelMismatch && (
                  <span className="mismatch-badge warning">⚠ Wheel Mismatch</span>
                )}
                {vehicleCheck.details.colorMismatch && (
                  <span className="mismatch-badge warning">⚠ Color Mismatch</span>
                )}
                {!vehicleCheck.details.brandMismatch && !vehicleCheck.details.licensePlateMismatch && !vehicleCheck.details.wheelMismatch && !vehicleCheck.details.colorMismatch && (
                  <span className="mismatch-badge success">✓ All checks passed</span>
                )}
              </div>
            )}
          </div>
          <div className={`integrity-card ${authenticityCheck?.status || "pass"}`}>
            <div className="card-top">
              <strong>Image Structure Authenticity Check</strong>
              <span className={`status-pill ${authenticityCheck?.status || "pass"}`}>{authenticityCheck?.status || "pass"}</span>
            </div>
            <p className="card-summary">{authenticityCheck?.summary || "No obvious digital tampering signs were detected."}</p>
          </div>
        </div>
      </section>

      <section className="results-section">
        <h2>Identified Surface Damage Findings</h2>
        {damages.length === 0 ? (
          <EmptyState title="No surface defects detected" text="No scratches, dents, scuffs, or paint chips were confirmed." />
        ) : (
          <div className="damage-cards-stack">
            {damages.map((damage: any, index: number) => (
              <DamageCard key={damage._id} damage={damage} index={index} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PrintPartCoverageCard({ item }: { item: PartCoverage }) {
  const partNames = Array.from(
    new Set(
      item.mappedParts.flatMap((part) =>
        part.coveredParts.length > 0 ? part.coveredParts : [part.partName]
      )
    )
  );

  return (
    <article className="part-coverage-card">
      <header className="part-coverage-card-header">
        <div>
          <span className="eyebrow">{item.viewLabel}</span>
          <h3>{item.fileName}</h3>
        </div>
        <span className="coverage-count">{item.mappedParts.length} target{item.mappedParts.length === 1 ? "" : "s"}</span>
      </header>

      <div className="part-chip-list">
        {partNames.length === 0 ? (
          <span className="part-chip muted">No part target</span>
        ) : (
          partNames.map((part) => <span key={part} className="part-chip">{labelize(part)}</span>)
        )}
      </div>
    </article>
  );
}
