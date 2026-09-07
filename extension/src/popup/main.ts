import { renderReview, setReview } from "./review";

/* UI element handles */
const $ = {
    status: document.getElementById("status") as HTMLElement,
    statusMsg: document.querySelector<HTMLElement>("#status .msg")! as HTMLElement,
    progress: document.getElementById("progress") as HTMLElement,
    resumeSubtitle: document.getElementById("resumeSubtitle") as HTMLElement,
    autoBadge: document.getElementById("autoBadge") as HTMLElement,
    resumeInfo: document.getElementById("resumeInfo") as HTMLElement,
    dEmail: document.getElementById("dEmail") as HTMLElement,
    dPhone: document.getElementById("dPhone") as HTMLElement,
    dLocation: document.getElementById("dLocation") as HTMLElement,
    dLinks: document.getElementById("dLinks") as HTMLElement,
    statPills: document.getElementById("statPills") as HTMLElement,
    fileInput: document.getElementById("resume") as HTMLInputElement,
    uploadBtn: document.getElementById("uploadBtn") as HTMLButtonElement,
    startBtn: document.getElementById("start") as HTMLButtonElement,
    clearBtn: document.getElementById("clear") as HTMLButtonElement,
    pauseBtn: document.getElementById("pauseBtn") as HTMLButtonElement,
    resumeBtn: document.getElementById("resumeBtn") as HTMLButtonElement,
    nextStepBtn: document.getElementById("nextStep") as HTMLButtonElement,
    continueReviewBtn: document.getElementById("continueReview") as HTMLButtonElement,
};

type StatusKind = "info" | "running" | "ready" | "warning" | "error";

/* Status bar — color-coded with a spinner for in-flight actions. */
function showStatus(message: string, kind: StatusKind = "info") {
    $.status.className = "status " + (kind === "info" ? "" : kind).trim();
    $.statusMsg.textContent = message;
}

/* Progress pills — fields / skills / validation summary. */
function renderProgress(data: any) {
    if (!data || !data.results) {
        $.progress.className = "progress hidden";
        $.progress.innerHTML = "";
        return;
    }
    const results = data.results;
    const filled = results.filter((r: any) => r.filled).length;
    const total = results.length;
    const attention = results.filter((r: any) => !r.filled && r.confidence > 0).length;
    const validation = data.validation || { valid: true, missingRequired: [], invalid: [] };
    const skillCount = data.skills?.added ?? null;

    const pill = (cls: string, inner: string) =>
        `<span class="pill ${cls}">${inner}</span>`;

    let html = pill("", `📋 ${filled}/${total} fields`);
    html += pill(attention ? "warn" : "ok", `⚠ ${attention} need review`);
    html += validation.valid
        ? pill("ok", "✅ Validation ready")
        : pill("err", `❌ ${(validation.missingRequired || []).length + (validation.invalid || []).length} issue(s)`);
    if (skillCount !== null) html += pill(skillCount > 0 ? "ok" : "warn", `💡 ${skillCount} skills added`);

    $.progress.className = "progress";
    $.progress.innerHTML = html;
}

/* Resume state — header subtitle, detail grid, stat pills, buttons. */
function renderResumeState(resume: any, file: any) {
    const basics = resume?.basics || {};
    const name = basics.full_name || file?.filename || "Resume";

    if (resume) {
        $.resumeSubtitle.textContent = `Working with: ${name}`;
        $.resumeInfo.textContent = file?.filename
            ? `Parsed from ${file.filename} • ready to autofill`
            : `Resume loaded${name !== "Resume" ? ` — ${name}` : ""} • ready to autofill`;

        $.dEmail.textContent = basics.email || "—";
        $.dPhone.textContent = basics.phone || "—";
        $.dLocation.textContent = basics.location || "—";
        const links = [basics.linkedin, basics.github, basics.website].filter(Boolean);
        $.dLinks.textContent = links.length ? links.join(" · ") : "—";

        const skills = (resume.skills || []).length;
        const xp = (resume.work_experience || []).length;
        const edu = (resume.education || []).length;
        const certs = (resume.certifications || []).length;
        const pills: Array<[string, string]> = [
            ["💡", `${skills} Skills`], ["💼", `${xp} Experience`],
            ["🎓", `${edu} Education`], ["📜", `${certs} Certs`],
        ];
        $.statPills.innerHTML = pills
            .map(([ico, label]) => `<span class="stat">${ico} ${label}</span>`)
            .join("");

        $.startBtn.disabled = false;
        $.clearBtn.disabled = false;
        setReview("");
    } else {
        $.resumeSubtitle.textContent = "No resume loaded yet";
        $.resumeInfo.textContent = "No resume selected. Upload a PDF/DOCX to begin.";
        $.dEmail.textContent = $.dPhone.textContent = $.dLocation.textContent = $.dLinks.textContent = "—";
        $.statPills.innerHTML = "";
        $.startBtn.disabled = true;
        $.clearBtn.disabled = true;
    }
}

/* Automation-control buttons depend on loaded resume + autofill running. */
let running = false;
let paused = false;

