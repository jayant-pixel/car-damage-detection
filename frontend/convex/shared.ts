import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const appendInspectionLog = internalMutation({
  args: {
    inspectionId: v.id("inspections"),
    message: v.string()
  },
  handler: async (ctx, { inspectionId, message }) => {
    await ctx.db.insert("inspectionLogs", {
      inspectionId,
      message,
      createdAt: Date.now()
    });
  }
});

export const updateInspectionProgressInternal = internalMutation({
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
