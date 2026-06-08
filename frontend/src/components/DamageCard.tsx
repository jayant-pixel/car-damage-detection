import React from "react";
import logoUrl from "../assets/surens-infotek-logo.png";
import { EvidenceImage } from "./EvidenceImage";
import { DamageResult } from "../lib/types";
import { labelize } from "../lib/utils";

export interface DamageCardProps {
  damage: DamageResult;
  index: number;
}

export function DamageCard({ damage, index }: DamageCardProps) {
  const {
    part,
    damageType,
    severity,
    confidence,
    description,
    box1000,
    imageUrl,
    recommendation,
    viewLabel
  } = damage;

  const severityClass = severity.toLowerCase();

  return (
    <div className="damage-card">
      <header className="damage-card-header">
        <div className="header-brand-part">
          <img src={logoUrl} alt="Surensinfotek Logo" className="card-brand-logo" />
          <div>
            <h3>Damage #{index + 1} · {labelize(part)}</h3>
            <span className="damage-meta-text">
              View: {viewLabel || "Exterior View"} · Confidence: {Math.round(confidence * 100)}%
            </span>
          </div>
        </div>
        <div className="header-indicators">
          <span className={`severity-badge ${severityClass}`}>
            {severity}
          </span>
          <span className="type-badge">{damageType}</span>
        </div>
      </header>

      <div className="damage-card-body">
        <div className="damage-triptych two-cols">
          <div className="triptych-item">
            <span>Original context</span>
            {imageUrl ? (
              <EvidenceImage imageUrl={imageUrl} altText="Original car context" highlighted={false} />
            ) : (
              <div className="image-placeholder">Image missing</div>
            )}
          </div>

          <div className="triptych-item">
            <span>Full image annotation</span>
            {imageUrl ? (
              <EvidenceImage imageUrl={imageUrl} altText="Annotated damage location" box1000={box1000} highlighted={true} />
            ) : (
              <div className="image-placeholder">Image missing</div>
            )}
          </div>
        </div>

        <div className="damage-card-details">
          <h4>Visual Finding Analysis</h4>
          <p className="damage-description">{description}</p>
          <div className="damage-recommendation">
            <strong>Recommended action:</strong> {recommendation}
          </div>
        </div>
      </div>
    </div>
  );
}
