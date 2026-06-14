"use node";

import { v } from "convex/values";
import { Buffer } from "node:buffer";
import { decode as decodeJpeg, encode as encodeJpeg } from "jpeg-js";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// Interfaces for coordinate box mapping
type Box1000 = { left: number; top: number; right: number; bottom: number };
type ImagePayload = {
  imageId: string;
  media: any;
  mimeType: string;
  base64: string;
  originalBase64?: string;
};
type AnalysisGroup = {
  key: string;
  label: string;
  payloads: ImagePayload[];
};
type GroupAnalysisResult = {
  groupKey: string;
  groupLabel: string;
  imageIds: string[];
  result: any;
};
type DamageAnnotation = {
  box1000: Box1000;
  severity: "minor" | "moderate" | "severe";
  damageType: string;
  index: number;
};

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_MAX_ATTEMPTS = readPositiveIntEnv("GEMINI_MAX_ATTEMPTS", 2);
const DAMAGE_LABELS = [
  "scratch",
  "dent",
  "damaged"
];

// BACKGROUND ACTION RUNNING THE PIPELINE
export const runAnalysisStage1And2 = internalAction({
  args: {
    inspectionId: v.id("inspections")
  },
  handler: async (ctx, { inspectionId }) => {
    const log = async (msg: string) => {
      await ctx.runMutation(internal.shared.appendInspectionLog, { inspectionId, message: msg });
    };

    const updateProgress = async (status: any, progress: number, msg: string) => {
      await ctx.runMutation(internal.shared.updateInspectionProgressInternal, {
        inspectionId,
        status,
        progress,
        progressMessage: msg
      });
    };

    try {
      const apiKey = process.env.GOOGLE_API_KEY;
      const model = process.env.GEMMA_MODEL_ID || DEFAULT_GEMINI_MODEL;

      // --- STAGE 1: READ PHOTOS ---
      const media = await ctx.runQuery(api.media.getInspectionMedia, { inspectionId });
      if (!media || media.length === 0) {
        throw new Error("No inspection photos have been uploaded yet.");
      }
      const sortedMedia = [...media].sort((a, b) => a._creationTime - b._creationTime);

      if (!apiKey) {
        await log("Warning: GOOGLE_API_KEY is not configured. Running in Mock/Simulated classification mode.");
        await simulateMockClassification(ctx, inspectionId, sortedMedia, log, updateProgress);
        return;
      }

      await updateProgress("uploading", 8, "Reading full-resolution inspection photos...");
      await log(`Stage 1/4: Classifying ${sortedMedia.length} full-resolution photo(s) in one multi-image request...`);

      const imagePayloads = await loadImagePayloads(ctx, sortedMedia);
      const classificationPrompt = `
        You are classifying a vehicle inspection photo set. The request includes every uploaded image at original uploaded resolution.

        For each image, return:
        - imageId exactly as provided
        - viewLabel
        - visiblePartDescriptions with natural descriptions of visible vehicle parts and coverage quality
        - carBoundingBox1000: The bounding box [left, top, right, bottom] wrapping only the main vehicle in 0-1000 coordinates (0 to 1000 scale) for zoom analysis. Use null if it is "Close-up damage view", "Interior view", "VIN view", or "Odometer view".

        Mention important exterior and small parts when visible:
        hood, front bumper, rear bumper, fenders, doors, quarter panels, rocker panels/sills,
        wheel arch panels, A/B/C pillars, roof, trunk/tailgate, grille, mirrors, lamps,
        fog lights, tow hook covers, fuel filler door, lower valance, diffuser, license plate area,
        brand badges/emblems/logos (grille badge, trunk badge, fender badge), wheels/rims/tires.

        CRITICAL CLASSIFICATION RULE:
        - If a significant portion of the vehicle is visible, classify it as the matching exterior view.
        - Only use "Close-up damage view" for a tight close-up where the rest of the car is not visible.

        CAR BOUNDING BOX RULES:
        - Return the tightest bounding box that fully contains the main vehicle in the image.
        - The coordinates MUST be numbers between 0 and 1000.
        - Format: {"left": X, "top": Y, "right": X, "bottom": Y}
        - Leave a small margin (approx. 10-30 units on each side) to avoid clipping.
        - If there is no vehicle or it is a close-up/interior/VIN/odometer, return null.

        Return exactly one JSON object:
        {
          "images": [
            {
              "imageId": "image_01",
              "viewLabel": "Front view|Front left view|Front right view|Rear view|Rear left view|Rear right view|Left side view|Right side view|Interior view|VIN view|Odometer view|Close-up damage view",
              "visiblePartDescriptions": [
                "The front bumper is fully visible, including the lower valance and license plate surround.",
                "The left headlight and left front fender edge are visible with clear inspection coverage."
              ],
              "carBoundingBox1000": { "left": 120, "top": 200, "right": 880, "bottom": 850 }
            }
          ]
        }
      `.trim();

      const classification = await callGeminiWithImages(apiKey, model, imagePayloads, classificationPrompt);
      const labelsByImageId = new Map<string, any>();
      for (const item of Array.isArray(classification?.images) ? classification.images : []) {
        if (item?.imageId) labelsByImageId.set(String(item.imageId), item);
      }

      for (const payload of imagePayloads) {
        const label = labelsByImageId.get(payload.imageId) || {};
        const viewLabel = label?.viewLabel || "Close-up damage view";
        const visiblePartDescriptions: string[] = Array.isArray(label?.visiblePartDescriptions)
          ? label.visiblePartDescriptions.filter((d: any) => typeof d === "string")
          : [];
        const carBoundingBox1000 = label?.carBoundingBox1000 &&
          typeof label.carBoundingBox1000 === "object" &&
          typeof label.carBoundingBox1000.left === "number"
            ? {
                left: Math.max(0, Math.min(1000, label.carBoundingBox1000.left)),
                top: Math.max(0, Math.min(1000, label.carBoundingBox1000.top)),
                right: Math.max(0, Math.min(1000, label.carBoundingBox1000.right)),
                bottom: Math.max(0, Math.min(1000, label.carBoundingBox1000.bottom))
              }
            : undefined;

        await ctx.runMutation(internal.media.updateMediaViewLabel, {
          mediaId: payload.media._id,
          viewLabel
        });

        if (carBoundingBox1000) {
          await ctx.runMutation(internal.media.updateMediaCarBoundingBox, {
            mediaId: payload.media._id,
            carBoundingBox1000
          });
        }

        if (visiblePartDescriptions.length > 0) {
          await ctx.runMutation(internal.media.updateMediaVisiblePartDescriptions, {
            mediaId: payload.media._id,
            visiblePartDescriptions
          });
        }

        const boxLogStr = carBoundingBox1000 ? ` (Car box: [L:${carBoundingBox1000.left}, T:${carBoundingBox1000.top}, R:${carBoundingBox1000.right}, B:${carBoundingBox1000.bottom}])` : "";
        await log(`Photo "${payload.media.fileName}" identified as: ${viewLabel}${boxLogStr} (${visiblePartDescriptions.length} part descriptions)`);
      }

      await log("All photos classified from one multi-image request.");
      await ctx.runMutation(internal.inspections.updateClassificationStatusInternal, {
        inspectionId,
        classificationStatus: "completed",
        progressMessage: "Camera views classified. Ready for damage analysis."
      });
    } catch (error: any) {
      console.error("Stage 1 & 2 failed:", error);
      await log(`CRITICAL ERROR during Stage 1 & 2: ${error.message || String(error)}`);
      await ctx.runMutation(internal.inspections.updateClassificationStatusInternal, {
        inspectionId,
        classificationStatus: "pending",
        progressMessage: `Classification failed: ${error.message || "Unknown error"}`
      });
      await updateProgress("failed", 100, `Analysis failed: ${error.message || "Unknown error"}`);
    }
  }
});

