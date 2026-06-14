import React from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import logoUrl from "../assets/surens-infotek-logo.png";
import { EvidenceImage } from "../components/EvidenceImage";
import { EmptyState, Metric, RiskPill } from "../components/common";
import { PartCoverage } from "../lib/types";
import { formatDate, labelize, labelizeDamageType } from "../lib/utils";

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
        <h2>Identified Surface Damage Findings by Photo Angle</h2>
        <p className="section-intro" style={{ marginBottom: "0.5rem" }}>
          The following damage points were identified using full-image systematic anomaly analysis. View the original photo and the visual annotations side-by-side, with detailed findings listed below.
        </p>
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem", alignItems: "center" }}>
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
          <EmptyState title="No photo data available" text="No vehicle images were found for this audit session." />
        ) : (
          <div className="damage-images-stack" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {(() => {
              // Group damages by mediaId
              const damagesByMediaId = new Map<string, any[]>();
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
                      pageBreakInside: "avoid",
                      breakInside: "avoid",
                      marginBottom: "1rem"
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", borderBottom: "1px solid #edf2f7", paddingBottom: "0.75rem" }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#1a202c" }}>
                          {item.viewLabel || "Exterior View"}
                        </h3>
                        <span style={{ fontSize: "0.8rem", color: "#718096" }}>File: {item.fileName}</span>
                      </div>
                      <span
                        style={{
                          backgroundColor: imgDamages.length > 0 ? "rgba(221, 107, 32, 0.1)" : "rgba(49, 151, 149, 0.1)",
                          color: imgDamages.length > 0 ? "#dd6b20" : "#319795",
                          padding: "2px 10px",
                          borderRadius: "20px",
                          fontSize: "0.75rem",
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
                        padding: "0.5rem",
                        borderRadius: "8px",
                        border: "1px solid #edf2f7"
                      }}
                    >
                      <div>
                        <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#4a5568", marginBottom: "2px", textAlign: "center" }}>Original Context</span>
                        <div style={{ borderRadius: "6px", overflow: "hidden", height: "320px", border: "1px solid #e2e8f0", position: "relative", backgroundColor: "#000" }}>
                          <img
                            src={item.imageUrl || ""}
                            alt="Original Context"
                            style={{ width: "100%", height: "100%", objectFit: "contain" }}
                          />
                        </div>
                      </div>
                      <div>
                        <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#4a5568", marginBottom: "2px", textAlign: "center" }}>Annotated View</span>
                        <div style={{ borderRadius: "6px", overflow: "hidden", height: "320px", border: "1px solid #e2e8f0", position: "relative", backgroundColor: "#000" }}>
                          <EvidenceImage
                            imageUrl={item.annotatedImageUrl || item.imageUrl || ""}
                            altText="Annotated View"
                            objectFit="contain"
                            boxes1000={item.annotatedImageUrl ? [] : imgDamages.map((dmg: any) => ({ ...dmg.box1000, severity: dmg.severity }))}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Findings list below the images */}
                    <div className="findings-details-container">
                      {imgDamages.length === 0 ? (
                        <p style={{ margin: 0, fontSize: "0.85rem", color: "#718096", fontStyle: "italic", textAlign: "center", padding: "0.5rem 0" }}>
                          No visual defects identified on this camera angle.
                        </p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: "#2d3748", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Identified Anomalies:
                          </h4>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
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
                                    padding: "0.75rem",
                                    borderRadius: "8px",
                                    backgroundColor: "#f7fafc",
                                    border: "1px solid #edf2f7",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.25rem",
                                    pageBreakInside: "avoid"
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                                    <span style={{ fontWeight: 700, color: "#2d3748", fontSize: "0.9rem" }}>
                                      #{idx + 1}. {labelize(dmg.part)} · <span style={{ textTransform: "capitalize", color: "#4a5568", fontWeight: 500 }}>{labelizeDamageType(dmg.damageType)}</span>
                                    </span>
                                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                      {score !== undefined && (
                                        <span
                                          style={{
                                            backgroundColor: intensityBg,
                                            color: intensityText,
                                            padding: "2px 6px",
                                            borderRadius: "12px",
                                            fontSize: "0.7rem",
                                            fontWeight: 600,
                                            border: `1px solid ${intensityText}30`
                                          }}
                                        >
                                          Intensity: {score}/10
                                        </span>
                                      )}
                                      <span className={`severity-badge ${severityClass}`} style={{ fontSize: "0.7rem", padding: "1px 6px", borderRadius: "12px" }}>
                                        {dmg.severity}
                                      </span>
                                    </div>
                                  </div>
                                  <p style={{ margin: 0, fontSize: "0.85rem", color: "#4a5568", lineHeight: "1.4" }}>
                                    {dmg.description}
                                  </p>
                                  <div style={{ fontSize: "0.8rem", color: "#718096" }}>
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
