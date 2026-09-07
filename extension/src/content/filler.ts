import type { FieldDescriptor, MappingDecision } from "./types";
function setNative(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    // Workday keeps a lot of inputs' model value in a separate wrapper and only
    // commits it into `el.value` once the field actually loses focus. For plain
    // text inputs / textareas a REAL focus->blur commits the value - this is
    // exactly what the manual click-in/click-out trick used to do, and without
    // it the first-pass value is not picked up by later validation / re-scans.
    //
    // <select> fields are excluded: setting an <option> value plus a change
    // event is already a complete, valid commit for them, and force-blurring a
    // Workday searchable/combo select makes Workday flag it as invalid on the
    // next step. Keep only a synthetic blur for selects (harmless fallback).
    if (!(el instanceof HTMLSelectElement)) {
        try { el.focus(); } catch { /* non-focusable field */ }
        el.blur();
    }
    el.dispatchEvent(new Event("blur", { bubbles: true }));
}
function currentValue(el: HTMLElement): string {
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return el.checked ? "on" : "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        if (el.value) return el.value;
        // Value is rendered by Workday in a sibling/child display element while
        // the input itself is empty. Fall back to that rendered text so we never
        // overwrite an already-filled field.
        const host = el.closest<HTMLElement>("[data-automation-id], .gwt-container") || el.parentElement;
        if (host) {
            const shown = host.querySelector<HTMLElement>('[data-automation-id*="promptLabel"], [data-automation-id$="-text"], .gwt-Label, .wd-row-chips, [data-automation-id*="selectedItem"]');
            if (shown) {
                const t = (shown.textContent || "").replace(/\s+/g, " ").trim();
                if (t) return t;
            }
        }
        return "";
    }
    return el.textContent || "";
}

// Find the first <option> matching a value by option value, exact text, or
// normalized-substring comparison.
function matchOption(el: HTMLSelectElement, raw: string): HTMLOptionElement | null {
    const v = raw.toLowerCase().trim();
    return [...el.options].find((x) => x.value.toLowerCase() === v || x.text.toLowerCase().trim() === v || x.text.toLowerCase().trim().includes(v)) || null;
}

// Common spellings of a numeric month (1..12) that Workday options may use.
function monthVariants(num: string): string[] {
    const n = parseInt(num, 10);
    if (Number.isNaN(n) || n < 1 || n > 12) return [num];
    const name = new Date(2000, n - 1, 1).toLocaleString("en-US", { month: "long" });
    return [name, name.toLowerCase(), String(n), String(n).padStart(2, "0"), name.slice(0, 3), name.slice(0, 3).toLowerCase()];
}

export function fillField(f: FieldDescriptor, m: MappingDecision) {
    if (m.value === null || m.confidence < .90) return false;
    const el = f.element; if (currentValue(el).trim()) return false;
    if (el instanceof HTMLInputElement) {
        if (el.type === "file") return false;
        if (el.type === "date") { const v = String(m.value); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; setNative(el, v); return true; }
        if (el.type === "checkbox") { el.checked = Boolean(m.value); el.dispatchEvent(new Event("change", { bubbles: true })); return true; }
        if (el.type === "radio") { if (el.value.toLowerCase() === String(m.value).toLowerCase()) { el.click(); return true; } return false; }
        setNative(el, String(m.value)); return true;
    }
    if (el instanceof HTMLTextAreaElement) { setNative(el, String(m.value)); return true; }
    if (el instanceof HTMLSelectElement) {
        // Direct matches first (option value, exact text, or substring).
        let o = matchOption(el, String(m.value));
        if (o) { setNative(el, o.value); return true; }
        // Workday may pass a full "YYYY-MM" to a month or year select; split
        // and try each part (year, then month variants) against the options.
        const mm = String(m.value).match(/^(\d{4})-(\d{1,2})$/);
        if (mm) {
            for (const part of [mm[1], ...monthVariants(mm[2])]) {
                o = matchOption(el, part);
                if (o) { setNative(el, o.value); return true; }
            }
        }
        return false;
    }
    if (f.kind === "richtext") {
        el.textContent = String(m.value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }
    return false;
}

// Workday "Type to Add Skills"-style widgets are autocompletes: after typing,
// a suggestion row (with a checkbox) appears and must be clicked to add it.
// Polls for the matching suggestion because Workday renders it asynchronously.
export async function selectSuggestion(el: HTMLElement, value: string): Promise<boolean> {
    const v = value.toLowerCase().trim();
    const options = () => [
        ...document.querySelectorAll<HTMLElement>(
            "[role='option'], [role='listbox'] li, ul li[data-automation-id], [data-automation-id*='item'] li, li[data-automation-id*='checkbox']",
        ),
    ].filter((o) => (o.textContent || "").trim());

    const clickable = (o: HTMLElement): boolean => {
        // Prefer the real <input type="checkbox"> (query separately so the
        // input is matched before a wrapper div with data-automation-id=checkbox).
        const cb =
            o.querySelector<HTMLElement>("input[type='checkbox']") ||
            o.querySelector<HTMLElement>("[role='checkbox']");
        if (cb) cb.click();
        else o.click();
        return true;
    };

    const deadline = Date.now() + 4000; // poll up to 4s for the dropdown
    for (let i = 0; Date.now() < deadline; i++) {
        const list = options();
        const exact = list.find((o) => (o.textContent || "").trim().toLowerCase() === v);
        const matched = exact || list.find((o) => (o.textContent || "").trim().toLowerCase().includes(v));
        if (matched) {
            clickable(matched);
            return true;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}
export function fillAll(fields: FieldDescriptor[], maps: MappingDecision[]) { return fields.map(f => { const m = maps.find(x => x.fieldId === f.id); return { fieldId: f.id, label: f.label, filled: !!m && fillField(f, m), confidence: m?.confidence || 0 }; }); }
