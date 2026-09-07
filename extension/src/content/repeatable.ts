// Workday renders one field group per entry, repeating the same labels
// (Company, Job Title, Start Date, ...). Fields are grouped into entries by
// the ordinal position of each repeated label, which avoids depending on
// tenant-specific container markup.

import { scanFields } from "./dom-scanner";
import { fillField } from "./filler";
import type { FieldDescriptor, MappingDecision, ResumeProfile } from "./types";

const norm = (s: string) =>
    (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Split "2024-02" (or "2024") into select-friendly month + year parts.
// Returns null for a part that cannot be determined.
export function dateParts(date: string | null | undefined): { month?: string; year?: string } {
    if (!date) return {};
    const m = String(date).trim();
    const mm = m.match(/^(\d{4})-(\d{1,2})$/);
    if (mm) {
        const monthNum = Number(mm[2]);
        const year = mm[1];
        const monthName = new Date(Number(year), monthNum - 1, 1)
            .toLocaleString("en-US", { month: "long" });
        return { month: monthName, year };
    }
    const yy = m.match(/^(\d{4})$/);
    if (yy) return { year: yy[1] };
    return {};
}

// Candidate values to try for a month select, most-reliable first.
export function monthCandidates(monthName: string): string[] {
    const monthNum = new Date(`${monthName} 1, 2000`).getMonth() + 1;
    if (!monthNum) return [monthName];
    const num = String(monthNum);
    return [
        monthName,
        monthName.toLowerCase(),
        monthName.slice(0, 3),
        monthName.slice(0, 3).toLowerCase(),
        num,
        String(monthNum).padStart(2, "0"),
    ];
}

export interface EntryResult {
    index: number;
    filled: number;
    missing: string[];
}

// entries.get(i) = the fields belonging to the i-th repeated entry.
export function groupByEntry(fields: FieldDescriptor[]): Map<number, FieldDescriptor[]> {
    const perLabel = new Map<string, FieldDescriptor[]>();
    for (const f of fields) {
        const key = norm(f.label) || norm(f.name);
        if (!key) continue;
        const group = perLabel.get(key) || [];
        group.push(f);
        perLabel.set(key, group);
    }
    const entries = new Map<number, FieldDescriptor[]>();
    for (const group of perLabel.values()) {
        group.forEach((f, i) => {
            if (!entries.has(i)) entries.set(i, []);
            entries.get(i)!.push(f);
        });
    }
    return entries;
}

// Which resume value answers a given experience field label.
// Month/Year selects are handled via dateParts; "month"/"year" subfields get
// the corresponding part, otherwise the combined value.
export function experienceValueFor(label: string, entry: ResumeProfile["work_experience"][number]): string | null {
    const key = norm(label);
    if (key.includes("company") || key.includes("employer")) return entry.company;
    if (key.includes("job title") || key === "title" || key.includes("position")) return entry.title;
    if (key.includes("location")) return entry.location || null;

    const isStart = key.includes("start");
    const isEnd = key.includes("end") || key.includes("finish");
    if (isStart || isEnd) {
        const raw = isStart ? entry.start_date : entry.end_date;
        const parts = dateParts(raw);
        // End year/month for a current job has no value.
        if (isEnd && entry.current) return null;
        if ((key.includes(" month") || key.includes("month")) && parts.month) return parts.month;
        if ((key.includes(" year") || key === "year" || key.includes("year")) && parts.year) return parts.year;
        return raw || null;
    }

    if (key.includes("description") || key.includes("duties") || key.includes("responsibilit")) {
        return entry.bullets.length ? entry.bullets.join("\n") : null;
    }
    if (key.includes("i currently work here") || key.includes("currently work") || key === "present") {
        return entry.current ? "true" : "false";
    }
    return null;
}

// Whether a field is a "currently work here" checkbox.
export function isCurrentWorkCheckbox(label: string): boolean {
    const key = norm(label);
    return key.includes("currently work") || key.includes("i currently work") || key === "present";
}

// Which resume value answers a given education field label.
export function educationValueFor(label: string, entry: ResumeProfile["education"][number]): string | null {
    const key = norm(label);
    if (key.includes("school") || key.includes("institution") || key.includes("university") || key.includes("college")) {
        return entry.institution;
    }
    if (key.includes("degree") || key.includes("level") || key.includes("diploma")) return entry.degree || null;
    if (key.includes("field") || key.includes("major") || key.includes("study")) return entry.field || null;

    const isStart = key.includes("start");
    const isEnd = key.includes("end") || key.includes("graduat");
    if (isStart || isEnd) {
        const raw = isStart ? entry.start_date : entry.end_date;
        const parts = dateParts(raw);
        if (key.includes("month") && parts.month) return parts.month;
        if (key.includes("year") && parts.year) return parts.year;
        return raw || null;
    }
    return null;
}

const EXPERIENCE_LABEL_HINTS = [
    "company", "employer", "job title", "position", "location",
    "start date", "start", "end date", "end", "description", "duties",
    "responsibilit", "currently work",
];
const EDUCATION_LABEL_HINTS = [
    "school", "institution", "university", "college", "degree", "field of study",
    "major", "start date", "start", "graduat", "end date", "end",
];

const decision = (fieldId: string, value: string | null): MappingDecision => ({
    fieldId,
    value,
    confidence: value === null ? 0 : 0.95,
    source: "heuristic",
    reason: "Repeatable section mapping.",
});

// Try each candidate value until one fills.
function fillCandidates(
    f: FieldDescriptor,
    candidates: Array<string | null>,
): boolean {
    for (const c of candidates) {
        if (c === null || c === undefined) continue;
        if (fillField(f, decision(f.id, c))) return true;
    }
    return false;
}

interface GroupSpec<K extends "work_experience" | "education"> {
    section: string;
    entries: ResumeProfile[K];
    valueFor: (label: string, entry: any) => string | null;
    hints: string[];
}

export interface RepeatableResult {
    section: string;
    addedSections: number;
    entries: EntryResult[];
}
// Fill Workday custom date widgets. A date is rendered as a wrapper
// ("dateInputWrapper") containing two role=spinbutton text inputs:
//   dateSectionMonth-input  (aria-label "Month")
//   dateSectionYear-input   (aria-label "Year")
// The wrapper id encodes the group, entry index and field, e.g.
//   workExperience-6--startDate   |   education-3--endDate
// These are NOT selects or <input type=date>, so they are handled here.
export async function fillDateWidgets(
    resume: ResumeProfile
): Promise<number> {
    let filled = 0;
    const wrappers = [
        ...document.querySelectorAll<HTMLElement>(
            "[data-automation-id='dateInputWrapper']"
        ),
    ];

    // Workday IDs such as:
    // workExperience-24--startDate
    // workExperience-24--endDate
    //
    // 24 is NOT the resume array index.
    // We map unique Workday IDs to resume array indexes.
    const workExperienceMap = new Map<number, number>();
    const educationMap = new Map<number, number>();

    let nextWorkExperienceIndex = 0;
    let nextEducationIndex = 0;

    const setSpin = (el: HTMLInputElement, value: string) => {
        const setter =
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
            )?.set;
        setter?.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        // Fallback commit for spin month/year inputs. Uses ONLY a synthetic
        // blur (not a real focus->blur): spinning a raw value into these
        // widgets can leave an invalid month/year that Workday flags red on the
        // next step. The dedicated keystroke path (typeDateValue) is preferred
        // and already does a real focus/blur when it succeeds.
        el.dispatchEvent(new Event("blur", { bubbles: true }));
    };

    const monthNum = (name: string): string | null => {
        const n = new Date(`${name} 1, 2000`).getMonth() + 1;
        return n ? String(n) : null;
    };

    for (const w of wrappers) {
        const id = w.id || "";
        const m = id.match(
            /^(workExperience|education)-(\d+)--(startDate|endDate)$/
        );
        if (!m) continue;

        const group = m[1] as "workExperience" | "education";
        const workdayIndex = Number(m[2]);
        const field = m[3];
        const isStart = field === "startDate";

        let resumeIndex: number;

        if (group === "workExperience") {
            if (!workExperienceMap.has(workdayIndex)) {
                workExperienceMap.set(
                    workdayIndex,
                    nextWorkExperienceIndex++
                );
            }
            resumeIndex = workExperienceMap.get(workdayIndex)!;
        } else {
            if (!educationMap.has(workdayIndex)) {
                educationMap.set(
                    workdayIndex,
                    nextEducationIndex++
                );
            }
            resumeIndex = educationMap.get(workdayIndex)!;
        }
        let date: string | null | undefined = null;
        let current = false;

        if (group === "workExperience") {
            const e = resume.work_experience?.[resumeIndex];
            if (e) {
                date = isStart ? e.start_date : e.end_date;
                current = e.current ?? false;
            }
        } else {
            const e = resume.education?.[resumeIndex];
            if (e) {
                date = isStart ? e.start_date : e.end_date;
            }
        }

        // Current job has no end date.
        if (!isStart && current) continue;

        if (!date) continue;

        const parts = dateParts(date);

        const monthInput =
            w.querySelector<HTMLInputElement>(
                "[data-automation-id='dateSectionMonth-input']"
            );
        const yearInput =
            w.querySelector<HTMLInputElement>(
                "[data-automation-id='dateSectionYear-input']"
            );

        if (monthInput || yearInput) {
            const mm = parts.month ? monthNum(parts.month) : null;
            const wantM = mm ? String(mm) : null;
            const wantY = parts.year || null;

            if (monthInput && wantM) {
                typeDateValue(monthInput, wantM);
            }
            if (yearInput && wantY) {
                typeDateValue(yearInput, wantY);
            }

            await sleepMs(100);

            if (
                monthInput &&
                wantM &&
                Number(monthInput.value) !== Number(wantM)
            ) {
                setSpin(monthInput, wantM);
            }
            if (
                yearInput &&
                wantY &&
                yearInput.value.trim() !== wantY
            ) {
                setSpin(yearInput, wantY);
            }

            await sleepMs(100);

            const okM =
                !monthInput || !wantM || Number(monthInput.value) === Number(wantM);
            const okY =
                !yearInput || !wantY || yearInput.value.trim() === wantY;

            if (okM && okY) {
                // Count each date wrapper once.
                continue;
            }

            // Calendar fallback: some wrappers only react through the picker.
            const icon =
                w.querySelector<HTMLElement>(
                    "[data-automation-id='dateIcon'], " +
                    "[data-automation-id*='dateIcon'], " +
                    "[data-automation-id*='calendar']"
                );

            if (!icon) continue;

            await pickMonthYear(icon, parts);

            continue;
        }

        const combined =
            w.querySelector<HTMLInputElement>(
                "input[data-automation-id*='onthYear'], " +
                "input[data-automation-id*='onth-'], " +
                "input[placeholder='MM/YYYY'], " +
                "input[placeholder='MM/YY'], " +
                "input[placeholder*='MM']"
            );

        if (!combined) continue;

        const want = combinedValue(parts);

        if (!want) continue;

        const typed = typeDateValue(combined, want);

        await sleepMs(100);

        if (typed && combined.value.trim() === want) {
            filled++;
            continue;
        }

        if (await pickViaCalendar(combined, parts)) {
            filled++;
        }
    }

    return filled;
}
function combinedValue(parts: { month?: string; year?: string }): string | null {
    const n = parts.month ? monthNumInternal(parts.month) : null;
    if (!n || !parts.year) return null;
    return `${String(n).padStart(2, "0")}/${parts.year}`;
}

