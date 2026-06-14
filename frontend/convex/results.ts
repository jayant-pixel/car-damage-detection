import { v } from "convex/values";
import { query } from "./_generated/server";

export const getInspectionResults = query({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const media = await ctx.db
      .query("inspectionMedia")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();
    const mediaById = new Map(media.map((item) => [item._id.toString(), item]));

    const damages = await ctx.db
      .query("damageResults")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    const integrityChecks = await ctx.db
      .query("integrityChecks")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    const roiScans = await ctx.db
      .query("roiScans")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    const damagesWithUrls = await Promise.all(
      damages.map(async (item) => {
        const mediaItem = mediaById.get(item.mediaId.toString()) || null;
        const imageUrl = mediaItem ? await ctx.storage.getUrl(mediaItem.storageId) : null;
        const annotatedImageUrl = (mediaItem && mediaItem.annotatedStorageId)
          ? await ctx.storage.getUrl(mediaItem.annotatedStorageId)
          : null;
        const partCropUrl = item.partCropStorageId ? await ctx.storage.getUrl(item.partCropStorageId) : null;
        return {
          ...item,
          imageUrl,
          annotatedImageUrl,
          partCropUrl,
          viewLabel: mediaItem?.viewLabel || "Exterior View",
          fileName: mediaItem?.fileName || "Unknown file"
        };
      })
    );

    const roiScansWithUrls = await Promise.all(
      roiScans.map(async (item) => {
        const mediaItem = mediaById.get(item.mediaId.toString()) || null;
        const imageUrl = mediaItem ? await ctx.storage.getUrl(mediaItem.storageId) : null;
        const cropUrl = await ctx.storage.getUrl(item.cropStorageId);
        return {
          ...item,
          imageUrl,
          cropUrl,
          viewLabel: mediaItem?.viewLabel || "Exterior View",
          fileName: mediaItem?.fileName || "Unknown file"
        };
      })
    );

    const partCoverage = await Promise.all(
      media.map(async (item) => ({
        mediaId: item._id,
        fileName: item.fileName,
        viewLabel: item.viewLabel || "Exterior View",
        imageUrl: await ctx.storage.getUrl(item.storageId),
        annotatedImageUrl: item.annotatedStorageId ? await ctx.storage.getUrl(item.annotatedStorageId) : null,
        visiblePartDescriptions: item.visiblePartDescriptions || [],
        mappedParts: (item.mappedParts || []).map((part) => ({
          partName: part.partName,
          coveredParts: part.coveredParts || [],
          box1000: part.box1000
        }))
      }))
    );

    return {
      damages: damagesWithUrls,
      integrityChecks,
      roiScans: roiScansWithUrls,
      partCoverage
    };
  }
});

export const getInspectionDamageResults = query({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    return await ctx.db
      .query("damageResults")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();
  }
});
