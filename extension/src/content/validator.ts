import type { FieldDescriptor } from "./types";
export function validate(fields: FieldDescriptor[]) {
    const missingRequired: string[] = [], invalid: string[] = [];
    for (const f of fields) {
        const el = f.element, value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value.trim() : "";
        if (f.required && !value && !(el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") && el.checked)) missingRequired.push(f.label || f.name || f.id);
        if (el instanceof HTMLInputElement && el.type === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) invalid.push(f.label || f.name || f.id);
    }
    return { valid: !missingRequired.length && !invalid.length, missingRequired, invalid };
}
