/* Prep Sarthi: the pass holder's saved interviews, in their account (licence server src/history.js).
 *
 * Nothing is sent until the person switches history on (setEnabled(true), after the page has told them what
 * is kept). Then every report is saved with its transcript, never the CV. A save that cannot reach the
 * server waits in this browser's outbox and is retried; statusOf(id) and the "status" events on
 * HISTORY_EVENTS say where each one is, so the page can show Saving / Saved / Retry.
 *
 * This browser also keeps its own short list of summaries (numbers only, the last 20), so progress and the
 * report badges work even with history off; the account's list wins wherever both have an interview.
 */

import { LICENSE_API, session } from "./billing.js?v=20261009-live-gift";
import { summarize } from "./progress.js";

export const HISTORY_EVENTS = new EventTarget();
/** Where a save is: saving | saved | retry | off | signed_out | no_pass | failed */
export const SAVE_STATES = ["saving", "saved", "retry", "off", "signed_out", "no_pass", "failed"];

const K = { outbox: "ps_history_outbox", cache: "ps_history_cache", local: "ps_history", last: "ps_last_report" };
const LOCAL_MAX = 20;
const OUTBOX_MAX = 5;
const OUTBOX_CHARS = 1_500_000;         // localStorage holds about 5 MB for the whole site
const CACHE_DAYS = 60, CACHE_MAX = 150;
const BODY_MAX = 200_000;               // the server's HISTORY.MAX_BODY
const RETRY_MS = [30_000, 120_000, 600_000];
const PREFS_FRESH_MS = 10 * 60_000;     // the setting can be changed on another device: ask again after this

const mem = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* storage off */ } },
};
const states = new Map();
function emit(id, state, message = "") {
  states.set(id, { state, message, at: new Date().toISOString() });
  HISTORY_EVENTS.dispatchEvent(new CustomEvent("status", { detail: { id, state, message } }));
}
const changed = () => HISTORY_EVENTS.dispatchEvent(new CustomEvent("changed"));

/** The last known state of a save this page made, or null. */
export const statusOf = (id) => states.get(id) || null;

