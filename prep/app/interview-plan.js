// JD criteria are fixed before the call. CV matches guide questions, not scores.
const clean = value => typeof value === "string" ? value.trim() : "";
const comparable = value => clean(value).replace(/\s+/g, " ").toLowerCase();
const contains = (document, quote) => !!clean(quote) && comparable(document).includes(comparable(quote));
const list = value => Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
export const PLAN_CATEGORIES = ["role_knowledge", "problem_solving", "ownership", "quality_risk", "judgment_learning", "collaboration", "communication", "leadership"];
export const TARGET_LEVELS = ["Entry-level / fresher", "Individual contributor", "Senior individual contributor", "Lead / manager"];

export function interviewContext({ jd = "", practiceFocus = "role", targetRole = "", targetLevel = "" } = {}) {
  if (clean(jd)) return { mode: "job_description", targetRole: "", targetLevel: "" };
  if (practiceFocus === "general_cv") return { mode: "general_cv", targetRole: "General CV practice", targetLevel: "No target seniority" };
  if (!clean(targetRole)) throw new Error("Without a JD, enter the role you want to practise for, or choose General CV practice.");
  if (!TARGET_LEVELS.includes(targetLevel)) throw new Error("Choose the level of the role you want to practise for.");
  return { mode: "role_baseline", targetRole: clean(targetRole), targetLevel };
}

export function validatePlan(raw, { cv = "", jd = "", context } = {}) {
  if (!raw || !Array.isArray(raw.requirements) || !raw.requirements.length || raw.requirements.length > 12) throw new Error("The assessment plan needs 1–12 specific requirements.");
  if (!clean(jd) && context && (comparable(raw.role) !== comparable(context.targetRole) || comparable(raw.level) !== comparable(context.targetLevel))) {
    throw new Error("The assessment plan changed the chosen role or level. Please retry.");
  }
  const requirements = raw.requirements.map((r, i) => {
    if (!r || !clean(r.label) || !clean(r.question) || !clean(r.criteria?.weak)
      || !clean(r.criteria?.adequate) || !clean(r.criteria?.strong)) throw new Error("The assessment plan is missing questions or scoring criteria.");
    const sourced = contains(jd, r.source_quote);
    const priority = sourced && ["essential", "preferred"].includes(r.priority) ? r.priority : "inferred";
    const cvEvidence = contains(cv, r.cv_evidence) ? clean(r.cv_evidence) : "";
    return { id: `r${i + 1}`, label: clean(r.label),
      category: PLAN_CATEGORIES.includes(r.category) ? r.category : "role_knowledge",
      priority, weight: priority === "essential" ? 2 : 1,
      source_quote: sourced ? clean(r.source_quote) : "",
      cv_evidence: cvEvidence, cv_match: cvEvidence && ["direct", "related"].includes(r.cv_match) ? r.cv_match : "unknown",
      assessment_method: r.assessment_method === "work_sample" ? "work_sample" : "interview",
      question: clean(r.question), followups: list(r.followups).slice(0, 3),
      criteria: { weak: clean(r.criteria.weak), adequate: clean(r.criteria.adequate), strong: clean(r.criteria.strong) },
      next_assessment: clean(r.next_assessment),
    };
  });
  const mode = clean(jd) ? "job_description" : context?.mode || "general_cv";
  return { mode,
    role: !clean(jd) ? context?.targetRole || "General CV practice" : clean(raw.role) || "Role to clarify",
    level: !clean(jd) ? context?.targetLevel || "No target seniority" : clean(raw.level) || "Level to clarify",
    uncertainties: [...list(raw.uncertainties), ...(!clean(jd) ? [mode === "role_baseline"
      ? "No JD supplied: this is general practice for your chosen role and level. Criteria are inferred, not employer-confirmed requirements."
      : "No JD supplied: this is CV-based practice, not a score for a specific job or seniority level."] : [])],
    deferred_requirements: list(raw.deferred_requirements), requirements,
    weighting: "Essential requirements have weight 2; preferred and inferred requirements have weight 1. Priorities are fixed before the call; inferred priorities are not employer-confirmed.",
  };
}

export function evidenceTurns(indices, transcript) {
  return [...new Set(Array.isArray(indices) ? indices : [])].filter(n => Number.isInteger(n) && n > 0
    && transcript[n - 1]?.who === "candidate" && clean(transcript[n - 1].text) && !transcript[n - 1].interrupted);
}

export class PlanCoverage {
  constructor(plan) { this.plan = plan; this.records = new Map(); }

