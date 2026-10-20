/* Prep Sarthi: what the interviewer is quietly told about a pass holder's earlier interviews.
 *
 * Built here in the browser from the saved summaries the progress page already has, so starting an interview
 * never waits for it. Short on purpose: a live voice model handed a whole history dwells on it or reads it out.
 * The interviewer uses it to choose questions and depth, never mentions it (interviewer.js), and gets it again
 * on every reconnect because it is part of the instructions.
 */

import { SKILL_GROUPS } from "./progress.js";

export const COACHING = {
  RECENT: 5,             // interviews looked at, newest last
  MIN_MINUTES: 3,        // shorter than this was a false start, not an interview
  FRESH_DAYS: 60,        // an older interview says little about today
  ANALYSIS_DAYS: 30,
  QUESTIONS: 10,         // recent questions listed so they are not asked again
  MAX_CHARS: 1600,
};
const DAY_MS = 86400_000;
const LABEL = Object.fromEntries(SKILL_GROUPS.map((g) => [g.id, g.label]));
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const fresh = (s, days, now) => now.getTime() - Date.parse(s.at) <= days * DAY_MS;
const INTRODUCTION = /about yourself|introduce yourself|your (background|introduction)|apne baare|apna (intro|parichay)/i;

/**
 * @param {object[]} items  saved summaries (history.js knownSummaries)
 * @param {object} o
 * @param {string|null} o.track  this interview's track (progress.js trackKey), or null when it is not known yet
 *                               (a pasted JD: the role is read from it later); then every recent interview counts,
 *                               but role knowledge from another job does not.
 * @returns {string} a few lines for the interviewer, or "" when there is nothing useful to say
 */
export function coachingBrief(items, { track = null, now = new Date() } = {}) {
  const all = (items || []).filter((s) => s && s.at && fresh(s, COACHING.FRESH_DAYS, now));
  const past = all.filter((s) => s.kind === "interview" && !s.demo && (Number(s.minutes) || 0) >= COACHING.MIN_MINUTES
    && (!track || s.track === track)).sort(byAt).slice(-COACHING.RECENT);
  if (!past.length) return "";
  const lines = [];

  const scores = past.map((s) => s.score).filter((x) => Number.isFinite(x));
  if (scores.length) lines.push(`Practice scores of the last ${scores.length === 1 ? "interview" : `${scores.length} interviews`}, oldest first: ${scores.join(" -> ")} (out of 100).`);

  const byGroup = {};
  for (const s of past) for (const [g, v] of Object.entries(s.groups || {})) {
    if (!track && g === "role_knowledge") continue;
    if (v && Number.isFinite(v.score)) (byGroup[g] ||= []).push(v.score);
  }
  const weakest = Object.entries(byGroup).map(([g, xs]) => [g, xs.reduce((a, b) => a + b, 0) / xs.length])
    .filter(([, m]) => m < 7).sort((a, b) => a[1] - b[1]).slice(0, 2);
  if (weakest.length) lines.push(`Weakest areas so far: ${weakest.map(([g, m]) => `${LABEL[g] || g} (${m.toFixed(1)}/10)`).join(", ")}. Give each at least one fair chance to show improvement.`);

  const last = scores.at(-1);
  if (scores.length >= 2 && last >= 70 && last > scores[0]) lines.push("Scores are rising: when an answer is solid, ask one deeper follow-up before moving on.");
  else if (Number.isFinite(last) && last < 45) lines.push("Recent answers were thin: keep questions accessible and build up one step at a time.");

  // The opening self-introduction is part of every interview (interviewer.js), so it is never listed as "asked".
  const asked = [];
  for (const s of [...past].reverse()) for (const q of s.questions || []) {
    const text = clip(q && q.q, 120);
    if (text && !INTRODUCTION.test(text) && !asked.includes(text)) asked.push(text);
  }
  if (asked.length) lines.push(`Already asked in recent interviews. Keep the usual opening introduction, then ask different questions; a new angle on the same skill is fine:\n${asked.slice(0, COACHING.QUESTIONS).map((q) => `- ${q}`).join("\n")}`);

  const analysis = all.filter((s) => s.kind === "analysis" && s.enough && Array.isArray(s.patterns) && fresh(s, COACHING.ANALYSIS_DAYS, now)).sort(byAt).at(-1);
  const patterns = analysis ? analysis.patterns.filter((p) => p && p.type !== "improved" && p.type !== "strength" && p.title).slice(0, 2).map((p) => clip(p.title, 90)) : [];
  if (patterns.length) lines.push(`Patterns seen across interviews: ${patterns.join("; ")}.`);

  const text = lines.join("\n");
  return text.length > COACHING.MAX_CHARS ? text.slice(0, COACHING.MAX_CHARS - 1) + "…" : text;
}
