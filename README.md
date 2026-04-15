# DamageLens Vehicle Inspection

DamageLens is a Netlify-only vehicle damage inspection website. Users upload a car photo, the site returns a marked image plus a plain-language damage report, and provider/model details stay hidden from the UI.

## Netlify-Only Architecture

```text
Browser
  -> Netlify static React app
  -> Netlify Function /.netlify/functions/analyze
  -> Google hosted model API
  -> Serverless image annotation with sharp
  -> Annotated image + report returned to browser
```

No separate FastAPI backend is required for the Netlify deployment path.

## Project Layout

```text
frontend/
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
GOOGLE_API_KEY=your_google_ai_api_key
GEMMA_MODEL_ID=gemma-4-26b-a4b-it
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

## Local Netlify-Style Development

Install frontend dependencies:

```powershell
cd frontend
npm install
```

Create a local env file in the repo root:

```powershell
cd ..
notepad .env
```

Add:

```env
GOOGLE_API_KEY=your_google_ai_api_key
GEMMA_MODEL_ID=gemma-4-26b-a4b-it
```

Run the full Netlify local environment from the repo root:

```powershell
npx netlify-cli dev
```

Open only this URL:

```text
http://localhost:8888
```

Do not use the Vite-only URL for image analysis. Plain Vite does not run Netlify Functions.

If you want the local command from inside `frontend/`, run:

```powershell
npm run dev
```

## User-Facing Behavior

The UI shows only:

- image upload
- loading animation
- input image
- annotated output image
- inspection summary
- damage findings

The visible UI does not show model names, API request payloads, backend names, or raw JSON.

## Notes

- The API key is stored as a Netlify environment variable and is only used inside the serverless function.
- Uploaded images are sent to the Netlify Function as base64 JSON.
- Uploads are limited to 4MB to stay practical for serverless request sizes.
- The serverless function returns data URLs for the original and annotated images, so no persistent file storage is needed.
- Bounding boxes are model-estimated and should be treated as inspection assistance, not a certified repair estimate.
