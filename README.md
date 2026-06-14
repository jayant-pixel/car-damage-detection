# DamageLens Vehicle Inspection

DamageLens is an enterprise vehicle claims audit application. The current UI uses Convex for case records, media storage, realtime processing state, audit findings, and export records, while the existing Netlify Function remains as a legacy single-image analysis fallback.

## Enterprise Convex Workflow

The current frontend has been upgraded to a case-based enterprise claims audit workflow:

- dashboard queue
- session-based analysis workspace
- 11-slot image upload grid
- Convex file uploads
- asynchronous processing timeline
- AI visual anomaly and relational consistency findings
- generated PDF reports linked to sessions

Convex is now the primary data layer for cases, media, jobs, audit results, and export records.

Required frontend environment variable:

```env
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_APP_LOGIN_EMAIL=auditor@example.com
VITE_APP_LOGIN_PASSWORD=change-this-password
VITE_APP_PROFILE_NAME=Auditor
```

Required Convex environment variables for AI visual anomaly and relational vehicle analysis:

```env
GOOGLE_API_KEY=your_google_ai_api_key
GEMMA_MODEL_ID=gemini-3.5-flash
```

Because SynthID detector access is not available yet, the Convex action uses Gemini multimodal image understanding to inspect uploaded claim photos for visible damage, edit/manipulation anomalies, and cross-image vehicle consistency. It compares model class, paint, trim, lamps, wheels, body geometry, documents, and damage continuity across the uploaded media slots.

Gemini model choice:

- Default: `gemini-3.5-flash`
- Override: set `GEMMA_MODEL_ID` in Convex if a deployment needs a different Gemini-compatible model.
- The native Gemini visual pipeline is the default damage-analysis flow. The Cloud Run / YOLO ML endpoint path is temporarily disabled in the Convex analysis action.
- Gemini-returned damage boxes are stored with findings and used to annotate result and print views. The backend also attempts to persist marked JPEG copies when the source image can be decoded as JPEG.

Install and initialize Convex from inside `frontend/`:

```powershell
npm install
npx convex dev
```

This shell may need to be PowerShell or a WSL 2/Linux Node environment. WSL 1 with a Windows Node install can fail before npm starts.

## Current Architecture

```text
Browser
  -> Netlify static React app
  -> Convex database, functions, file storage, and reactive queries
  -> Convex processing actions
  -> Analysis sessions and generated PDF reports
```

The legacy `/.netlify/functions/analyze` endpoint is still present for the older single-image flow, but the enterprise workflow is backed by Convex.

## Project Layout

```text
frontend/
  convex/
  src/main.tsx
  src/styles.css
  netlify/functions/analyze.mjs
  package.json
netlify.toml
```

## Netlify Setup

1. Push this repo to GitHub.
2. Create a new Netlify site from the repo.
3. Netlify will read `netlify.toml` from the repo root.
4. Add these Netlify environment variables:

```env
VITE_CONVEX_URL=https://your-deployment.convex.cloud
VITE_APP_LOGIN_EMAIL=auditor@example.com
VITE_APP_LOGIN_PASSWORD=change-this-password
VITE_APP_PROFILE_NAME=Auditor
GOOGLE_API_KEY=your_google_ai_api_key
GEMMA_MODEL_ID=gemini-3.5-flash
```

5. Deploy.

The build settings are already configured:

```toml
[build]
base = "frontend"
command = "npm run build"
publish = "dist"

[functions]
directory = "netlify/functions"
node_bundler = "esbuild"
```

## Local Development

Install frontend dependencies:

```powershell
cd frontend
npm install
```

Start Convex from inside `frontend/`:

```powershell
npx convex dev
```

Create a local env file for the frontend:

```powershell
notepad .env
```

Add:

```env
VITE_CONVEX_URL=https://your-deployment.convex.cloud
GOOGLE_API_KEY=your_google_ai_api_key
GEMMA_MODEL_ID=gemini-3.5-flash
```

Set the AI visual analyzer variables in Convex:

```powershell
npx convex env set GOOGLE_API_KEY your_google_ai_api_key
npx convex env set GEMMA_MODEL_ID gemini-3.5-flash
```

Run the local web app from inside `frontend/`:

```powershell
npm run dev
```

Open the URL printed by Netlify/Vite, usually:

```text
http://localhost:8888
```

The legacy single-image Netlify Function still requires Netlify dev. The enterprise Convex workflow requires Convex dev and `VITE_CONVEX_URL`.

## User-Facing Behavior

The UI shows only:

- landing and static login
- Dashboard
- Analysis
- Reports
- linked session images
- generated report PDFs

The visible UI does not show model names, API request payloads, backend names, or raw JSON.

## Notes

- The API key is stored as a Netlify environment variable and is only used inside the serverless function.
- Uploaded images are sent to the Netlify Function as base64 JSON.
- Uploads are limited to 4MB to stay practical for serverless request sizes.
- The serverless function returns data URLs for the original and annotated images, so no persistent file storage is needed.
- Bounding boxes are model-estimated and should be treated as inspection assistance, not a certified repair estimate.
