# Architecture

## 1. Overview

**Workday AI Autofill** is a **Manifest V3 Chrome extension** paired with a lightweight
**FastAPI** backend. The extension does all DOM interaction inside the Workday tab; the
backend is the only component that talks to an AI provider.

```
┌─────────────────────────── Chrome Browser ───────────────────────────┐
│                                                                       │
│   ┌──────────────┐   ┌─────────────────────┐   ┌──────────────────┐  │
│   │   POPUP      │   │  SERVICE WORKER     │   │  CONTENT SCRIPT  │  │
│   │ (main.ts)    │──▶│  (service-worker.ts)│──▶│  (index.ts)      │  │
│   │ UI + upload  │   │  routes + storage   │   │  owns the DOM    │  │
│   └──────┬───────┘   └─────────┬───────────┘   └────────┬─────────┘  │
│          │ chrome.runtime      │ chrome.storage         │ scans /    │
│          ▼                     ▼  (persist resume)      │ fills /    │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                   FastAPI backend (localhost:8000)          │     │
│   │  /api/parse-resume   ⇄  AIClient.parse_resume              │     │
│   │  /api/map-fields     ⇄  AIClient.map_fields                │     │
│   └──────────────────────────────┬──────────────────────────────┘     │
│                                 ▼                                      │
│                    OpenAI-compatible chat completions API              │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. Components

### 2.1 Extension popup — `extension/src/popup/`
- **`main.ts`** — user interface. Handles file upload (reads the file as bytes →
  base64 → `chrome.runtime.sendMessage({ type: "PARSE_RESUME", … })`), renders the
  parsed resume summary, progress pills, and buttons.
- **`review.ts`** — renders a tiered review list (✓ filled / ⚠ needs attention /
  ? needs your decision) from the autofill result.
- **`index.html` / `style.css`** — popup markup and card-based stylesheet.

### 2.2 Service worker — `extension/src/background/service-worker.ts`
- Routes messages to the active tab's content script and to the backend.
- `PARSE_RESUME` → calls `POST {BACKEND_URL}/api/parse-resume`, persists the profile to
  `chrome.storage.local`, then forwards `SET_RESUME` to the active tab.
- `GET_RESUME` / `CLEAR_RESUME` → read / clear stored resume.
- `AUTOFILL`, `START_AUTOFILL`, `PAUSE_AUTOFILL`, `CONTINUE_REVIEW`,
  `NAVIGATE_NEXT_STEP`, `SCAN` → forwarded verbatim to the active content script.
### 2.3 Content script — `extension/src/content/`
Runs inside every `*.myworkdayjobs.com/*` page and **owns all DOM interaction**.

| Module | Responsibility |
|--------|-----------------|
| `dom-scanner.ts` | Enumerates form fields → `FieldDescriptor[]` (inputs, selects, textareas, rich text). Extracts label via `<label for>`, wrapping `<label>`, `fieldset>legend`, or a sibling label. |
| `mapper.ts` | Deterministic heuristic mapping (confidence `0.98`) for known labels, then delegates unresolved fields to `/api/map-fields`. Caches the AI result per step. |
| `filler.ts` | Writes values using the native value setter + synthetic `input` / `change` / `blur` events. Handles selects (option matching incl. `YYYY-MM` month/year splitting), checkboxes, radios, dates, and rich text. |
| `repeatable.ts` | Expands and fills repeatable sections (Work Experience / Education) and Workday custom date widgets. |
| `navigator.ts` | Workday step detection + `MutationObserver` that watches the SPA and schedules per-step autofill. |
| `validator.ts` | Reports required-but-empty and invalid email fields after each pass. |
| `types.ts` | Shared types: `FieldDescriptor`, `MappingDecision`, `ResumeProfile`, `FieldKind`. |

### 2.4 Backend — `backend/`
| File | Responsibility |
|------|-----------------|
| `app/main.py` | FastAPI app, CORS, `/health`, `/api/parse-resume`, `/api/map-fields`. |
| `app/schemas.py` | Pydantic models (`ResumeProfile`, `FieldInput`, `MappingDecision`, …). |
| `app/ai/client.py` | Thin wrapper over the OpenAI SDK using constrained JSON-schema responses. |
| `app/ai/prompts.py` | System prompts that constrain the AI to real resume facts and forbid fabricating sensitive data. |
| `app/services/resume_parser.py` | PDF (PyMuPDF) and DOCX (python-docx) text extraction. |

---

## 3. Request / data flow

### Upload → parse → store
```
popup (file→base64)
  → chrome.runtime.sendMessage(PARSE_RESUME)
  → service worker → POST /api/parse-resume  (backend extracts text + calls AI)
  → service worker saves profile to chrome.storage.local
  → service worker → SET_RESUME → content script (in-memory copy)
```
## 4. Key algorithms & design decisions

### 4.1 Heuristic-first mapping
`mapper.heuristicMap` normalizes each field's label + name + placeholder + aria-label and
runs an alias table (e.g. `first name`, `given name` → `first_name`) giving a
`confidence: 0.98` result. Anything below `AUTOFILL_THRESHOLD = 0.90` is considered
unresolved and handed to the AI (see [AI Strategy](AI_Strategy.md)).

### 4.2 Idempotent SPA autofill
Workday is a single-page app that re-renders a page repeatedly. The content script
observes DOM mutations (ignoring its own elements) and **debounces** them for **400 ms**,
then schedules `autofill()` after another **800 ms**. Because `filler.ts` never writes
into a field that already holds a value, re-runs are safe and converge instead of
duplicating or thrashing.

### 4.3 Repeatable sections
Workday repeats the same field labels (Company, Job Title, Start Date, …) per entry, so
`repeatable.ts` groups fields by **the ordinal position of each repeated label** rather
than relying on tenant-specific container IDs. It:
1. Counts current entries from the live DOM.
2. Clicks **Add** until the entry count matches the resume (bounded by a safety cap
   `target * 4`).
3. Fills each entry by label order, handling **"I currently work here"** toggles and
   month/year selects.
4. Handles Workday masked **MM/YYYY** date inputs and spin-button date widgets, falling
   back to the calendar picker when typing doesn't commit.

### 4.4 Skills widget
`fillSkills` types each skill **character-by-character**, presses **Enter** to open the
Workday suggestion, and clicks the checkbox option that matches. Guards:
- `skillsRunning` prevents re-entrancy while a pass is in flight.
- `skillsDone` ensures a pass runs once per step/resume (DOM mutations from adding skills
  would otherwise re-schedule autofill forever).
- `addedSkills()` detects already-selected chips and skips the section to avoid
  duplicates.
- Capped at 40 skills; skills containing unusual characters are skipped.

### 4.5 Navigation & step detection
`navigator.detectCurrentStep` classifies the current step by checking, in priority
order: the page **`<h1>`** (strongest signal), other headings, visible action buttons,
then `document.title`. It intentionally never reads `document.body.innerText` (forcing a
full layout/serialization on every mutation froze Workday pages).

"Next" buttons are matched by label — **"Submit" is intentionally excluded** — and the
code refuses to act on the **Review** step, leaving authentication and final submission to
the user by design.

### 4.6 Storage
`chrome.storage.local` persists the parsed resume across page navigations, so the user
never re-uploads between steps. Automation only ever runs after an explicit **Start
Autofill** click — it is **not** auto-restored on reload.

---

## 5. Build & test

- **Build**: `cd extension && npm run build` → `tsc` + `vite build` (bundles content
  script as an IIFE classic script, the service worker as an ES module, and the popup as
  a normal Vite page) then copies `manifest.json` into `dist/`.
- **Test**: `npm run test` (Vitest, jsdom environment, `src/**/*.test.ts`).
- **Backend tests**: `backend/` uses `pytest` (see `backend/pytest.ini`).

### Autofill each step (Trigger → Scan → Map → Fill → Validate → status)
```
1. MutationObserver (debounced 400ms) or explicit "Start Autofill"
2. navigation detected → step classification (h1 → headings → buttons → title)
3. scanFields()        → FieldDescriptor[]
4. buildMappings()     → heuristic map + AI map for unresolved (cached per step)
5. fillAll()           → writes values (idempotent, never overwrites filled)
6. fillRepeatableGroups()/fillDateWidgets()/fillSkills()
7. validate()          → missing required / invalid email
8. status() message + popup renderProgress()/renderReview()
```