function syncControls() {
    const hasResume = !$.startBtn.disabled;
    $.pauseBtn.disabled = !(hasResume && running);
    $.resumeBtn.disabled = !(hasResume && running && paused);
    $.nextStepBtn.disabled = !hasResume;
    $.continueReviewBtn.disabled = !hasResume;
    $.autoBadge.textContent = running ? (paused ? "⏸ PAUSED" : "🔵 RUNNING") : "AUTO OFF";
}

/* ------------------------------------------------------------------ *
 * Upload → PARSE_RESUME
 * ------------------------------------------------------------------ */
$.uploadBtn.addEventListener("click", () => $.fileInput.click());

$.fileInput.addEventListener("change", async () => {
    try {
        const f = $.fileInput.files?.[0];
        if (!f) return;
        showStatus(`Parsing ${f.name}…`, "running");
        const b = new Uint8Array(await f.arrayBuffer());
        let s = "";
        for (const x of b) s += String.fromCharCode(x);
        const response = await chrome.runtime.sendMessage({
            type: "PARSE_RESUME",
            filename: f.name,
            content_base64: btoa(s),
        });
        if (response.error) throw Error(response.error);
        $.fileInput.value = ""; // allow re-selecting the same file
        const stored = await chrome.runtime.sendMessage({ type: "GET_RESUME" });
        renderResumeState(stored.resume, stored.file);
        showStatus("Resume parsed and stored ✓", "ready");
    } catch (e) {
        showStatus(`Upload failed: ${String(e)}`, "error");
    }
    syncControls();
});

/* ------------------------------------------------------------------ *
 * Start Autofill
 * ------------------------------------------------------------------ */
$.startBtn.addEventListener("click", async () => {
    try {
        showStatus("Starting automation…", "running");
        const response = await chrome.runtime.sendMessage({ type: "START_AUTOFILL" });
        if (response?.error) throw Error(response.error);
        running = true;
        paused = false;
        if (response?.waiting) {
            showStatus(response.message || "Waiting for you to complete this step manually. Automation resumes automatically.", "warning");
        } else if (response?.results) {
            renderReview(response);
            renderProgress(response);
            showStatus("Autofill complete — review below.", "ready");
        } else {
            showStatus(JSON.stringify(response, null, 2), "info");
        }
    } catch (e) {
        showStatus(`Autofill failed: ${String(e)}`, "error");
    } finally {
        syncControls();
    }
});

/* ------------------------------------------------------------------ *
 * Clear resume
 * ------------------------------------------------------------------ */
$.clearBtn.addEventListener("click", async () => {
    try {
        await chrome.runtime.sendMessage({ type: "CLEAR_RESUME" });
        renderResumeState(null, null);
        setReview("");
        renderProgress(null);
        running = false;
        paused = false;
        showStatus("Cleared stored resume.", "ready");
    } catch (e) {
        showStatus(`Clear failed: ${String(e)}`, "error");
    } finally {
        syncControls();
    }
});

/* ------------------------------------------------------------------ *
 * Automation controls: pause, resume, next step, continue to review.
 * ------------------------------------------------------------------ */
$.pauseBtn.addEventListener("click", async () => {
    try {
        paused = true;
        await chrome.runtime.sendMessage({ type: "PAUSE_AUTOFILL", paused: true });
        syncControls();
        showStatus("Automation paused.", "warning");
    } catch (e) {
        showStatus(`Pause failed: ${String(e)}`, "error");
    }
});

$.resumeBtn.addEventListener("click", async () => {
    try {
        paused = false;
        await chrome.runtime.sendMessage({ type: "PAUSE_AUTOFILL", paused: false });
        const r = await chrome.runtime.sendMessage({ type: "AUTOFILL" });
        if (r?.error) throw Error(r.error);
        if (r?.results) { renderReview(r); renderProgress(r); }
        syncControls();
        showStatus("Automation resumed.", "ready");
    } catch (e) {
        showStatus(`Resume failed: ${String(e)}`, "error");
    }
});

$.nextStepBtn.addEventListener("click", async () => {
    try {
        showStatus("Navigating to next step…", "running");
        const r = await chrome.runtime.sendMessage({ type: "NAVIGATE_NEXT_STEP" });
        if (r?.error) throw Error(r.error);
        if (r?.results) { renderReview(r); renderProgress(r); }
        showStatus(typeof r?.message === "string" ? r.message : JSON.stringify(r), "info");
    } catch (e) {
        showStatus(`Navigate failed: ${String(e)}`, "error");
    }
});

$.continueReviewBtn.addEventListener("click", async () => {
    try {
        showStatus("Navigating to Review…", "running");
        const r = await chrome.runtime.sendMessage({ type: "CONTINUE_REVIEW" });
        if (r?.error) throw Error(r.error);
        showStatus(r?.message || "Review reached.", "info");
    } catch (e) {
        showStatus(`Review failed: ${String(e)}`, "error");
    }
});

/* ------------------------------------------------------------------ *
 * Restore persisted resume on popup open.
 * ------------------------------------------------------------------ */
(async () => {
    try {
        const stored = await chrome.runtime.sendMessage({ type: "GET_RESUME" });
        renderResumeState(stored?.resume, stored?.file);
        if (stored?.resume) showStatus("Resume loaded from storage.", "info");
    } catch (e) {
        showStatus(`Error loading persisted data: ${String(e)}`, "error");
    }
    syncControls();
})();
