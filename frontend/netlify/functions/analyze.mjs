import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { resolve } from "node:path";
import sharp from "sharp";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "frontend", ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", ".env") });

const SYSTEM_PROMPT = `
You are an expert automotive damage assessor working from a single inspection photo.

Return exactly one JSON object using this schema:
{
  "summary": "one concise sentence",
  "damages": [
    {
      "label": "short human readable label",
      "damage_type": "scratch|dent|crack|paint_damage|bumper_damage|glass_damage|light_damage|panel_deformation|missing_part|other",
      "part": "specific car part",
      "severity": "minor|moderate|severe",
      "confidence": 0.0,
      "box_1000": {
        "left": 0,
        "top": 0,
        "right": 0,
        "bottom": 0
      },
      "evidence": "brief visual justification"
    }
  ]
}

Rules:
- Output JSON only. No markdown, no code fences, no commentary.
- Use image-relative coordinates normalized to integers from 0 to 1000.
- Boxes must tightly cover the damaged area, not the full car.
- Include at most 8 damage regions.
- If no obvious damage is visible, return an empty damages array.
- Keep labels short and practical.
- Confidence must be between 0.0 and 1.0.
`.trim();

const USER_PROMPT = `
Inspect this car image and identify visible exterior damage locations.
Focus on exact damaged region, damage type, affected part, severity, and short evidence text.
Respond with valid JSON only.
`.trim();

const SEVERITY_COLORS = {
  minor: "#25745f",
  moderate: "#e86f37",
  severe: "#b9382f"
};

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { detail: "Method not allowed." });
  }

  let stage = "initializing";
  try {
    stage = "checking configuration";
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return jsonResponse(503, { detail: "Inspection service is not configured." });
    }

    stage = "reading uploaded image";
    const body = JSON.parse(event.body || "{}");
    const image = parseDataUrl(body.image);
    if (!image) {
      return jsonResponse(400, { detail: "Upload a valid image file." });
    }

    const imageBuffer = Buffer.from(image.base64, "base64");
    if (imageBuffer.byteLength > 4 * 1024 * 1024) {
      return jsonResponse(413, { detail: "Image is too large. Use an image under 4MB." });
    }

    stage = "calling inspection model";
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMMA_MODEL_ID || "gemma-4-26b-a4b-it";
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          inlineData: {
            mimeType: image.mimeType,
            data: image.base64
          }
        },
        { text: USER_PROMPT }
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: 700
      }
    });

    stage = "parsing inspection result";
    const analysis = normalizePayload(parseModelJson(response.text || ""));
    stage = "annotating image";
    const annotated = await annotateImage(imageBuffer, image.mimeType, analysis.damages);

    return jsonResponse(200, {
      summary: analysis.summary,
      damages: analysis.damages.map(({ box_1000, ...publicDamage }) => publicDamage),
      original_image_data_url: `data:${image.mimeType};base64,${image.base64}`,
      annotated_image_data_url: annotated
    });
  } catch (error) {
    console.error(`[analyze] Failed while ${stage}:`, error);
    return jsonResponse(500, { detail: publicErrorMessage(stage, error) });
  }
}

function publicErrorMessage(stage, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (stage === "calling inspection model") {
    if (/api key|permission|unauthenticated|forbidden|quota|billing/i.test(message)) {
      return "Inspection service could not authenticate or is not enabled for this API key.";
    }
    if (/not found|model|unsupported/i.test(message)) {
      return "The configured inspection model is not available for this API key.";
    }
    return "The inspection model request failed. Check the Netlify terminal logs for details.";
  }
  if (stage === "parsing inspection result") {
    return "The inspection service returned an unexpected result. Try another image or retry.";
  }
  if (stage === "annotating image") {
    return "The inspection completed, but image annotation failed.";
  }
  return "Inspection failed. Please try another vehicle photo.";
}

function parseDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  return { mimeType, base64: match[2] };
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return JSON.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalizePayload(payload) {
  const damages = Array.isArray(payload.damages) ? payload.damages.slice(0, 8).map(normalizeDamage).filter(Boolean) : [];
  return {
    summary: typeof payload.summary === "string" && payload.summary.trim()
      ? payload.summary.trim()
      : damages.length
        ? "Visible exterior damage was detected."
        : "No obvious visible exterior damage was detected.",
    damages
  };
}

function normalizeDamage(rawDamage) {
  if (!rawDamage || typeof rawDamage !== "object") return null;
  const box = normalizeBox(rawDamage.box_1000 || rawDamage.box);
  if (!box) return null;

  const severity = ["minor", "moderate", "severe"].includes(String(rawDamage.severity).toLowerCase())
    ? String(rawDamage.severity).toLowerCase()
    : "moderate";
  const damageType = String(rawDamage.damage_type || "other").toLowerCase();
  const part = String(rawDamage.part || "unknown part").trim();
  const label = String(rawDamage.label || `${part} ${damageType}`).trim();

  return {
    label,
    damage_type: damageType,
    part,
    severity,
    confidence: clampNumber(rawDamage.confidence, 0, 1, 0.5),
    evidence: String(rawDamage.evidence || "").trim(),
    box_1000: box
  };
}

function normalizeBox(rawBox) {
  if (!rawBox || typeof rawBox !== "object") return null;
  const left = clampInt(rawBox.left ?? rawBox.x, 0, 1000, 0);
  const top = clampInt(rawBox.top ?? rawBox.y, 0, 1000, 0);
  let right = clampInt(rawBox.right ?? left + clampInt(rawBox.width, 0, 1000, 25), 0, 1000, left + 25);
  let bottom = clampInt(rawBox.bottom ?? top + clampInt(rawBox.height, 0, 1000, 25), 0, 1000, top + 25);
  if (right <= left) right = Math.min(1000, left + 25);
  if (bottom <= top) bottom = Math.min(1000, top + 25);
  return { left, top, right, bottom };
}

async function annotateImage(imageBuffer, mimeType, damages) {
  const image = sharp(imageBuffer).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || 1000;
  const height = metadata.height || 1000;
  const svg = buildOverlaySvg(width, height, damages);
  const output = await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${output.toString("base64")}`;
}

function buildOverlaySvg(width, height, damages) {
  const items = damages.map((damage, index) => {
    const box = damage.box_1000;
    const left = Math.round((box.left / 1000) * width);
    const top = Math.round((box.top / 1000) * height);
    const right = Math.round((box.right / 1000) * width);
    const bottom = Math.round((box.bottom / 1000) * height);
    const boxWidth = Math.max(8, right - left);
    const boxHeight = Math.max(8, bottom - top);
    const color = SEVERITY_COLORS[damage.severity] || SEVERITY_COLORS.moderate;
    const label = `${index + 1}. ${damage.label}`;
    const labelWidth = Math.min(width - left - 6, Math.max(120, label.length * 8 + 20));
    const labelY = Math.max(4, top - 34);

    return `
      <rect x="${left}" y="${top}" width="${boxWidth}" height="${boxHeight}" rx="10" ry="10"
        fill="none" stroke="${color}" stroke-width="5" />
      <rect x="${left}" y="${labelY}" width="${labelWidth}" height="28" rx="8" ry="8"
        fill="${color}" opacity="0.94" />
      <text x="${left + 10}" y="${labelY + 19}" fill="white"
        font-size="15" font-family="Arial, sans-serif" font-weight="700">${escapeXml(label)}</text>
    `;
  }).join("");

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${items}
    </svg>
  `;
}

function clampInt(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
