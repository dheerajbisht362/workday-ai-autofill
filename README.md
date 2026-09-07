# Workday AI Autofill

An **AI-assisted, user-confirmed** Chrome extension (Manifest V3) that parses a resume
and auto-fills a Workday job application step by step — stopping at the Review page so a
human always confirms and submits.

- **Deterministic core**: semantic DOM scanning + heuristic field mapping for the
  majority of fields (absent a network call).
- **AI fallback**: an OpenAI-compatible backend maps genuinely ambiguous fields, with
  confidence scores and safety constraints (never fabricates sensitive data).
- **Repeatable sections**: expands and fills Work Experience / Education entries and
  Workday's custom month/year date widgets.
- **Idempotent SPA handling**: a debounced `MutationObserver` re-fills on every Workday
  re-render without overwriting already-filled fields.
- **Safety by design**: authentication and final submission are always manual.

---

## Quick start

```powershell
# 1) Backend (keep this terminal running)
cd backend
python -m venv .venv ; .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # then set a working OPENAI_API_KEY (demo mode not yet implemented)
uvicorn app.main:app --reload --port 8000

# 2) Extension
cd extension
npm install
npm run build
```

Then load `extension/dist` as an unpacked extension in `chrome://extensions` (Developer
mode), open any `*.myworkdayjobs.com` apply page, and use the popup to
**Upload Resume → Start Autofill**.

Full instructions: **[docs/Setup.md](docs/Setup.md)**.

---

## Documentation

| Document | What it covers |
|----------|----------------|
| [Setup](docs/Setup.md) | Prerequisites, backend + extension setup, `.env` reference, troubleshooting |
| [Architecture](docs/Architecture.md) | Components, request flow, mapping / filling / navigation algorithms |
| [AI Strategy](docs/AI_Strategy.md) | Heuristic-first mapping, AI fallback, caching, confidence, safety prompts, demo mode |
| [Limitations](docs/Limitations.md) | Manual auth/submit, Workday DOM coupling, skills/date constraints, what it never does |
| [Demo](docs/Demo.md) | Step-by-step script for recording the upload → autofill → review → submit demo video |

---

## Repository layout

```
workday-ai-autofill/
├── backend/                       FastAPI AI backend
│   └── app/
│       ├── main.py                API routes, CORS, settings
│       ├── schemas.py             Pydantic models
│       ├── ai/                    OpenAI-compatible client + prompts
│       └── services/              PDF/DOCX text extraction
├── extension/                     Chrome extension (MV3)
│   ├── manifest.json
│   └── src/
│       ├── popup/                 extension UI
│       ├── content/               DOM scanner, mapper, filler, repeatable, navigator
│       ├── background/            service worker (routing + storage)
│       └── shared/                shared constants
├── docs/                          Setup / Architecture / AI Strategy / Limitations / Demo
└── LICENSE                        MIT
```

---

## Code of conduct for automation

- ✅ Fills fields, adds repeatable entries, adds skills, advances through steps.
- ✅ Provides a review list with confidence + reasons so you can verify.
- ❌ Never submits the application.
- ❌ Never fills credentials or bypasses authentication / CAPTCHA.
- ❌ Never fabricates demographic, EEO, legal, salary, or work-authorization data.

See **[docs/Limitations.md](docs/Limitations.md)** for the full list.
