import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const inspectionStatus = v.union(
  v.literal("uploading"),
  v.literal("analyzing"),
  v.literal("done"),
  v.literal("failed")
);

const mediaSlot = v.union(
  v.literal("image_01"),
  v.literal("image_02"),
  v.literal("image_03"),
  v.literal("image_04"),
  v.literal("image_05"),
  v.literal("image_06"),
  v.literal("image_07"),
  v.literal("image_08"),
  v.literal("image_09"),
  v.literal("image_10"),
  v.literal("image_11"),
  v.literal("image_12"),
  v.literal("image_13"),
  v.literal("image_14"),
  v.literal("image_15"),
  v.literal("image_16"),
  v.literal("image_17"),
  v.literal("image_18"),
  v.literal("image_19"),
  v.literal("image_20")
);

const classificationStatus = v.union(
  v.literal("pending"),
  v.literal("classifying"),
  v.literal("completed")
);

const severity = v.union(v.literal("minor"), v.literal("moderate"), v.literal("severe"));

const checkType = v.union(
  v.literal("image_authenticity"),
  v.literal("vehicle_consistency")
);

const checkStatus = v.union(
  v.literal("pass"),
  v.literal("warning"),
  v.literal("fail")
);

const roiScanStatus = v.union(
  v.literal("scanning"),
  v.literal("damage_found"),
  v.literal("no_damage")
);

const box1000 = v.object({
  left: v.number(),
  top: v.number(),
  right: v.number(),
  bottom: v.number()
});

export default defineSchema({
  inspections: defineTable({
    customerName: v.string(),
    vehicleNumber: v.string(),
    carModel: v.string(),
    status: inspectionStatus,
    progress: v.number(),
    progressMessage: v.string(),
    totalDamageCount: v.number(),
    totalImages: v.number(),
    classificationStatus: v.optional(classificationStatus),
    createdAt: v.number(),
    completedAt: v.optional(v.number())
  })
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"]),

  inspectionMedia: defineTable({
    inspectionId: v.id("inspections"),
    slot: mediaSlot,
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    storageId: v.id("_storage"),
    viewLabel: v.optional(v.string()), // e.g. "front", "rear", "left_side", "right_side", "close_up"
    visiblePartDescriptions: v.optional(v.array(v.string())),
    mappedParts: v.optional(
      v.array(
        v.object({
          partName: v.string(),
          box1000: box1000,
          coveredParts: v.optional(v.array(v.string()))
        })
      )
    ),
    uploadedAt: v.number()
  })
    .index("by_inspectionId", ["inspectionId"])
    .index("by_inspectionId_slot", ["inspectionId", "slot"]),

  damageResults: defineTable({
    inspectionId: v.id("inspections"),
    mediaId: v.id("inspectionMedia"),
    part: v.string(),
    damageType: v.string(),
    severity,
    confidence: v.number(),
    description: v.string(),
    box1000,
    isFromPartScan: v.boolean(),
    partCropStorageId: v.optional(v.id("_storage")),
    recommendation: v.string(),
    createdAt: v.number()
  })
    .index("by_inspectionId", ["inspectionId"])
    .index("by_mediaId", ["mediaId"]),

  roiScans: defineTable({
    inspectionId: v.id("inspections"),
    mediaId: v.id("inspectionMedia"),
    partName: v.string(),
    sourceBox1000: box1000,
    expandedBox1000: box1000,
    cropStorageId: v.id("_storage"),
    zoomFactor: v.number(),
    damageCount: v.number(),
    status: roiScanStatus,
    createdAt: v.number()
  })
    .index("by_inspectionId", ["inspectionId"])
    .index("by_mediaId", ["mediaId"]),

  integrityChecks: defineTable({
    inspectionId: v.id("inspections"),
    checkType,
    status: checkStatus,
    summary: v.string(),
    details: v.optional(v.object({
      brandMismatch: v.optional(v.boolean()),
      licensePlateMismatch: v.optional(v.boolean()),
      wheelMismatch: v.optional(v.boolean()),
      colorMismatch: v.optional(v.boolean())
    })),
    createdAt: v.number()
  })
    .index("by_inspectionId", ["inspectionId"]),

  inspectionLogs: defineTable({
    inspectionId: v.id("inspections"),
    message: v.string(),
    createdAt: v.number()
  })
    .index("by_inspectionId", ["inspectionId"])
});
