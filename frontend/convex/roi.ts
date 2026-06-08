"use node";

import { v } from "convex/values";
import { Buffer } from "node:buffer";
import { decode as decodeJpeg, encode as encodeJpeg } from "jpeg-js";
import { internalAction } from "./_generated/server";

type Box1000 = { left: number; top: number; right: number; bottom: number };

export const cropPart = internalAction({
  args: {
    storageId: v.id("_storage"),
    box1000: v.object({
      left: v.number(),
      top: v.number(),
      right: v.number(),
      bottom: v.number()
    }),
    paddingRatio: v.number() // e.g., 0.25 for 25% padding
  },
  handler: async (ctx, { storageId, box1000, paddingRatio }) => {
    try {
      const url = await ctx.storage.getUrl(storageId);
      if (!url) throw new Error("Could not generate storage URL");
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not fetch image: ${response.statusText}`);
      
      const input = Buffer.from(await response.arrayBuffer());
      const decoded = decodeJpeg(new Uint8Array(input), { useTArray: true, maxMemoryUsageInMB: 256 });
      
      // 1. Expand the box coordinates by paddingRatio (e.g. 0.25)
      const expandedBox = expandBox1000(box1000, paddingRatio);
      
      // 2. Convert 0-1000 coordinates to actual pixel box
      const pixelBox = boxToPixels(expandedBox, decoded.width, decoded.height);
      
      // 3. Crop from original RGBA data
      const cropped = cropRgba(decoded.data, decoded.width, pixelBox);
      
      // 4. Determine upscale dimensions. Keep crops useful for inspection without sending oversized payloads.
      const targetWidth = Math.min(1500, Math.round(pixelBox.width * 3.5));
      const targetHeight = Math.max(1, Math.round((pixelBox.height / pixelBox.width) * targetWidth));
      
      // 5. Apply bilinear interpolation for high-quality upscaling (rather than nearest neighbor)
      const resized = resizeRgbaBilinear(cropped, pixelBox.width, pixelBox.height, targetWidth, targetHeight);
      
      // 6. Encode and store crop in Convex storage
      const encoded = encodeJpeg({ data: resized, width: targetWidth, height: targetHeight }, 90).data;
      const cropStorageId = await ctx.storage.store(new Blob([new Uint8Array(encoded)], { type: "image/jpeg" }));
      
      // 7. Calculate zoom factor
      const sourceArea = decoded.width * decoded.height;
      const cropArea = pixelBox.width * pixelBox.height;
      const zoomFactor = roundToOne(Math.sqrt(sourceArea / cropArea));
      
      return {
        cropStorageId,
        cropBase64: Buffer.from(encoded).toString("base64"),
        expandedBox1000: expandedBox,
        zoomFactor,
        success: true
      };
    } catch (err: any) {
      console.error("Failed to crop part:", err);
      return {
        success: false,
        error: err.message || String(err)
      };
    }
  }
});

function expandBox1000(box: Box1000, ratio: number): Box1000 {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const padX = Math.round(width * ratio);
  const padY = Math.round(height * ratio);
  return {
    left: clamp(box.left - padX, 0, 1000),
    top: clamp(box.top - padY, 0, 1000),
    right: clamp(box.right + padX, 0, 1000),
    bottom: clamp(box.bottom + padY, 0, 1000)
  };
}

function boxToPixels(box: Box1000, width: number, height: number) {
  const left = Math.floor((box.left / 1000) * width);
  const top = Math.floor((box.top / 1000) * height);
  const right = Math.ceil((box.right / 1000) * width);
  const bottom = Math.ceil((box.bottom / 1000) * height);
  
  // Ensure minimum pixel box size of 200x200
  let boxW = clamp(right - left, 200, width);
  let boxH = clamp(bottom - top, 200, height);
  
  let finalLeft = clamp(left, 0, width - boxW);
  let finalTop = clamp(top, 0, height - boxH);
  
  return {
    left: finalLeft,
    top: finalTop,
    width: boxW,
    height: boxH
  };
}

function cropRgba(data: Uint8Array, sourceWidth: number, box: { left: number; top: number; width: number; height: number }) {
  const output = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const sourceStart = ((box.top + y) * sourceWidth + box.left) * 4;
    const targetStart = y * box.width * 4;
    output.set(data.subarray(sourceStart, sourceStart + box.width * 4), targetStart);
  }
  return output;
}

function resizeRgbaBilinear(data: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number) {
  const output = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = (y / dstH) * srcH;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = srcY - y0;
    
    for (let x = 0; x < dstW; x++) {
      const srcX = (x / dstW) * srcW;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const fx = srcX - x0;
      
      // Blend 4 neighboring pixels
      for (let c = 0; c < 4; c++) {
        const tl = data[(y0 * srcW + x0) * 4 + c];
        const tr = data[(y0 * srcW + x1) * 4 + c];
        const bl = data[(y1 * srcW + x0) * 4 + c];
        const br = data[(y1 * srcW + x1) * 4 + c];
        
        output[(y * dstW + x) * 4 + c] = Math.round(
          tl * (1 - fx) * (1 - fy) +
          tr * fx * (1 - fy) +
          bl * (1 - fx) * fy +
          br * fx * fy
        );
      }
    }
  }
  return output;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundToOne(value: number) {
  return Math.round(value * 10) / 10;
}