export const runAnalysisStage3 = internalAction({
  args: {
    inspectionId: v.id("inspections")
  },
  handler: async (ctx, { inspectionId }) => {
    const log = async (msg: string) => {
      await ctx.runMutation(internal.shared.appendInspectionLog, { inspectionId, message: msg });
    };

    const updateProgress = async (status: any, progress: number, msg: string) => {
      await ctx.runMutation(internal.shared.updateInspectionProgressInternal, {
        inspectionId,
        status,
        progress,
        progressMessage: msg
      });
    };

    try {
      const apiKey = process.env.GOOGLE_API_KEY;
      const model = process.env.GEMMA_MODEL_ID || DEFAULT_GEMINI_MODEL;

      const media = await ctx.runQuery(api.media.getInspectionMedia, { inspectionId });
      if (!media || media.length === 0) {
        throw new Error("No inspection photos found.");
      }
      const sortedMedia = [...media].sort((a, b) => a._creationTime - b._creationTime);

      if (!apiKey) {
        await log("Warning: GOOGLE_API_KEY is not configured. Running in Mock/Simulated analysis mode.");
        await simulateMockAnalysis(ctx, inspectionId, sortedMedia, log, updateProgress);
        return;
      }

      const exteriorMedia = sortedMedia.filter((item) => {
        const viewLabel = item.viewLabel || "Close-up damage view";
        return !["VIN view", "Odometer view", "Interior view"].includes(viewLabel);
      });

      if (exteriorMedia.length === 0) {
        await log("No exterior photos found for damage analysis.");
        await updateProgress("analyzing", 88, "No exterior photos found. Completing Stage 3.");
      } else {
        const imagePayloads = await loadImagePayloads(ctx, exteriorMedia);

        // --- CROPPING / AUTO-ZOOM PREPROCESSING ---
        await log("Applying automatic zoom to the car body on wide-angle images...");
        for (const payload of imagePayloads) {
          const cropBox = payload.media.carBoundingBox1000;
          if (cropBox && typeof cropBox === "object") {
            const paddedBox = {
              left: Math.max(0, cropBox.left - 40),
              top: Math.max(0, cropBox.top - 40),
              right: Math.min(1000, cropBox.right + 40),
              bottom: Math.min(1000, cropBox.bottom + 40)
            };
            
            // Check if the crop box is significantly smaller than the full image (e.g. less than 95% area)
            const area = (paddedBox.right - paddedBox.left) * (paddedBox.bottom - paddedBox.top);
            if (area < 950000 && area > 50000) {
              await log(`  Zooming into car body for "${payload.media.fileName}" using box [L:${paddedBox.left}, T:${paddedBox.top}, R:${paddedBox.right}, B:${paddedBox.bottom}]`);
              payload.originalBase64 = payload.base64; // save original for annotation drawing
              payload.base64 = cropImageBase64(payload.base64, paddedBox);
              // Store the paddedBox on the media payload so we can reference it when mapping coordinates back!
              payload.media.cropBox1000 = paddedBox;
            }
          }
        }

        await log("Stage 3: Running visual damage analysis.");
        await updateProgress("analyzing", 40, "Running visual anomaly group analysis...");

        const groups = buildAnalysisGroups(imagePayloads);
        await log(`  Running ${groups.length} group(s) in parallel: ${groups.map((group) => group.label).join(", ")}.`);

        const groupResults = await Promise.all(
          groups.map((group) => analyzeImageGroup(apiKey, model, group, log))
        );

        await updateProgress("analyzing", 72, "Reconciling grouped analysis outputs...");
        const finalAnalysis = await reconcileGroupAnalyses(apiKey, model, groupResults, imagePayloads);
        const analysis = hasAnalysisImages(finalAnalysis) ? finalAnalysis : combineGroupAnalyses(groupResults);

        await persistAnalysisResult(ctx, inspectionId, imagePayloads, analysis, log);

        const count = countResultDamages(analysis);
        const reportSummary = `### Vehicle Inspection Report Summary\n\n* **Damages Detected**: ${count} surface defect(s) found.\n\nAll exterior panels have been inspected. Details for each finding are listed in the damage catalog cards below.\n`;

        await ctx.runMutation(internal.inspections.updateReportSummary, {
          inspectionId,
          reportSummary
        });
      }

      await log("Stage 3 completed successfully.");
      await updateProgress("analyzing", 88, "Damage analysis complete. Reconciling findings...");

      await ctx.scheduler.runAfter(0, internal.processing.runAnalysisStage5And6, {
        inspectionId
      });
    } catch (error: any) {
      console.error("Stage 3 failed:", error);
      await log(`CRITICAL ERROR during Stage 3: ${error.message || String(error)}`);
      await updateProgress("failed", 100, `Analysis failed: ${error.message || "Unknown error"}`);
    }
  }
});

export const runAnalysisStage5And6 = internalAction({
  args: {
    inspectionId: v.id("inspections")
  },
  handler: async (ctx, { inspectionId }) => {
    const log = async (msg: string) => {
      await ctx.runMutation(internal.shared.appendInspectionLog, { inspectionId, message: msg });
    };

    const updateProgress = async (status: any, progress: number, msg: string) => {
      await ctx.runMutation(internal.shared.updateInspectionProgressInternal, {
        inspectionId,
        status,
        progress,
        progressMessage: msg
      });
    };

    try {
      const apiKey = process.env.GOOGLE_API_KEY;
      const model = process.env.GEMMA_MODEL_ID || DEFAULT_GEMINI_MODEL;
      if (!apiKey) throw new Error("API Key is missing in Stage 5 & 6");

      const media = await ctx.runQuery(api.media.getInspectionMedia, { inspectionId });
      if (!media || media.length === 0) {
        throw new Error("No inspection photos found.");
      }
      const sortedMedia = [...media].sort((a, b) => a._creationTime - b._creationTime);

      await log("Stage 3/4: Findings already audited and deduplicated in Stage 3. Skipping additional deduplication.");
      await updateProgress("analyzing", 95, "Running final integrity checks...");
      await log("Stage 4/4: Verifying same vehicle consistency and image authenticity...");

      const finalFindings = await ctx.runQuery(api.results.getInspectionDamageResults, { inspectionId });

      const inspectionRecord = await ctx.runQuery(api.inspections.getInspection, { inspectionId });
      const vehicleDesc = inspectionRecord
        ? `vehicle: ${inspectionRecord.carModel}, plate: ${inspectionRecord.vehicleNumber}`
        : "vehicle";

      // Load ALL images including Interior/VIN/Odometer for visual cross-verification
      const allImagePayloads = await loadImagePayloads(ctx, sortedMedia);

      const consistencyPrompt = `
        You are a claims integrity auditor performing VISUAL cross-verification on all uploaded images.
        The customer entered: ${vehicleDesc}.

        CRITICAL VISUAL CHECKS — examine the actual images carefully:
        1. BRAND VERIFICATION: Compare the vehicle BRAND visible on exterior images (body shape, grille design, headlight shape, badges on grille/trunk/fenders) against any VIN plate text, interior steering wheel logo, dashboard branding, or instrument cluster style visible in other images. Flag any mismatch (e.g. exterior looks like Toyota but VIN says Honda).
        2. LICENSE PLATE: Check if the license plate number is consistent across all exterior views where it is visible.
        3. BODY COLOR: Verify the body paint color is consistent across all exterior views.
        4. WHEEL CONSISTENCY: Check all visible wheels for type mismatch (e.g. alloy wheel on one side, steel wheel on another), size mismatch, or spare tire installed.
        5. MODEL MATCH: Compare the entered vehicle model "${inspectionRecord?.carModel || 'unknown'}" against what the car actually looks like in the images.

        Findings context: ${JSON.stringify(finalFindings.map((f: any) => ({ part: f.part, description: f.description })))}
        Media labels: ${JSON.stringify(sortedMedia.map((m: any) => ({ fileName: m.fileName, label: m.viewLabel })))}

        Return exactly one JSON object:
        {
          "status": "pass|warning|fail",
          "summary": "Detailed explanation of all consistency findings.",
          "brandMismatch": true or false,
          "licensePlateMismatch": true or false,
          "wheelMismatch": true or false,
          "colorMismatch": true or false
        }
      `.trim();

      const authPrompt = `
        You are a claim fraud specialist. Review these photos visually. Is there any evidence of image manipulation, photoshop, or synthetic damage being pasted in?

        Findings: ${JSON.stringify(finalFindings.map((f: any) => ({ type: f.damageType, desc: f.description, confidence: f.confidence })))}

        Return exactly one JSON object:
        {
          "status": "pass|warning|fail",
          "summary": "Brief explanation of image authenticity check."
        }
      `.trim();

      const [consistencyRes, authRes] = await Promise.all([
        callGeminiWithImages(apiKey, model, allImagePayloads, consistencyPrompt),
        callGeminiWithImages(apiKey, model, allImagePayloads, authPrompt)
      ]);

      const consistencyDetails: any = {};
      if (consistencyRes?.brandMismatch !== undefined) consistencyDetails.brandMismatch = !!consistencyRes.brandMismatch;
      if (consistencyRes?.licensePlateMismatch !== undefined) consistencyDetails.licensePlateMismatch = !!consistencyRes.licensePlateMismatch;
      if (consistencyRes?.wheelMismatch !== undefined) consistencyDetails.wheelMismatch = !!consistencyRes.wheelMismatch;
      if (consistencyRes?.colorMismatch !== undefined) consistencyDetails.colorMismatch = !!consistencyRes.colorMismatch;

      await ctx.runMutation(internal.inspections.writeIntegrityCheck, {
        inspectionId,
        checkType: "vehicle_consistency",
        status: consistencyRes?.status || "pass",
        summary: consistencyRes?.summary || "Vehicle visual markers are consistent across all views.",
        details: Object.keys(consistencyDetails).length > 0 ? consistencyDetails : undefined
      });

      await ctx.runMutation(internal.inspections.writeIntegrityCheck, {
        inspectionId,
        checkType: "image_authenticity",
        status: authRes?.status || "pass",
        summary: authRes?.summary || "Image structures appear authentic with no obvious digital tampering."
      });

      // --- COMPLETE ANALYSIS ---
      const postChecksFindings = await ctx.runQuery(api.results.getInspectionDamageResults, { inspectionId });

      await ctx.runMutation(internal.shared.updateInspectionProgressInternal, {
        inspectionId,
        status: "done",
        progress: 100,
        progressMessage: `Analysis complete. Found ${postChecksFindings.length} damages.`
      });

      await ctx.runMutation(internal.inspections.completeInspection, {
        inspectionId,
        totalDamageCount: postChecksFindings.length
      });

      await log(`Inspection completed. Found ${postChecksFindings.length} total damage points.`);
    } catch (error: any) {
      console.error("Stage 5 & 6 failed:", error);
      await log(`CRITICAL ERROR during Stage 5 & 6: ${error.message || String(error)}`);
      await updateProgress("failed", 100, `Analysis failed: ${error.message || "Unknown error"}`);
    }
  }
});

