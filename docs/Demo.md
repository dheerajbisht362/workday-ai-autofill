# Demo — Recording Your Video

This is a **recording script** to help you produce a clean demo video showing
**upload → autofill → review** (and manual submission). It describes the exact screen
setup, the steps to perform, and the narration for each segment.

> ⚠️ **Important**: The extension never auto-submits. The demo should show the flow up to
> Workday's Review page and then (optionally) you clicking **Submit yourself** while
> narrating that the tool leaves submission to the user.

---

## 1. Before you record

1. **Start the backend** with a working `OPENAI_API_KEY` (parse always calls the AI —
   `USE_MOCK` is configured but not yet implemented, so set a real key in `backend/.env`):
   ```powershell
   cd backend
   .venv\Scripts\activate
   # ensure OPENAI_API_KEY is set in backend/.env
   uvicorn app.main:app --reload --port 8000
   ```
2. **Build + load the extension**:
   ```powershell
   cd extension
   npm run build
   ```
   → Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select
   `extension/dist`. Pin the extension icon.
3. **Prepare a sample resume** (PDF or DOCX). Any file works as long as it contains
   readable text (the backend extracts text and the AI parses it) — pick a realistic one
   for narration consistency.
4. **Pick the target page**: a public Workday apply URL, e.g.
   `https://target.wd5.myworkdayjobs.com/en-US/targetcareers/details/...`.
5. **Screen-recording tool**: OBS, Windows Xbox Game Bar, or your OS screen recorder.
   Record at 1080p. **Start recording before** opening the extension so nothing is missed.

---

## 2. Suggested layout

Open **two windows side by side**:

```
┌──────────────────────────┬──────────────────────────┐
│  Workday apply page tab  │  Chrome toolbar          │
│                          │  (extension icon pinned) │
│                          ├──────────────────────────┤
│                          │  Optional: localhost:8000│
│                          │  /docs (FastAPI)         │
└──────────────────────────┴──────────────────────────┘
```

Keep the extension **popup open on top** of the Workday page so the status bar,
progress pills, and review list stay visible.

---

## 3. Recording script (timeline)

### Segment A — Setup & goal (≈0:00–0:25)
- **Narrate**: "This is Workday AI Autofill. It parses a resume, maps it to a Workday
  application, fills the fields step by step, and stops at Review — submission stays
  manual."
- Show the pinned extension icon; the backend terminal tail (uvicorn logs).

### Segment B — Upload (≈0:25–0:50)
1. Click the extension icon → popup opens.
2. Click **📤 Upload Resume** → pick your `.pdf`.
3. Watch the status bar: *"Parsing …"* → **"Resume parsed and stored ✓"**.
4. Point out the **Resume card**: name, email, phone, location, and the stat pills
   (Skills / Experience / Education / Certs).
- **Narrate**: "The extension sent the file to the local backend, which extracted the
  text and mapped it to a structured profile."

### Segment C — Autofill (≈0:50–1:40)
1. Click **▶ Start Autofill**.
2. Watch fields populate on the Workday page; visible inputs fill one by one.
3. When the first step completes, the popup shows the **review list** (✓ filled /
   ⚠ needs attention / ? needs your decision) and **progress pills**.
4. Click **Next Step ➡️** repeatedly to advance through steps; pause/promise fills on
   each.
5. If a skills section is present, note the skills chips being added.
- **Narrate**: "Each step is detected from the page and filled automatically. Filled
  fields are never overwritten, and any field the AI isn't confident about is flagged for
  your review."

### Segment D — Review (≈1:40–2:00)
1. Click **✅ Review & Submit** to navigate to Workday's Review page.
2. Show the popup review list itemizing what was filled and anything still needing a
  decision.
- **Narrate**: "This is the safety boundary — here you verify everything."

### Segment E — Manual submission (≈2:00–2:15, optional)
1. Click Workday's **Submit** yourself.
- **Narrate**: "The extension never submits. You confirm, then click Submit — so no
  unauthorized applications are ever sent."

---

## 4. What to hide / avoid

- Do **not** show your real API key or `.env` contents.
- Do **not** show personal data you don't want shared; use a sample resume.
- Be aware that **each live AI parse consumes quota** — `USE_MOCK` demo mode is
  configured but not yet implemented, so use a real `OPENAI_API_KEY` or wire the mock
  first (see [AI Strategy](AI_Strategy.md#6-demo-mode-use_mock)).
- Keep the demo under ~2–3 minutes; tighter beats longer.
- If the target tenant requires sign-in, sign in **before** recording Segment B so the
  autofill flow is uninterrupted.

---

## 5. Reference: expected on-screen messages

| Stage | Status text you should see |
|-------|-----------------------------|
| Upload started | `Parsing <file>…` |
| Upload done | `Resume parsed and stored ✓` |
| Autofill | `Filled X/Y fields; validation=ready` (or `review needed`) |
| Review | Validation badge: `✅ Required fields ready` |
| Manual | *(none — you click Submit)* |