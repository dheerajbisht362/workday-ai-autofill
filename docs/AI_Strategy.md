# AI Strategy

This document explains **how** and **when** the AI provider is used, and the guardrails
that keep output deterministic and safe. The guiding principle is:

> **Use deterministic logic first. Call the AI only when a field genuinely needs it,
> call it at most once per step, and never let it fabricate data — especially sensitive,
> legal, or demographic facts.**

---

## 1. Two AI operations

The backend exposes exactly two AI-driven endpoints. Both use OpenAI-style
**structured JSON-schema responses** (`response_format.type = "json_schema"`, `strict:
true`) so the extension always receives valid, typed data.

### 1.1 Resume parsing — `POST /api/parse-resume`
- **Input**: raw text extracted from the uploaded PDF/DOCX.
- **Output**: a `ResumeProfile` — `basics`, `work_experience[]`, `education[]`,
  `skills[]`, `certifications[]`.
- **System prompt** (`backend/app/ai/prompts.py` → `RESUME_SYSTEM`):
  *"Extract resume facts only. Normalize dates to YYYY-MM where possible. Never invent
  employers, degrees, skills, dates, URLs or contact data."*
- Dates are normalized to `YYYY-MM` (or `YYYY`) so the filler can split them into
  month/year selects.

### 1.2 Field mapping — `POST /api/map-fields`
- **Input**: the `ResumeProfile` plus a list of **unresolved** `FieldInput`s.
- **Output**: one `MappingDecision` per field — `{ fieldId, value, confidence, source,
  reason }`.
- **System prompt** (`MAPPING_SYSTEM`):
  *"Map Workday fields to a candidate profile. Use only supported facts. Never fabricate
  demographic, EEO, legal, work authorization, criminal history, salary or other
  sensitive facts. If uncertain, return null with low confidence."*

---

## 2. Heuristic-first, AI-as-fallback

Field mapping never jumps straight to the AI. The content script does:

```
1. scanFields() → FieldDescriptor[]
2. heuristicMap()  → deterministic alias matching (confidence 0.98) for the ~common fields
                    (first/last/full name, email, phone, location, LinkedIn, GitHub, website)
3. unresolved = fields with confidence < AUTOFILL_THRESHOLD (0.90)
4. if unresolved non-empty → POST /api/map-fields (only unresolved fields)
5. merge: heuristic decisions win where they cleared the threshold,
          else the AI decision is used
```

Benefits of this split:

- **Cost & latency**: the majority of fields (names, contact info) never hit the network.
- **Determinism**: unambiguous fields are filled identically every run.
- **Accuracy**: the AI is reserved for genuinely ambiguous labels (application-specific
  questions, paraphrased labels, custom selects).

---

## 3. Caching — no redundant AI calls

Repeated SPA re-renders of the same step would otherwise re-call `/api/map-fields` on
every render. `mapper.ts` fixes this with a **per-step cache**:

- The cache key is built from the resume plus the *unresolved fields' metadata*
  (id, kind, label, description, name, placeholder, ariaLabel, required, options).
- If the key is unchanged and a previous AI result exists, the cached decisions are
  reused and **no network call is made**.
- Genuine UI changes (new or renamed fields) change the key and trigger a fresh AI
  mapping.

Resume *parsing* is intentionally *not* cached the same way — it runs once per upload and
is cheap relative to the mapping load.

---

## 4. Confidence threshold & field safety

| Confidence | Action |
|------------|--------|
| `>= 0.90` | Value is written to the field |
| `< 0.90` | Value is **not** auto-filled; surfaced to the user for review |

- `AUTOFILL_THRESHOLD = 0.90` (`extension/src/shared/config.ts`).
- Heuristic matches are pinned at `0.98` — high enough to auto-fill, low enough that a
  reviewer can still see the confidence and reason.
- The AI is *required* to emit a `confidence` and `reason` per field, which the popup's
  review list renders ("needs your decision", "needs attention").

**Formatting / widget guardrails in the filler:**

- Skills are **never** filled by `map_fields`; they go through the dedicated skills
  autocomplete loop (`fillSkills`), which types, enters, and clicks the checkbox — capped
  at 40 and restricted to safe characters.
- `file` inputs are never auto-filled (a human must attach their own documents).
- Radio groups are mapped at the *question* level; the AI answers the question (yes/no),
  and the matching option is clicked. Unresolvable groups are left for the user.
- Selects are matched by option value → exact text → substring, and `YYYY-MM` values are
  split into year/month parts and matched against month variants.
- If a field already holds a value, it is **never overwritten** (idempotency).

---

## 5. Safety & prompt discipline

The most important contract with the model:

- **No fabrication.** The mapping prompt explicitly forbids inventing demographic, EEO,
  legal, work-authorization, criminal-history, or salary facts. If the resume does not
  support a value, the model must return `null` with low confidence rather than guess.
- **Resume facts only.** The parsing prompt forbids inventing employers, degrees, skills,
  dates, URLs, or contact data.
- **Error handling.** If the AI call fails (network, rate limit, invalid response), the
  extension degrades gracefully: heuristic mappings are still used, and the request is
  reported back to the popup as an error instead of silently auto-filling garbage.

---

## 6. Demo mode (`USE_MOCK`)

The `Settings` class in `backend/app/main.py` defines a `USE_MOCK: bool = False` flag
(and `.env.example` ships it as `USE_MOCK=true`).

> **Current status:** as of this snapshot, `USE_MOCK` is **declared but not yet wired
> into the `/api/parse-resume` request path** — the flag exists in settings but parsing
> always calls the AI client. The referenced `MOCK_RESUME` module is also not present in
> the checked-in source. Treat demo mode as **configured-but-pending**, not live.

Consequences to be aware of when you run it:

- With `USE_MOCK=true` but **no API key**, `/api/parse-resume` returns HTTP `503`
  ("`OPENAI_API_KEY is not configured`") because the real AI path is still hit.
- To run the live flow offline, provide a real `OPENAI_API_KEY` (any OpenAI-compatible
  provider), or wire `USE_MOCK` into `parse_resume` (return the canned profile before the
  AI call) and add the mock module.

This is a convenient follow-up to fully realize the zero-config demo described in
[Setup](Setup.md).