// SIMULATOR FOR MOCK RUNS (Runs if API Key is not set)
async function simulateMockClassification(
  ctx: any,
  inspectionId: any,
  media: any[],
  log: (msg: string) => Promise<void>,
  updateProgress: (status: any, progress: number, msg: string) => Promise<void>
) {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Stage 2
  await wait(800);
  await updateProgress("uploading", 18, "Identifying vehicle angles...");
  for (const item of media) {
    const labels = ["Front view", "Rear view", "Left side view", "Right side view", "Close-up damage view"];
    const label = labels[Math.floor(Math.random() * labels.length)];
    await ctx.runMutation(internal.media.updateMediaViewLabel, {
      mediaId: item._id,
      viewLabel: label
    });
    await log(`Photo "${item.fileName}" identified as: ${label}`);
  }

  await wait(500);
  await ctx.runMutation(internal.inspections.updateClassificationStatusInternal, {
    inspectionId,
    classificationStatus: "completed",
    progressMessage: "Camera views classified. Ready for damage analysis."
  });
}

async function simulateMockAnalysis(
  ctx: any,
  inspectionId: any,
  media: any[],
  log: (msg: string) => Promise<void>,
  updateProgress: (status: any, progress: number, msg: string) => Promise<void>
) {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Stage 3
  await wait(800);
  await updateProgress("analyzing", 30, "Mapping visible parts...");
  await log("Mapped visible parts: bumper, fender, grille, hood.");

  await wait(1500);
  await updateProgress("analyzing", 65, "Inspecting each image with systematic anomaly detection...");

  // Inject some mock damage findings
  const mockDamages = [
    {
      part: "left fender",
      damageType: "scratch",
      severity: "minor" as const,
      confidence: 0.91,
      description: "A thin hairline scratch on the upper edge of the fender panel, approx 6cm long.",
      box1000: { left: 420, top: 310, right: 680, bottom: 480 },
      isFromPartScan: false,
      recommendation: "Monitor"
    },
    {
      part: "front bumper",
      damageType: "scratch",
      severity: "minor" as const,
      confidence: 0.88,
      description: "Minor paint scuff/scratch near the lower splitter edge, likely road scrape.",
      box1000: { left: 120, top: 780, right: 340, bottom: 890 },
      isFromPartScan: false,
      recommendation: "Polish / clean"
    }
  ];

  for (const d of mockDamages) {
    // Attach to the first media item
    if (media[0]) {
      await ctx.runMutation(internal.inspections.writeDamageResult, {
        inspectionId,
        mediaId: media[0]._id,
        ...d
      });
      await log(`Found minor ${d.damageType} on "${d.part}" (simulated full-image scan)`);
    }
  }

  // Stage 5
  await wait(800);
  await updateProgress("analyzing", 82, "Scanning full images for major damage...");
  await log("Full image scans completed. No major structural damage detected.");

  // Stage 6
  await wait(800);
  await updateProgress("analyzing", 95, "Running final integrity checks...");
  await ctx.runMutation(internal.inspections.writeIntegrityCheck, {
    inspectionId,
    checkType: "vehicle_consistency",
    status: "pass",
    summary: "Mock analysis: vehicle panels match model visual specifications."
  });
  await ctx.runMutation(internal.inspections.writeIntegrityCheck, {
    inspectionId,
    checkType: "image_authenticity",
    status: "pass",
    summary: "Mock analysis: image file headers and metadata structures are consistent."
  });

  await wait(500);
  await ctx.runMutation(internal.shared.updateInspectionProgressInternal, {
    inspectionId,
    status: "done",
    progress: 100,
    progressMessage: "Analysis complete (simulated)."
  });

  const finalCount = mockDamages.length;
  await ctx.runMutation(internal.inspections.completeInspection, {
    inspectionId,
    totalDamageCount: finalCount
  });
  await log(`Simulation complete. Found ${finalCount} simulated damages.`);
}

function buildAnalysisGroups(payloads: ImagePayload[]): AnalysisGroup[] {
  const labelsByKey: Record<string, string> = {
    front: "Front-related views",
    left: "Left-side views",
    right: "Right-side views",
    rear: "Rear-related views",
    closeup: "Close-up damage views",
    exterior: "Other exterior views"
  };
  const order = ["front", "left", "right", "rear", "closeup", "exterior"];
  const grouped = new Map<string, ImagePayload[]>();

  for (const payload of payloads) {
    const keys = getAnalysisGroupKeys(payload.media.viewLabel || "");
    for (const key of keys) {
      const groupPayloads = grouped.get(key) || [];
      if (!groupPayloads.some((existing) => existing.imageId === payload.imageId)) {
        groupPayloads.push(payload);
      }
      grouped.set(key, groupPayloads);
    }
  }

  return order
    .filter((key) => grouped.has(key))
    .map((key) => ({
      key,
      label: labelsByKey[key] || key,
      payloads: grouped.get(key) || []
    }));
}

function getAnalysisGroupKeys(viewLabel: string): string[] {
  const normalized = viewLabel.toLowerCase();
  const keys = new Set<string>();

  if (normalized.includes("front")) keys.add("front");
  if (normalized.includes("left")) keys.add("left");
  if (normalized.includes("right")) keys.add("right");
  if (normalized.includes("rear") || normalized.includes("back")) keys.add("rear");
  if (normalized.includes("close-up") || normalized.includes("closeup") || normalized.includes("damage")) keys.add("closeup");
  if (keys.size === 0) keys.add("exterior");

  return Array.from(keys);
}

