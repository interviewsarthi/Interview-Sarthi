// Shared assessment targets. These describe practice evidence, not a hiring decision.
export const COMPETENCIES = [
  { id: "communication", label: "Communication", description: "Clear, relevant explanations and listening across the conversation." },
  { id: "ownership", label: "Project and work ownership", description: "Purpose, personal contribution and outcomes of a real project or responsibility." },
  { id: "role_knowledge", label: "Role knowledge", description: "Understanding and application of the key skills required by the target role." },
  { id: "problem_solving", label: "Problem solving", description: "A reasoned approach to a relevant practical problem, including checking the result." },
  { id: "collaboration", label: "Collaboration", description: "Specific actions when working with others, resolving disagreement or asking for help." },
  { id: "judgment_learning", label: "Judgment and learning", description: "Trade-offs, priorities, mistakes and what the candidate learned or would change." },
];

export const ASSESSMENT_BRIEF = COMPETENCIES.map(c => `${c.id}: ${c.description}`).join("\n");

// One application clock feeds the display, model tool and hard deadline.
export function interviewProgress({ plannedSeconds, elapsedSeconds, entitlementSeconds = Infinity }) {
  const total = Math.max(0, Number(plannedSeconds) || 0);
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  const remaining = Math.max(0, Math.min(total - elapsed, entitlementSeconds));
  const closingSeconds = Math.min(60, total * 0.1);
  const canWrapUp = remaining <= closingSeconds;
  const fraction = total ? elapsed / total : 1;
  const focus = remaining <= 0 ? "end" : canWrapUp ? "candidate_questions"
    : fraction < 0.12 ? "introduction" : fraction < 0.32 ? "project_walkthrough"
    : fraction < 0.68 ? "role_knowledge_and_problem_solving"
    : fraction < 0.85 ? "collaboration_and_judgment" : "unassessed_areas";
  return {
    elapsedSeconds: Math.floor(elapsed), remainingSeconds: Math.ceil(remaining),
    closingSeconds, canWrapUp, focus,
    instruction: remaining <= 0 ? "Time is over. Thank the candidate and stop."
      : canWrapUp ? "Finish the current answer, invite candidate questions, then close near the deadline."
      : "Continue assessment. Do not say goodbye, announce a final question or invite closing questions. Prioritize an uncovered competency after the introduction and project overview. Do not interrupt an answer to change stages.",
  };
}

// Missing or invalid evidence never becomes a zero score. Evidence indices refer
// to the original transcript, not model-generated question numbering.
export function normalizeAssessment(report, transcript) {
  const rows = Array.isArray(report.competencies) ? report.competencies : [];
  const competencies = COMPETENCIES.map(c => {
    const row = rows.find(r => r.id === c.id) || {};
    const evidence = [...new Set(Array.isArray(row.evidence_turns) ? row.evidence_turns : [])]
      .filter(n => Number.isInteger(n) && n > 0 && transcript[n - 1]?.who === "candidate"
        && transcript[n - 1].text?.trim() && !transcript[n - 1].interrupted);
    const assessed = ["assessed", "limited"].includes(row.status) && evidence.length > 0
      && typeof row.score === "number" && Number.isFinite(row.score) && row.score >= 0 && row.score <= 10;
    return { id: c.id, label: c.label, status: assessed ? row.status : "not_assessed",
      score: assessed ? Math.round(row.score * 10) / 10 : null,
      evidence_turns: assessed ? evidence : [],
      explanation: assessed ? String(row.explanation || "") : "Not enough relevant answer evidence to score this area.",
    };
  });
  const scored = competencies.filter(c => c.score !== null);
  return { ...report, competencies,
    overall_score: scored.length ? Math.round(scored.reduce((sum, c) => sum + c.score, 0) / scored.length * 10) : null,
    coverage: `${scored.length} of ${COMPETENCIES.length} areas have scoring evidence`,
    assessment_scope: scored.length === COMPETENCIES.length && scored.every(c => c.status === "assessed")
      ? "All six areas sampled. This practice score is based only on this conversation, not a complete skills assessment."
      : "Partial assessment. Missing areas are not scored as zero; the score reflects only available evidence.",
  };
}
