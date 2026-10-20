/* Prep Sarthi: a pass holder's progress across their month, from their saved interviews.
 *
 * Pure functions: no page, no network. history.js supplies the summaries (from the account, or from this
 * browser's own list) and the page draws what these return. Every number here is computed from the saved
 * reports; the only AI-written text about the month comes from insights.js.
 *
 * Trust rules (owner-approved plan, 29 Sep 2026):
 * - A trend needs at least two comparable interviews; with fewer the answer says so instead of drawing one.
 * - An interview too short, or with too little of its plan scored, is shown but never moves a trend.
 * - Skills are compared through the eight skill groups every plan requirement already belongs to, so
 *   interviews for different jobs can share one line. Scores that are missing stay missing, never zero.
 * - Each summary records which scoring rules and which AI wrote the report, so a change of either is visible
 *   and is not mistaken for a change in the person.
 * - Delivery numbers are estimates from turn timing and the transcript, not measurements.
 */

import { PLAN_CATEGORIES } from "./interview-plan.js";

export const SUMMARY_VERSION = 1;
export const MIN_MINUTES = 5;          // shorter than this is a false start or a mic test, not an interview
export const MIN_COVERAGE = 0.5;       // at least half of the plan's requirements scored
export const RECENT = 3;               // "recent" = the last three comparable interviews
export const FOCUS_FRESH_DAYS = 14;    // an older focus is not carried into a new interview
const DAY_MS = 86400_000;

const LABELS = {
  communication: "Communication", ownership: "Ownership", role_knowledge: "Role knowledge",
  problem_solving: "Problem solving", quality_risk: "Quality and risk", collaboration: "Collaboration",
  judgment_learning: "Judgment and learning", leadership: "Leadership",
};
export const SKILL_GROUPS = PLAN_CATEGORIES.map((id) => ({ id, label: LABELS[id] || id }));
const CORE_GROUPS = ["communication", "role_knowledge", "problem_solving"];

/* Guide ranges, drawn from what speaking coaches publish (Quinncia 110-130 wpm and under 2 fillers a
 * minute, Big Interview 115-180 wpm, answers under 30 s too thin to judge). Loose on purpose: our numbers
 * are estimates, so the page should say "outside the usual range", never "wrong". */
export const DELIVERY = [
  { id: "wpm", label: "Speaking pace", unit: "words per minute", target: { min: 110, max: 160 } },
  { id: "pause", label: "Pause before answering", unit: "seconds", target: { max: 3 } },
  { id: "fillers_pm", label: "Filler words", unit: "per minute", target: { max: 2 } },
  { id: "answer_seconds", label: "Average answer length", unit: "seconds", target: { min: 30, max: 120 } },
  { id: "talk_share", label: "Your share of the talking", unit: "fraction", target: { min: 0.6 } },
];

// ------------------------------------------------------------------ helpers

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);

/** "main" = the first report model, "lite" = its fallback, "backup" = the licence server's Groq writer. */
export function writerTier(model) {
  const m = String(model || "");
  if (!m) return "unknown";
  if (/flash-lite/.test(m)) return "lite";
  if (/^gemini-/.test(m)) return "main";
  return "backup";
}

/** One line per role and level practised: interviews for the same target share a track. */
export function trackKey({ mode, role, level }) { return [norm(mode), norm(role), norm(level)].join("|"); }

