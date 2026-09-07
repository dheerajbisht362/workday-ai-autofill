# Setup Guide

This document walks you through getting **Workday AI Autofill** running on your machine —
both the FastAPI backend and the Chrome extension (Manifest V3).

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.11+ (3.13 tested) | Required by the FastAPI backend |
| Node.js | 18+ (20 tested) | Required by the Vite build toolchain |
| npm | 9+ | Ships with Node.js |
| Chrome or Edge | Latest | For installing the extension |

You also need at least **one** of:

- An **OpenAI-compatible** API key + base URL (used by `backend/app/ai/client.py`), **or**
- To **wire up demo mode first** — `USE_MOCK` and the referenced `MOCK_RESUME` module are
  declared but not yet fully implemented in the request path (see
  [AI Strategy](AI_Strategy.md#6-demo-mode-use_mock)). Until then, parsing always calls
  the AI, so the demo flow needs a real key.

> ⚠️ For the fastest live demo, provide a working `OPENAI_API_KEY`. Alternatively, follow
> the AI-Strategy note to wire `USE_MOCK` into `parse_resume` and add the mock module so
> uploads return a fixed profile without any AI call.

---

## 2. Backend setup

```powershell
cd backend

# 1) Create and activate a virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS / Linux:
# source .venv/bin/activate

# 2) Install Python dependencies
pip install -r requirements.txt

# 3) Configure environment
copy .env.example .env
# then edit .env — see the reference table below

# 4) Start the API server
uvicorn app.main:app --reload --port 8000
```

Verify the server is up:

```powershell
curl http://localhost:8000/health
# => {"status":"ok","ai_configured":true}
```

If you set `USE_MOCK=true`, `ai_configured` still only reflects whether an API key is
present — parsing requires a real key until demo mode is fully wired (see
[AI Strategy](AI_Strategy.md#6-demo-mode-use_mock)).

### `.env` reference

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *(empty)* | API key for the OpenAI-compatible provider |
| `OPENAI_BASE_URL` | `https://api.teamorouter.com/v1` | Base URL of the chat-completions endpoint |
| `OPENAI_MODEL` | `deepseek-v4-pro-free` | Model identifier |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CSV of CORS origins allowed to call the API |
| `MAX_RESUME_BYTES` | `8000000` | Max resume upload size (bytes) |
| `USE_MOCK` | `true` | Flag for offline demo mode — declared in settings but **not yet implemented**; see [AI Strategy](AI_Strategy.md#6-demo-mode-use_mock) |

> `.env` is git-ignored. Commit only `.env.example`.

---

## 3. Extension setup

```powershell
cd extension

# 1) Install Node dependencies
npm install

# 2) Type-check + build the extension into extension/dist/
npm run build

# 3) (optional) run the unit tests
npm run test
```

The build command does three things (see `extension/vite.config.ts` and `package.json`):

1. `tsc` — strict TypeScript type-check of `extension/src`.
2. `vite build` — bundles the **content script**, **service worker**, and **popup** into
   `extension/dist/`.
3. Copies `manifest.json` into `extension/dist/`.

### Load the extension in Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the `extension/dist` folder.
5. Pin the **Workday AI Autofill** icon to the toolbar.

> Note: When you rebuild after editing source, click the **↻ reload** icon on the
> extension card and refresh any open Workday tabs.

---

## 4. Trying it end-to-end (quick start)

1. Start the backend (Step 2) — leave the terminal running.
2. Load the extension (Step 3).
3. Open a public Workday apply page, for example:
   `https://target.wd5.myworkdayjobs.com/en-US/targetcareers/details/...`
4. Click the extension icon →
   **Upload Resume** → pick a `.pdf` or `.docx` →
   wait for *"Resume parsed and stored ✓"*.
5. Click **▶ Start Autofill** and watch the form fill across steps.
6. Use **Next Step ➡️** / **✅ Review & Submit** to advance; the final
   **Submit** click on Workday is always manual.

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Popup says `Upload failed: Failed to fetch` | Backend not running, or CORS | Confirm `uvicorn` is up on `:8000` and `ALLOWED_ORIGINS` includes the popup origin |
| `Content script is not available` | Old tab was opened before the extension loaded | Refresh the Workday tab |
| `GET /map-fields 404 / connection refused` | Backend stopped, or proxy blocks `localhost` | Restart backend; ensure no VPN/proxy routes `localhost` |
| AI 503 `rate limit or quota exceeded` | Provider quota exhausted | Retry later or point `OPENAI_BASE_URL` at another provider / key |
| `OPENAI_API_KEY is not configured` (503) | No key set, real AI path hit (mock not implemented) | Set a working `OPENAI_API_KEY`, or wire `USE_MOCK` first |
| Extension won't load (manifest error) | Outdated `dist/` | Run `npm run build` again |
| Skills aren't added | Autocomplete requires network + a provider with that suggestion | Confirm provider connection; skills without a dropdown match are skipped |