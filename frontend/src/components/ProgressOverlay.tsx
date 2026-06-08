import React from "react";
import { Inspection } from "../lib/types";

export interface ProgressOverlayProps {
  inspection: Inspection;
  onOpenResults: () => void;
  onClose: () => void;
}

export function ProgressOverlay({
  inspection,
  onOpenResults,
  onClose
}: ProgressOverlayProps) {
  const { progress, progressMessage, status } = inspection;
  
  const isComplete = status === "done";
  const isFailed = status === "failed";
  const isRunning = status === "analyzing";

  return (
    <div className="progress-overlay-container" role="status" aria-live="polite">
      <div className="progress-card">
        <div className="progress-card-header">
          <h2>Vehicle Analysis Progress</h2>
          <span className={`status-badge ${status}`}>{status}</span>
        </div>

        <div className="progress-body">
          <div className="progress-metrics">
            <span className="progress-message-text">{progressMessage}</span>
            <span className="progress-percentage">{Math.round(progress)}%</span>
          </div>

          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="progress-steps-list">
            <div className={`step-item ${progress >= 18 ? "completed" : isRunning ? "active" : ""}`}>
              <span className="step-check">✓</span>
              <span>Classifying camera views</span>
            </div>
            <div className={`step-item ${progress >= 30 ? "completed" : progress === 18 && isRunning ? "active" : ""}`}>
              <span className="step-check">✓</span>
              <span>Describing every uploaded image</span>
            </div>
            <div className={`step-item ${progress >= 65 ? "completed" : progress === 30 && isRunning ? "active" : ""}`}>
              <span className="step-check">✓</span>
              <span>Full-image pixel-grid anomaly analysis</span>
            </div>
            <div className={`step-item ${progress >= 82 ? "completed" : progress === 65 && isRunning ? "active" : ""}`}>
              <span className="step-check">✓</span>
              <span>Reconciling repeated findings</span>
            </div>
            <div className={`step-item ${progress >= 95 ? "completed" : progress === 82 && isRunning ? "active" : ""}`}>
              <span className="step-check">✓</span>
              <span>Image and vehicle integrity verification</span>
            </div>
          </div>
        </div>

        <footer className="progress-footer">
          {isComplete ? (
            <button className="primary-action" onClick={onOpenResults}>
              View Report
            </button>
          ) : isFailed ? (
            <button className="secondary-action" onClick={onClose}>
              Go Back
            </button>
          ) : (
            <span className="wait-message">
              Analyzing vehicle photos. This may take up to a minute...
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
