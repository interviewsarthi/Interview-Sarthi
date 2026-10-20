/* Prep Sarthi: free minutes, passes and invites, through the licence server.
 *
 * Free minutes are keyed by a one-way hash of the Gemini key (the key itself
 * never leaves the browser). Passes belong to a Google account; after sign-in
 * the server gives this browser a 30-day session. The server is the only
 * clock: the page asks how many seconds are left and counts down from there.
 *
 * When the server cannot be reached, free minutes fall back to a local counter
 * so a mock is never blocked by a hiccup; the server wins whenever it answers.
 */

// Local preview (python -m http.server) talks to the sandbox worker, whose CORS
// allows 127.0.0.1:8765; the live site talks to production.
import { diagnosticContext } from './diagnostics.js';
export const LOCAL = typeof location !== "undefined" && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
export const LICENSE_API = LOCAL
  ? "https://interview-sarthi-license-test.interview-sarthi-license.workers.dev"
  : "https://license.interviewsarthi.com";
export const TRIAL_SECONDS = 20 * 60;

const mem = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) { /* private mode */ } },
};

export async function keyHash(apiKey) {
  const bytes = new TextEncoder().encode("prep-sarthi:" + apiKey.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- who invited this visitor: the first code seen wins, and it is only sent
// until the server has met this key.
export function rememberInvite() {
  try {
    const ref = new URLSearchParams(location.search).get("ref");
    if (ref && /^[A-Za-z0-9]{7}$/.test(ref) && !mem.get("ps_ref")) mem.set("ps_ref", ref.toUpperCase());
  } catch (_) { /* no URL */ }
  return mem.get("ps_ref");
}

// ---- where this visitor came from. ApplySarthi's links carry from=applysarthi, which earns a key the server
// has never met 10 extra free minutes. Remembered like an invite: the first value wins.
export function rememberSource() {
  try {
    const from = new URLSearchParams(location.search).get("from");
    if (from === "applysarthi" && !mem.get("ps_from")) mem.set("ps_from", from);
  } catch (_) { /* no URL */ }
  return mem.get("ps_from");
}
const from = () => mem.get("ps_from") || undefined;

export const session = {
  get: () => mem.get("ps_session"),
  set: (v) => mem.set("ps_session", v),
  clear: () => mem.set("ps_session", ""),
};

const localTrial = {
  key: (hash) => "ps_trial_" + hash.slice(0, 16),
  used(hash) { return Number(mem.get(this.key(hash)) || 0); },
  add(hash, seconds) { mem.set(this.key(hash), String(this.used(hash) + seconds)); },
  set(hash, seconds) { mem.set(this.key(hash), String(Math.max(0, seconds))); },
};

async function post(path, body) {
  const res = await fetch(LICENSE_API + path, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) { const err = new Error(data.error || `license server ${res.status}`); err.status = res.status; throw err; }
  return data;
}

function shape(r, hash) {
  // `trial` is absent when the person is signed in but this browser holds no
  // Gemini key yet: then only the pass is known.
  const hasTrial = !!(r.trial && typeof r.trial.seconds_left === "number");
  const trialLeft = hasTrial ? Math.max(0, Number(r.trial.seconds_left)) : 0;
  if (hasTrial && hash) localTrial.set(hash, Number(r.trial.total) - trialLeft);   // keep the local mirror honest
  const base = { invite: r.invite || null, account: r.account || null, plans: r.plans || null, live_gift: r.live_gift || null, trialLeft, hasTrial,
                 welcome: r.welcome || null, source: "server" };
  if (r.pass && r.pass.valid) return { ...base, kind: "pass", secondsLeft: Math.max(0, Number(r.pass.seconds_left)), expiresAt: r.pass.expires_at };
  if (!hasTrial) return { ...base, kind: "none", secondsLeft: 0 };
  return { ...base, kind: trialLeft > 0 ? "trial" : "none", secondsLeft: trialLeft };
}

/**
 * What this key (and this account, if signed in) may do right now.
 * @returns {{kind:"pass"|"trial"|"none", secondsLeft:number, expiresAt?:string, invite, account, plans, source}}
 */
export async function entitlement(hash) {
  try {
    const r = await post("/mock/status", { hash, session: session.get() || undefined, ref: mem.get("ps_ref") || undefined, from: from() });
    if (session.get() && !r.account) session.clear();            // expired or unknown session
    return shape(r, hash);
  } catch (_) {
    const left = Math.max(0, TRIAL_SECONDS - localTrial.used(hash));
    return { kind: left > 0 ? "trial" : "none", secondsLeft: left, trialLeft: left, invite: null, account: null, plans: null, source: "local" };
  }
}

/* What the signed-in person owns, when this browser has no key to hash yet.
 * Returns null when nobody is signed in. */
export async function entitlementBySession() {
  if (!session.get()) return null;
  try {
    const r = await post("/mock/status", { session: session.get(), device: demoDevice() });
    if (!r.account) { session.clear(); return null; }
    return shape(r, null);
  } catch (_) { return null; }
}

/* Book a slice of the free minutes, like the desktop app's book_free_tick. */
export async function tick(hash, seconds) {
  localTrial.add(hash, seconds);
  try {
    const r = await post("/mock/trial/tick", { hash, seconds, ref: mem.get("ps_ref") || undefined, from: from() });
    return { secondsLeft: Math.max(0, Number(r.seconds_left)), reward: r.reward || null, source: "server" };
  } catch (_) {
    return { secondsLeft: Math.max(0, TRIAL_SECONDS - localTrial.used(hash)), reward: null, source: "local" };
  }
}

// ---- passes

export const config = () => post("/mock/config", {});

/* `hash` is optional: someone buying straight from the pricing page has no
 * Gemini key in this browser yet. The invite code rides along so it still counts. */
export async function signIn(idToken, hash) {
  const r = await post("/mock/auth/google", { id_token: idToken, hash: hash || undefined, ref: mem.get("ps_ref") || undefined, from: from(), device: demoDevice() });
  session.set(r.session);
  return shape(r, hash || null);
}

export const startOrder = (plan, phone) => post("/mock/buy", { session: session.get(), plan, phone });

/* payment_id is Dodo's, handed to us on the return URL. Cashfree orders do not
 * have one and the worker never looks at it for them. */
export async function orderStatus(orderId, hash, paymentId) {
  const r = await post("/mock/order", { session: session.get(), order_id: orderId, hash, payment_id: paymentId || undefined });
  return r.status === "paid" ? { status: "paid", plan: r.plan, entitlement: shape(r, hash) } : { status: r.status };
}

export const startFreeDays = () => post("/mock/days/start", { session: session.get() });

export async function claimLiveGift(key, hash) {
  const r = await post("/mock/gift/claim", { session: session.get(), key, hash: hash || undefined, device: demoDevice() });
  return { entitlement: shape(r, hash || null), claimed: !!r.claimed, alreadyYours: !!r.already_yours };
}

// Straight to /prep/ (was the retired /mock/, whose redirect page gave WhatsApp the preview "Moved to /prep/").
export const inviteLink = (code) => `https://interviewsarthi.com/prep/?ref=${encodeURIComponent(code)}`;
/* The invite of a visitor on the free demo: no key, no sign-in, tied to this browser's demo device. The server
   answers 403 until this browser has had a demo. Signed in, the session lets its earned days reach the account. */
export const deviceInvite = () => post("/mock/invite", { device: demoDevice(), session: session.get() || undefined });
/* The invite code this visitor arrived through, if any: their first pass is a week longer. */
export const invitedBy = () => mem.get("ps_ref");

// ── The free demo (license-server src/demo.js) ─────────────────────────────
// One short interview on our key, before any setup. The device id is what "one demo per device" counts;
// it is random, stays in this browser, and says nothing about the person.
export function demoDevice() {
  let d = mem.get("ps_demo_device");
  if (!/^[a-z0-9-]{16,64}$/.test(d)) { d = crypto.randomUUID(); mem.set("ps_demo_device", d); }
  return d;
}
export const demoUsed = { get: () => mem.get("ps_demo_used") === "1", set: () => mem.set("ps_demo_used", "1") };
// The id of this device's demo that Google's drops ruined before any answer was heard (4 Oct 2026): the next
// start asks the server to begin it afresh, once, instead of being told "used". Kept across a reload.
export const demoReplace = { get: () => mem.get("ps_demo_replace"), set: (id) => mem.set("ps_demo_replace", id), clear: () => mem.set("ps_demo_replace", "") };

/* { ok, demo, token, model, seconds } or { ok: false, reason: used|day_full|network|busy|unavailable }. */
export async function requestDemo() {
  const replace = demoReplace.get();
  try { return await post("/mock/demo/start", { device: demoDevice(), ...(replace ? { replace, reason: "outage" } : {}), diagnostics: diagnosticContext() }); }
  catch (_) { return { ok: false, reason: "unavailable" }; }
}

/* Live Sarthi's try-it test (3 Oct 2026): the same interviewer on our key, counted apart from the Prep demo.
   { ok, test, token, model, seconds } or { ok: false, reason: used|day_full|network|full|unavailable }. */
export async function requestLiveTest() {
  try { return await post("/mock/livetest/start", { device: demoDevice(), diagnostics: diagnosticContext() }); }
  catch (_) { return { ok: false, reason: "unavailable" }; }
}

/* The plan and report requests, sent through the licence server on our key. `body` is the JSON string the
   app would have sent to Google; the answer is Google's own, so the callers need no other change. */
export function demoTransport(demo, stage = 'report') {
  return (model, body, signal, request_id) => fetch(LICENSE_API + "/mock/demo/generate", {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify({ demo, device: demoDevice(), model, request: JSON.parse(body), diagnostics: diagnosticContext(request_id), stage }),
  });
}
