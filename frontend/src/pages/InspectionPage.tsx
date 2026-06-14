import React, { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ProgressOverlay } from "../components/ProgressOverlay";
import { ResultsView } from "../components/ResultsView";
import { PageHeader, NoticeBanner } from "../components/common";
import { getViewDisplayName } from "../lib/utils";

export interface InspectionPageProps {
  inspectionId: string;
  onBackToDashboard: () => void;
  onOpenPrintReport?: () => void;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB limit
const UPLOAD_CONCURRENCY = 4;

export function InspectionPage({
  inspectionId,
  onBackToDashboard,
  onOpenPrintReport
}: InspectionPageProps) {
  const inspection = useQuery(api.inspections.getInspection, { inspectionId: inspectionId as any });
  const media = useQuery(api.media.getInspectionMedia, { inspectionId: inspectionId as any });
  const results = useQuery(api.results.getInspectionResults, { inspectionId: inspectionId as any });

  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const attachUploadedMedia = useMutation(api.media.attachUploadedMedia);
  const removeMedia = useMutation(api.media.removeMedia);
  const startAnalysis = useMutation(api.inspections.startInspectionAnalysis);
  const startClassification = useMutation(api.inspections.startCameraClassification);
  const resetClassification = useMutation(api.inspections.resetClassificationStatus);

  const [isUploading, setIsUploading] = useState(false);
  const classificationStatus = inspection?.classificationStatus || "pending";
  const isConfirmed = classificationStatus === "classifying" || classificationStatus === "completed";
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "info" | "warning"; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!inspection) {
    return (
      <div className="empty-workspace">
        <h2>Loading session...</h2>
      </div>
    );
  }

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleBulkUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Filter slots that are not currently occupied
    const occupiedSlots = new Set<string>(media?.map((m) => m.slot) || []);
    const slots = Array.from({ length: 20 }, (_, index) => {
      const num = String(index + 1).padStart(2, "0");
      return `image_${num}`;
    });
    const availableSlots = slots.filter((s) => !occupiedSlots.has(s));

    if (availableSlots.length === 0) {
      setNotice({ tone: "danger", text: "Maximum limit of 20 images has been reached. Remove some to add more." });
      return;
    }

    const filesToUpload = Array.from(files).slice(0, availableSlots.length);
    if (files.length > availableSlots.length) {
      setNotice({ tone: "warning", text: `Only the first ${availableSlots.length} images were uploaded (limit of 20 max).` });
    }

    setIsUploading(true);
    setNotice({ tone: "info", text: `Uploading ${filesToUpload.length} file(s)...` });

    const uploadPhoto = async (file: File, slot: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (file.size > MAX_IMAGE_BYTES) {
        return { ok: false, message: `Skipped "${file.name}": exceeds 4MB size limit.` };
      }

      try {
        const fileToUpload = file;

        const uploadUrl = await generateUploadUrl();
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": fileToUpload.type },
          body: fileToUpload
        });

        if (!response.ok) throw new Error("Upload failed");

