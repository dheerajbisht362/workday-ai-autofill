import type { FieldDescriptor, FieldKind } from "./types";
const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim();
const escAttr = (s: string) => s.replace(/["\\]/g, "\\$&");
function labelFor(el: HTMLElement) {
  if (el.id) { const x = document.querySelector(`label[for="${escAttr(el.id)}"]`); if (x) return clean(x.textContent || ""); }
  const p = el.closest("label"); if (p) return clean(p.textContent || "");
  const l = el.closest("fieldset")?.querySelector("legend"); if (l) return clean(l.textContent || "");
  return clean(el.closest("div")?.querySelector("label")?.textContent || "");
}
function stablize(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return `q-${h.toString(36)}`; }

// For radios/checkboxes Workday renders ONE <input> per option (Yes / No)
// with no value; the question wraps the group. Resolve which option label this
// input belongs to, and the shared question label, so the whole group maps to
// a single question the AI can answer (e.g. relocation → yes/no).
function choiceMeta(el: HTMLInputElement): { question: string; option: string } {
  const ownLabel = clean(el.getAttribute("aria-label") || (el.closest("label")?.textContent || ""));
  const wrap = el.closest("fieldset") || el.closest<HTMLElement>("[role='radiogroup'], [role='group'], div > div, li, tr");
  // Parent wrapper holds other sibling options; question label comes first (legend
  // or the first text-node / label that isn't one of the options).
  const wrapLabel = el.closest("fieldset")?.querySelector("legend") || wrap?.querySelector<HTMLElement>("[data-automation-id*='promptLabel'], label, span");
  const question = clean(wrapLabel?.textContent || (wrap?.querySelector("legend")?.textContent || (el.closest("div")?.querySelector("label")?.textContent || "")));
  const option = ownLabel || clean(el.closest("label")?.textContent || "");
  return { question, option };
}
function kindFor(el: HTMLElement): FieldKind {
  if (el.getAttribute("contenteditable") === "true") return "richtext";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLInputElement) { if (el.type === "date") return "date"; if (el.type === "file") return "file"; if (el.type === "radio") return "radio"; if (el.type === "checkbox") return "checkbox"; return "text"; }
  return "unknown";
}
export function scanFields(root: ParentNode = document): FieldDescriptor[] {
  return [...root.querySelectorAll<HTMLElement>("input:not([type=hidden]),textarea,select,[contenteditable='true']")].map((el, i) => {
    const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : "";
    const options = el instanceof HTMLSelectElement ? [...el.options].map(o => clean(o.text)).filter(Boolean) : [];
    const name = el.getAttribute("name") || "", placeholder = el.getAttribute("placeholder") || "", ariaLabel = el.getAttribute("aria-label") || "";
    return {
      id: el.id || `field-${i}`, kind: kindFor(el), label: labelFor(el) || ariaLabel || placeholder || name,
      description: clean(el.closest("div")?.querySelector("[data-automation-id*=description]")?.textContent || ""),
      name, placeholder, ariaLabel,
      required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true", value, options, element: el
    };
  }).filter(f => f.label || f.name || f.placeholder || f.ariaLabel);
}
