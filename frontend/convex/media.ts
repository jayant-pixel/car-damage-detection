import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

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

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  }
});

export const attachUploadedMedia = mutation({
  args: {
    inspectionId: v.id("inspections"),
    slot: mediaSlot,
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number()
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Check for existing media in the slot
    const existing = await ctx.db
      .query("inspectionMedia")
      .withIndex("by_inspectionId_slot", (q) =>
        q.eq("inspectionId", args.inspectionId).eq("slot", args.slot)
      )
      .first();

    if (existing) {
      // Clean up old storage file
      try {
        await ctx.storage.delete(existing.storageId);
      } catch (err) {
        console.error("Failed to delete overwritten storage file", existing.storageId, err);
      }
      
      // Update with new media information
      await ctx.db.patch(existing._id, {
        fileName: args.fileName,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        storageId: args.storageId,
        viewLabel: undefined,
        uploadedAt: now
      });
    } else {
      // Insert new media
      await ctx.db.insert("inspectionMedia", {
        inspectionId: args.inspectionId,
        slot: args.slot,
        fileName: args.fileName,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        storageId: args.storageId,
        uploadedAt: now
      });
    }

    // Update the inspections total images count
    const allMedia = await ctx.db
      .query("inspectionMedia")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", args.inspectionId))
      .collect();

    await ctx.db.patch(args.inspectionId, {
      totalImages: allMedia.length,
      progressMessage: `${allMedia.length} image(s) uploaded.`
    });
  }
});

export const removeMedia = mutation({
  args: { mediaId: v.id("inspectionMedia") },
  handler: async (ctx, { mediaId }) => {
    const media = await ctx.db.get(mediaId);
    if (!media) return;

    // Delete the file from storage
    try {
      await ctx.storage.delete(media.storageId);
    } catch (err) {
      console.error("Failed to delete storage file", media.storageId, err);
    }

    // Delete the database record
    await ctx.db.delete(mediaId);

    // Update the inspections total images count
    const allMedia = await ctx.db
      .query("inspectionMedia")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", media.inspectionId))
      .collect();

    await ctx.db.patch(media.inspectionId, {
      totalImages: allMedia.length,
      progressMessage: allMedia.length > 0 ? `${allMedia.length} image(s) uploaded.` : "Ready to upload photos."
    });
  }
});

export const getInspectionMedia = query({
  args: { inspectionId: v.id("inspections") },
  handler: async (ctx, { inspectionId }) => {
    const media = await ctx.db
      .query("inspectionMedia")
      .withIndex("by_inspectionId", (q) => q.eq("inspectionId", inspectionId))
      .collect();

    return await Promise.all(
      media.map(async (item) => ({
        ...item,
        url: await ctx.storage.getUrl(item.storageId)
      }))
    );
  }
});

export const updateMediaViewLabel = internalMutation({
  args: {
    mediaId: v.id("inspectionMedia"),
    viewLabel: v.string()
  },
  handler: async (ctx, { mediaId, viewLabel }) => {
    await ctx.db.patch(mediaId, { viewLabel });
  }
});

export const updateMediaMappedParts = internalMutation({
  args: {
    mediaId: v.id("inspectionMedia"),
    mappedParts: v.array(
      v.object({
        partName: v.string(),
        box1000: v.object({
          left: v.number(),
          top: v.number(),
          right: v.number(),
          bottom: v.number()
        }),
        coveredParts: v.optional(v.array(v.string()))
      })
    )
  },
  handler: async (ctx, { mediaId, mappedParts }) => {
    await ctx.db.patch(mediaId, { mappedParts });
  }
});

export const updateMediaVisiblePartDescriptions = internalMutation({
  args: {
    mediaId: v.id("inspectionMedia"),
    visiblePartDescriptions: v.array(v.string())
  },
  handler: async (ctx, { mediaId, visiblePartDescriptions }) => {
    await ctx.db.patch(mediaId, { visiblePartDescriptions });
  }
});
