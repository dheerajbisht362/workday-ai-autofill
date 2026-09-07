import { scanFields } from "./dom-scanner";
import { buildMappings } from "./mapper";
import { fillAll, selectSuggestion } from "./filler";
import { validate } from "./validator";
import { WorkdayNavigator } from "./navigator";
import { fillRepeatableGroups, fillDateWidgets } from "./repeatable";
import type { ResumeProfile } from "./types";
import { STORAGE_KEYS } from "../shared/config";

console.log("🔥 WORKDAY CONTENT SCRIPT LOADED");
console.log("URL:", window.location.href);

const nav = new WorkdayNavigator();
let resume: ResumeProfile | null = null;
let running = false; // automation started via "Start Autofill"
let pausedState = false;

// Skills-widget state. Adding a skill mutates the DOM, which re-triggers the
// MutationObserver and re-schedules autofill - without these guards the skill
// loop re-ran (and re-added the same skills) forever.
let skillsRunning = false; // a fillSkills pass is in flight (re-entrancy guard)
let skillsDone = false;    // skills were filled for the current step/resume

const status = (message: string) =>
    chrome.runtime.sendMessage({ type: "STATUS", message }).catch(() => { });

async function autofill() {
    if (!resume) throw Error("Upload a resume first.");

    // Collapsed repeatable sections (Work Experience / Education) have no
    // fields until "Add" is clicked - expand and fill them entry by entry.
    if (nav.getCurrentStep() === "my_experience") {
        const groups = await fillRepeatableGroups(resume, (section) =>
            nav.clickAddInSection(section),
        );
        for (const g of groups) {
            status(
                `${g.section}: ${g.entries.length} entr(ies), ${g.addedSections} section(s) added.`,
            );
        }
        // Workday custom date widgets (spin-button Month/Year inputs) are not
        // ordinary selects - set them from the resume directly.
        const dateFilled = await fillDateWidgets(resume);
        if (dateFilled) status(`Date widget(s) filled: ${dateFilled} input(s).`);
    }

    const fields = scanFields();
    const maps = await buildMappings(fields, resume);
    const results = fillAll(fields, maps);

    // Run the skills loop only once per step/resume; the DOM mutations it
    // causes would otherwise re-schedule autofill and re-run it endlessly.
    if (!skillsDone) await fillSkills();

    const validation = validate(scanFields());

    const filled = results.filter((x) => x.filled).length;



    status(`Filled ${filled}/${fields.length}; validation=${validation.valid ? "ready" : "review needed"}`);
    return { results, validation, page: nav.summary() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Drive the Workday skills autocomplete. Each skill follows this flow:
//   1. type the skill (char-by-char so the search fires)
//   2. press Enter -> Workday opens/commits a checkbox suggestion
//   3. click that checkbox to add it
//   4. clear the input and move to the next skill (cap 40)
async function fillSkills() {
    if (!resume || skillsRunning || skillsDone) return;
    skillsRunning = true;
    try {
        await runSkillsLoop();
        skillsDone = true; // never retry automatically: a partial pass must
        // not restart, or the observer would loop forever.
    } finally {
        skillsRunning = false;
    }
}

const normSkill = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Skills already present in the widget (selected chips/tokens). Best-effort:
// covers Workday's token strip and checked multiselect rows.
function addedSkills(): Set<string> {
    const nodes = document.querySelectorAll<HTMLElement>(
        "[data-automation-id$='Token'], [data-automation-id*='selectedItem'], " +
        "[data-automation-id*='promptToken'], [data-automation-id='promptOption'][aria-selected='true']",
    );
    return new Set([...nodes].map((el) => normSkill(el.textContent)).filter(Boolean));
}

async function runSkillsLoop() {
    const skills = (resume?.skills || []).slice(0, 40);
    const inputs = scanFields().filter((x) => /skill/i.test(x.label) && x.kind === "text");
    if (!skills.length || !inputs.length) return;

    const input = inputs[0].element;
    if (!(input instanceof HTMLInputElement)) return;

    const already = addedSkills();
    // If the widget already shows any skills, the section was filled before -
    // do not touch it at all (also avoids duplicate skills).
    if (already.size > 0) {
        status(`Skills section already has ${already.size} skill(s) - skipped.`);
        return;
    }
    input.focus();
    let added = 0;
    const failed: string[] = [];

    for (const skill of skills) {
        if (already.has(normSkill(skill))) continue; // idempotent: never re-add
        if (/^[a-z0-9 .+#()-]+$/i.test(skill)) {
            typeText(input, skill);
        } else {
            // Unusual characters may break the autocomplete; skip.
            failed.push(skill);
            continue;
        }
        const picked = await selectSuggestion(input, skill);
        if (picked) {
            added++;
            await sleep(350);
        } else {
            failed.push(skill);
        }
        clearInput(input);
        await sleep(200);
    }

    status(
        added
            ? `Added ${added} skill(s)${failed.length ? `; could not add: ${failed.join(", ")}` : ""}.`
            : `No skills added${failed.length ? `; could not add: ${failed.join(", ")}` : ""}.`,
    );
}

// Type text char-by-char with realistic events so Workday's autocomplete will
// open and search as it types.
function typeText(el: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    el.focus();
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        const setVal = el.value + ch;
        setter?.call(el, setVal);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
    }
    // Press Enter to commit and trigger the checkbox suggestion.
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
}

function clearInput(el: HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

// The floating on-page panel was removed; surface messages via the popup.
function refreshPanel(message?: string) {
    if (message) status(message);
}

// Re-inject the resume (and automation state) after reloads/navigation so
// the user never has to re-upload between multi-step pages.
(async () => {
    try {
        const stored = await chrome.storage.local.get([
            STORAGE_KEYS.RESUME_DATA,
        ]);
        if (stored[STORAGE_KEYS.RESUME_DATA]) {
            resume = stored[STORAGE_KEYS.RESUME_DATA] as ResumeProfile;
            console.log("Resume restored from storage");
        }
        // NOTE: automation must only start when the user explicitly clicks the
        // "Start Autofill" button in the extension popup. Do NOT restore a
        // previously-stored AUTO_RUN flag here - that would auto-fill the form
        // without an explicit click (which we intentionally avoid).
        running = false;
        refreshPanel("Waiting for Start Autofill.");
    } catch (e) {
        console.error("Storage restore failed:", e);
    }
})();


chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    console.log("📩 Content script received:", msg);

    if (msg.type === "SET_RESUME") {
        resume = msg.resume as ResumeProfile;
        skillsDone = false; // allow the skills loop to run for the new resume
        console.log("Resume set:", resume);
        sendResponse({ ok: true });
    }

    if (msg.type === "CLEAR_RESUME") {
        resume = null;
        running = false;
        console.log("Resume cleared");
        sendResponse({ ok: true });
    }

    if (msg.type === "START_AUTOFILL") {
        (async () => {
            running = true;
            pausedState = false;
            skillsDone = false; // explicit start always re-attempts skills
            await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_RUN]: true });

            if (nav.isAuthenticationStep()) {
                refreshPanel("Please sign in to Workday. Automation resumes automatically afterwards.");
                sendResponse({
                    ok: true,
                    waiting: true,
                    message: "Please sign in to Workday. Automation resumes automatically after you sign in.",
                });
                return;
            }

            // On the start page the user still chooses the entry route;
            // "Apply Manually" is application navigation, not authentication.
            if (nav.getCurrentStep() === "start_application") {
                await nav.clickApplyManually();
                sendResponse({
                    ok: true,
                    waiting: true,
                    message: "Clicked Apply Manually. Automation continues on the next page.",
                });
                return;
            }

            refreshPanel("Filling…");
            sendResponse(await autofill());
        })().catch((e) => sendResponse({ error: String(e) }));
        return true;
    }

    if (msg.type === "PAUSE_AUTOFILL") {
        pausedState = Boolean(msg.paused);
        refreshPanel(pausedState ? "Paused." : "Resumed.");
        sendResponse({ ok: true, paused: pausedState });
    }

    if (msg.type === "CONTINUE_REVIEW") {
        const r = nav.continueToReview();
        status(r.message);
        sendResponse(r);
    }

    if (msg.type === "AUTOFILL") {
        autofill()
            .then(sendResponse)
            .catch((e) => sendResponse({ error: String(e) }));
        return true;
    }

    if (msg.type === "NAVIGATE_NEXT_STEP") {
        nav.navigateToNextStep()
            .then(sendResponse)
            .catch((e) => sendResponse({ error: String(e) }));
        return true;
    }

    if (msg.type === "SCAN") sendResponse(nav.summary());
});

// Observe Workday's SPA rendering. This drives the whole per-step flow:
// after authentication the observer notices the application UI appeared and
// repeatedly, so a fill is scheduled on EVERY render - it is idempotent
// because already-filled fields are never overwritten.
let lastStep = nav.getCurrentStep();
let autoRunTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleAutofill() {
    clearTimeout(autoRunTimer);
    autoRunTimer = setTimeout(() => {
        autofill().catch((e) => status(`Auto-fill failed: ${String(e)}`));
    }, 800);
}

nav.start(() => {
    const currentStep = nav.getCurrentStep();
    const stepChanged = currentStep !== lastStep;
    lastStep = currentStep;

    if (nav.isAuthenticationStep()) {
        refreshPanel("Authentication required — waiting for you to sign in.");
        return;
    }

    if (currentStep === "review") {
        refreshPanel("Workday review reached. Verify everything and submit yourself.");
        return;
    }

    if (stepChanged) {
        status(`Dynamic content changed. Current step: ${currentStep}.`);
    }

    // Per-step automation: Detect → Map → Fill → Validate → status.
    if (running && resume && !pausedState) {
        scheduleAutofill();
    } else {
        refreshPanel();
    }
});
