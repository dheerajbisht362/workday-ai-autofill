export type FieldKind = "text" | "textarea" | "select" | "date" | "file" | "radio" | "checkbox" | "richtext" | "unknown";
export interface JobContext {
    title?: string;
    location?: string;
    company?: string;
}
export interface FieldDescriptor { id: string; kind: FieldKind; label: string; description: string; name: string; placeholder: string; ariaLabel: string; required: boolean; value: string; options: string[]; optionLabel?: string; element: HTMLElement; }
export interface MappingDecision { fieldId: string; value: string | boolean | null; confidence: number; source: "ai" | "heuristic" | "manual" | "none"; reason: string; }
export interface ResumeProfile {
    basics: { first_name?: string; last_name?: string; full_name?: string; email?: string; phone?: string; location?: string; linkedin?: string; github?: string; website?: string };
    work_experience: Array<{ company: string; title: string; location?: string; start_date?: string; end_date?: string; current?: boolean; bullets: string[] }>;
    education: Array<{ institution: string; degree?: string; field?: string; start_date?: string; end_date?: string }>;
    skills: string[]; certifications: string[];
    job?: JobContext;
}
