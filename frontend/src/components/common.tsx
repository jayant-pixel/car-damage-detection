import React from "react";

export function PageHeader({
  eyebrow,
  title,
  action
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </header>
  );
}

export function Metric({
  label,
  value,
  tone = ""
}: {
  label: string;
  value: string | number;
  tone?: "success" | "danger" | "warning" | "";
}) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <i />
    </article>
  );
}

export function RiskPill({ level, score }: { level: string; score: number }) {
  const normalizedLevel = level.toLowerCase();
  return (
    <span className={`risk-pill ${normalizedLevel}`}>
      {score}% {normalizedLevel} risk
    </span>
  );
}

export function NoticeBanner({
  tone,
  text,
  onDismiss
}: {
  tone: "success" | "danger" | "info" | "warning";
  text: string;
  onDismiss: () => void;
}) {
  return (
    <div className={`notice-banner ${tone}`} role="alert">
      <span>{text}</span>
      <button onClick={onDismiss} aria-label="Dismiss notice">Dismiss</button>
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
