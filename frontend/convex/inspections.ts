import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const listDashboardInspections = query({
  args: {},
  handler: async (ctx) => {
    const inspections = await ctx.db
      .query("inspections")
      .withIndex("by_createdAt")
      .order("desc")
      .take(50);

    const totalCount = inspections.length;
    const doneCount = inspections.filter((i) => i.status === "done").length;
    const analyzingCount = inspections.filter((i) => i.status === "analyzing").length;
    const failedCount = inspections.filter((i) => i.status === "failed").length;
    const totalDamages = inspections.reduce((acc, i) => acc + (i.totalDamageCount || 0), 0);

    return {
      inspections,
      stats: {
        totalCount,
        doneCount,
        analyzingCount,
        failedCount,
        totalDamages
      }
    };
  }
});

export const getInspection = query({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    return await ctx.db.get(inspectionId);
  }
});

export const getInspectionLogs = query({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    return await ctx.db
      .query("inspectionLogs")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();
  }
});

export const createInspection = mutation({
  args: {
    customerName: v.string(),
    vehicleNumber: v.string(),
    carModel: v.string()
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("inspections", {
      customerName: args.customerName.trim(),
      vehicleNumber: args.vehicleNumber.trim().toUpperCase(),
      carModel: args.carModel.trim(),
      status: "uploading",
      progress: 0,
      progressMessage: "Ready to upload photos. Up to 20 images are supported.",
      totalDamageCount: 0,
      totalImages: 0,
      classificationStatus: "pending",
      createdAt: now
    });
  }
});

export const updateInspectionProgress = mutation({
  args: {
    inspectionId: v.id("inspections"),
    status: v.union(
      v.literal("uploading"),
      v.literal("analyzing"),
      v.literal("done"),
      v.literal("failed")
    ),
    progress: v.number(),
    progressMessage: v.string()
  },
  handler: async (ctx, args) => {
    const patch: any = {
      status: args.status,
      progress: args.progress,
      progressMessage: args.progressMessage
    };
    if (args.status === "done" || args.status === "failed") {
      patch.completedAt = Date.now();
    }
    await ctx.db.patch(args.inspectionId, patch);
  }
});

export const deleteInspection = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    // 1. Delete all media and their storage files
    const media = await ctx.db
      .query("inspectionMedia")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    for (const item of media) {
      try {
        await ctx.storage.delete(item.storageId);
      } catch (err) {
        console.error("Failed to delete storage file", item.storageId, err);
      }
      await ctx.db.delete(item._id);
    }

    // 2. Delete all damage results and their zoomed crops (if any)
    const damages = await ctx.db
      .query("damageResults")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    for (const item of damages) {
      if (item.partCropStorageId) {
        try {
          await ctx.storage.delete(item.partCropStorageId);
        } catch (err) {
          console.error("Failed to delete crop storage file", item.partCropStorageId, err);
        }
      }
      await ctx.db.delete(item._id);
    }

    // 3. Delete ROI debug scans and their crops
    const roiScans = await ctx.db
      .query("roiScans")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    for (const item of roiScans) {
      try {
        await ctx.storage.delete(item.cropStorageId);
      } catch (err) {
        console.error("Failed to delete ROI crop storage file", item.cropStorageId, err);
      }
      await ctx.db.delete(item._id);
    }

    // 4. Delete integrity checks
    const checks = await ctx.db
      .query("integrityChecks")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    for (const item of checks) {
      await ctx.db.delete(item._id);
    }

    // 5. Delete logs
    const logs = await ctx.db
      .query("inspectionLogs")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    for (const item of logs) {
      await ctx.db.delete(item._id);
    }

    // 6. Delete inspection record itself
    await ctx.db.delete(inspectionId);
  }
});

// BACKGROUND MUTATIONS NEEDED BY PROCESSING PIPELINE

export const startInspectionAnalysis = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const now = Date.now();
    const inspection = await ctx.db.get(inspectionId);
    if (!inspection) throw new Error("Inspection not found");

    await ctx.db.patch(inspectionId, {
      status: "analyzing",
      progress: 30,
      progressMessage: "Starting vehicle damage analysis...",
      totalDamageCount: 0
    });

    await clearInspectionResults(ctx, inspectionId);

    await ctx.db.insert("inspectionLogs", {
      inspectionId,
      message: "Inspection analysis job started in background.",
      createdAt: now
    });

    // Directly chain Stage 3 (skipping Stage 1 & 2 view classification)
    await ctx.scheduler.runAfter(0, internal.processing.runAnalysisStage3, { inspectionId });
  }
});

export const startCameraClassification = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const now = Date.now();
    const inspection = await ctx.db.get(inspectionId);
    if (!inspection) throw new Error("Inspection not found");

    await ctx.db.patch(inspectionId, {
      classificationStatus: "classifying",
      progressMessage: "Starting camera view classification..."
    });

    await ctx.db.insert("inspectionLogs", {
      inspectionId,
      message: "Camera view classification started.",
      createdAt: now
    });

    await ctx.scheduler.runAfter(0, internal.processing.runAnalysisStage1And2, { inspectionId });
  }
});

export const updateClassificationStatusInternal = internalMutation({
  args: {
    inspectionId: v.id("inspections"),
    classificationStatus: v.union(v.literal("pending"), v.literal("classifying"), v.literal("completed")),
    progressMessage: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const patch: any = {
      classificationStatus: args.classificationStatus
    };
    if (args.progressMessage !== undefined) {
      patch.progressMessage = args.progressMessage;
    }
    await ctx.db.patch(args.inspectionId, patch);
  }
});

