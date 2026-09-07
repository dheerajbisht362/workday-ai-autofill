# Limitations & Known Issues

This document is an honest account of what **Workday AI Autofill** does **not** do, and
the conditions under which it may fail. Please read this before using the extension on a
real application.

---

## 1. Security & privacy

- **Authentication is always manual.** The extension never fills credentials and never
  handles SSO, 2FA, CAPTCHA, or re-login challenges. Workday's authentication page is
  detected and the automation pauses until *you* sign in.
- **Final submission is always manual.** By design, the code will **not** click Submit —
  the review step is the automation's terminal state. You review and submit yourself.
- **Data path.** Resume content is sent to your configured AI provider over HTTPS, parsed,
  and stored in `chrome.storage.local`. The backend runs on `localhost:8000` and has **no
  auth layer** — anyone on your machine's localhost can reach it. Do not deploy it as-is
  to a public network.
- **HTTP / localhost trust.** The backend uses HTTP on localhost. Do not run it behind a
  default (non-TLS) public port or tunnel it without adding authentication and TLS.

---

## 2. Workday DOM coupling (the biggest risk)

Workday is a heavily customized single-page app. Each tenant ("myworkdayjobs" site) can
theme and restructure its DOM differently, and Workday itself changes markup over time.

- Field/label detection is heuristic — it relies on `data-automation-id`, `<label for>`,
  `fieldset > legend`, and sibling-label heuristics. Unusual or customized markup can
  produce missing or wrong labels, which lowers confidence and leaves fields for review.
- Step detection classifies pages by `<h1>` → headings → buttons → `document.title`.
  Rare layouts may be misclassified as `unknown`, in which case the extension simply does
  **nothing** (safe failure).
- The date-widget and skills-widget drivers target specific `data-automation-id` patterns.
  If Workday changes them, adding skills or filling dates may stop working until the
  selectors are updated.
- **Implied requirement**: the extension is matched to `*://*.myworkdayjobs.com/*`. Pages
  served under a company's custom domain (e.g. `jobs.acme.com` instead of
  `acme.wd*.myworkdayjobs.com`) may not match and the content script will not inject.
  You can add the domain to `manifest.json` → `content_scripts[0].matches`.

---

## 3. Skill-loop constraints

- **Capped at 40 skills** (to bound runtime); additional resume skills are ignored.
- Only skills matching `[a-z0-9 .+#()-]` are typed into the autocomplete; skills with
  unusual characters are skipped.
- Skills are added only when a matching dropdown suggestion appears. If the provider or
  Workday shortlists don't include a skill, it's left out (reported as "could not add").
- The skills pass runs **once per step/resume** (`skillsDone`); if a pass partially fails,
  it is not automatically retried on the same step (to avoid the observer looping).

---

## 4. Repeatable sections & dates

- Repeatable sections (Work Experience / Education) are expanded by clicking **Add**
  repeatedly, bounded by `target * 4` safety iterations. Unusual entry counts or
  asynchronous extra blank rows can yield an entry mismatch that requires manual review.
- "I currently work here" is inferred from the resume's `current` flag and drives whether
  an end date is left blank.
- Workday custom date widgets are complex (spin buttons, masked MM/YYYY inputs,
  calendar pickers). The filler tries several strategies and falls back to the calendar;
  some tenants may require manual date entry.

---

## 5. Experimental / incomplete areas

- **No unit tests** exist in the repository today. The test harness is wired up
  (`vitest` with a jsdom environment; `pytest` in `backend/`) but there are currently no
  test files, so `npm run test` will report no suites. Add tests before relying on this
  in production.
- The **mock data module** referenced by the `USE_MOCK` demo path (a canned profile) is
  not present in the checked-in source — mock mode is configured but returns the fixed
  profile only if that module exists. For a live AI demo, provide a real
  `OPENAI_API_KEY`.
- **Background auto-fill restoration** is intentionally disabled: automation never
  restores a previously stored `AUTO_RUN` flag on page load, so nothing auto-fills
  without an explicit **Start Autofill** click.
- `extension/manifest.json` includes `"file:///*"` in `content_scripts` matches for local
  HTML testing; **remove it** in production to narrow the extension's blast radius.

---

## 6. Operational constraints

| Constraint | Notes |
|------------|-------|
| Backend must be running on `localhost:8000` | The extension calls it directly; no remote config |
| AI provider quota / rate limits | A `503` is returned when quota is hit; retry later or point at another provider / key |
| CORS | `ALLOWED_ORIGINS` must include the popup origin or the upload will fail |
| Proxy / firewall | Must allow `localhost:8000` from the popup and outbound HTTPS to the AI provider |
| Browser | Chrome or Edge with Manifest V3 support |

---

## 7. What the tool does NOT do

- ❌ Never submits an application.
- ❌ Never fills credentials or bypasses authentication / CAPTCHA.
- ❌ Never fabricates or guesses demographic, EEO, legal, work-authorization, or salary
  data (it returns null instead).
- ❌ Never auto-attaches files (resume upload into Workday's own file picker is manual).
- ❌ Not a general web form filler — it is specific to Workday's application flow.

---

If you encounter one of these limits, the recommended path is: use **Next Step** /
**Continue Review** in the popup, review the flagged "needs your decision" fields in the
popup's review list, fix any gaps by hand, and submit manually.