async function post(path, body) {
  const s = session.get();
  if (!s) { const e = new Error("Sign in first."); e.status = 401; throw e; }
  const res = await fetch(LICENSE_API + path, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ session: s, ...body }),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) { const e = new Error(data.error || `license server ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// ---------------------------------------------------------------- the setting

/** {enabled, consent_version, current_consent_version, retention_days, pass:{live, expires_at}} or null when signed out or offline. */
export async function getPrefs() {
  if (!session.get()) return null;
  try { const p = await post("/mock/history/prefs", {}); remember({ prefs: p }); return p; }
  catch (_) { return cached().prefs || null; }
}

/** Switch saving on or off. Switching on also sends anything waiting in the outbox. Throws if it fails. */
export async function setEnabled(on) {
  const p = await post("/mock/history/prefs", { enabled: !!on });
  remember({ prefs: p });
  if (p.enabled) flushOutbox();
  changed();
  return p;
}

// ---------------------------------------------------------------- saving

/* What the account keeps of an interview: everything the report page needs to draw it again, never the CV.
 * The plan inside the report carries only the short CV and JD quotes the report cites. */
export function bodyOf(record) {
  const m = record.metrics || {};
  const body = {
    v: 1, id: record.id, at: record.at, elapsed: record.elapsed, language: record.language, model: record.model,
    rubric: record.rubric || null, demo: !!record.demo, report: record.report,
    metrics: { ...m, answers: (m.answers || []).map(({ text: _text, ...rest }) => rest) },   // the transcript has the words
    transcript: record.transcript || [], usage: record.usage || {},
    ...(record.focus_carried ? { focus_carried: record.focus_carried } : {}),
    ...(record.changes ? { changes: record.changes } : {}),
  };
  if (JSON.stringify(body).length <= BODY_MAX) return body;
  // Very long interviews only: keep the report whole and cut the transcript to what still fits.
  const slim = { ...body, usage: {}, metrics: { ...body.metrics, answers: [] }, transcript_trimmed: true };
  while (slim.transcript.length && JSON.stringify(slim).length > BODY_MAX) slim.transcript = slim.transcript.slice(0, -5);
  return slim;
}

/**
 * Save a finished interview (the record app.js builds after a report). Always updates this browser's own
 * list; sends it to the account when signed in with history on.
 * @returns {Promise<{state:string, summary:object}>}
 */
export async function saveInterview(record) {
  const summary = summarize(record);
  saveLocal(summary);
  const state = await saveItem({ id: record.id, kind: "interview", at: record.at, summary, body: bodyOf(record) });
  return { state, summary };
}

/** Save any item ({id, kind, at, summary, body}): analyses and re-answers use this too. */
export async function saveItem(item) {
  if (!session.get()) { emit(item.id, "signed_out"); return "signed_out"; }
  const c = cached();
  let prefs = c.prefs && Date.now() - Date.parse(c.at || 0) < PREFS_FRESH_MS ? c.prefs : null;
  if (!prefs) prefs = await getPrefs();                 // falls back to the last known setting when offline
  if (!prefs) { queue(item); emit(item.id, "retry", "Could not reach the server."); schedule(); return "retry"; }
  if (!prefs.enabled) { emit(item.id, "off"); return "off"; }
  queue(item);
  return send(item);
}

async function send(item) {
  emit(item.id, "saving");
  try {
    await post("/mock/history/save", { item });
    unqueue(item.id);
    if (item.kind === "interview") addToCache(item.summary);
    emit(item.id, "saved");
    changed();
    return "saved";
  } catch (err) {
    const s = err.status;
    if (s === 409) { unqueue(item.id); remember({ prefs: { ...(cached().prefs || {}), enabled: false } }); emit(item.id, "off"); return "off"; }
    if (s === 403) { unqueue(item.id); emit(item.id, "no_pass", err.message); return "no_pass"; }
    if (s === 401) { emit(item.id, "signed_out", err.message); return "signed_out"; }   // kept: sent after the next sign-in
    // 404: a server without history (not deployed yet) -- retrying cannot help.
    if (s === 400 || s === 404 || s === 413) { unqueue(item.id); emit(item.id, "failed", err.message); return "failed"; }
    bump(item.id);
    emit(item.id, "retry", err.message);
    schedule();
    return "retry";
  }
}

function queue(item) {
  let box = (mem.get(K.outbox, []) || []).filter((x) => x.item.id !== item.id);
  box.push({ item, tries: 0 });
  while (box.length > OUTBOX_MAX || (box.length > 1 && JSON.stringify(box).length > OUTBOX_CHARS)) box.shift();
  if (!mem.set(K.outbox, box)) {
    // Storage full: keep only this one rather than none.
    mem.set(K.outbox, [{ item, tries: 0 }]);
  }
}
function unqueue(id) { mem.set(K.outbox, (mem.get(K.outbox, []) || []).filter((x) => x.item.id !== id)); }
function bump(id) { mem.set(K.outbox, (mem.get(K.outbox, []) || []).map((x) => (x.item.id === id ? { ...x, tries: x.tries + 1 } : x))); }

/** Ids waiting to be sent from this browser. */
export const pending = () => (mem.get(K.outbox, []) || []).map((x) => x.item.id);

let timer = null, attempt = 0;
function schedule() {
  if (timer || typeof setTimeout === "undefined") return;
  timer = setTimeout(() => { timer = null; flushOutbox(); }, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
  if (timer && timer.unref) timer.unref();          // under node (the tests), a pending retry must not hold the process open
}

/** Send whatever is waiting. Called on load, after sign-in, when the browser comes back online, and on a timer. */
export async function flushOutbox() {
  const box = mem.get(K.outbox, []) || [];
  if (!box.length || !session.get()) return 0;
  let sent = 0;
  for (const { item } of box) if ((await send(item)) === "saved") sent++;
  if (!(mem.get(K.outbox, []) || []).length) attempt = 0;
  return sent;
}
if (typeof window !== "undefined") window.addEventListener("online", () => { flushOutbox(); });

// ---------------------------------------------------------------- reading

function cached() { return mem.get(K.cache, {}) || {}; }
function remember(part) { mem.set(K.cache, { ...cached(), ...part, at: new Date().toISOString() }); }
function trimCache(items) {
  const since = new Date(Date.now() - CACHE_DAYS * 86400_000).toISOString();
  return items.filter((s) => s.at >= since).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, CACHE_MAX);
}
function addToCache(summary) {
  const c = cached();
  remember({ items: trimCache([summary, ...(c.items || []).filter((s) => s.id !== summary.id)]) });
}

/* This browser's own list: numbers only. Entries written before 29 Sep 2026 held just a score. */
export function localSummaries() {
  return (mem.get(K.local, []) || []).map((x) => x && x.sv ? x : x && x.at ? {
    sv: 0, id: `iv-l-${String(x.at).replace(/[^0-9TZ]/g, "")}`, kind: "interview", at: x.at, score: typeof x.score === "number" ? x.score : null,
    minutes: Math.round((Number(x.elapsed) || 0) / 6) / 10, language: x.language || "", groups: {}, planned: {}, coverage: {}, delivery: {},
    questions: [], writer: "unknown", track: "||", focus: null, focus_check: null, practice_next: [],
  } : null).filter(Boolean);
}
function saveLocal(summary) {
  const list = (mem.get(K.local, []) || []).filter((x) => !(x && x.id === summary.id));
  list.unshift(summary);
  mem.set(K.local, list.slice(0, LOCAL_MAX));
}

/**
 * Every summary this person has: the account's (when signed in) merged with this browser's own. Items only
 * in this browser carry local_only: true (the page can offer to add them to the account).
 * @returns {Promise<{items:Array, periods:Array, prefs:object|null, source:"account"|"cache"|"browser", more:boolean}>}
 */
export async function listSummaries() {
  const local = localSummaries();
  let items = [], periods = [], prefs = null, source = "browser", more = false;
  if (session.get()) {
    try {
      const r = await post("/mock/history/list", {});
      items = r.items.map((i) => ({ ...i.summary, id: i.id, kind: i.kind, at: i.at, saved_at: i.saved_at }));
      periods = r.periods || []; prefs = r.prefs || null; more = !!r.more; source = "account";
      remember({ items: trimCache(items.filter((s) => s.kind === "interview")), periods, prefs });
    } catch (_) {
      const c = cached();
      items = c.items || []; periods = c.periods || []; prefs = c.prefs || null; source = "cache";
    }
  }
  const have = new Set(items.map((s) => s.id));
  const merged = [...items, ...local.filter((s) => !have.has(s.id)).map((s) => ({ ...s, local_only: true }))]
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  return { items: merged, periods, prefs, source, more };
}

/** Summaries known without asking the server: the last account list plus this browser's own. */
export function knownSummaries() {
  const items = cached().items || [];
  const have = new Set(items.map((s) => s.id));
  return [...items, ...localSummaries().filter((s) => !have.has(s.id))];
}
/** The pass periods from the last account list, if any. */
export const knownPeriods = () => cached().periods || [];

/** Full items (summary + body) by id, from the account; this browser's last report is answered locally. */
export async function getItems(ids) {
  const out = [], ask = [];
  const last = mem.get(K.last, null);
  for (const id of ids) {
    if (last && last.id === id && last.report && !last.locked) out.push({ id, kind: "interview", at: last.at, summary: summarize(last), body: bodyOf(last) });
    else ask.push(id);
  }
  for (let i = 0; i < ask.length && session.get(); i += 12) {
    const r = await post("/mock/history/get", { ids: ask.slice(i, i + 12) });
    out.push(...r.items);
  }
  return out;
}

/** One interview in the shape renderReport draws ({id, at, elapsed, language, model, report, metrics, transcript}). */
export async function getInterview(id) {
  const [item] = await getItems([id]);
  if (!item || !item.body) return null;
  // saved_at marks a copy that came from the account (the page labels it "Saved to your account").
  return { ...item.body, id: item.id, at: item.at, ...(item.saved_at ? { saved_at: item.saved_at } : {}) };
}

// ---------------------------------------------------------------- deleting and exporting

/** Delete one interview (or analysis) everywhere: the account, this browser's list, and its saved copy. */
export async function deleteItem(id) {
  let deleted = 0;
  if (session.get()) deleted = (await post("/mock/history/delete", { id })).deleted;
  unqueue(id);
  mem.set(K.local, (mem.get(K.local, []) || []).filter((x) => !(x && x.id === id)));
  const c = cached(); remember({ items: (c.items || []).filter((s) => s.id !== id) });
  const last = mem.get(K.last, null);
  if (last && last.id === id) mem.del(K.last);
  changed();
  return deleted;
}

/** Delete every saved interview and analysis of this account, and this browser's copies. The setting stays. */
export async function deleteAll() {
  let deleted = 0;
  if (session.get()) deleted = (await post("/mock/history/delete", { all: true })).deleted;
  for (const k of [K.outbox, K.local, K.last]) mem.del(k);
  remember({ items: [] });
  changed();
  return deleted;
}

/**
 * Everything, for the person to keep: every item with its full body, page by page from the account, plus
 * anything only in this browser. `json` is the complete data; `text` is a readable copy.
 */
export async function exportAll() {
  const items = [];
  if (session.get()) {
    let before;
    for (;;) {
      const r = await post("/mock/history/list", { bodies: true, ...(before ? { before } : {}) });
      items.push(...r.items);
      if (!r.more || !r.items.length) break;
      before = r.items.at(-1).at;
    }
  }
  const have = new Set(items.map((i) => i.id));
  const last = mem.get(K.last, null);
  if (last && last.report && !last.locked && last.id && !have.has(last.id)) items.push({ id: last.id, kind: "interview", at: last.at, summary: summarize(last), body: bodyOf(last), local_only: true });
  for (const s of localSummaries()) if (!have.has(s.id) && !(last && last.id === s.id)) items.push({ id: s.id, kind: "interview", at: s.at, summary: s, body: null, local_only: true });
  items.sort((a, b) => (a.at < b.at ? -1 : 1));
  const json = { exported_at: new Date().toISOString(), product: "Prep Sarthi", items };
  return { json, text: exportText(items) };
}

export function exportText(items) {
  const out = [`Prep Sarthi: your saved interviews, exported ${new Date().toLocaleString()}`, ""];
  for (const it of items) {
    const b = it.body || {}, rep = b.report || {}, s = it.summary || {};
    out.push("=".repeat(60), `${it.kind === "interview" ? "Interview" : it.kind === "redrill" ? "Answer practised again" : "Analysis"} · ${new Date(it.at).toLocaleString()}`);
    if (it.kind === "interview") {
      out.push(`Role: ${s.role || "-"} · ${s.level || "-"} · ${s.minutes || "?"} min · score ${s.score ?? "not enough evidence"}`);
      if (rep.verdict) out.push(rep.verdict);
      for (const q of rep.questions || []) out.push("", `Q: ${q.question}`, `  Score ${q.score}/10. You said: ${q.answer_gist}`, `  Missing: ${q.what_was_missing}`, `  Stronger: ${q.better_answer}`);
      if (rep.next_focus) out.push("", `Focus for next time: ${rep.next_focus.issue}`);
      if ((b.transcript || []).length) out.push("", "Transcript:", ...b.transcript.map((u) => `${u.who === "interviewer" ? "Interviewer" : "You"}: ${u.text}`));
      if (!it.body) out.push("(Only the score was kept for this one: it was saved in this browser before full history existed.)");
    } else if (it.kind === "redrill") {
      out.push(`Q: ${s.question || ""}`, `Before: ${s.score_before ?? "?"}/10 · After: ${s.score_after ?? "?"}/10`, s.verdict || "");
    } else {
      out.push(s.summary || (b && b.summary) || "");
      for (const p of (b && b.patterns) || []) out.push(`- ${p.title}: ${p.detail}`);
    }
    out.push("");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- reports saved before history

/* The full report this browser still holds, if it is not in the account yet. Older reports kept only a score
 * and cannot be rebuilt. A demo report counts once the pass has unlocked it. */
export function importable() {
  const last = mem.get(K.last, null);
  if (!last || !last.report || last.locked) return [];
  const ids = new Set((cached().items || []).map((s) => s.id));
  const record = last.id ? last : { ...last, id: `iv-l-${String(last.at).replace(/[^0-9TZ]/g, "")}` };
  return ids.has(record.id) ? [] : [record];
}

/** Add importable() to the account. Only after the person has agreed; needs history on and a live pass. */
export async function importLocal() {
  const results = [];
  for (const record of importable()) {
    if (!mem.get(K.last, {}).id) mem.set(K.last, record);   // give the old report its id, so it is not offered twice
    results.push({ id: record.id, state: (await saveInterview(record)).state });
  }
  return results;
}