        const { storageId } = await response.json();
        await attachUploadedMedia({
          inspectionId: inspectionId as any,
          slot: slot as any,
          storageId,
          fileName: fileToUpload.name,
          mimeType: fileToUpload.type,
          sizeBytes: fileToUpload.size
        });
        return { ok: true };
      } catch (err: any) {
        console.error("Bulk upload error:", err);
        return { ok: false, message: `Failed to upload "${file.name}": ${err.message || String(err)}` };
      }
    };

    try {
      const uploadJobs = filesToUpload.map((file, index) => () => uploadPhoto(file, availableSlots[index]));
      const uploadResults = await runWithConcurrency(uploadJobs, UPLOAD_CONCURRENCY);
      const successCount = uploadResults.filter((result) => result.ok).length;
      const failedMessages = uploadResults
        .filter((result): result is { ok: false; message: string } => !result.ok)
        .map((result) => result.message);

      if (successCount > 0) {
        const failureSummary = failedMessages.length > 0 ? ` ${failedMessages.length} skipped/failed.` : "";
        setNotice({ tone: "success", text: `Successfully uploaded ${successCount} photo(s).${failureSummary}` });
      } else if (failedMessages.length > 0) {
        setNotice({ tone: "danger", text: failedMessages[0] });
      }
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleRemove = async (mediaId: string) => {
    try {
      await removeMedia({ mediaId: mediaId as any });
      setNotice({ tone: "info", text: "Photo removed from audit session." });
    } catch (err: any) {
      setNotice({ tone: "danger", text: err.message || "Failed to remove photo." });
    }
  };

  const handleStartAnalysis = async () => {
    try {
      await startAnalysis({ inspectionId: inspectionId as any });
    } catch (err: any) {
      setNotice({ tone: "danger", text: err.message || "Failed to start analysis." });
    }
  };

  const handleStartClassification = async () => {
    try {
      await startClassification({ inspectionId: inspectionId as any });
      setNotice({ tone: "success", text: "Evidence locked. View classification started!" });
    } catch (err: any) {
      setNotice({ tone: "danger", text: err.message || "Failed to start view classification." });
    }
  };

  const handleResetClassification = async () => {
    try {
      await resetClassification({ inspectionId: inspectionId as any });
      setNotice({ tone: "info", text: "Unlocked evidence ledger for modification." });
    } catch (err: any) {
      setNotice({ tone: "danger", text: err.message || "Failed to reset classification." });
    }
  };

  const hasPhotos = media && media.length > 0;
  const isAnalyzing = inspection.status === "analyzing";
  const isDone = inspection.status === "done";

  // Render view based on state
  if (isAnalyzing) {
    return (
      <ProgressOverlay
        inspection={inspection}
        onOpenResults={() => {}} // results view will open automatically
        onClose={onBackToDashboard}
      />
    );
  }

  if (isDone && results) {
    return (
      <ResultsView
        inspection={inspection}
        damages={results.damages || []}
        integrityChecks={results.integrityChecks || []}
        roiScans={results.roiScans || []}
        partCoverage={results.partCoverage || []}
        onBackToDashboard={onBackToDashboard}
        onOpenPrintReport={onOpenPrintReport}
      />
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`Session: ${inspection.vehicleNumber}`}
        title={`Audit Setup: ${inspection.customerName}`}
        action={
          <button className="secondary-action" onClick={onBackToDashboard}>
            Back to Dashboard
          </button>
        }
      />

      {notice && (
        <NoticeBanner
          tone={notice.tone}
          text={notice.text}
          onDismiss={() => setNotice(null)}
        />
      )}

      <section className="surface session-overview-summary">
        <div className="meta-blocks">
          <div>
            <span className="eyebrow">Customer Name</span>
            <strong>{inspection.customerName}</strong>
          </div>
          <div>
            <span className="eyebrow">Vehicle Plate</span>
            <strong>{inspection.vehicleNumber}</strong>
          </div>
          <div>
            <span className="eyebrow">Car Model & Trim</span>
            <strong>{inspection.carModel}</strong>
          </div>
          <div>
            <span className="eyebrow">Status</span>
            <span className={`status-pill ${inspection.status}`}>{inspection.status}</span>
          </div>
        </div>
      </section>

      <section className="surface upload-workspace">
        <div className="surface-title flex-header">
          <div>
            <h2>Upload Evidence Photos</h2>
            <p className="subtitle">
              Choose one or more photos of the vehicle from various angles. The limit is 20 images.
            </p>
          </div>
          <span className="upload-counter">
            {media?.length || 0} / 20 Images Uploaded
          </span>
        </div>

        {/* INPUT FOR BULK UPLOAD */}
        <input
          type="file"
          accept="image/*"
          multiple
          ref={fileInputRef}
          onChange={handleBulkUpload}
          style={{ display: "none" }}
          disabled={isUploading || isConfirmed}
        />

        {/* 1. UPLOAD ZONE (renders if no photos uploaded) */}
        {!hasPhotos && (
          <div className="bulk-upload-dropzone" onClick={triggerFileInput}>
            {isUploading ? (
              <div className="spinner-loader">
                <span className="spinner" />
                <h3>Uploading photos...</h3>
                <p>Storing evidence securely in claim registry</p>
              </div>
            ) : (
              <>
                <span className="upload-icon">📂</span>
                <h3>Upload Car Photos</h3>
                <p>Select or drag multiple vehicle images to initialize the audit ledger</p>
                <button className="primary-action select-photos-btn" type="button">
                  Browse Files
                </button>
              </>
            )}
          </div>
        )}

        {/* 2. PREVIEW & CONFIRMATION GALLERY (renders if photos uploaded) */}
        {hasPhotos && (
          <div className="bulk-upload-review-container">
            {!isConfirmed ? (
              <>
                <div className="review-gallery-header">
                  <h3>Verify Uploaded Evidence</h3>
                  {media && media.length < 20 && (
                    <button
                      className="secondary-action add-more-photos-btn"
                      onClick={triggerFileInput}
                      disabled={isUploading}
                    >
                      {isUploading ? "Uploading..." : "Add More Photos"}
                    </button>
                  )}
                </div>

                <div className="uploaded-images-list">
                  {media.map((item, idx) => (
                    <div key={item._id} className="uploaded-image-row">
                      {item.url ? (
                        <img src={item.url} alt={item.fileName} className="row-thumb" />
                      ) : (
                        <div className="row-thumb-placeholder">{idx + 1}</div>
                      )}
                      <div className="row-info">
                        <strong>
                          Image {String(idx + 1).padStart(2, "0")} : {item.fileName}
                        </strong>
                        <span>
                          {(item.sizeBytes ? (item.sizeBytes / 1024 / 1024).toFixed(2) : "0.00")} MB
                        </span>
                      </div>
                      <button
                        className="row-remove-btn"
                        onClick={() => handleRemove(item._id)}
                        disabled={isUploading}
                        aria-label="Delete image"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="bulk-upload-actions">
                  <button
                    className="primary-action conform-evidence-btn"
                    onClick={handleStartClassification}
                  >
                    Confirm & Classify Views
                  </button>
                </div>
              </>
            ) : classificationStatus === "classifying" ? (
              // 3. CLASSIFYING VIEWS STATE
              <>
                <div className="review-gallery-header">
                  <h3>Detecting Camera Angles... ({media.length} image(s))</h3>
                  <button
                    className="secondary-action modify-evidence-btn"
                    disabled={true}
                  >
                    Modify Photos
                  </button>
                </div>

                <div className="uploaded-images-list confirmed classifying">
                  {media.map((item, idx) => (
                    <div key={item._id} className="uploaded-image-row locked">
                      {item.url ? (
                        <img src={item.url} alt={item.fileName} className="row-thumb" />
                      ) : (
                        <div className="row-thumb-placeholder">{idx + 1}</div>
                      )}
                      <div className="row-info">
                        <strong>
                          Image {String(idx + 1).padStart(2, "0")} : {item.fileName}
                        </strong>
                        <span>Detecting view angle...</span>
                      </div>
                      <span className="locked-badge classifying">Processing</span>
                    </div>
                  ))}
                </div>

                <div className="bulk-upload-actions" style={{ flexDirection: "column", gap: "1rem" }}>
                  <div className="spinner-loader" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="spinner" />
                    <strong>Processing views...</strong>
                  </div>
                  <p className="subtitle" style={{ margin: 0 }}>
                    {inspection.progressMessage || "Processing camera views..."}
                  </p>
                </div>
              </>
            ) : (
              // 4. LOCKED COMPLETED STATE (classified)
              <>
                <div className="review-gallery-header">
                  <h3>Confirmed Evidence Ledger ({media.length} image(s))</h3>
                  <button
                    className="secondary-action modify-evidence-btn"
                    onClick={handleResetClassification}
                  >
                    Modify Photos
                  </button>
                </div>

                <div className="uploaded-images-list confirmed">
                  {media.map((item, idx) => (
                    <div key={item._id} className="uploaded-image-row locked">
                      {item.url ? (
                        <img src={item.url} alt={item.fileName} className="row-thumb" />
                      ) : (
                        <div className="row-thumb-placeholder">{idx + 1}</div>
                      )}
                      <div className="row-info">
                        <strong>
                          Image {String(idx + 1).padStart(2, "0")} : {item.viewLabel || "Exterior View"}
                        </strong>
                        <span>{item.fileName}</span>
                      </div>
                      <span className="locked-badge">Classified</span>
                    </div>
                  ))}
                </div>

                <div className="bulk-upload-actions">
                  <button
                    className="primary-action run-analysis-btn"
                    onClick={handleStartAnalysis}
                  >
                    Run Damage Analysis
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

async function runWithConcurrency<T>(
  jobs: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (nextIndex < jobs.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await jobs[currentIndex]();
    }
  });

  await Promise.all(workers);
  return results;
}