async function analyzeImageGroup(
  apiKey: string,
  model: string,
  group: AnalysisGroup,
  log: (msg: string) => Promise<void>
): Promise<GroupAnalysisResult> {
  await log(`  ${group.label}: pass 1 started with ${group.payloads.length} image(s).`);
  const pass1 = await callGeminiWithImages(apiKey, model, group.payloads, buildGroupAnalysisPrompt(group, 1));

  await log(`  ${group.label}: pass 2 critique started.`);
  const pass2 = await callGeminiWithImages(
    apiKey,
    model,
    group.payloads,
    buildGroupAnalysisPrompt(group, 2, pass1)
  );

  await log(`  ${group.label}: pass 3 final missed-damage review started.`);
  const pass3 = await callGeminiWithImages(
    apiKey,
    model,
    group.payloads,
    buildGroupAnalysisPrompt(group, 3, { pass1, pass2 })
  );

  const result = hasAnalysisImages(pass3) ? pass3 : hasAnalysisImages(pass2) ? pass2 : pass1;
  await log(`  ${group.label}: completed with ${countResultDamages(result)} candidate finding(s).`);
  return {
    groupKey: group.key,
    groupLabel: group.label,
    imageIds: group.payloads.map((payload) => payload.imageId),
    result
  };
}

function buildGroupAnalysisPrompt(group: AnalysisGroup, passNumber: number, priorResult?: any): string {
  const imageContext = group.payloads.map((payload) => ({
    imageId: payload.imageId,
    fileName: payload.media.fileName,
    classifiedView: payload.media.viewLabel || "Exterior view",
    classificationDescriptions: payload.media.visiblePartDescriptions || []
  }));
  const prior = priorResult ? `\n\nPrior analysis JSON to audit and improve:\n${compactJson(priorResult, 18000)}` : "";
  const passInstruction = passNumber === 1
    ? "Create the first complete damage analysis for this grouped vehicle view."
    : passNumber === 2
      ? "Critique the prior analysis. Assume something may have been missed. Reinspect all images and return a full corrected result, not only additions."
      : "Final strict review. Combine pass 1 and pass 2, search again for missing or over-reported findings, then return the best full corrected result.";

  return `
    You are performing deterministic vehicle damage analysis for the group: ${group.label}.
    Use the original uploaded image resolution. Do not assume any crop or preprocessing.
    ${passInstruction}

    Image context from camera classification:
    ${JSON.stringify(imageContext, null, 2)}

    IMPORTANT OUTPUT CONSISTENCY:
    - Be conservative and repeatable. The same images should produce materially the same findings across runs.
    - Only report physical vehicle anomalies supported by visual evidence.
    - Do NOT report dirt, dust, water drops, glare, shadows, sky/tree/building reflections, or compression artifacts as scratches or dents.
    - However, if heavy dirt or grime is visibly MASKING an area where damage could be hidden underneath, report it as damageType "obstruction" with severity "minor" and describe the area that needs cleaning for proper inspection.
    - If an area is not inspectable, say so in imageDescription or coverageDescription instead of inventing damage.
    - damageType must be exactly one value from this label list: ${DAMAGE_LABELS.join(", ")}.

    CO-LOCATED DAMAGE RULE (CRITICAL):
    A single part can have MULTIPLE co-existing damage types. For example:
    - A hood can have BOTH misalignment/panel_gap AND surface denting — report each as a SEPARATE finding.
    - A bumper can have BOTH a missing section AND scuffs/paint transfer — report each separately.
    - A fender can have BOTH a dent AND scratches — report each separately.
    Always report each distinct damage type as its own finding even if they overlap spatially on the same part.

    CROSS-IMAGE DEDUPLICATION (CRITICAL):
    When multiple images show the SAME physical part of the vehicle from different angles:
    - Report each unique physical damage ONLY ONCE, in the SINGLE IMAGE where it is MOST CLEARLY VISIBLE.
    - Do NOT report the same bumper dent in both the "front view" image AND the "front right view" image.
    - Before adding a damage finding to an image, check: "Have I already reported this exact physical damage in another image?" If yes, SKIP it.
    - The rule is: ONE physical damage = ONE finding in ONE image. Choose the image with the best angle and clarity for that damage.

    DAMAGE TAXONOMY AND LABEL MAPPING (STRICT — ONLY 3 TYPES ALLOWED):
    You MUST classify every damage into EXACTLY one of these 3 labels. No other labels are allowed:
    1. scratch — any linear surface mark, paint scuff, scrape, abrasion, paint scratch, key scratch, brush mark, paint chip, or surface mark that removes or displaces paint. This is surface-level only with no deformation.
    2. dent — any physical deformation, depression, dip, crease, push-in, buckle, or surface waviness that changes the panel shape. Includes shallow dents, deep dents, crease dents, and impact deformations.
    3. damaged — ALL other damage types: tears, cracks, broken parts, missing parts, structural damage, crushed panels, broken glass, broken lights, detached parts, missing trim, rust, holes, punctures, or any damage that doesn't fit scratch or dent.

    STRICT GUARDRAILS:
    - Do NOT use panel_gap, misalignment, part_dislocation, structural_damage, tear, missing_part, emblem_damage, glass_crack, broken_glass, spider_web_fracture, glass_chip, wheel_anomaly, obstruction, rust, or paint_peel as damageType values.
    - If something looks like a panel gap or misalignment, classify it as "damaged" ONLY if it is actual physical damage. Normal manufacturing panel gaps and factory trim lines are NOT damage — do NOT report them.
    - If a bumper is hanging off or a headlight is broken, classify as "damaged".
    - If a badge or emblem is missing, classify as "damaged".

    LOOP 1 - IMAGE AND PART DESCRIPTION:
    For each image, describe the visible vehicle view and list every visible part.
    Mention coverage quality: fully visible, partially visible, steep angle, obscured, or not inspectable.

    LOOP 2 - SYSTEMATIC ANOMALY DETECTION:
    For each visible part in each image:
    - Inspect the panel for DENTS: look for surface deformations, buckles, creases, light reflection distortions, and surface waviness.
    - Inspect the panel for SCRATCHES: look for linear paint marks, scuffs, and surface abrasions — BUT verify they are NOT reflections, panel seams, trim lines, or dirt (see scratch false positive rules).
    - Inspect for other DAMAGE: torn parts, broken glass/lights, missing components, crushed panels, holes, cracks.
    - Check edges, corners, bumpers, and high-risk zones carefully.
    - Return boxes in original full-image 0-1000 coordinates.
    - Boxes must cover the full visible damaged/anomalous area, not only a center point.

    BOUNDING BOX PRECISION RULES (CRITICAL):
    - Each bounding box MUST tightly wrap ONLY the visually damaged area with a small margin (20-50 units).
    - Do NOT extend the box to cover the entire panel or component — only the damage itself.
    - For a scratch, the box should be a narrow rectangle covering just the scratch line plus small margin.
    - For a dent, the box should cover the visible deformation boundary, NOT the whole panel.
    - If two damages are on the same panel but separated by more than 80 units, they MUST have separate non-overlapping boxes.
    - NEVER make a box larger than 350x350 units unless the damage genuinely spans that area.
    - Prefer TIGHT boxes over generous boxes. A box that is too large is worse than a box that is slightly too small.

    SCRATCH FALSE POSITIVE PREVENTION (CRITICAL):
    Before reporting ANY scratch, you MUST mentally zoom into that specific area at high resolution and confirm:
    1. Is this an actual paint scratch/scuff, or is it one of these FALSE POSITIVES?
       - Body panel SEAM lines or panel EDGES — these are manufacturing features, NOT scratches.
       - TRIM lines, chrome strips, or rubber molding borders — NOT scratches.
       - REFLECTIONS of nearby objects (poles, fences, buildings, other cars) on the paint — NOT scratches.
       - SHADOW edges from surrounding objects or the car's own body lines — NOT scratches.
       - DIRT, dust, water streaks, or dried mud — NOT scratches unless paint is clearly damaged underneath.
       - JPEG compression artifacts or image noise — NOT scratches.
       - Door handle edges, fuel filler edges, or antenna lines — NOT scratches.
    2. A real scratch has a DISTINCT linear mark that INTERRUPTS the paint surface with visible paint removal, color change, or surface texture change.
    3. If you are not at least 70% confident that it is a real scratch and not a reflection/seam/edge, DO NOT report it.
    4. When in doubt, err on the side of NOT reporting a scratch. False positives are worse than missed scratches.

    DENT DETECTION TECHNIQUE (IMPORTANT):
    Dents are often subtle and easy to miss. Use these visual cues:
    1. LIGHT REFLECTION DISTORTION — look for warped, bent, or interrupted reflections on the body panels. A smooth panel reflects light evenly; a dent creates a distorted reflection.
    2. SURFACE WAVINESS — look for subtle undulations or ripples in the body panels, especially when viewed at shallow angles.
    3. SHADOW PATTERNS — dents create small shadow pockets or bright spots that differ from the surrounding surface.
    4. PAINT COLOR VARIATION — dents often cause subtle color shifts due to the angle change of the paint surface.
    5. HIGH-RISK DENT AREAS — doors, front/rear quarter panels, hood, trunk lid, roof, and pillars. Pay extra attention to these.
    6. Look carefully at EACH body panel individually. Scan slowly across the surface looking for ANY irregularity in the reflection pattern.

    LEFT vs RIGHT SIDE RULE:
    Damage on the left side and damage on the right side of the same part are SEPARATE findings. Always include the side (left/right/center) in the part name when the damage is on a specific side.

    Return exactly one JSON object:
    ${analysisSchemaExample()}

    SMALL/FINE DAMAGE DETECTION (MANDATORY):
    - Scan every panel for hairline scratches, minor scuffs, and light paint marks — but ONLY report them if they pass the scratch false positive checks above.
    - Pay special attention to: bumper corners, door edges, fender lips, mirror housings, rocker panels, wheel arch edges, fuel filler door area, and trunk/tailgate edges.
    - For each image, confirm you have checked ALL edges, transitions, and high-risk zones before finishing.
    - Number each damage finding sequentially within each image starting from 1 using the damageIndex field.
    ${prior}
  `.trim();
}

