// Review renderer for the popup: tiered ✓ filled / ⚠ needs attention / ? decisions.
export function setReview(html: string) {
    const el = document.getElementById("review");
    if (el) el.innerHTML = html;
}

export function renderReview(data: any) {
    if (!data || data.error || !data.results) {
        setReview("");
        return;
    }
    const results: Array<{ label: string; fieldId: string; filled: boolean; confidence: number }> = data.results;
    const validation = data.validation || { valid: true, missingRequired: [], invalid: [] };
    const step = data.page?.currentStep ? esc(String(data.page.currentStep)) : "";

    const filled = results.filter((r) => r.filled);
    const attention = results.filter((r) => !r.filled && r.confidence > 0);
    const decisions = results.filter((r) => !r.filled && r.confidence === 0);

    const li = (r: any, cls: string, badge: string) =>
        `<li><span class="${cls}">${badge} ${esc(r.label || r.fieldId)}</span>` +
        (r.confidence ? ` <span class="conf">(${Math.round(r.confidence * 100)}%)</span>` : "") +
        "</li>";

    const reviewList = (items: any[], cls: string, badge: string) =>
        items.length ? `<ul class="review-list">${items.map((r) => li(r, cls, badge)).join("")}</ul>` : "";

    const missing =
        (validation.missingRequired || []).length ? `<b>${esc(validation.missingRequired.join(", "))}</b>` : "";
    const extra = (validation.invalid || []).length ? ` invalid: <b>${esc(validation.invalid.join(", "))}</b>` : "";

    setReview(`
      <div class="card review-card">
        <div class="review-head">📋 Review ${step ? `<span class="step">— step: ${step}</span>` : ""}</div>
        ${validation.valid
            ? '<div class="val-badge ok">✅ Required fields ready</div>'
            : `<div class="val-badge err">⚠ Missing required: ${missing || "—"}${extra}</div>`}
        ${reviewList(filled, "b-ok", "✓")}
        ${reviewList(attention, "b-warn", "⚠")}
        ${decisions.length
            ? `<details class="review-details"><summary>${decisions.length} question(s) need your decision</summary>${reviewList(decisions, "b-na", "?")}</details>`
            : ""}
      </div>`);
}

function esc(s: string) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