async function clearInspectionResults(ctx: any, inspectionId: any) {
  const damages = await ctx.db
    .query("damageResults")
    .withIndex("by_inspectionId", (q: any) => q.eq("inspectionId", inspectionId))
    .collect();
  for (const d of damages) {
    if (d.partCropStorageId) {
      try {
        await ctx.storage.delete(d.partCropStorageId);
      } catch {}
    }
    await ctx.db.delete(d._id);
  }

  const roiScans = await ctx.db
    .query("roiScans")
    .withIndex("by_inspectionId", (q: any) => q.eq("inspectionId", inspectionId))
    .collect();
  for (const r of roiScans) {
    try {
      await ctx.storage.delete(r.cropStorageId);
    } catch {}
    await ctx.db.delete(r._id);
  }

  const checks = await ctx.db
    .query("integrityChecks")
    .withIndex("by_inspectionId", (q: any) => q.eq("inspectionId", inspectionId))
    .collect();
  for (const c of checks) {
    await ctx.db.delete(c._id);
  }

  const logs = await ctx.db
    .query("inspectionLogs")
    .withIndex("by_inspectionId", (q: any) => q.eq("inspectionId", inspectionId))
    .collect();
  for (const l of logs) {
    await ctx.db.delete(l._id);
  }
}

export const writeDamageResult = internalMutation({
  args: {
    inspectionId: v.id("inspections"),
    mediaId: v.id("inspectionMedia"),
    part: v.string(),
    damageType: v.string(),
    severity: v.union(v.literal("minor"), v.literal("moderate"), v.literal("severe")),
    confidence: v.number(),
    description: v.string(),
    box1000: v.object({
      left: v.number(),
      top: v.number(),
      right: v.number(),
      bottom: v.number()
    }),
    isFromPartScan: v.boolean(),
    partCropStorageId: v.optional(v.id("_storage")),
    recommendation: v.string()
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("damageResults", {
      ...args,
      createdAt: Date.now()
    });
  }
});

export const deleteDamageResults = internalMutation({
  args: {
    damageResultIds: v.array(v.id("damageResults"))
  },
  handler: async (ctx, { damageResultIds }) => {
    for (const id of damageResultIds) {
      const record = await ctx.db.get(id);
      if (record) {
        if (record.partCropStorageId) {
          try {
            await ctx.storage.delete(record.partCropStorageId);
          } catch {}
        }
        await ctx.db.delete(id);
      }
    }
  }
});


export const writeRoiScan = internalMutation({
  args: {
    inspectionId: v.id("inspections"),
    mediaId: v.id("inspectionMedia"),
    partName: v.string(),
    sourceBox1000: v.object({
      left: v.number(),
      top: v.number(),
      right: v.number(),
      bottom: v.number()
    }),
    expandedBox1000: v.object({
      left: v.number(),
      top: v.number(),
      right: v.number(),
      bottom: v.number()
    }),
    cropStorageId: v.id("_storage"),
    zoomFactor: v.number()
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("roiScans", {
      ...args,
      damageCount: 0,
      status: "scanning",
      createdAt: Date.now()
    });
  }
});

export const updateRoiScanResult = internalMutation({
  args: {
    roiScanId: v.id("roiScans"),
    damageCount: v.number(),
    status: v.union(v.literal("damage_found"), v.literal("no_damage"))
  },
  handler: async (ctx, { roiScanId, damageCount, status }) => {
    await ctx.db.patch(roiScanId, {
      damageCount,
      status
    });
  }
});

export const writeIntegrityCheck = internalMutation({
  args: {
    inspectionId: v.id("inspections"),
    checkType: v.union(v.literal("image_authenticity"), v.literal("vehicle_consistency")),
    status: v.union(v.literal("pass"), v.literal("warning"), v.literal("fail")),
    summary: v.string(),
    details: v.optional(v.object({
      brandMismatch: v.optional(v.boolean()),
      licensePlateMismatch: v.optional(v.boolean()),
      wheelMismatch: v.optional(v.boolean()),
      colorMismatch: v.optional(v.boolean())
    }))
  },
  handler: async (ctx, args) => {
    const doc: any = {
      inspectionId: args.inspectionId,
      checkType: args.checkType,
      status: args.status,
      summary: args.summary,
      createdAt: Date.now()
    };
    if (args.details) {
      doc.details = args.details;
    }
    await ctx.db.insert("integrityChecks", doc);
  }
});

export const completeInspection = internalMutation({
  args: {
    inspectionId: v.id("inspections"),
    totalDamageCount: v.number()
  },
  handler: async (ctx, { inspectionId, totalDamageCount }) => {
    await ctx.db.patch(inspectionId, {
      totalDamageCount
    });
  }
});

export const resetClassificationStatus = mutation({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    await ctx.db.patch(inspectionId, {
      classificationStatus: "pending",
      progressMessage: "Ready to upload photos."
    });
    
    // Clear viewLabel and visiblePartDescriptions on all media
    const media = await ctx.db
      .query("inspectionMedia")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();
    for (const item of media) {
      await ctx.db.patch(item._id, {
        viewLabel: undefined,
        visiblePartDescriptions: undefined,
        mappedParts: undefined
      });
    }
  }
});