async function reconcileGroupAnalyses(
  apiKey: string,
  model: string,
  groupResults: GroupAnalysisResult[],
  payloads: ImagePayload[]
): Promise<any> {
  const mediaContext = payloads.map((payload) => ({
    imageId: payload.imageId,
    fileName: payload.media.fileName,
    viewLabel: payload.media.viewLabel || "Exterior view"
  }));
  const prompt = `
    You are the final vehicle damage report reconciler.
    You receive independent grouped analyses from parallel requests. Merge them into one clean inspection result.

    Rules:
    - Keep imageId values exactly as provided.
    - Do not invent new visual findings. Use only findings supported by the grouped analyses.
    - damageType must be exactly one value from this label list: ${DAMAGE_LABELS.join(", ")}.
    - Map any subtype wording to these 3 labels: paint scuff/scrape/abrasion → scratch, crease/buckle/deformation → dent, tear/crack/broken/missing/structural → damaged.
    - If a finding has a damageType like panel_gap, misalignment, part_dislocation, structural_damage, tear, missing_part — remap it to "damaged".
    - Normal factory panel gaps and trim lines are NOT damage — remove those findings entirely.

    CROSS-IMAGE DEDUPLICATION (MOST IMPORTANT RULE):
    - When the SAME physical damage is reported in multiple images (e.g., "front bumper dent" found in both "front view" and "front right view"), you MUST keep it ONLY in the ONE image where it is most clearly visible.
    - DELETE the duplicate findings from all other images. Do NOT repeat the same physical damage across multiple images.
    - Two findings are duplicates if they describe the same part, same damage type, and the same physical location on the vehicle — even if the box coordinates differ between images.
    - Example: "front bumper right side · scratch" in image_01 AND "front bumper right side · scratch" in image_03 = DUPLICATE. Keep only the one with the better view.

    FALSE POSITIVE SCRATCH REMOVAL:
    - Remove any scratch findings that describe panel seams, trim lines, reflections, shadows, dirt, or manufacturing edges.
    - A real scratch must show visible paint removal, color change, or surface texture disruption.
    - If a scratch description mentions "faint", "possible", "potential", or "might be" — remove it unless the confidence is above 0.7.

    DENT VERIFICATION:
    - Keep all dent findings. Dents are physical deformations that are hard to misidentify.
    - If a dent was found in the grouped analyses, preserve it in the final result.

    Media context:
    ${JSON.stringify(mediaContext, null, 2)}

    Parallel group outputs:
    ${compactJson(groupResults.map((group) => ({
      groupKey: group.groupKey,
      groupLabel: group.groupLabel,
      imageIds: group.imageIds,
      result: group.result
    })), 60000)}

    Return exactly one JSON object:
    ${analysisSchemaExample()}
  `.trim();

  return callGemini(apiKey, model, "text/plain", "", prompt);
}

async function persistAnalysisResult(
  ctx: any,
  inspectionId: any,
  imagePayloads: ImagePayload[],
  analysis: any,
  log: (msg: string) => Promise<void>
) {
  const analysisByImageId = new Map<string, any>();
  for (const item of Array.isArray(analysis?.images) ? analysis.images : []) {
    if (item?.imageId) analysisByImageId.set(String(item.imageId), item);
  }

  for (const payload of imagePayloads) {
    const imageAnalysis = analysisByImageId.get(payload.imageId) || {};
    const parts = Array.isArray(imageAnalysis.parts) ? imageAnalysis.parts : [];
    const mappedParts: Array<{ partName: string; box1000: Box1000; coveredParts?: string[] }> = [];
    const cropBox = payload.media.cropBox1000;

    for (const part of parts) {
      const box = sanitizeBox(part?.box1000);
      if (!box || !part?.partName) continue;
      const mappedBox = mapBoxBack(box, cropBox);
      mappedParts.push({
        partName: String(part.partName),
        box1000: expandBoxWithMin(mappedBox, 0.05, 120, 100),
        coveredParts: Array.isArray(part.coveredParts)
          ? part.coveredParts.filter((p: any) => typeof p === "string")
          : []
      });
    }

    await ctx.runMutation(internal.media.updateMediaMappedParts, {
      mediaId: payload.media._id,
      mappedParts
    });

    if (typeof imageAnalysis.imageDescription === "string" && imageAnalysis.imageDescription.trim()) {
      const existingDescriptions = Array.isArray(payload.media.visiblePartDescriptions)
        ? payload.media.visiblePartDescriptions
        : [];
      await ctx.runMutation(internal.media.updateMediaVisiblePartDescriptions, {
        mediaId: payload.media._id,
        visiblePartDescriptions: [imageAnalysis.imageDescription, ...existingDescriptions].slice(0, 12)
      });
    }

    const damages = Array.isArray(imageAnalysis.damages) ? imageAnalysis.damages : [];
    const damageAnnotations: DamageAnnotation[] = [];
    for (const d of damages) {
      const box = sanitizeBox(d?.box1000);
      if (!box) continue;
      const mappedBox = mapBoxBack(box, cropBox);
      const severity = sanitizeSeverity(d?.severity);
      const damageType = String(d?.damageType || "other");
      const expandedBox = expandDamageBox(mappedBox);

      let intensityScore = 5;
      if (severity === "minor") intensityScore = 2;
      else if (severity === "moderate") intensityScore = 5;
      else if (severity === "severe") intensityScore = 9;

      await ctx.runMutation(internal.inspections.writeDamageResult, {
        inspectionId,
        mediaId: payload.media._id,
        part: String(d?.part || "vehicle"),
        damageType,
        severity,
        confidence: clampConfidence(d?.confidence),
        description: String(d?.description || `Anomaly found on ${d?.part || "vehicle"}.`),
        box1000: expandedBox,
        isFromPartScan: false,
        recommendation: getRecommendation(damageType, severity),
        source: "vision_model",
        intensityScore
      });
      damageAnnotations.push({ box1000: expandedBox, severity, damageType, index: damageAnnotations.length + 1 });
    }

    await storeAnnotatedDamageImage(ctx, payload, damageAnnotations, log);
    await log(`Analyzed "${payload.media.fileName}": ${mappedParts.length} parts described, ${damages.length} reconciled finding(s).`);
  }
}

