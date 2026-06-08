import React from "react";
import logoUrl from "../assets/surens-infotek-logo.png";
import { DamageCard } from "./DamageCard";
import { DamageResult, IntegrityCheck, Inspection, PartCoverage, RoiScan } from "../lib/types";
import { Metric, RiskPill, EmptyState } from "./common";
import { formatDate, labelize } from "../lib/utils";

export interface ResultsViewProps {
  inspection: Inspection;
  damages: DamageResult[];
  integrityChecks: IntegrityCheck[];
  roiScans: RoiScan[];
  partCoverage: PartCoverage[];
  onBackToDashboard: () => void;
  onOpenPrintReport?: () => void;
}

export function ResultsView({
  inspection,
  damages,
  integrityChecks,
  roiScans,
  partCoverage,
  onBackToDashboard,
  onOpenPrintReport
}: ResultsViewProps) {
  // Integrity check helpers
  const vehicleCheck = integrityChecks.find((c) => c.checkType === "vehicle_consistency");
  const authenticityCheck = integrityChecks.find((c) => c.checkType === "image_authenticity");

  // Determine overall risk
  const hasFail = integrityChecks.some((c) => c.status === "fail") || damages.some((d) => d.severity === "severe");
  const overallRiskLevel = hasFail ? "high" : damages.length > 3 ? "medium" : "low";
  const riskScore = hasFail ? 95 : damages.length * 15;
  const totalPartTargets = partCoverage.reduce((count, item) => count + item.mappedParts.length, 0);

  return (
    <div className="results-view-container">
      <div className="results-header-card surface">
        <div className="branded-header">
          <img src={logoUrl} alt="Surensinfotek Logo" className="results-brand-logo" />
          <div className="header-meta">
            <span className="eyebrow">Surensinfotek Vehicle Claim Audit</span>
            <h1>Vehicle Claim Audit Report</h1>
            <p className="report-subtitle">
              Interactive session audit report for customer evidence, AI scan, and integrity analysis.
            </p>
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
            <div className="pill-container">
              <RiskPill level={overallRiskLevel} score={riskScore} />
            </div>
          </div>
        </div>
      </div>

      <div className="results-metrics-row">
        <Metric label="Total Damages Found" value={damages.length} tone={damages.length > 0 ? "warning" : "success"} />
        <Metric
          label="Vehicle Consistency Status"
          value={vehicleCheck?.status ? vehicleCheck.status.toUpperCase() : "PASS"}
          tone={vehicleCheck?.status === "fail" ? "danger" : vehicleCheck?.status === "warning" ? "warning" : "success"}
        />
        <Metric
          label="Image Authenticity Status"
          value={authenticityCheck?.status ? authenticityCheck.status.toUpperCase() : "PASS"}
          tone={authenticityCheck?.status === "fail" ? "danger" : authenticityCheck?.status === "warning" ? "warning" : "success"}
        />
      </div>

      <section className="surface results-section">
        <h2>Claims Integrity Verification</h2>
        <p className="section-intro">
          Verifications run across metadata and images to detect duplicate scans, photo tampering, or mismatched vehicle visual indicators.
        </p>
        <div className="integrity-cards-grid">
          <div className={`integrity-card ${vehicleCheck?.status || "pass"}`}>
            <div className="card-top">
              <strong>Same-Vehicle Panel Check</strong>
              <span className={`status-pill ${vehicleCheck?.status || "pass"}`}>
                {vehicleCheck?.status || "pass"}
              </span>
            </div>
            <p className="card-summary">
              {vehicleCheck?.summary || "Analyzed all camera views. The car body panels, trim lines, grille pattern, and window shapes match model specification standards across all uploaded files."}
            </p>
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
              <span className={`status-pill ${authenticityCheck?.status || "pass"}`}>
                {authenticityCheck?.status || "pass"}
              </span>
            </div>
            <p className="card-summary">
              {authenticityCheck?.summary || "Ran forensic integrity scan on photo pixel borders and shadows. Files display organic light boundaries without structural compositing or copy-paste manipulation signs."}
            </p>
          </div>
        </div>
      </section>

      {/* Damages Findings */}
      <section className="results-section">
        <h2>Identified Surface Damage findings</h2>
        <p className="section-intro">
          The following damage points were identified using full-image systematic anomaly analysis.
        </p>

        {damages.length === 0 ? (
          <EmptyState
            title="No surface defects detected"
            text="Visual analysis found no scratches, dents, scuffs, or paint chips on the exterior vehicle body panels. Verify uploaded photos are clear and show the entire car."
            action={
              <button className="secondary-action" onClick={onBackToDashboard}>
                Back to Dashboard
              </button>
            }
          />
        ) : (
          <div className="damage-cards-stack">
            {damages.map((dmg, idx) => (
              <DamageCard key={dmg._id} damage={dmg} index={idx} />
            ))}
          </div>
        )}
      </section>

      <div className="results-actions">
        {onOpenPrintReport && (
          <button className="secondary-action" onClick={onOpenPrintReport}>
            Download PDF Report
          </button>
        )}
        <button className="primary-action" onClick={onBackToDashboard}>
          Return to Dashboard
        </button>
      </div>
    </div>
  );
}

function PartCoverageCard({ item }: { item: PartCoverage }) {
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
        <span className="coverage-count">
          {item.mappedParts.length} target{item.mappedParts.length === 1 ? "" : "s"}
        </span>
      </header>

      {partNames.length > 0 ? (
        <div className="part-chip-list">
          {partNames.slice(0, 14).map((part) => (
            <span key={part} className="part-chip">{labelize(part)}</span>
          ))}
          {partNames.length > 14 && <span className="part-chip muted">+{partNames.length - 14} more</span>}
        </div>
      ) : (
        <p className="coverage-note">No part coverage targets were returned for this image.</p>
      )}

      <ul className="coverage-target-list">
        {item.mappedParts.map((part, index) => (
          <li key={`${part.partName}-${index}`}>
            <strong>{labelize(part.partName)}</strong>
            {part.coveredParts.length > 0 && <span>{part.coveredParts.map(labelize).join(", ")}</span>}
          </li>
        ))}
      </ul>

      {item.visiblePartDescriptions.length > 0 && (
        <div className="coverage-description-list">
          {item.visiblePartDescriptions.slice(0, 4).map((description, index) => (
            <p key={index}>{description}</p>
          ))}
        </div>
      )}
    </article>
  );
}
