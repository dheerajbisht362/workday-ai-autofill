import type { FieldDescriptor, MappingDecision, ResumeProfile } from "./types";
import { BACKEND_URL, AUTOFILL_THRESHOLD } from "../shared/config";
const aliases: Record<string, keyof ResumeProfile["basics"]> = {
    "first name": "first_name", "given name": "first_name", "forename": "first_name",
    "last name": "last_name", "surname": "last_name", "family name": "last_name", "full name": "full_name",
    "email": "email", "email address": "email", "phone": "phone", "phone number": "phone", "mobile": "phone",
    "linkedin": "linkedin", "github": "github", "website": "website", "portfolio": "website", "city": "location", "location": "location"
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export function heuristicMap(fields: FieldDescriptor[], resume: ResumeProfile): MappingDecision[] {
    return fields.map(field => {
        const label = norm([field.label, field.name, field.placeholder, field.ariaLabel].join(" "));
        for (const [key, k] of Object.entries(aliases)) { if (label.includes(key)) { const v = resume.basics[k]; if (v) return { fieldId: field.id, value: v, confidence: .98, source: "heuristic", reason: `Matched "${key}".` }; } }
        // Skills are added via the Skills widget one-by-one (see fillSkills in
        // index.ts). Leave them to that flow rather than pre-filling here.
        if (label.includes("skill")) return { fieldId: field.id, value: null, confidence: 0, source: "none", reason: "Skills widget handled separately by the skill loop." };
        return { fieldId: field.id, value: null, confidence: 0, source: "none", reason: "No deterministic match." };
    });
}
// Cache of the last AI mapping result. Repeated SPA re-renders of the same
// step would otherwise call /api/map-fields on every render; the cache is
// keyed by the unresolved fields' metadata so genuine UI changes still
// trigger fresh AI mapping.
let aiCacheKey = "";
let aiCache: MappingDecision[] | null = null;

export async function buildMappings(fields: FieldDescriptor[], resume: ResumeProfile) {
    const h = heuristicMap(fields, resume), unresolved = fields.filter(f => (h.find(x => x.fieldId === f.id)?.confidence || 0) < AUTOFILL_THRESHOLD);
    if (!unresolved.length) return h;
    const key = JSON.stringify([resume, unresolved.map(f => [f.id, f.kind, f.label, f.description, f.name, f.placeholder, f.ariaLabel, f.required, f.options])]);
    const merge = (ai: MappingDecision[]) =>
        h.map(x => x.confidence >= AUTOFILL_THRESHOLD ? x : (ai.find(a => a.fieldId === x.fieldId) || x));
    if (key === aiCacheKey && aiCache) return merge(aiCache);
    try {
        const r = await fetch(`${BACKEND_URL}/api/map-fields`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resume, fields: unresolved.map(f => ({ id: f.id, kind: f.kind, label: f.label, description: f.description, name: f.name, placeholder: f.placeholder, ariaLabel: f.ariaLabel, required: f.required, options: f.options })) })
        });
        if (!r.ok) throw Error(`Mapping API ${r.status}`); const ai: MappingDecision[] = await r.json();
        aiCacheKey = key; aiCache = ai;
        return merge(ai);
    } catch { return h; }
}