async function storeAnnotatedDamageImage(
  ctx: any,
  payload: ImagePayload,
  damages: DamageAnnotation[],
  log: (msg: string) => Promise<void>
) {
  if (damages.length === 0) return;

  try {
    const sourceBuffer = Buffer.from(payload.originalBase64 || payload.base64, "base64");
    const decoded = decodeJpeg(new Uint8Array(sourceBuffer), { useTArray: true, maxMemoryUsageInMB: 256 });
    const data = new Uint8Array(decoded.data);

    for (const damage of damages) {
      const color = getSeverityColor(damage.severity);
      drawBox1000(data, decoded.width, decoded.height, damage.box1000, color);
      const label = `#${damage.index} ${formatDamageLabel(damage.damageType)}`;
      drawLabel(data, decoded.width, decoded.height, damage.box1000, label, color);
    }

    const encoded = encodeJpeg({ data, width: decoded.width, height: decoded.height }, 90);
    const blob = new Blob([Buffer.from(encoded.data)], { type: "image/jpeg" });
    const annotatedStorageId = await ctx.storage.store(blob);

    await ctx.runMutation(internal.media.updateMediaAnnotatedStorageId, {
      mediaId: payload.media._id,
      annotatedStorageId
    });
  } catch (err: any) {
    console.warn(`Could not create annotated image for ${payload.media.fileName}:`, err);
    await log(`Annotation image skipped for "${payload.media.fileName}": ${err.message || String(err)}`);
  }
}

function formatDamageLabel(damageType: string): string {
  return String(damageType || "damage").replace(/_/g, " ");
}

function cropImageBase64(base64: string, cropBox: Box1000): string {
  try {
    const input = Buffer.from(base64, "base64");
    const decoded = decodeJpeg(new Uint8Array(input), { useTArray: true, maxMemoryUsageInMB: 256 });
    
    // Map 0-1000 coordinates to actual pixel box
    const left = Math.max(0, Math.min(decoded.width - 1, Math.round((cropBox.left / 1000) * decoded.width)));
    const top = Math.max(0, Math.min(decoded.height - 1, Math.round((cropBox.top / 1000) * decoded.height)));
    const right = Math.max(0, Math.min(decoded.width - 1, Math.round((cropBox.right / 1000) * decoded.width)));
    const bottom = Math.max(0, Math.min(decoded.height - 1, Math.round((cropBox.bottom / 1000) * decoded.height)));

    let boxW = right - left;
    let boxH = bottom - top;
    if (boxW <= 0) boxW = 1;
    if (boxH <= 0) boxH = 1;

    const output = new Uint8Array(boxW * boxH * 4);
    for (let y = 0; y < boxH; y += 1) {
      const sourceStart = ((top + y) * decoded.width + left) * 4;
      const targetStart = y * boxW * 4;
      output.set(decoded.data.subarray(sourceStart, sourceStart + boxW * 4), targetStart);
    }

    const encoded = encodeJpeg({ data: output, width: boxW, height: boxH }, 90).data;
    return Buffer.from(encoded).toString("base64");
  } catch (err) {
    console.error("Failed to crop image base64:", err);
    return base64; // Fallback to original
  }
}

function mapBoxBack(box: Box1000, cropBox?: Box1000): Box1000 {
  if (!cropBox) return box;
  const L = cropBox.left;
  const T = cropBox.top;
  const R = cropBox.right;
  const B = cropBox.bottom;

  return {
    left: Math.max(0, Math.min(1000, Math.round(L + (box.left / 1000) * (R - L)))),
    top: Math.max(0, Math.min(1000, Math.round(T + (box.top / 1000) * (B - T)))),
    right: Math.max(0, Math.min(1000, Math.round(L + (box.right / 1000) * (R - L)))),
    bottom: Math.max(0, Math.min(1000, Math.round(T + (box.bottom / 1000) * (B - T))))
  };
}

