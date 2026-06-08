"use node";

import { v } from "convex/values";
import { Buffer } from "node:buffer";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

// Interfaces for coordinate box mapping
type Box1000 = { left: number; top: number; right: number; bottom: number };
type ImagePayload = {
  imageId: string;
  media: any;
  mimeType: string;
  base64: string;
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

const GEMINI_MAX_ATTEMPTS = readPositiveIntEnv("GEMINI_MAX_ATTEMPTS", 2);
const DAMAGE_LABELS = [
  "scratch",
  "dent",
  "tear",
  "structural_damage",
  "glass_crack",
  "glass_chip",
  "spider_web_fracture",
  "broken_glass",
  "panel_gap",
  "part_dislocation",
  "misalignment",
  "missing_part",
  "wheel_anomaly",
  "obstruction",
  "emblem_damage"
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
      const model = process.env.GEMMA_MODEL_ID || "gemini-3.5-flash";

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

        Mention important exterior and small parts when visible:
        hood, front bumper, rear bumper, fenders, doors, quarter panels, rocker panels/sills,
        wheel arch panels, A/B/C pillars, roof, trunk/tailgate, grille, mirrors, lamps,
        fog lights, tow hook covers, fuel filler door, lower valance, diffuser, license plate area,
        brand badges/emblems/logos (grille badge, trunk badge, fender badge), wheels/rims/tires.

        CRITICAL CLASSIFICATION RULE:
        - If a significant portion of the vehicle is visible, classify it as the matching exterior view.
        - Only use "Close-up damage view" for a tight close-up where the rest of the car is not visible.

        Return exactly one JSON object:
        {
          "images": [
            {
              "imageId": "image_01",
              "viewLabel": "Front view|Front left view|Front right view|Rear view|Rear left view|Rear right view|Left side view|Right side view|Interior view|VIN view|Odometer view|Close-up damage view",
              "visiblePartDescriptions": [
                "The front bumper is fully visible, including the lower valance and license plate surround.",
                "The left headlight and left front fender edge are visible with clear inspection coverage."
              ]
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

        await ctx.runMutation(internal.media.updateMediaViewLabel, {
          mediaId: payload.media._id,
          viewLabel
        });

        if (visiblePartDescriptions.length > 0) {
          await ctx.runMutation(internal.media.updateMediaVisiblePartDescriptions, {
            mediaId: payload.media._id,
            visiblePartDescriptions
          });
        }

        await log(`Photo "${payload.media.fileName}" identified as: ${viewLabel} (${visiblePartDescriptions.length} part descriptions)`);
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
      const model = process.env.GEMMA_MODEL_ID || "gemma-4-31b-it";

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

      await updateProgress("analyzing", 30, "Running parallel grouped anomaly analysis...");
      await log(`Stage 2/4: Preparing grouped full-resolution analysis for ${exteriorMedia.length} exterior photo(s)...`);

      if (exteriorMedia.length === 0) {
        await log("No exterior photos found for damage analysis.");
      } else {
        const imagePayloads = await loadImagePayloads(ctx, exteriorMedia);
        const groups = buildAnalysisGroups(imagePayloads);
        await log(`  Running ${groups.length} group(s) in parallel: ${groups.map((group) => group.label).join(", ")}.`);

        const groupResults = await Promise.all(
          groups.map((group) => analyzeImageGroup(apiKey, model, group, log))
        );

        await updateProgress("analyzing", 72, "Reconciling grouped analysis outputs...");
        const finalAnalysis = await reconcileGroupAnalyses(apiKey, model, groupResults, imagePayloads);
        const analysis = hasAnalysisImages(finalAnalysis) ? finalAnalysis : combineGroupAnalyses(groupResults);
        await persistAnalysisResult(ctx, inspectionId, imagePayloads, analysis, log);
      }

      await log("Parallel grouped damage analysis complete.");
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
      const model = process.env.GEMMA_MODEL_ID || "gemma-4-31b-it";
      if (!apiKey) throw new Error("API Key is missing in Stage 5 & 6");

      const media = await ctx.runQuery(api.media.getInspectionMedia, { inspectionId });
      if (!media || media.length === 0) {
        throw new Error("No inspection photos found.");
      }
      const sortedMedia = [...media].sort((a, b) => a._creationTime - b._creationTime);

      await updateProgress("analyzing", 90, "Deduplicating findings across views...");
      await log("Stage 3/4: Running deterministic and AI deduplication on full-resolution findings...");

      const allFindingsBeforeCleanup = await ctx.runQuery(api.results.getInspectionDamageResults, { inspectionId });
      const deterministicDuplicateIds = findDeterministicDuplicateIds(allFindingsBeforeCleanup);
      if (deterministicDuplicateIds.length > 0) {
        await ctx.runMutation(internal.inspections.deleteDamageResults, {
          damageResultIds: deterministicDuplicateIds.map((id) => id as any)
        });
        await log(`  Removed ${deterministicDuplicateIds.length} deterministic duplicate finding(s) before AI deduplication.`);
      }

      const allFindings = deterministicDuplicateIds.length > 0
        ? await ctx.runQuery(api.results.getInspectionDamageResults, { inspectionId })
        : allFindingsBeforeCleanup;

      if (allFindings.length > 1) {
        const mediaIdMap = new Map<string, { name: string; label: string }>();
        for (const item of sortedMedia) {
          mediaIdMap.set(item._id.toString(), { name: item.fileName, label: item.viewLabel || "Close-up damage view" });
        }

        const formattedFindings = allFindings.map((f: any) => {
          const mediaInfo = mediaIdMap.get(f.mediaId.toString());
          return {
            id: f._id.toString(),
            image: mediaInfo ? `${mediaInfo.name} (${mediaInfo.label})` : "unknown",
            part: f.part,
            damageType: f.damageType,
            severity: f.severity,
            confidence: f.confidence,
            description: f.description,
            isFromPartScan: f.isFromPartScan,
            box1000: f.box1000
          };
        });

        const dedupPrompt = `
          You are an expert vehicle damage claims auditor. Your task is to analyze a list of damage findings detected from different full-resolution images of the same vehicle and identify duplicates.

          A duplicate is when the exact same physical damage (e.g. the same scratch, the same dent, or the same paint scuff) is reported multiple times because it was visible in multiple photos or overlapping part checks.

          RULES FOR DUPLICATE GROUPING:
          1. Check coordinates, descriptions, and parts. If two findings are on the same side of the vehicle (e.g. left side) and describe similar length/type/position of damage, group them.
          2. CRITICAL: NEVER merge left-side damage with right-side damage, even if both are on the same part type. For example, "rear bumper left scuff" and "rear bumper right scuff" are SEPARATE physical damages on opposite sides of the vehicle — do NOT group them.
          3. CRITICAL: NEVER merge different damage types on the same part. For example, a "hood panel_gap" and a "hood dent" are different physical issues even if they overlap spatially — do NOT group them.
          4. For each group of duplicates, select the single "best" finding to KEEP, preferring higher confidence, clearer description, and more accurate box coverage.
          5. List the IDs of all other findings in the group to DELETE.

          Here is the list of findings:
          ${JSON.stringify(formattedFindings, null, 2)}

          Return exactly one JSON object:
          {
            "duplicateGroups": [
              {
                "reason": "Both findings describe the same 5cm scratch on the left front wheel arch panel visible from different views.",
                "keepId": "id_of_best_finding",
                "deleteIds": ["id_of_duplicate_1", "id_of_duplicate_2"]
              }
            ]
          }
          If there are no duplicates, return {"duplicateGroups": []}.
        `.trim();

        const dedupRes = await callGemini(apiKey, model, "text/plain", "", dedupPrompt);
        const groups = dedupRes?.duplicateGroups || [];
        const idsToDeleteSet = new Set<string>();

        for (const g of groups) {
          if (g.deleteIds && Array.isArray(g.deleteIds)) {
            for (const id of g.deleteIds) {
              if (id && id !== g.keepId) {
                idsToDeleteSet.add(id);
              }
            }
            await log(`  AI merged duplicate group: Keeping ${g.keepId}, deleting duplicates [${g.deleteIds.join(", ")}]. Reason: ${g.reason}`);
          }
        }

        const idsToDelete = Array.from(idsToDeleteSet).map((id) => id as any);
        if (idsToDelete.length > 0) {
          await ctx.runMutation(internal.inspections.deleteDamageResults, { damageResultIds: idsToDelete });
          await log(`  Successfully deleted ${idsToDelete.length} duplicate findings from database.`);
        } else {
          await log("  No duplicate findings were identified by the AI pass.");
        }
      } else {
        await log("  Skipping deduplication pass (1 or fewer findings).");
      }

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

    DAMAGE TAXONOMY AND LABEL MAPPING:
    1. Metal Damage - painted/metal body parts such as bumpers, bonnet/hood, doors, fenders, quarter panels, roof, boot/trunk, side panels:
       - scratch: light scratch, deep scratch, paint scratch, paint scuff, scrape, abrasion.
       - dent: small dent, large dent, shallow dent, sharp dent, crease dent, multiple dents, surface waviness/creases from impact.
       - tear: metal tear, bumper tear, split, cut, hole, puncture.
       - structural_damage: crushed panel, bent panel, deformed bumper, broken body part, collapsed section, severe impact damage.
    2. Glass Damage - windshield, windows, rear glass, sunroof glass, headlights, tail lights, fog lights:
       - glass_crack: linear crack, long crack, edge crack, stress crack, star crack.
       - glass_chip: stone chip, small chip, bullseye chip, pit mark, half-moon chip.
       - spider_web_fracture: spider crack, radial crack, web crack, shattered glass pattern.
       - broken_glass: broken headlight, broken tail light, shattered window, damaged windshield.
    3. Miscellaneous Damage - alignment, fitting, and part-position related damage:
       - panel_gap: bumper gap, door gap, hood gap, boot/trunk gap, fender gap.
       - part_dislocation: bumper dislocation, headlight dislocation, grille dislocation, mirror displacement, number plate displacement.
       - misalignment: bumper misalignment, door misalignment, hood misalignment, trunk misalignment, fender misalignment.
       - missing_part: loose bumper, missing trim, missing reflector, missing mirror cover, missing grille piece.
    4. Vehicle Anomalies - non-standard conditions visible in photos:
       - wheel_anomaly: mismatched wheel types on same vehicle (e.g. alloy on one side and steel on another), wrong wheel size, space-saver spare on driving position, damaged alloy rim.
       - obstruction: heavy dirt, mud, or grime masking potential damage underneath; area requires cleaning for proper inspection.
       - emblem_damage: missing brand badge, damaged logo, incorrect brand emblem, broken nameplate, missing model badge on grille, trunk, or fenders.

    LOOP 1 - IMAGE AND PART DESCRIPTION:
    For each image, describe the visible vehicle view and list every visible part.
    Mention coverage quality: fully visible, partially visible, steep angle, obscured, or not inspectable.
    Specifically note: brand badges/emblems/logos on grille, trunk, and fenders. Note all visible wheel types (alloy, steel, spare).

    LOOP 2 - SYSTEMATIC ANOMALY DETECTION:
    For each visible part in each image:
    - Inspect broad area first for missing parts, deformation, broken lamps/glass, panel gaps, structural damage, misalignment, part dislocation, and major dents.
    - Inspect medium areas using a 3x3 mental grid.
    - Inspect smaller high-risk areas using 5x5 to 10x10 mental grids for scratches, paint scuffs, glass chips, and hairline cracks.
    - Check edges, corners, wheel arches, rocker panels, bumpers, lamps, mirrors, panel transitions, and trim lines carefully.
    - Check brand badges and emblems: are they present, correctly oriented, and undamaged? If a badge is missing, cracked, or shows the wrong brand, report as emblem_damage.
    - Check wheels: compare wheel types across all images. If one wheel is alloy and another is steel on the same vehicle, report as wheel_anomaly.
    - Check for heavy dirt/grime that could be concealing damage underneath — report as obstruction if significant.
    - Return boxes in original full-image 0-1000 coordinates.
    - Boxes must cover the full visible damaged/anomalous area, not only a center point.

    LEFT vs RIGHT SIDE RULE:
    Damage on the left side and damage on the right side of the same part are SEPARATE findings. Always include the side (left/right/center) in the part name when the damage is on a specific side.

    Return exactly one JSON object:
    ${analysisSchemaExample()}
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
    - Merge duplicate damages that describe the same physical issue across front/left/right/rear/close-up groups.
    - Prefer the clearest description, highest confidence, and box that best covers the full visible damage area.
    - Preserve part coverage for each image so the report can mention parts identified and their source images.
    - If the same image appears in multiple groups, produce only one final entry for that image.
    - damageType must be exactly one value from this first-version label list: ${DAMAGE_LABELS.join(", ")}.
    - Map any subtype wording from the grouped analyses to the closest first-version label. For example, paint scuff maps to scratch, crease dent maps to dent, windshield crack maps to glass_crack, broken headlight maps to broken_glass, and bumper gap maps to panel_gap.

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

    for (const part of parts) {
      const box = sanitizeBox(part?.box1000);
      if (!box || !part?.partName) continue;
      mappedParts.push({
        partName: String(part.partName),
        box1000: expandBoxWithMin(box, 0.08, 180, 160),
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
    for (const d of damages) {
      const box = sanitizeBox(d?.box1000);
      if (!box) continue;
      const severity = sanitizeSeverity(d?.severity);
      const damageType = String(d?.damageType || "other");
      await ctx.runMutation(internal.inspections.writeDamageResult, {
        inspectionId,
        mediaId: payload.media._id,
        part: String(d?.part || "vehicle"),
        damageType,
        severity,
        confidence: clampConfidence(d?.confidence),
        description: String(d?.description || `Anomaly found on ${d?.part || "vehicle"}.`),
        box1000: expandDamageBox(box),
        isFromPartScan: false,
        recommendation: getRecommendation(damageType, severity)
      });
    }

    await log(`Analyzed "${payload.media.fileName}": ${mappedParts.length} parts described, ${damages.length} reconciled finding(s).`);
  }
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

  let paddingRatio = 0.16;
  let minWidth = width;
  let minHeight = height;

  if (area < 2500) {
    paddingRatio = 0.55;
    if (isLinearMark) {
      const minLong = Math.max(90, longSide * 1.25);
      const minShort = 48;
      minWidth = width >= height ? minLong : minShort;
      minHeight = width >= height ? minShort : minLong;
    } else {
      minWidth = 78;
      minHeight = 78;
    }
  } else if (area < 10000) {
    paddingRatio = 0.35;
    if (isLinearMark) {
      const minLong = Math.max(110, longSide * 1.18);
      const minShort = 56;
      minWidth = width >= height ? minLong : minShort;
      minHeight = width >= height ? minShort : minLong;
    } else {
      minWidth = Math.max(width, 92);
      minHeight = Math.max(height, 92);
    }
  } else if (area < 35000) {
    paddingRatio = 0.24;
    minWidth = Math.max(width, isLinearMark ? 120 : 100);
    minHeight = Math.max(height, isLinearMark ? 60 : 100);
    if (height > width && isLinearMark) {
      minWidth = Math.max(width, 60);
      minHeight = Math.max(height, 120);
    }
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

  if (sameMedia && relatedType && (overlap >= 0.3 || centersClose)) return true;
  return relatedPart && relatedType && overlap >= 0.45;
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
