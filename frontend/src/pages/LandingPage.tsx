import React from "react";
import logoUrl from "../assets/surens-infotek-logo.png";

export interface LandingPageProps {
  onSignIn: () => void;
}

export function LandingPage({ onSignIn }: LandingPageProps) {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <div className="landing-brand">
          <img src={logoUrl} alt="Surensinfotek Logo" />
          <span>AutoVision Dashboard</span>
        </div>
        <button className="ghost-button" onClick={onSignIn}>
          Sign in
        </button>
      </header>
      
      <section className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">Surensinfotek claim solutions</span>
          <h1>Session-based vehicle claim audit.</h1>
          <p>
            Upload vehicle photos, map exterior panels, inspect scratches or dents close-up, and compile branded claims evidence records with zero manual transcription.
          </p>
          <div className="hero-actions">
            <button className="primary-action" onClick={onSignIn}>
              Open Workspace
            </button>
            <span className="hero-feature-text">
              Multi-angle audit · Structural integrity checks · Evidence records
            </span>
          </div>
        </div>
        
        <div className="hero-visual" aria-hidden="true">
          <div className="vehicle-silhouette">
            <span />
          </div>
          <div className="hero-panel one">
            <strong>100%</strong>
            <span>evidence linked</span>
          </div>
          <div className="hero-panel two">
            <strong>20</strong>
            <span>max slots supported</span>
          </div>
          <div className="hero-panel three">
            <strong>Surensinfotek</strong>
            <span>audit ledger</span>
          </div>
        </div>
      </section>
    </main>
  );
}