// Simple 5x7 bitmap font for digits and common ASCII (uppercase + lowercase)
const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPHS: Record<string, number[]> = {
  "#": [0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b00000, 0b00000],
  " ": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  "3": [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  "a": [0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
  "b": [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
  "c": [0b00000, 0b00000, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110],
  "d": [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111],
  "e": [0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110],
  "f": [0b00110, 0b01000, 0b11110, 0b01000, 0b01000, 0b01000, 0b01000],
  "g": [0b00000, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  "h": [0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
  "i": [0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
  "k": [0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  "l": [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "m": [0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001],
  "n": [0b00000, 0b00000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
  "o": [0b00000, 0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
  "p": [0b00000, 0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000],
  "r": [0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000],
  "s": [0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
  "t": [0b01000, 0b01000, 0b11110, 0b01000, 0b01000, 0b01001, 0b00110],
  "u": [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101],
  "w": [0b00000, 0b00000, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010],
  "x": [0b00000, 0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
  "y": [0b00000, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  "_": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111],
};

function drawLabel(
  data: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  box: Box1000,
  label: string,
  color: [number, number, number]
) {
  const scale = Math.max(1, Math.round(Math.min(imageWidth, imageHeight) / 600));
  const charW = GLYPH_W * scale + scale;
  const charH = GLYPH_H * scale;
  const padX = scale * 3;
  const padY = scale * 2;
  const maxLabelChars = 18;
  const truncatedLabel = label.length > maxLabelChars ? label.slice(0, maxLabelChars) : label;

  const labelWidth = truncatedLabel.length * charW + padX * 2;
  const labelHeight = charH + padY * 2;

  const boxLeft = Math.max(0, Math.min(imageWidth - 1, Math.round((box.left / 1000) * imageWidth)));
  const boxTop = Math.max(0, Math.min(imageHeight - 1, Math.round((box.top / 1000) * imageHeight)));

  // Position label just above the box; if no room, put it inside at the top
  let labelX = boxLeft;
  let labelY = boxTop - labelHeight - 1;
  if (labelY < 0) labelY = boxTop + 1;
  if (labelX + labelWidth > imageWidth) labelX = Math.max(0, imageWidth - labelWidth);

  // Draw filled background rectangle
  for (let dy = 0; dy < labelHeight && labelY + dy < imageHeight; dy++) {
    for (let dx = 0; dx < labelWidth && labelX + dx < imageWidth; dx++) {
      const px = labelX + dx;
      const py = labelY + dy;
      if (px >= 0 && py >= 0) {
        setPixel(data, imageWidth, px, py, color);
      }
    }
  }

  // Draw text in white
  const textColor: [number, number, number] = [255, 255, 255];
  let cursorX = labelX + padX;
  const textY = labelY + padY;
  for (const ch of truncatedLabel) {
    const glyph = GLYPHS[ch.toLowerCase()] || GLYPHS[" "];
    if (glyph) {
      for (let row = 0; row < GLYPH_H; row++) {
        const bits = glyph[row];
        for (let col = 0; col < GLYPH_W; col++) {
          if ((bits >> (GLYPH_W - 1 - col)) & 1) {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = cursorX + col * scale + sx;
                const py = textY + row * scale + sy;
                if (px >= 0 && px < imageWidth && py >= 0 && py < imageHeight) {
                  setPixel(data, imageWidth, px, py, textColor);
                }
              }
            }
          }
        }
      }
    }
    cursorX += charW;
  }
}

function drawBox1000(data: Uint8Array, width: number, height: number, box: Box1000, color: [number, number, number]) {
  const left = Math.max(0, Math.min(width - 1, Math.round((box.left / 1000) * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round((box.top / 1000) * height)));
  const right = Math.max(0, Math.min(width - 1, Math.round((box.right / 1000) * width)));
  const bottom = Math.max(0, Math.min(height - 1, Math.round((box.bottom / 1000) * height)));
  if (right <= left || bottom <= top) return;

  const thickness = Math.max(3, Math.round(Math.min(width, height) * 0.005));
  for (let offset = 0; offset < thickness; offset += 1) {
    drawHorizontalLine(data, width, height, left, right, top + offset, color);
    drawHorizontalLine(data, width, height, left, right, bottom - offset, color);
    drawVerticalLine(data, width, height, left + offset, top, bottom, color);
    drawVerticalLine(data, width, height, right - offset, top, bottom, color);
  }
}

function drawHorizontalLine(
  data: Uint8Array,
  width: number,
  height: number,
  x1: number,
  x2: number,
  y: number,
  color: [number, number, number]
) {
  if (y < 0 || y >= height) return;
  const start = Math.max(0, Math.min(x1, x2));
  const end = Math.min(width - 1, Math.max(x1, x2));
  for (let x = start; x <= end; x += 1) {
    setPixel(data, width, x, y, color);
  }
}

function drawVerticalLine(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y1: number,
  y2: number,
  color: [number, number, number]
) {
  if (x < 0 || x >= width) return;
  const start = Math.max(0, Math.min(y1, y2));
  const end = Math.min(height - 1, Math.max(y1, y2));
  for (let y = start; y <= end; y += 1) {
    setPixel(data, width, x, y, color);
  }
}

function setPixel(data: Uint8Array, width: number, x: number, y: number, color: [number, number, number]) {
  const index = (y * width + x) * 4;
  data[index] = color[0];
  data[index + 1] = color[1];
  data[index + 2] = color[2];
  data[index + 3] = 255;
}

function getSeverityColor(severity: "minor" | "moderate" | "severe"): [number, number, number] {
  if (severity === "severe") return [229, 62, 62];
  if (severity === "moderate") return [221, 107, 32];
  return [49, 151, 149];
}

function combineGroupAnalyses(groupResults: GroupAnalysisResult[]): any {
  const byImageId = new Map<string, any>();

  for (const group of groupResults) {
    for (const image of Array.isArray(group.result?.images) ? group.result.images : []) {
      if (!image?.imageId) continue;
      const imageId = String(image.imageId);
      const current = byImageId.get(imageId) || {
        imageId,
        imageDescription: "",
        parts: [],
        damages: []
      };
      if (image.imageDescription && !current.imageDescription) {
        current.imageDescription = image.imageDescription;
      }
      if (Array.isArray(image.parts)) current.parts.push(...image.parts);
      if (Array.isArray(image.damages)) current.damages.push(...image.damages);
      byImageId.set(imageId, current);
    }
  }

  return { images: Array.from(byImageId.values()) };
}

function hasAnalysisImages(result: any): boolean {
  return Array.isArray(result?.images) && result.images.length > 0;
}

function countResultDamages(result: any): number {
  return (Array.isArray(result?.images) ? result.images : []).reduce((count: number, image: any) => {
    return count + (Array.isArray(image?.damages) ? image.damages.length : 0);
  }, 0);
}

function compactJson(value: any, maxChars: number): string {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...truncated for prompt length...`;
}

function analysisSchemaExample(): string {
  return `{
  "images": [
    {
      "imageId": "image_01",
      "imageDescription": "Natural description of the image and visible vehicle angle.",
      "parts": [
        {
          "partName": "front bumper left half",
          "coveredParts": ["front bumper", "lower valance", "left fog light surround"],
          "coverageDescription": "Fully visible from the front-left angle.",
          "box1000": { "left": 60, "top": 520, "right": 520, "bottom": 860 }
        }
      ],
      "damages": [
        {
          "damageIndex": 1,
          "part": "front bumper left half",
          "damageType": "${DAMAGE_LABELS.join("|")}",
          "severity": "minor|moderate|severe",
          "confidence": 0.0,
          "description": "Describe the anomaly and the visual evidence supporting it.",
          "box1000": { "left": 120, "top": 650, "right": 310, "bottom": 735 }
        }
      ]
    }
  ]
}`;
}

// HELPER: Coordinate math and validation
function sanitizeBox(box: any): Box1000 | null {
  if (!box) return null;
  const left = clampCoord(box.left);
  const top = clampCoord(box.top);
  const right = clampCoord(box.right);
  const bottom = clampCoord(box.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function clampCoord(val: any): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1000, Math.round(n)));
}

function clampConfidence(val: any): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0.75;
  return Math.max(0, Math.min(1, n));
}

function sanitizeSeverity(val: any): "minor" | "moderate" | "severe" {
  const s = String(val || "").toLowerCase();
  if (s === "severe" || s === "moderate" || s === "minor") return s;
  return "minor";
}

function expandBoxWithMin(box: Box1000, ratio: number, minWidth: number, minHeight: number): Box1000 {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const centerX = (box.left + box.right) / 2;
  const centerY = (box.top + box.bottom) / 2;
  const targetWidth = Math.max(width * (1 + ratio * 2), minWidth);
  const targetHeight = Math.max(height * (1 + ratio * 2), minHeight);
  let left = centerX - targetWidth / 2;
  let right = centerX + targetWidth / 2;
  let top = centerY - targetHeight / 2;
  let bottom = centerY + targetHeight / 2;

  if (left < 0) {
    right -= left;
    left = 0;
  }
  if (right > 1000) {
    left -= right - 1000;
    right = 1000;
  }
  if (top < 0) {
    bottom -= top;
    top = 0;
  }
  if (bottom > 1000) {
    top -= bottom - 1000;
    bottom = 1000;
  }

  return {
    left: clampCoord(left),
    top: clampCoord(top),
    right: clampCoord(right),
    bottom: clampCoord(bottom)
  };
}

function expandDamageBox(box: Box1000): Box1000 {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const shortSide = Math.max(1, Math.min(width, height));
  const longSide = Math.max(width, height);
  const area = width * height;
  const aspectRatio = longSide / shortSide;
  const isLinearMark = aspectRatio >= 3;

  // Tighter padding ratios — boxes should wrap the damage closely
  let paddingRatio = 0.06;
  let minWidth = width;
  let minHeight = height;

  if (area < 2500) {
    // Small damage: modest expansion, keep it compact
    paddingRatio = 0.15;
    if (isLinearMark) {
      const minLong = Math.max(55, longSide * 1.1);
      const minShort = 28;
      minWidth = width >= height ? minLong : minShort;
      minHeight = width >= height ? minShort : minLong;
    } else {
      minWidth = 40;
      minHeight = 40;
    }
  } else if (area < 10000) {
    // Medium damage: small expansion
    paddingRatio = 0.10;
    if (isLinearMark) {
      const minLong = Math.max(70, longSide * 1.08);
      const minShort = 35;
      minWidth = width >= height ? minLong : minShort;
      minHeight = width >= height ? minShort : minLong;
    } else {
      minWidth = Math.max(width, 50);
      minHeight = Math.max(height, 50);
    }
  } else if (area < 35000) {
    // Large damage: minimal expansion, box is already large enough
    paddingRatio = 0.06;
    minWidth = width;
    minHeight = height;
  }

  return expandBoxWithMin(box, paddingRatio, minWidth, minHeight);
}

function findDeterministicDuplicateIds(findings: any[]): string[] {
  const idsToDelete = new Set<string>();

  for (let i = 0; i < findings.length; i += 1) {
    for (let j = i + 1; j < findings.length; j += 1) {
      const a = findings[i];
      const b = findings[j];
      const aId = a?._id?.toString();
      const bId = b?._id?.toString();
      if (!aId || !bId || idsToDelete.has(aId) || idsToDelete.has(bId)) continue;
      if (!areLikelyDuplicateFindings(a, b)) continue;

      const keep = scoreFindingForDedup(a) >= scoreFindingForDedup(b) ? a : b;
      const remove = keep === a ? b : a;
      idsToDelete.add(remove._id.toString());
    }
  }

  return Array.from(idsToDelete);
}

function areLikelyDuplicateFindings(a: any, b: any): boolean {
  const partA = normalizeLabel(a.part);
  const partB = normalizeLabel(b.part);
  const typeA = normalizeLabel(a.damageType);
  const typeB = normalizeLabel(b.damageType);
  const sameMedia = a.mediaId?.toString() === b.mediaId?.toString();
  const relatedPart = partA === partB || partA.includes(partB) || partB.includes(partA);
  const relatedType = typeA === typeB || typeA.includes(typeB) || typeB.includes(typeA);
  const overlap = boxOverlapRatio(a.box1000, b.box1000);
  const centersClose = boxCenterDistance(a.box1000, b.box1000) < 115;

  // Never merge damage on opposite sides of the vehicle
  const sideA = extractSideFromLabel(partA);
  const sideB = extractSideFromLabel(partB);
  if (sideA && sideB && sideA !== sideB) return false;

  // Never merge different damage types on the same part (co-located damage)
  if (typeA !== typeB) return false;

  // SAME IMAGE: deduplicate by box overlap or proximity
  if (sameMedia && relatedType && (overlap >= 0.3 || centersClose)) return true;

  // CROSS-IMAGE: same part + same type = likely the same physical damage seen from different angles
  // (boxes from different images have incomparable coordinates, so we match by part name instead)
  if (!sameMedia && relatedPart && relatedType) return true;

  return false;
}

function scoreFindingForDedup(finding: any): number {
  const confidence = Number(finding.confidence || 0);
  const descriptionBonus = Math.min(String(finding.description || "").length / 500, 0.2);
  const severityBonus = finding.severity === "severe" ? 0.15 : finding.severity === "moderate" ? 0.08 : 0;
  return confidence + descriptionBonus + severityBonus;
}

function normalizeLabel(value: any): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function boxCenterDistance(a: Box1000, b: Box1000): number {
  const ax = (a.left + a.right) / 2;
  const ay = (a.top + a.bottom) / 2;
  const bx = (b.left + b.right) / 2;
  const by = (b.top + b.bottom) / 2;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function boxOverlapRatio(a: Box1000, b: Box1000) {
  const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const intersection = xOverlap * yOverlap;
  const smaller = Math.min(
    (a.right - a.left) * (a.bottom - a.top),
    (b.right - b.left) * (b.bottom - b.top)
  );
  return smaller > 0 ? intersection / smaller : 0;
}

function getRecommendation(type: string, severity: string): string {
  const t = String(type || "").toLowerCase();
  const s = String(severity || "").toLowerCase();
  if (t === "structural_damage") return "Requires structural body shop assessment and repair";
  if (t === "tear") return "Requires panel or bumper repair/replacement";
  if (t === "broken_glass") return "Requires glass or lamp replacement";
  if (t === "glass_crack" || t === "spider_web_fracture") return "Requires glass inspection and likely replacement";
  if (t === "glass_chip") return "Glass chip repair recommended if within repairable limits";
  if (t === "panel_gap" || t === "misalignment" || t === "part_dislocation") return "Requires fitment and alignment inspection";
  if (t === "missing_part") return "Requires replacement or refit of missing/loose part";
  if (t === "wheel_anomaly") return "Verify wheel specification match; check for prior undocumented repair or theft";
  if (t === "obstruction") return "Clean affected area and re-inspect for concealed damage";
  if (t === "emblem_damage") return "Verify brand identity; replace missing or damaged emblem";
  if (s === "severe") return "Requires body shop repair or replacement";
  if (s === "moderate") return "Requires standard panel repair and repainting";
  if (t === "scratch") return "Minor touch-up paint / polish recommended";
  if (t === "dent") return "Paintless dent repair or panel repair recommended";
  return "Monitor condition";
}

function extractSideFromLabel(label: string): string | null {
  if (/\bleft\b/.test(label)) return "left";
  if (/\bright\b/.test(label)) return "right";
  return null;
}

// DIRTY JSON PARSER (Strips comments, duplicated/trailing commas, and extracts JSON content)
function dirtyJsonParse(text: string): any {
  const trimmed = text.trim();

  const direct = tryParseJson(trimmed);
  if (direct.ok) return direct.value;

  for (const candidate of extractJsonCandidates(trimmed)) {
    const cleaned = cleanJsonText(candidate);
    const parsed = tryParseJson(cleaned);
    if (parsed.ok) return parsed.value;

    console.error("dirtyJsonParse failed to parse cleaned text:", cleaned);
  }

  throw new Error("No parseable JSON object or array found in the response text.");
}

function tryParseJson(text: string): { ok: true; value: any } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  for (let start = 0; start < text.length; start += 1) {
    const opening = text[start];
    if (opening !== "{" && opening !== "[") continue;

    const closingStack: string[] = [opening === "{" ? "}" : "]"];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < text.length; i += 1) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{" || char === "[") {
        closingStack.push(char === "{" ? "}" : "]");
      } else if (char === "}" || char === "]") {
        if (char !== closingStack[closingStack.length - 1]) break;
        closingStack.pop();
        if (closingStack.length === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }

  return candidates;
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      output += "\n";
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
    } else {
      output += char;
    }
  }

  return output;
}

function cleanJsonText(text: string): string {
  return stripTrailingJsonCommas(collapseRepeatedJsonCommas(stripJsonComments(text)));
}

function collapseRepeatedJsonCommas(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let pendingComma = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      pendingComma = false;
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      if (!pendingComma) output += char;
      pendingComma = true;
      continue;
    }

    if (!/\s/.test(char)) pendingComma = false;
    output += char;
  }

  return output;
}

function stripTrailingJsonCommas(text: string): string {
  return text.replace(/,\s*(\r?\n?\s*[}\]])/g, "$1");
}

async function loadImagePayloads(ctx: any, mediaItems: any[]): Promise<ImagePayload[]> {
  const payloads = await Promise.all(
    mediaItems.map(async (item, index) => {
      const url = await ctx.storage.getUrl(item.storageId);
      if (!url) throw new Error(`Could not generate download URL for ${item.fileName}`);

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not fetch photo ${item.fileName}`);

      const arrayBuffer = await response.arrayBuffer();
      return {
        imageId: `image_${String(index + 1).padStart(2, "0")}`,
        media: item,
        mimeType: item.mimeType || "image/jpeg",
        base64: Buffer.from(arrayBuffer).toString("base64")
      };
    })
  );

  return payloads;
}

async function callGeminiWithImages(
  apiKey: string,
  model: string,
  images: ImagePayload[],
  prompt: string,
  attempt: number = 1
): Promise<any> {
  const parts: any[] = [{ text: prompt }];
  for (const image of images) {
    parts.push({
      text: `Image ID: ${image.imageId}\nFile name: ${image.media.fileName}\nCurrent view label: ${image.media.viewLabel || "unknown"}`
    });
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64
      }
    });
  }

  return callGeminiWithParts(apiKey, model, parts, attempt);
}

// CALL GEMINI REST API
async function callGemini(
  apiKey: string,
  model: string,
  mimeType: string,
  base64: string,
  prompt: string,
  attempt: number = 1
): Promise<any> {
  const parts: any[] = [];
  if (base64) {
    parts.push({
      inlineData: {
        mimeType,
        data: base64
      }
    });
  }
  parts.push({ text: prompt });

  return callGeminiWithParts(apiKey, model, parts, attempt);
}

async function callGeminiWithParts(
  apiKey: string,
  model: string,
  parts: any[],
  attempt: number = 1
): Promise<any> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json"
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE"
          }
        ]
      })
    });

    if (response.status === 429 && attempt < GEMINI_MAX_ATTEMPTS) {
      const delay = attempt * 2000;
      console.warn(`Gemini API 429 rate limit hit. Retrying in ${delay}ms (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return callGeminiWithParts(apiKey, model, parts, attempt + 1);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error (status ${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const candidate = result?.candidates?.[0];
    const responseParts = candidate?.content?.parts || [];
    const text = responseParts
      .filter((p: any) => p.text && !p.thought)
      .map((p: any) => p.text)
      .join("\n")
      .trim();

    if (!text) {
      console.error("Gemini API returned empty text. Full response:", JSON.stringify(result));
      const finishReason = candidate?.finishReason || "unknown";
      throw new Error(`Gemini API returned empty text. finishReason: ${finishReason}. fullResponse: ${JSON.stringify(result)}`);
    }

    try {
      return dirtyJsonParse(text);
    } catch (err: any) {
      console.error("Gemini JSON parse failed. Original text:", text, "Full response:", JSON.stringify(result));
      throw new Error(`Could not parse JSON response from Gemini: ${text}. Error: ${err.message}`);
    }
  } catch (error: any) {
    if (attempt < GEMINI_MAX_ATTEMPTS) {
      const delay = attempt * 2000;
      console.warn(`Gemini API Request failed (Error: ${error.message || String(error)}). Retrying in ${delay}ms (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return callGeminiWithParts(apiKey, model, parts, attempt + 1);
    }
    throw error;
  }
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}