/** Calendar day of an instant, in the viewer's time zone unless one is given. */
export function dayKey(iso, timeZone) {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function groupOf(row) {
  if (row && PLAN_CATEGORIES.includes(row.category)) return row.category;
  if (row && PLAN_CATEGORIES.includes(row.id)) return row.id;           // the six broad areas of a plan-less report
  return null;
}

// ------------------------------------------------------------- summaries

/**
 * The small, numbers-only record of one interview that the progress page is built from. Its full report
 * and transcript are kept separately (history.js); this is what the account list returns.
 * @param {object} record  what app.js saves after a report: {id, at, elapsed, language, model, rubric,
 *                         demo, report, metrics}
 */
export function summarize(record) {
  const rep = record.report || {};
  const rows = Array.isArray(rep.requirements) ? rep.requirements : Array.isArray(rep.competencies) ? rep.competencies : [];
  const plan = rep.plan || {};
  const groups = {}, planned = {};
  for (const g of PLAN_CATEGORIES) {
    const mine = rows.filter((r) => groupOf(r) === g);
    if (mine.length) planned[g] = mine.length;
    const scored = mine.filter((r) => num(r.score) !== null);
    if (!scored.length) continue;
    const weight = (r) => Number(r.weight) > 0 ? Number(r.weight) : 1;
    const total = scored.reduce((s, r) => s + weight(r), 0);
    groups[g] = {
      score: round1(scored.reduce((s, r) => s + r.score * weight(r), 0) / total),
      n: scored.length,
      limited: scored.every((r) => r.status === "limited"),
    };
  }
  const m = record.metrics || {};
  const answers = Array.isArray(m.answers) ? m.answers : [];
  const words = answers.reduce((s, a) => s + (Number(a.words) || 0), 0);
  const cand = Number(m.candidateTalkSeconds) || 0, intv = Number(m.interviewerTalkSeconds) || 0;
  const mode = plan.mode || (rows === rep.competencies ? "broad" : "unknown");
  const role = plan.role || "", level = plan.level || "";
  return {
    sv: SUMMARY_VERSION,
    id: record.id, kind: "interview", at: record.at,
    minutes: round1((Number(record.elapsed) || 0) / 60),
    language: record.language || "",
    model: record.model || "", writer: writerTier(record.model), rubric: record.rubric || null,
    demo: !!record.demo,
    mode, role: clip(role, 80), level: clip(level, 60), track: trackKey({ mode, role, level }),
    score: num(rep.overall_score),
    coverage: { scored: rows.filter((r) => num(r.score) !== null).length, total: rows.length },
    groups, planned,
    questions: (rep.questions || []).map((q) => ({ q: clip(q.question, 200), score: num(Number(q.score)) })),
    delivery: {
      wpm: num(m.avgWpm), pause: num(m.avgResponseDelay), fillers_pm: num(m.fillersPerMinute),
      fillers_p100: words ? round1((Number(m.fillersTotal) || 0) / words * 100) : null,
      longest_pause: num(m.longestPause),
      answer_seconds: answers.length ? round1(mean(answers.map((a) => Number(a.seconds) || 0))) : null,
      talk_share: cand + intv ? round2(cand / (cand + intv)) : null,
      answers: answers.length, metrics_v: Number(m.v) || 1,
    },
    focus: normalizeFocus(rep.next_focus),
    focus_check: normalizeCheck(rep.focus_check),
    practice_next: (rep.practice_next || []).slice(0, 3).map((x) => clip(x, 300)),
  };
}

export function normalizeFocus(f) {
  if (!f || typeof f !== "object" || !PLAN_CATEGORIES.includes(f.group) || !String(f.issue || "").trim()) return null;
  return { group: f.group, issue: clip(f.issue, 300), drill: clip(f.drill, 300) };
}
export const FOCUS_STATUSES = ["fixed", "improved", "still_open", "not_tested"];
function normalizeCheck(c) {
  if (!c || typeof c !== "object" || !FOCUS_STATUSES.includes(c.status)) return null;
  return { status: c.status, note: clip(c.note, 300), evidence_turns: Array.isArray(c.evidence_turns) ? c.evidence_turns.filter(Number.isInteger) : [] };
}

/** Whether an interview may move a trend, and if not, why. */
export function comparability(s) {
  if (num(s.score) === null) return { ok: false, reason: "no_score" };
  if ((Number(s.minutes) || 0) < MIN_MINUTES) return { ok: false, reason: "too_short" };
  const c = s.coverage || {};
  if (c.total && c.scored / c.total < MIN_COVERAGE) return { ok: false, reason: "low_coverage" };
  return { ok: true, reason: null };
}
export const REASONS = {
  no_score: "Not enough answers to score.",
  too_short: `Shorter than ${MIN_MINUTES} minutes.`,
  low_coverage: "Less than half of the interview plan was scored.",
};

// ---------------------------------------------------------- report badges

/**
 * What changed since earlier interviews, for the badges on a new report: "+8 since last time".
 * @param {object} current   the new interview's summary
 * @param {Array}  items     earlier summaries (the current one may be among them; it is skipped)
 * @param {{start:string,end:string}} [period]  count "first" from this pass window only
 */
export function reportChanges(current, items, period = null) {
  const cmp = comparability(current);
  const out = { comparable: cmp.ok, reason: cmp.reason, score: null, groups: [] };
  if (!cmp.ok) return out;
  const earlier = interviews(items)
    .filter((s) => s.id !== current.id && s.at < current.at && comparability(s).ok && inPeriod(s, period))
    .sort(byAt);
  const last = earlier.at(-1), first = earlier[0];
  if (last) {
    out.score = {
      now: current.score,
      since_last: current.score - last.score, last_id: last.id, last_at: last.at, same_role_as_last: last.track === current.track,
      since_first: current.score - first.score, first_id: first.id, first_at: first.at, same_role_as_first: first.track === current.track,
      interviews: earlier.length + 1,
    };
  }
  for (const g of SKILL_GROUPS) {
    const now = current.groups && current.groups[g.id];
    if (!now) continue;
    const prev = earlier.filter((s) => s.groups && s.groups[g.id]);
    if (!prev.length) { out.groups.push({ id: g.id, label: g.label, score: now.score, first_time: true }); continue; }
    const l = prev.at(-1), f = prev[0];
    out.groups.push({ id: g.id, label: g.label, score: now.score,
      since_last: round1(now.score - l.groups[g.id].score), since_first: round1(now.score - f.groups[g.id].score), first_time: false });
  }
  return out;
}

// ------------------------------------------------------------ the month

const interviews = (items) => (items || []).filter((s) => s && s.kind === "interview" && s.at);
/** Whether an item belongs to a pass period. A period's `from` (history.js) reaches back before its start: the
 * first pass also holds the free demo and anything imported ("day 0"); a period without `from` starts at start. */
export const inPeriod = (s, p) => {
  if (!p) return true;
  const from = "from" in p ? p.from : p.start;
  return (!from || s.at >= from) && s.at <= p.end;
};

/**
 * Everything the "My progress" page draws.
 * @param {Array} items  summaries from history.js (any kinds, any order)
 * @param {object} [o]
 * @param {{start:string,end:string}} [o.period]  one pass window; default: every saved interview
 * @param {string} [o.track]   "all" (default) or a key from the returned `tracks`
 * @param {Date}   [o.now]
 * @param {string} [o.timeZone]  for the calendar; default the viewer's
 */
export function buildProgress(items, o = {}) {
  const now = o.now || new Date();
  const tz = o.timeZone;
  const all = interviews(items).filter((s) => inPeriod(s, o.period)).sort(byAt);
  const tracks = trackList(all);
  const track = o.track && o.track !== "all" ? o.track : "all";
  const list = track === "all" ? all : all.filter((s) => s.track === track);

  const points = list.map((s) => {
    const c = comparability(s);
    return { id: s.id, at: s.at, score: s.score, comparable: c.ok, reason: c.reason, writer: s.writer, rubric: s.rubric, track: s.track, demo: !!s.demo, minutes: s.minutes };
  });
  const comp = list.filter((s) => comparability(s).ok);
  const scores = comp.map((s) => s.score);
  const recentScores = scores.slice(-RECENT);
  const score = {
    points,
    enough: comp.length >= 2,
    first: comp.length ? comp[0].score : null,
    latest: comp.length ? comp.at(-1).score : null,
    best: scores.length ? Math.max(...scores) : null,
    average: scores.length ? Math.round(mean(scores)) : null,
    recent: recentScores.length ? Math.round(mean(recentScores)) : null,
    change_since_first: comp.length >= 2 ? comp.at(-1).score - comp[0].score : null,
    change_since_last: comp.length >= 2 ? comp.at(-1).score - comp.at(-2).score : null,
    different_roles: comp.length >= 2 && comp[0].track !== comp.at(-1).track,
    comparable: comp.length,
  };
  score.message = score.enough ? null : comp.length === 1
    ? "One full interview so far. Your trend starts with the next one."
    : "No full interview yet. Your trend starts after two.";

  const groups = SKILL_GROUPS.map((g) => groupTrend(g, comp));
  const delivery = DELIVERY.map((d) => deliveryTrend(d, list));
  const coverage = {
    strong: groups.filter((g) => g.status === "strong").map((g) => g.id),
    developing: groups.filter((g) => g.status === "developing").map((g) => g.id),
    weak: groups.filter((g) => g.status === "weak").map((g) => g.id),
    thin: groups.filter((g) => g.n === 1).map((g) => g.id),
    never_tested: groups.filter((g) => g.n === 0).map((g) => g.id),
    // Planned in some interview but never scored: the interviewer ran out of time, or the answers were too thin.
    planned_not_scored: groups.filter((g) => g.n === 0 && list.some((s) => s.planned && s.planned[g.id])).map((g) => g.id),
  };

  return {
    period: o.period ? periodView(o.period, now) : null,
    totals: totals(all, now, tz),
    calendar: calendar(all, o.period, now, tz),
    tracks, track,
    score, groups, delivery, coverage,
    readiness: readiness(comp, groups),
    focus: focusView(list),
    warnings: warnings(list, comp),
  };
}

function trackList(list) {
  const map = new Map();
  for (const s of list) {
    const t = map.get(s.track) || { key: s.track, mode: s.mode, role: s.role, level: s.level, count: 0, last_at: s.at };
    t.count++; t.last_at = s.at;
    map.set(s.track, t);
  }
  return [...map.values()].sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
}

function groupTrend(g, comp) {
  const pts = comp.filter((s) => s.groups && s.groups[g.id])
    .map((s) => ({ id: s.id, at: s.at, score: s.groups[g.id].score, limited: !!s.groups[g.id].limited }));
  const vals = pts.map((p) => p.score);
  const [start, end] = ends(vals);
  const recent = vals.length ? round1(mean(vals.slice(-RECENT))) : null;
  const change = vals.length >= 2 ? round1(end - start) : null;
  const trend = vals.length < 2 ? "not_enough" : change >= 0.5 ? "up" : change <= -0.5 ? "down" : "flat";
  const status = !vals.length ? "not_tested" : recent >= 7 ? "strong" : recent >= 5 ? "developing" : "weak";
  return { id: g.id, label: g.label, n: vals.length, points: pts,
    first: vals.length ? vals[0] : null, latest: vals.length ? vals.at(-1) : null, best: vals.length ? Math.max(...vals) : null,
    start, recent, change, trend, status };
}

/* Where a line started and where it is now: the first and last value, or with four or more the average of
 * the first two and of the last two, so one odd interview cannot fake a trend. The two never overlap. */
function ends(vals) {
  if (!vals.length) return [null, null];
  const k = vals.length >= 4 ? 2 : 1;
  return [round2(mean(vals.slice(0, k))), round2(mean(vals.slice(-k)))];
}

function distance(v, t) {
  if (v === null) return null;
  if (t.min !== undefined && v < t.min) return t.min - v;
  if (t.max !== undefined && v > t.max) return v - t.max;
  return 0;
}

function deliveryTrend(d, list) {
  const pts = list.map((s) => ({ id: s.id, at: s.at, value: num(s.delivery && s.delivery[d.id]) })).filter((p) => p.value !== null);
  const vals = pts.map((p) => p.value);
  const latest = vals.length ? vals.at(-1) : null;
  const avg = vals.length ? round2(mean(vals)) : null;
  const recent = vals.length ? round2(mean(vals.slice(-RECENT))) : null;
  // Better or worse = closer to or further from the guide range, comparing where they started with lately.
  let trend = "not_enough";
  if (vals.length >= 2) {
    const [first, last] = ends(vals);
    const before = distance(first, d.target), after = distance(last, d.target);
    const scale = d.id === "talk_share" ? 0.05 : d.id === "wpm" ? 5 : d.id === "answer_seconds" ? 5 : 0.3;
    trend = after < before - scale ? "better" : after > before + scale ? "worse" : after === 0 ? "in_range" : "flat";
  }
  return { id: d.id, label: d.label, unit: d.unit, target: d.target, points: pts, latest, average: avg, recent,
    latest_in_target: latest === null ? null : distance(latest, d.target) === 0, trend, approximate: true };
}

function readiness(comp, groups) {
  const reasons = [];
  if (comp.length < RECENT) {
    return { level: "not_enough", reasons: [{ code: "few_interviews", value: comp.length,
      text: `Readiness needs ${RECENT} full interviews; you have ${comp.length}.` }] };
  }
  const last = comp.slice(-RECENT);
  const recent = Math.round(mean(last.map((s) => s.score)));
  reasons.push({ code: "recent_average", value: recent, text: `Your last ${RECENT} interviews averaged ${recent} out of 100.` });
  const weak = groups.filter((g) => g.n > 0 && g.recent !== null && g.recent < 6);
  for (const g of weak) reasons.push({ code: "weak_group", group: g.id, value: g.recent, text: `${g.label} is at ${g.recent} out of 10 lately.` });
  const untested = CORE_GROUPS.filter((id) => !last.some((s) => s.groups && s.groups[id]));
  for (const id of untested) reasons.push({ code: "untested_core", group: id, text: `${LABELS[id]} was not tested in your last ${RECENT} interviews.` });
  const open = last.filter((s) => s.focus_check && s.focus_check.status === "still_open").length;
  if (open >= 2) reasons.push({ code: "focus_open", value: open, text: `Your practice focus was still open in ${open} of your last ${RECENT} interviews.` });
  const level = recent >= 70 && !weak.length && !untested.length && open < 2 ? "ready" : recent >= 55 ? "getting_there" : "not_yet";
  return { level, reasons };
}

function focusView(list) {
  const withFocus = list.filter((s) => s.focus);
  const latest = withFocus.at(-1);
  const checks = list.filter((s) => s.focus_check).map((s) => {
    const before = withFocus.filter((p) => p.at < s.at).at(-1);
    return { id: s.id, at: s.at, focus: before ? before.focus : null, status: s.focus_check.status, note: s.focus_check.note };
  });
  return {
    current: latest ? { ...latest.focus, from_id: latest.id, at: latest.at } : null,
    checks,
    fixed: checks.filter((c) => c.status === "fixed" || c.status === "improved").length,
    open: checks.filter((c) => c.status === "still_open").length,
  };
}

function warnings(list, comp) {
  const out = [];
  const backup = comp.filter((s) => s.writer === "lite" || s.writer === "backup");
  if (backup.length && backup.length < comp.length) {
    out.push({ code: "mixed_writers", ids: backup.map((s) => s.id),
      text: `${backup.length} of your reports were written by a backup AI because Google was busy. Their scores can differ slightly.` });
  }
  const rubrics = new Set(comp.map((s) => s.rubric || "none"));
  if (rubrics.size > 1) out.push({ code: "rules_changed", text: "Our scoring rules changed during this period, so early and late scores are not perfectly comparable." });
  const left = list.filter((s) => !comparability(s).ok);
  if (left.length) out.push({ code: "excluded", ids: left.map((s) => s.id),
    text: `${left.length} interview${left.length === 1 ? " is" : "s are"} shown but left out of your trends (too short or too little scored).` });
  return out;
}

function totals(all, now, tz) {
  const days = [...new Set(all.map((s) => dayKey(s.at, tz)))].sort();
  let streak = 0;
  const today = dayKey(now.toISOString(), tz);
  const yesterday = dayKey(new Date(now.getTime() - DAY_MS).toISOString(), tz);
  if (days.includes(today) || days.includes(yesterday)) {
    let d = days.includes(today) ? now : new Date(now.getTime() - DAY_MS);
    while (days.includes(dayKey(d.toISOString(), tz))) { streak++; d = new Date(d.getTime() - DAY_MS); }
  }
  return { interviews: all.length, practice_days: days.length, minutes: Math.round(all.reduce((s, x) => s + (Number(x.minutes) || 0), 0)), streak };
}

function calendar(all, period, now, tz) {
  const startIso = period ? (all.length && all[0].at < period.start ? all[0].at : period.start) : all.length ? all[0].at : now.toISOString();
  const endIso = period ? period.end : now.toISOString();
  const today = dayKey(now.toISOString(), tz);
  const out = [];
  const seen = new Set();
  // Step in 6-hour hops so a time zone or daylight-saving shift can never skip a day.
  for (let t = Date.parse(startIso); t <= Date.parse(endIso) + DAY_MS; t += DAY_MS / 4) {
    const key = dayKey(new Date(Math.min(t, Date.parse(endIso))).toISOString(), tz);
    if (seen.has(key)) continue;
    seen.add(key);
    const mine = all.filter((s) => dayKey(s.at, tz) === key);
    const scored = mine.map((s) => s.score).filter((x) => num(x) !== null);
    out.push({ date: key, interviews: mine.map((s) => s.id), minutes: Math.round(mine.reduce((s, x) => s + (Number(x.minutes) || 0), 0)),
      best: scored.length ? Math.max(...scored) : null, future: key > today });
  }
  return out;
}

function periodView(p, now) {
  const start = Date.parse(p.start), end = Date.parse(p.end), t = now.getTime();
  const days = Math.max(1, Math.round((end - start) / DAY_MS));
  return { start: p.start, end: p.end, days,
    day: Math.min(days, Math.max(1, Math.floor((t - start) / DAY_MS) + 1)),
    days_left: Math.max(0, Math.ceil((end - t) / DAY_MS)), ended: t >= end };
}

/**
 * The weakness the next interview should test: the latest report's focus, if recent. A role-knowledge focus
 * belongs to one role, so it is carried only into an interview for the same role and level.
 * @param {Array} items  summaries
 * @param {string} [track]  the track of the interview about to start
 */
export function carryFocus(items, track, now = new Date()) {
  const recent = interviews(items).filter((s) => s.focus && now.getTime() - Date.parse(s.at) <= FOCUS_FRESH_DAYS * DAY_MS).sort(byAt);
  for (let i = recent.length - 1; i >= 0; i--) {
    const s = recent[i];
    if (s.focus.group !== "role_knowledge" || !track || s.track === track) return { ...s.focus, from_id: s.id, at: s.at };
  }
  return null;
}
