/* Live Sarthi on the phone: the licence server, and what this phone remembers.
 *
 * Kept in this browser only: the licence key, the Gemini key, the CV text and the answer choices. The Gemini key
 * goes to Google and, at each start, to our licence server, which uses it once and keeps only a one-way hash.
 */

export const LOCAL = typeof location !== "undefined" && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
export const API = LOCAL ? location.origin + "/__worker" : "https://license.interviewsarthi.com";

export async function post(path, body, { timeout = 30000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal, cache: "no-store" });
    let data = {};
    try { data = await r.json(); } catch (_) { /* empty */ }
    return { status: r.status, ok: r.ok, ...data };
  } catch (_) {
    return { status: 0, ok: false, error: "network" };
  } finally {
    clearTimeout(timer);
  }
}

const KEY = "lw_setup_v1";
const DEVICE = "lw_device_v1";

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode: kept for this visit only */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* nothing */ } },
};
let memo = null;

export const DEFAULTS = {
  licenseKey: "", geminiKey: "", cv: "", cvName: "", name: "", field: "", level: "", terms: [],
  length: "detailed", english: "simple", language: "en", code: "auto",
  jd: "", stories: "", pay: { current_ctc: "", expected_ctc: "", notice: "", offers: "" },
  textSize: 24, micCleanup: false, trial: false, light: false,
};

export function loadSetup() {
  if (memo) return memo;
  let saved = {};
  try { saved = JSON.parse(ls.get(KEY) || "{}") || {}; } catch (_) { saved = {}; }
  memo = { ...DEFAULTS, ...saved, pay: { ...DEFAULTS.pay, ...(saved.pay || {}) } };
  return memo;
}

export function saveSetup(patch) {
  memo = { ...loadSetup(), ...patch };
  ls.set(KEY, JSON.stringify(memo));
  return memo;
}

export function forgetSetup() { memo = null; ls.del(KEY); }

export function deviceId() {
  let id = ls.get(DEVICE);
  if (!/^[a-f0-9]{32}$/.test(id || "")) {
    id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    ls.set(DEVICE, id);
  }
  return id;
}

/** What the server needs to build the answer instructions (it is sent at each start and reconnect, never stored). */
export function promptBody(s, memory = []) {
  return {
    gemini_key: s.geminiKey, name: s.name, style: { length: s.length, english: s.english, level: s.level },
    language: s.language, code: s.code, terms: (s.terms || []).slice(0, 30),
    profile: { cv: s.cv, jd: s.jd, stories: s.stories, pay: s.pay },
    memory,
  };
}

/** Plain words for the reasons the server or Google give. */
export function reasonText(reason) {
  return ({
    gemini_key: "Google didn't accept your Gemini key. Copy it again from Google AI Studio and paste it in Setup.",
    gemini_quota: "Your Gemini key has used up Google's free limit for now. Try again in a few minutes, or use a key from another Google account.",
    gemini_billing: "Google says this Gemini key's project needs billing. Make a new free key in Google AI Studio, in a new project.",
    key_not_found: "We couldn't find that licence key. Check it in your email (it starts with IS-).",
    key_other_product: "This key is for another Sarthi app, not Live Sarthi.",
    pass_ended: "This pass has ended. You can buy a new pass on the Live Sarthi page.",
    in_use: "This pass is running on another phone right now. Stop it there first, or wait a few minutes.",
    phone_limit: "This pass has moved between phones too many times. Write to support and we'll sort it out.",
    trial_over: "Your 20 free minutes are used up. Get a pass to keep going.",
    busy: "Too many free starts from this network today. Try again tomorrow, or get a pass.",
    network: "No connection to our server. Check your internet and try again.",
    google: "Google's service didn't answer. Try again in a moment.",
    session_ended: "This interview session ended. Start again.",
    too_large: "Your CV and notes are too long. Shorten the job description or own examples in Setup.",
  })[reason] || "Something went wrong. Try again in a moment.";
}
