/* Prep Sarthi and My Sarthi (interviewsarthi.com/account/, owner 9 Oct 2026).
 *
 * Signed in, Prep fills its EMPTY boxes from the profile the person saved in My Sarthi (CV, job description, name,
 * and the Gemini key into the key step's box), and "Save to My Sarthi" keeps Prep's CV and job description there for
 * Live Sarthi; the Gemini key only after a confirm. My Sarthi lives on the same licence server and the same session.
 *
 * Silent by design: if My Sarthi is not open yet (the server answers 404), the person is signed out, or the network
 * fails, every call answers null and Prep carries on exactly as before. */
import { LICENSE_API, session } from "./billing.js?v=20261009-live-gift";   // the same URL app.js loads, so one copy

async function post(path, body = {}) {
  const token = session.get();
  if (!token) return null;
  try {
    const res = await fetch(LICENSE_API + path, { method: "POST", cache: "no-store", credentials: "omit",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ session: token, ...body }) });
    if (!res.ok) return res.status >= 400 && res.status < 500 && res.status !== 404 ? { error: (await res.json().catch(() => ({}))).error || "" } : null;
    return await res.json();
  } catch { return null; }
}

/* The saved profile, or null when there is none to read (signed out, My Sarthi not open, offline). */
export async function readProfile() {
  const p = await post("/account/profile");
  return p && !p.error ? p : null;
}

/* What to put in Prep's empty boxes: { cv, jd, name, key }, only the ones that are empty here and saved there. */
export async function fillFrom(profile, have) {
  const out = {};
  if (!profile) return out;
  if (!have.cv && profile.cv && profile.cv.text) out.cv = profile.cv.text;
  const jds = (profile.jds || []).filter((j) => j && j.text);
  if (!have.jd && jds.length) out.jd = jds.reduce((a, b) => (String(b.updated_at) > String(a.updated_at) ? b : a)).text;
  if (!have.name && profile.name) out.name = profile.name.split(/\s+/)[0];
  if (!have.key && profile.gemini && profile.gemini.saved) {
    const k = await post("/account/profile/gemini/key");
    if (k && k.key) out.key = k.key;
  }
  return out;
}

/* Prep's CV and job description into My Sarthi. The JD joins the saved list (the newest ten are kept). What is
 * already saved there is left alone: Prep knows only a first name and a menu's language, the page keeps the full ones. */
export async function saveFromPrep({ cv, jd, name, language, role, level }) {
  const profile = await readProfile();
  if (!profile) return { ok: false, error: "My Sarthi is not available right now." };
  const p = {};
  if (!profile.name && name) p.name = name;
  if (!profile.language && language) p.language = language;
  if (!profile.target_role && role) p.target_role = role;
  if (!profile.target_level && level) p.target_level = level;
  if (cv && cv !== (profile.cv && profile.cv.text)) p.cv = { text: cv, file_name: (profile.cv && profile.cv.file_name) || "" };
  if (jd && !(profile.jds || []).some((j) => j.text === jd)) {
    const kept = (profile.jds || []).slice().sort((a, b) => (String(a.updated_at) < String(b.updated_at) ? 1 : -1)).slice(0, 9);
    p.jds = [...kept.map((j) => ({ id: j.id, title: j.title, text: j.text })), { title: role || "From Prep Sarthi", text: jd }];
  }
  const saved = await post("/account/profile/save", { profile: p });
  if (!saved || saved.error) return { ok: false, error: (saved && saved.error) || "Could not save to My Sarthi. Try again." };
  return { ok: true, geminiSaved: Boolean(saved.gemini && saved.gemini.saved) };
}

export async function saveKey(key) {
  const out = await post("/account/profile/gemini", { key });
  return Boolean(out && !out.error && out.gemini && out.gemini.saved);
}