function monthNumInternal(name: string): number | null {
    const n = new Date(`${name} 1, 2000`).getMonth() + 1;
    return n || null;
}

// Type MM/YYYY with keystroke-level events (masked inputs build their value
// from key events). Returns true if the input holds the wanted value.
function typeDateValue(el: HTMLInputElement, want: string): boolean {
    const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
    )?.set;
    el.focus();
    setter?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    for (const ch of want) {
        setter?.call(el, el.value + ch);
        el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    return el.value.replace(/\s/g, "") === want;
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Click with the full pointer event sequence â€” some Workday widgets only
// react to mousedown/mouseup, not a synthetic .click().
function clickEl(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const opts: MouseEventInit = {
        bubbles: true, cancelable: true, view: window,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
}

// Drive Workday's month picker ([data-automation-id="monthPicker"]): click the
// calendar icon, step the year spinner to the target year, then click the
// month tile (data-uxi-monthpicker-month is 1-based).
async function pickMonthYear(icon: HTMLElement, parts: { month?: string; year?: string }): Promise<boolean> {
    try {
        const mm = parts.month ? monthNumInternal(parts.month) : null;
        if (!mm || !parts.year) return false;
        const target = String(Number(parts.year));

        clickEl(icon);
        const picker = (): HTMLElement | null =>
            document.querySelector<HTMLElement>("[data-automation-id='monthPicker']");
        let p: HTMLElement | null = null;
        for (let i = 0; i < 15 && !p; i++) { await sleepMs(200); p = picker(); }
        if (!p) return false;

        const label = p.querySelector<HTMLElement>("[data-automation-id='monthPickerSpinnerLabel']");
        const prev = p.querySelector<HTMLElement>("[data-automation-id='monthPickerLeftSpinner']");
        const next = p.querySelector<HTMLElement>("[data-automation-id='monthPickerRightSpinner']");
        for (let i = 0; i < 80; i++) {
            const cur = label?.textContent?.trim();
            if (!cur || cur === target) break;
            clickEl((Number(target) > Number(cur) ? next : prev)!);
            await sleepMs(120);
        }

        const tiles = [...p.querySelectorAll<HTMLElement>("li[data-automation-id='monthPickerTile']")];
        const tile = tiles.find((li) =>
            li.getAttribute("data-uxi-monthpicker-month") === String(mm) &&
            li.getAttribute("data-uxi-monthpicker-year") === target)
            || tiles.find((li) => li.getAttribute("data-uxi-monthpicker-month") === String(mm));
        if (!tile) return false;
        const btn = tile.querySelector<HTMLElement>("[data-automation-id='monthPickerTileLabel'], [role='button']") || tile;
        clickEl(btn);
        return true;
    } catch {
        return false;
    }
}

const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function findDatePickerPanel(): HTMLElement | null {
    const candidates = document.querySelectorAll<HTMLElement>(
        "[role='dialog'], " +
        "[data-automation-id*='calendar'], " +
        "[data-automation-id*='Calendar'], " +
        "[data-automation-id*='picker'], " +
        "[role='listbox']"
    );

    for (const el of candidates) {
        if (!isVisible(el)) continue;

        const text = el.textContent || "";

        if (
            text.includes("Jan") &&
            text.includes("Feb") &&
            text.includes("Mar") &&
            text.includes("Dec")
        ) {
            return el;
        }
    }

    return null;
}

function isVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
    );
}
// Fallback: open the calendar picker and select year + month.
async function pickViaCalendar(
    input: HTMLInputElement,
    parts: { month?: string; year?: string }
): Promise<boolean> {
    try {
        if (!parts.year || !parts.month) return false;

        const targetYear = Number(parts.year);
        const monthShort = parts.month.slice(0, 3).toLowerCase();

        const wrapper = input.closest<HTMLElement>(
            "[data-automation-id='dateInputWrapper']"
        );

        if (!wrapper) return false;

        const iconCandidates = [
            ...wrapper.querySelectorAll<HTMLElement>(
                "[data-automation-id*='calendar'], " +
                "[data-automation-id*='Calendar'], " +
                "[data-automation-id*='dateIcon'], " +
                "[data-automation-id*='atePicker'], " +
                "button, " +
                "[role='button']"
            ),
        ];

        const icon =
            iconCandidates.find(el =>
                el.getAttribute("data-automation-id")
                    ?.toLowerCase()
                    .includes("calendar")
            ) ||
            iconCandidates.find(el =>
                el.getAttribute("data-automation-id")
                    ?.toLowerCase()
                    .includes("dateicon")
            ) ||
            iconCandidates.find(el =>
                el.getAttribute("data-automation-id")
                    ?.toLowerCase()
                    .includes("datepicker")
            ) ||
            iconCandidates.find(
                el =>
                    el.tagName === "BUTTON" ||
                    el.getAttribute("role") === "button"
            );

        if (!icon) return false;

        icon.scrollIntoView({
            block: "center",
            inline: "center",
        });

        icon.click();

        const panel = await waitForCalendarPanel();

        if (!panel) return false;
        const getYear = (): number | null => {
            const elements = [
                ...panel.querySelectorAll<HTMLElement>(
                    "button, [role='button'], div, span"
                ),
            ];

            for (const el of elements) {
                const text = el.textContent?.trim() || "";
                if (/^\d{4}$/.test(text)) return Number(text);
            }

            return null;
        };

        let currentYear = getYear();

        if (currentYear == null) return false;

        const allButtons = [
            ...panel.querySelectorAll<HTMLElement>(
                "button, [role='button']"
            ),
        ];

        const findArrow = (
            direction: "previous" | "next"
        ): HTMLElement | null => {
            for (const button of allButtons) {
                const aria =
                    button
                        .getAttribute("aria-label")
                        ?.toLowerCase() || "";
                const title =
                    button
                        .getAttribute("title")
                        ?.toLowerCase() || "";
                const automation =
                    button
                        .getAttribute("data-automation-id")
                        ?.toLowerCase() || "";
                const text =
                    button.textContent
                        ?.trim()
                        .toLowerCase() || "";

                const previous =
                    direction === "previous" &&
                    (
                        aria.includes("previous") ||
                        aria.includes("prev") ||
                        title.includes("previous") ||
                        title.includes("prev") ||
                        automation.includes("previous") ||
                        automation.includes("prev") ||
                        text === "←" ||
                        text === "‹"
                    );

                const next =
                    direction === "next" &&
                    (
                        aria.includes("next") ||
                        title.includes("next") ||
                        automation.includes("next") ||
                        text === "→" ||
                        text === "›"
                    );

                if (previous || next) return button;
            }

            return null;
        };
        for (let i = 0; i < 60; i++) {
            currentYear = getYear();

            if (currentYear == null) return false;

            if (currentYear === targetYear) break;

            const direction =
                targetYear > currentYear
                    ? "next"
                    : "previous";

            const arrow = findArrow(direction);

            if (!arrow) return false;

            arrow.click();

            await sleepMs(300);
        }

        currentYear = getYear();

        if (currentYear !== targetYear) return false;

        const cells = [
            ...panel.querySelectorAll<HTMLElement>(
                "button, [role='button'], [role='option'], [role='gridcell']"
            ),
        ];

        const cell =
            cells.find(
                b =>
                    b.textContent
                        ?.trim()
                        .toLowerCase() === monthShort
            ) ||
            cells.find(
                b =>
                    b.textContent
                        ?.trim()
                        .toLowerCase()
                        .startsWith(monthShort)
            );

        if (!cell) return false;

        cell.scrollIntoView({
            block: "center",
            inline: "center",
        });

        cell.click();

        await sleepMs(300);

        input.dispatchEvent(
            new Event("input", {
                bubbles: true,
            })
        );

        input.dispatchEvent(
            new Event("change", {
                bubbles: true,
            })
        );

        await sleepMs(300);

        return input.value.trim().length > 0;
    } catch {
        return false;
    }
}
async function waitForCalendarPanel(): Promise<HTMLElement | null> {
    for (let i = 0; i < 15; i++) {
        const candidates = [
            ...document.querySelectorAll<HTMLElement>(
                "[role='dialog'], " +
                "[data-automation-id*='calendar'], " +
                "[data-automation-id*='Calendar'], " +
                "[data-automation-id*='picker'], " +
                "[role='listbox']"
            ),
        ];

        for (const candidate of candidates) {
            const rect = candidate.getBoundingClientRect();
            const text = candidate.textContent || "";

            if (
                rect.width > 0 &&
                rect.height > 0 &&
                text.includes("Jan") &&
                text.includes("Feb") &&
                text.includes("Mar") &&
                text.includes("Dec")
            ) {
                return candidate;
            }
        }

        await sleepMs(200);
    }

    return null;
}
export async function fillRepeatableGroups(
    resume: ResumeProfile,
    addFor: (section: string) => Promise<boolean>,
    delayMs = 700,
): Promise<RepeatableResult[]> {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const groups: GroupSpec<any>[] = [
        {
            section: "Work Experience",
            entries: resume.work_experience,
            valueFor: experienceValueFor,
            hints: EXPERIENCE_LABEL_HINTS,
        },
        {
            section: "Education",
            entries: resume.education,
            valueFor: educationValueFor,
            hints: EDUCATION_LABEL_HINTS,
        },
    ];

    const results: RepeatableResult[] = [];

    for (const group of groups) {
        if (!group.entries.length) continue;

        // Count current entries from the live DOM (collapsed sections = 0).
        const countExisting = (): number => {
            const counts = new Map<string, number>();
            for (const f of scanFields()) {
                const key = norm(f.label) || norm(f.name);
                if (!group.hints.some((hint) => key.includes(hint))) continue;
                counts.set(key, (counts.get(key) || 0) + 1);
            }
            return counts.size ? Math.max(...counts.values()) : 0;
        };

        // Add until we reach the desired count, but NEVER exceed it. This
        // also guards against Workday rendering an extra blank row asynchronously.
        let added = 0;
        const target = group.entries.length;
        for (let safety = 0; safety < target * 4; safety++) {
            if (countExisting() >= target) break;
            const ok = await addFor(group.section);
            if (!ok) break;
            added += 1;
            await wait(delayMs); // let Workday render the new entry
        }

        // Fill each entry by grouping the section's fields per label order.
        const perLabel = new Map<string, FieldDescriptor[]>();
        for (const f of scanFields()) {
            const key = norm(f.label) || norm(f.name);
            if (!group.hints.some((hint) => key.includes(hint))) continue;
            const list = perLabel.get(key) || [];
            list.push(f);
            perLabel.set(key, list);
        }
        const byEntry = new Map<number, FieldDescriptor[]>();
        for (const list of perLabel.values()) {
            list.forEach((f, i) => {
                if (!byEntry.has(i)) byEntry.set(i, []);
                byEntry.get(i)!.push(f);
            });
        }

        const entryResults: EntryResult[] = [];
        for (let i = 0; i < target; i++) {
            const fields = byEntry.get(i) || [];
            const entry: any = group.entries[i];
            const result: EntryResult = { index: i, filled: 0, missing: [] };
            // "I currently work here" checkbox first (affects end-date fields).
            const currentBox = fields.find((f) => isCurrentWorkCheckbox(f.label));
            if (currentBox) {
                const checked = fillCandidates(currentBox,
                    entry.current ? ["true", "yes", "1"] : ["false", "no", "0"]);
                if (checked) result.filled += 1;
            }

            for (const f of fields) {
                if (f === currentBox) continue; // already handled
                const candidates = (() => {
                    const key = norm(f.label) || norm(f.name);
                    const value = group.valueFor(f.label || f.name, entry);
                    if (value === null) return [null];
                    // Month selects: try several representations.
                    if (key.includes("month")) {
                        return monthCandidates(value);
                    }
                    return [value];
                })();
                if (fillCandidates(f, candidates)) {
                    result.filled += 1;
                } else {
                    result.missing.push(f.label || f.id);
                }
            }
            entryResults.push(result);
        }
        results.push({ section: group.section, addedSections: added, entries: entryResults });
    }

    return results;
}
