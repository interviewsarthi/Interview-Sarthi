const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function assessmentText(report) {
  return [report.plan ? `Practice target: ${report.plan.role} · ${report.plan.level}` : "", report.coverage || "", report.assessment_scope || "", report.plan?.weighting || "",
    ...(report.plan?.uncertainties || []).map(s => `Plan uncertainty: ${s}`),
    ...(report.plan?.deferred_requirements || []).map(s => `Outside this plan: ${s}`),
    ...(report.unresolved_essentials || []).map(s => `Unresolved essential: ${s}`),
    ...(report.requirements || report.competencies || []).map(c =>
    `${c.label}${c.priority ? ` (${c.priority})` : ""}: ${c.score === null ? "Not assessed" : `${c.score}/10 (${c.outcome || c.status})`}. ${c.explanation}${c.evidence_turns.length ? ` Evidence: transcript turns ${c.evidence_turns.join(", ")}.` : ""}${c.source_quote ? ` JD: ${c.source_quote}` : ""}${c.assessment_method === "work_sample" ? ` Practical assessment still needed: ${c.next_assessment || "Complete a relevant work sample."}` : ""}`)].filter(Boolean).join("\n");
}

export function assessmentHtml(report, transcript = []) {
  const rows = report.requirements || report.competencies;
  if (!rows) return "";
  return `<div class="card"><span class="label">Assessment coverage</span>
    <p>${escape(report.coverage)}</p><p class="muted">${escape(report.assessment_scope)}</p>
    ${report.plan ? `<p><b>Practice target:</b> ${escape(report.plan.role)} · ${escape(report.plan.level)}</p><p class="muted">${escape(report.plan.weighting)}</p>
      ${(report.plan.uncertainties || []).map(s => `<p>Plan uncertainty: ${escape(s)}</p>`).join("")}
      ${(report.plan.deferred_requirements || []).map(s => `<p>Outside this plan: ${escape(s)}</p>`).join("")}` : ""}
    ${(report.unresolved_essentials || []).length ? `<p><b>Essential requirements still unresolved</b></p><ul>${report.unresolved_essentials.map(s => `<li>${escape(s)}</li>`).join("")}</ul>` : ""}
    ${rows.map(c => `<div class="q"><h3>${escape(c.label)} · ${c.score === null ? "Not assessed" : `${escape(c.score)} / 10${c.status === "limited" ? " · Limited evidence" : ""}`}</h3>
      ${c.priority ? `<p class="muted">${escape(c.priority)} · ${escape(c.outcome)}</p>` : ""}
      <p>${escape(c.explanation)}</p>
      ${c.source_quote ? `<p class="muted">JD requirement: ${escape(c.source_quote)}</p>` : ""}
      ${c.assessment_method === "work_sample" ? `<p><b>Practical assessment still needed.</b> Any score here covers spoken reasoning only. ${escape(c.next_assessment || "Complete a relevant work sample.")}</p>` : ""}
      ${c.evidence_turns.map(n => `<p class="said">Evidence (turn ${n}): ${escape(transcript[n - 1]?.text || "")}</p>`).join("")}</div>`).join("")}</div>`;
}