  // The live model can attach evidence, but cannot add requirements, change their
  // priorities or mark an area covered without a quote in the actual transcript.
  update(updates, transcript) {
    for (const update of (Array.isArray(updates) ? updates : []).slice(0, 12)) {
      if (!update || !this.plan.requirements.some(r => r.id === update.requirement_id)
        || !["covered", "needs_followup"].includes(update.status) || !clean(update.answer_quote)) continue;
      const turnIndex = transcript.findLastIndex(t => t.who === "candidate" && !t.interrupted && contains(t.text, update.answer_quote));
      if (turnIndex < 1 || transcript[turnIndex - 1].who !== "interviewer") continue;
      const previous = this.records.get(update.requirement_id);
      const turns = [...new Set([...(previous?.evidence_turns || []), turnIndex + 1])];
      this.records.set(update.requirement_id, { status: update.status, evidence_turns: turns });
    }
  }

  snapshot(progress) {
    const requirements = this.plan.requirements.map(r => {
      const record = this.records.get(r.id);
      // Full questions and rubrics are already in the system brief. Send only
      // changing coverage here rather than repeating the whole plan every turn.
      return { id: r.id, label: r.label, priority: r.priority, weight: r.weight,
        assessment_method: r.assessment_method, status: record?.status || "pending", evidence_turns: record?.evidence_turns || [] };
    });
    const candidates = requirements.filter(r => r.status === "pending" || (r.status === "needs_followup" && r.evidence_turns.length < 2))
      .sort((a, b) => b.weight - a.weight || (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1));
    const canAssess = !progress.canWrapUp;
    return { requirements, question_opportunities: canAssess ? candidates : [],
      guidance: progress.canWrapUp ? "Respect the closing window; leave remaining requirements unassessed."
        : candidates.length ? "Complete the introduction and project overview before depth questions, but do not wait for a fixed timestamp once they are complete. Choose the next question dynamically from the answer, important gaps and remaining time. Opportunities are priority-ordered context, not a mandatory sequence. You may follow up, simplify or create a fresh role-related scenario. Prepared questions are examples, not a script. Ask one question, for a specific evidence purpose, and never repeat an already answered question."
        : "Continue with a new relevant scenario or deeper evidence for an essential requirement until the closing window. Do not finish early.",
    };
  }
}

export function normalizeRequirements(report, plan, transcript) {
  const rows = Array.isArray(report.requirements) ? report.requirements : [];
  const requirements = plan.requirements.map(r => {
    const row = rows.find(item => item?.id === r.id) || {};
    const evidence = evidenceTurns(row.evidence_turns, transcript);
    const valid = ["assessed", "limited"].includes(row.status) && evidence.length && typeof row.score === "number"
      && Number.isFinite(row.score) && row.score >= 0 && row.score <= 10;
    const score = valid ? Math.round(row.score * 10) / 10 : null;
    const status = score === null ? "not_assessed" : row.status === "limited" || r.assessment_method === "work_sample" ? "limited" : "assessed";
    return { ...r, score, status, evidence_turns: valid ? evidence : [],
      outcome: score === null ? "Not assessed" : score < 5 ? "Below expected level"
        : score < 7 || status === "limited" ? "Partially demonstrated" : "Demonstrated",
      explanation: valid ? clean(row.explanation) : "Insufficient relevant answer evidence; this is not a zero score.",
    };
  });
  const scored = requirements.filter(r => r.score !== null);
  const unresolved = requirements.filter(r => r.priority === "essential" && r.outcome !== "Demonstrated");
  return { ...report, requirements, plan,
    overall_score: scored.length ? Math.round(scored.reduce((sum, r) => sum + r.score * r.weight, 0) / scored.reduce((sum, r) => sum + r.weight, 0) * 10) : null,
    coverage: `${scored.length} of ${requirements.length} ${plan.mode === "job_description" ? "role requirements" : "practice areas"} have scoring evidence`,
    unresolved_essentials: unresolved.map(r => `${r.label}: ${r.outcome}${r.assessment_method === "work_sample" ? "; practical assessment required" : ""}`),
    assessment_scope: `${scored.length < requirements.length || requirements.some(r => r.status === "limited") ? "Partial assessment. " : "All planned requirements sampled. "}This practice score reflects only assessed requirements, not a hiring prediction. ${plan.mode === "job_description" ? `${unresolved.length} essential requirement(s) remain unresolved.` : "No employer-specific suitability is assessed without a JD."}`,
  };
}
