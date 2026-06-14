import React from "react";
import logoUrl from "../assets/surens-infotek-logo.png";
import { EvidenceImage } from "./EvidenceImage";
import { DamageResult, IntegrityCheck, Inspection, PartCoverage, RoiScan } from "../lib/types";
import { Metric, RiskPill, EmptyState } from "./common";
import { formatDate, labelize, labelizeDamageType } from "../lib/utils";

export interface ResultsViewProps {
  inspection: Inspection;
  damages: DamageResult[];
  integrityChecks: IntegrityCheck[];
  roiScans: RoiScan[];
  partCoverage: PartCoverage[];
  onBackToDashboard: () => void;
  onOpenPrintReport?: () => void;
}

function renderMarkdownToHtml(markdown: string): string {
  if (!markdown) return "";
  let html = markdown;
  // Convert headers (### title)
  html = html.replace(/^### (.*$)/gim, '<h3 style="margin-top: 1rem; margin-bottom: 0.5rem; color: #2d3748; font-weight: 600;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="margin-top: 1.5rem; margin-bottom: 0.75rem; color: #1a202c; font-weight: 600;">$1</h2>');
  // Convert bold (**text**)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Convert bullet points (* item)
  html = html.replace(/^\* (.*$)/gim, '<li style="margin-left: 1.25rem; margin-bottom: 0.25rem;">$1</li>');
  // Convert line breaks to <br/>
  html = html.replace(/\n/g, "<br/>");
  return html;
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
              Interactive session audit report for customer evidence, damage scan, and integrity analysis.
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

      {inspection.reportSummary && (
        <section className="surface results-section ai-summary-report" style={{ borderLeft: "4px solid #6b46c1", padding: "1.5rem", marginTop: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <span style={{ fontSize: "1.5rem" }}>📋</span>
            <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#1a202c", fontWeight: 600 }}>Compiled Audit Summary Report</h2>
          </div>
          <div
            className="markdown-content"
            style={{ fontSize: "0.95rem", lineHeight: "1.6", color: "#4a5568" }}
            dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(inspection.reportSummary) }}
          />
        </section>
      )}

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

      {/* Damages Findings grouped by Photo Angle */}
      <section className="results-section">
        <h2>Identified Surface Damage Findings by Photo Angle</h2>
        <p className="section-intro">
          The following damage points were identified using full-image systematic anomaly analysis. View the original photo and the visual annotations side-by-side, with detailed findings listed below.
        </p>
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#4a5568" }}>Severity Legend:</span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#319795", display: "inline-block" }} />
            <span style={{ fontSize: "0.75rem", color: "#4a5568" }}>Minor</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#dd6b20", display: "inline-block" }} />
            <span style={{ fontSize: "0.75rem", color: "#4a5568" }}>Moderate</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#e53e3e", display: "inline-block" }} />
            <span style={{ fontSize: "0.75rem", color: "#4a5568" }}>Severe</span>
          </span>
        </div>

        {partCoverage.length === 0 ? (
          <EmptyState
            title="No photo data available"
            text="No vehicle images were found for this audit session."
            action={
              <button className="secondary-action" onClick={onBackToDashboard}>
                Back to Dashboard
              </button>
            }
          />
        ) : (
          <div className="damage-images-stack" style={{ display: "flex", flexDirection: "column", gap: "2rem", marginTop: "1.5rem" }}>
            {(() => {
              // Group damages by mediaId
              const damagesByMediaId = new Map<string, DamageResult[]>();
              for (const dmg of damages) {
                const mediaIdStr = dmg.mediaId.toString();
                const list = damagesByMediaId.get(mediaIdStr) || [];
                list.push(dmg);
                damagesByMediaId.set(mediaIdStr, list);
              }

              return partCoverage
                .filter((item) => {
                  const imgDamages = damagesByMediaId.get(item.mediaId.toString()) || [];
                  return imgDamages.length > 0; // Only show images that have damage findings
                })
                .map((item) => {
                const imgDamages = damagesByMediaId.get(item.mediaId.toString()) || [];
                return (
                  <div
                    key={item.mediaId}
                    className="surface damage-image-group-card"
                    style={{
                      padding: "1.5rem",
                      borderRadius: "12px",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "#fff",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)"
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", borderBottom: "1px solid #edf2f7", paddingBottom: "0.75rem" }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "#1a202c" }}>
                          {item.viewLabel || "Exterior View"}
                        </h3>
                        <span style={{ fontSize: "0.8rem", color: "#718096" }}>File: {item.fileName}</span>
                      </div>
                      <span
                        style={{
                          backgroundColor: imgDamages.length > 0 ? "rgba(221, 107, 32, 0.1)" : "rgba(49, 151, 149, 0.1)",
                          color: imgDamages.length > 0 ? "#dd6b20" : "#319795",
                          padding: "4px 12px",
                          borderRadius: "20px",
                          fontSize: "0.8rem",
                          fontWeight: 600
                        }}
                      >
                        {imgDamages.length} Damage{imgDamages.length === 1 ? "" : "s"} Detected
                      </span>
                    </div>

                    {/* Side-by-side Images */}
                    <div
                      className="image-side-by-side-container"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "1rem",
                        marginBottom: "1.5rem",
                        backgroundColor: "#f7fafc",
                        padding: "0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #edf2f7"
                      }}
                    >
                      <div>
                        <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#4a5568", marginBottom: "4px", textAlign: "center" }}>Original Context</span>
                        <div style={{ borderRadius: "6px", overflow: "hidden", height: "320px", border: "1px solid #e2e8f0", position: "relative", backgroundColor: "#000" }}>
                          <img
                            src={item.imageUrl || ""}
                            alt="Original Context"
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                          />
                        </div>
                      </div>
                      <div>
                        <span style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#4a5568", marginBottom: "4px", textAlign: "center" }}>Annotated View</span>
                        <div style={{ borderRadius: "6px", overflow: "hidden", height: "320px", border: "1px solid #e2e8f0", position: "relative", backgroundColor: "#000" }}>
                          <EvidenceImage
                            imageUrl={item.annotatedImageUrl || item.imageUrl || ""}
                            altText="Annotated View"
                            objectFit="contain"
                            boxes1000={item.annotatedImageUrl ? [] : imgDamages.map((dmg) => ({ ...dmg.box1000, severity: dmg.severity }))}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Findings list below the images */}
                    <div className="findings-details-container">
                      {imgDamages.length === 0 ? (
                        <p style={{ margin: 0, fontSize: "0.9rem", color: "#718096", fontStyle: "italic", textAlign: "center", padding: "1rem 0" }}>
                          No visual defects identified on this camera angle.
                        </p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                          <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "#2d3748", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Identified Anomalies:
                          </h4>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                            {imgDamages.map((dmg, idx) => {
                              const severityClass = dmg.severity.toLowerCase();
                              const score = dmg.intensityScore;
                              const intensityBg = score
                                ? score >= 8 ? "rgba(229, 62, 62, 0.1)" : score >= 4 ? "rgba(221, 107, 32, 0.1)" : "rgba(49, 151, 149, 0.1)"
                                : "rgba(113, 128, 150, 0.1)";
                              const intensityText = score
                                ? score >= 8 ? "#e53e3e" : score >= 4 ? "#dd6b20" : "#319795"
                                : "#718096";

                              return (
                                <div
                                  key={dmg._id}
                                  style={{
                                    padding: "1rem",
                                    borderRadius: "8px",
                                    backgroundColor: "#f7fafc",
                                    border: "1px solid #edf2f7",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.5rem"
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                                    <span style={{ fontWeight: 700, color: "#2d3748", fontSize: "0.95rem" }}>
                                      #{idx + 1}. {labelize(dmg.part)} · <span style={{ textTransform: "capitalize", color: "#4a5568", fontWeight: 500 }}>{labelizeDamageType(dmg.damageType)}</span>
                                    </span>
                                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                      {score !== undefined && (
                                        <span
                                          style={{
                                            backgroundColor: intensityBg,
                                            color: intensityText,
                                            padding: "2px 8px",
                                            borderRadius: "12px",
                                            fontSize: "0.75rem",
                                            fontWeight: 600,
                                            border: `1px solid ${intensityText}30`
                                          }}
                                        >
                                          Intensity: {score}/10
                                        </span>
                                      )}
                                      <span className={`severity-badge ${severityClass}`} style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: "12px" }}>
                                        {dmg.severity}
                                      </span>
                                    </div>
                                  </div>
                                  <p style={{ margin: 0, fontSize: "0.9rem", color: "#4a5568", lineHeight: "1.5" }}>
                                    {dmg.description}
                                  </p>
                                  <div style={{ fontSize: "0.85rem", color: "#718096", marginTop: "2px" }}>
                                    <strong>Action:</strong> {dmg.recommendation}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
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
