/* Live on the phone: Log in / Sign up / Log out. Logged in, the pass, resume, job description, own examples, answer
 * choices and Gemini key come back on any phone, and every change is kept with the account. Not logged in, nothing here
 * runs and the app works on this phone alone. */

import { LOCAL, post, loadSetup, saveSetup, forgetSetup, onSetupSaved } from "./api.js?v=20261123-login";

const SESSION = "ps_session";          // the same login as Prep on this site
const CV_MAX = 20000, JD_MAX = 20000, STORIES_MAX = 150000;

export const session = {
  get() { try { return localStorage.getItem(SESSION) || ""; } catch (_) { return ""; } },
  set(v) { try { v ? localStorage.setItem(SESSION, v) : localStorage.removeItem(SESSION); } catch (_) { /* private mode */ } },
};
export const loggedIn = () => !!session.get();

export const A = { me: null };         // the last answer from the server about this account

/* The Google client this site signs in with (the same one Prep uses), or "" when there is none (local tests). */
export async function googleClientId() {
  try {
    if (LOCAL) return (await post("/mock/config", {})).google_client_id || "";
    const r = await fetch("/prep/app/config.json", { cache: "no-store" });
    return r.ok ? ((await r.json()).google_client_id || "") : "";
  } catch (_) { return ""; }
}

/* Google's credential (or "test:email" on a local test server) for a session. */
export async function logIn(credential) {
  const r = await post("/mock/auth/google", { id_token: credential });
  if (!r.ok || !r.session) return { ok: false, reason: r.status === 0 ? "network" : "login" };
  session.set(r.session);
  return { ok: true };
}

/* Everything saved with the account, put on this phone. What only this phone has (a key typed before logging in, say)
 * goes up to the account. Returns false when the login has run out (then this phone is logged out). */
export async function loadAccount() {
  const me = await post("/live/web/me", { session: session.get() }, { timeout: 15000 });
  if (me.status === 401) { logOutHere(); return { ok: false, reason: "login" }; }
  if (!me.ok) return { ok: false, reason: "network" };
  A.me = me;
  const s = loadSetup(), p = me.profile || {}, prefs = me.prefs || {};
  const patch = {}, up = { profile: {}, prefs: null, gemini_key: "" };

  const usable = (me.keys || []).find((k) => k.state === "active" || k.state === "not_started");
  const here = (me.keys || []).find((k) => k.key === s.licenseKey);
  if (usable && (!s.licenseKey || s.trial || (here && here.state === "ended"))) { patch.licenseKey = usable.key; patch.trial = false; }
  if (p.gemini_saved) {
    const k = await post("/live/web/me/key", { session: session.get() });
    if (k.ok && k.key) patch.geminiKey = k.key;
  } else if (s.geminiKey) up.gemini_key = s.geminiKey;

  if (p.cv) { patch.cv = p.cv; patch.cvName = p.cv_name || ""; }
  else if (s.cv) { up.profile.cv = s.cv.slice(0, CV_MAX); up.profile.cv_name = s.cvName || ""; }
  for (const [mine, theirs] of [["name", "name"], ["jd", "jd"], ["stories", "stories"]]) {
    if (p[theirs]) patch[mine] = p[theirs];
    else if (s[mine]) up.profile[theirs] = s[mine];
  }
  if (Object.keys(prefs).length) {
    for (const k of ["length", "english", "language", "level", "code"]) if (prefs[k] !== undefined) patch[k] = prefs[k];
    if (Array.isArray(prefs.terms)) patch.terms = prefs.terms;
    if (prefs.pay) patch.pay = { ...s.pay, ...prefs.pay };
  } else up.prefs = prefsOf(s);

  quiet = true;
  try { saveSetup(patch); } finally { quiet = false; }
  if (Object.keys(up.profile).length || up.prefs || up.gemini_key) await send(up);
  return { ok: true, me };
}

/* Logging out leaves nothing of the account on this phone (it may be shared). */
export function logOutHere() {
  session.set("");
  forgetSetup();
  A.me = null;
  clearTimeout(timer); pending = null;
}

/* Delete everything kept with the account (the pass stays), then log out here. */
export async function deleteSaved() {
  const r = await post("/live/web/me/delete", { session: session.get() });
  if (r.ok) logOutHere();
  return r.ok;
}

// ── saving as the person goes, quietly ───────────────────────────────────────────────────────────────────────────
const PROFILE_FIELDS = { cv: "cv", cvName: "cv_name", name: "name", jd: "jd", stories: "stories" };
const PREF_FIELDS = ["length", "english", "language", "level", "code", "terms", "pay", "name", "cvName", "licenseKey", "trial"];
let quiet = false, timer = 0, pending = null;

function prefsOf(s) {
  return { length: s.length, english: s.english, language: s.language, level: s.level, code: s.code,
    terms: s.terms || [], pay: s.pay || {}, name: s.name || "", cv_name: s.cvName || "",
    pass_key: s.trial ? undefined : s.licenseKey || undefined };     // a pass bought with another email comes back too
}

onSetupSaved((patch, before, after) => {
  if (quiet || !loggedIn()) return;
  const up = pending || { profile: {}, prefs: null, gemini_key: "" };
  let any = false;
  for (const [mine, theirs] of Object.entries(PROFILE_FIELDS)) {
    if (mine in patch && JSON.stringify(before[mine]) !== JSON.stringify(after[mine])) {
      let v = String(after[mine] || "");
      if (mine === "cv") v = v.slice(0, CV_MAX);
      if (mine === "jd") v = v.slice(0, JD_MAX);
      if (mine === "stories") v = v.slice(0, STORIES_MAX);
      if (mine === "jd" && !v) continue;                    // an emptied box doesn't delete the account's saved JDs
      up.profile[theirs] = v; any = true;
    }
  }
  if (PREF_FIELDS.some((k) => k in patch && JSON.stringify(before[k]) !== JSON.stringify(after[k]))) { up.prefs = prefsOf(after); any = true; }
  if ("geminiKey" in patch && after.geminiKey && after.geminiKey !== before.geminiKey) { up.gemini_key = after.geminiKey; any = true; }
  if (!any) return;
  pending = up;
  clearTimeout(timer);
  timer = setTimeout(flush, 1200);
});

async function flush() {
  const up = pending; pending = null;
  if (up && loggedIn()) await send(up);
}

async function send(up) {
  const body = { session: session.get() };
  if (Object.keys(up.profile).length) body.profile = up.profile;
  if (up.prefs) body.prefs = up.prefs;
  if (up.gemini_key) body.gemini_key = up.gemini_key;
  const r = await post("/live/web/me/save", body, { timeout: 20000 });
  if (r.status === 401) logOutHere();
  return r.ok;
}

/* Saves still waiting go out now (before an interview starts, or the page closes). */
export function saveNow() { clearTimeout(timer); return flush(); }
addEventListener("pagehide", () => { if (pending) saveNow(); });

// ── words for the ready screen ───────────────────────────────────────────────────────────────────────────────────
export function passLine(s) {
  if (s.trial || !s.licenseKey) return "";
  const k = A.me && (A.me.keys || []).find((x) => x.key === s.licenseKey);
  if (!k) return "";
  if (k.state === "not_started") return "Your pass starts when you begin";
  if (k.state === "ended") return "Your pass has ended";
  const ms = new Date(k.ends_at).getTime() - Date.now();
  if (!(ms > 0)) return "Your pass has ended";
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  return d >= 1 ? `Pass: ${d} day${d === 1 ? "" : "s"} ${h % 24} h left` : `Pass: ${h} h ${Math.floor(ms / 60000) % 60} min left`;
}
