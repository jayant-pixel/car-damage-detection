import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Damage = {
  label: string;
  damage_type: string;
  part: string;
  part_confidence: number;
  severity: "minor" | "moderate" | "severe";
  confidence: number;
  evidence: string;
  dent_depth?: "shallow" | "moderate" | "deep" | "unknown";
  measurement: {
    width_px: number;
    height_px: number;
    width_percent_of_image: number;
    height_percent_of_image: number;
    note: string;
  };
};

type AnalysisResponse = {
  summary: string;
  damages: Damage[];
  original_image_data_url: string;
  annotated_image_data_url: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const ANALYZE_ENDPOINT = `${API_BASE}/.netlify/functions/analyze`;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("Upload a clear vehicle photo to begin.");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }

    const nextPreview = URL.createObjectURL(file);
    setPreviewUrl(nextPreview);
    return () => URL.revokeObjectURL(nextPreview);
  }, [file]);

  function selectFile(nextFile?: File) {
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/")) {
      setMessage("Please choose a JPG, PNG, or WEBP image.");
      return;
    }
    if (nextFile.size > MAX_IMAGE_BYTES) {
      setMessage("Please choose an image under 4MB for the web inspection flow.");
      return;
    }
    setFile(nextFile);
    setResult(null);
    setMessage("Image ready. Start inspection when you are ready.");
  }

  async function analyzeUpload() {
    if (!file) {
      setMessage("Choose an image first.");
      return;
    }

    const image = await fileToDataUrl(file);
    await runAnalysis(() =>
      fetch(ANALYZE_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image })
      })
    );
  }

  async function runAnalysis(requestFactory: () => Promise<Response>) {
    setIsLoading(true);
    setMessage("Inspecting vehicle surfaces and marking visible damage...");
    try {
      const response = await requestFactory();
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data.detail || "Inspection failed. Please try another image.");
      }
      setResult(data);
      setMessage("Inspection complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inspection failed.");
    } finally {
      setIsLoading(false);
    }
  }

  const originalImage = result ? result.original_image_data_url : previewUrl;
  const annotatedImage = result ? result.annotated_image_data_url : "";

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="nav-line">
          <span className="brand-mark">DL</span>
          <span>DamageLens Inspection</span>
        </div>
        <div className="hero-grid">
          <div>
            <p className="eyebrow">Vehicle damage detection</p>
            <h1>Upload a car photo. Get marked damage zones and a clear report.</h1>
            <p className="hero-copy">
              Inspect exterior vehicle damage from a photo, highlight the visible impact areas,
              and summarize affected parts.
            </p>
          </div>
          <div className="status-card">
            <span className="status-dot" />
            <strong>Secure inspection workflow</strong>
            <p>Your upload is processed through a protected serverless function.</p>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="control-card">
          <h2>Start inspection</h2>
          <div
            className={`dropzone ${isDragging ? "is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              selectFile(event.dataTransfer.files[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label="Upload vehicle damage photo"
              title="Upload vehicle damage photo"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
            <div className="upload-icon">+</div>
            <strong>{file ? file.name : "Drop image here or browse"}</strong>
            <span>JPG, PNG, or WEBP vehicle photo</span>
          </div>

          <button className="primary-action" disabled={isLoading || !file} onClick={analyzeUpload}>
            Analyze image
          </button>

          <p className="helper-text">{message}</p>
        </aside>

        <section className="result-panel">
          {isLoading && <LoadingOverlay />}

          <div className="comparison-grid">
            <ImageFrame title="Input photo" src={originalImage} emptyText="Your uploaded image appears here." />
            <ImageFrame title="Marked result" src={annotatedImage} emptyText="Damage markings appear after analysis." />
          </div>

          <Report result={result} />
        </section>
      </section>
    </main>
  );
}

function ImageFrame({ title, src, emptyText }: { title: string; src: string; emptyText: string }) {
  return (
    <div className="image-frame">
      <div className="frame-title">{title}</div>
      {src ? <img src={src} alt={title} /> : <div className="empty-frame">{emptyText}</div>}
    </div>
  );
}

function LoadingOverlay() {
  return (
    <div className="loading-overlay">
      <div className="scanner">
        <span />
      </div>
      <strong>Analyzing damage</strong>
      <p>Locating visible dents, cracks, scratches, and affected parts.</p>
      <div className="progress-line" />
    </div>
  );
}

function Report({ result }: { result: AnalysisResponse | null }) {
  if (!result) {
    return (
      <div className="report-card muted-report">
        <h2>Inspection report</h2>
        <p>Run an inspection to receive a plain-language summary and damage list.</p>
      </div>
    );
  }

  return (
    <div className="report-card reveal">
      <div className="report-heading">
        <div>
          <span className="section-label">Inspection report</span>
          <h2>{result.summary}</h2>
        </div>
        <span className="count-pill">{result.damages.length} finding{result.damages.length === 1 ? "" : "s"}</span>
      </div>

      {result.damages.length === 0 ? (
        <p className="clean-result">No obvious exterior damage was detected in this photo.</p>
      ) : (
        <div className="damage-list">
          {result.damages.map((damage, index) => (
            <article className="damage-card" key={`${damage.label}-${index}`}>
              <div className="damage-index">{index + 1}</div>
              <div>
                <h3>{damage.label}</h3>
                <p>{damage.evidence || "Visible exterior damage was identified in this area."}</p>
                <div className="damage-meta">
                  <span>Affected part: {formatPartName(damage.part)}</span>
                  <span>{formatDamageType(damage.damage_type)}</span>
                  <span className={`severity ${damage.severity}`}>{damage.severity}</span>
                  <span>Part confidence: {formatConfidence(damage.part_confidence)}</span>
                  <span>Damage confidence: {formatConfidence(damage.confidence)}</span>
                  {damage.damage_type === "dent" && damage.dent_depth && (
                    <span>Dent depth: {damage.dent_depth}</span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDamageType(value: string) {
  return value.replaceAll("_", " ");
}

function formatPartName(value: string) {
  return value.replaceAll("_", " ");
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("Inspection endpoint returned an empty response. Use `netlify dev` to run the serverless function locally.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Inspection endpoint did not return JSON. Use `netlify dev`, not plain `npm run dev`, for end-to-end testing.");
  }
}

createRoot(document.getElementById("root")!).render(<App />);
