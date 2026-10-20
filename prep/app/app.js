/* Prep Sarthi: the app page. Four screens: CV, key, interview, report.
 *
 * All state lives in this browser. The CV text and the key go to Google only
 * when the interview starts; a hash of the key goes to the licence server for
 * the free-minutes counter. Timing is hard: when the planned time or the free
 * minutes run out, the interview ends that second and the report is written.
 *
 * The interview screen is a call, not a chat: the Sarthi wheel turns while the
 * interviewer speaks, only their current line is shown, and the full transcript
 * waits for the report. The chosen voice decides whether the page calls the
 * interviewer she or he: see interviewerPersona.
 */

import { AudioIO } from "./audio.js?v=20261008-bluetooth";
import { GeminiLive } from "./live.js?v=20261012-models38";
import { buildInterviewerInstructions, interviewerPersona } from "./interviewer.js?v=20261012-models38";
import { readDocFile, tidy, guessName } from "./cv.js";
import { computeMetrics } from "./metrics.js";
import { RUBRIC_VERSION, generateReport } from "./report.js?v=20261012-models38";
import { interviewProgress } from "./assessment.js";
import { assessmentText } from "./assessment-view.js?v=20260923-jd-plan";
import { reportHtml, wireReport } from "./report-view.js?v=20261001-site";
import { generateInterviewPlan } from "./plan-request.js?v=20261012-models38";
import { interviewContext } from "./interview-plan.js";
import { keyHash, entitlement, entitlementBySession, tick, rememberInvite, rememberSource, requestDemo, requestLiveTest, demoTransport, demoUsed, demoReplace, deviceInvite, session as accountSession } from "./billing.js?v=20261009-live-gift";
import { initPasses, isIntl, noticeLiveGift, openPasses, priceOf, refreshPasses, renderInvite } from "./pass.js?v=20261009-polish";
import { Wheel } from "../wheel.js";
import { MIC_HELP, MIC_DEAD_RMS } from "./miccheck.js";
import { beginDiagnostics, diagnosticEvent, errorClass, flushDiagnostics } from './diagnostics.js';
// Progress across the month (plan approved 29 Sep 2026). These modules hold the logic; the screens that show
// it are drawn elsewhere and reach this page through window.prepApp and the prep:* events below.
import { HISTORY_EVENTS, flushOutbox, getInterview, knownPeriods, knownSummaries, saveInterview, saveItem } from "./history.js";
import { fillFrom, readProfile, saveFromPrep, saveKey } from "./mysarthi.js?v=20261010-mysarthi";
import { carryFocus, reportChanges, summarize, trackKey } from "./progress.js";
import { coachingBrief } from "./coaching.js?v=20261001-faststart";
import { refreshAnalyses } from "./insights.js?v=20261012-models38";
import { REDRILL_SECONDS, buildRedrillInstructions, compareAnswers, redrillItem, redrillNotes, redrillProgress, redrillSource } from "./redrill.js?v=20261012-models38";

const $ = (id) => document.getElementById(id);
// Technical output is available only when support explicitly requests this URL.
// Keep it hidden in the HTML too, so it never flashes during normal page loading.
const diagnosticsEnabled = new URLSearchParams(location.search).get("diagnostics") === "1";
$("diagnostics").hidden = !diagnosticsEnabled;
const store = {
  get(k, d = "") { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
};
/* Live Sarthi's try-it test (3 Oct 2026). The Windows app's guide opens this page with ?from=livesarthi so a new
 * Live Sarthi user can hear an interviewer through the PC while the app suggests answers. That visitor is testing Live
 * Sarthi, not shopping for Prep: until 3 Oct the test used up their Prep demo, ended on a Prep offer and was counted
 * as a Prep demo. Now the interview runs on the licence
 * server's test grant, no report is written, the end screen offers Live Sarthi, and GA4 hears livetest_* instead of
 * mock_*, so Prep's numbers count only people who came for Prep. The tab remembers it, so a reload stays a test. */
const liveTest = (() => {
  const asked = new URLSearchParams(location.search).get("from") === "livesarthi";
  try { if (asked) sessionStorage.setItem("ps_live_test", "1"); return asked || sessionStorage.getItem("ps_live_test") === "1"; }
  catch (_) { return asked; }
})();
const track = (name, params) => {
  try { if (window.gtag) window.gtag("event", liveTest ? name.replace(/^mock_/, "livetest_") : name, params || {}); } catch (_) { /* analytics off */ }
};
const nowS = () => performance.now() / 1000;
const TICK_SECONDS = 30;
const VOICE_RMS = 0.005;
const BAR_SHAPE = [0.55, 1, 0.75, 0.95, 0.5];
const MIC_MUTED_RMS = 0.00002;   // exact digital silence: a mute key or a dead input
const LOW_FREE_SECONDS = 5 * 60;      // when the pass offer appears during a free interview

const S = { cv: "", jd: "", practiceFocus: "role", targetRole: "", targetLevel: "", name: "", language: "English", minutes: 12, voice: "Kore", key: "", hash: "", ent: null, plan: "m" };
let lastScreen = "s-cv";
let assessmentPlan = null, planPending = null, startController = null;
let audio = null, live = null, timer = null, startedAt = 0, plannedSeconds = 0, ending = false;
let voiceLog = [], bookedSeconds = 0, trialLeftAtStart = 0, tickPending = null;
let speaking = false, lastVoiceAt = 0, heardSinceShe = false, linkState = "idle";
let phase = "idle";               // idle | preparing (microphone, token) | call
let micStats = { chunks: 0, voiced: 0, maxRms: 0 };
let sheStoppedAt = 0, quietMax = 0, micWarned = false;
let youClearTimer = null;
let offerShown = false;
let exitCardOpen = false;
let deferredReportOffer = null;
let demoPurchase = (() => {
  try {
    const saved = JSON.parse(store.get("ps_demo_purchase", "null"));
    return saved && Date.now() - saved.at < 24 * 3600_000 ? saved : null;
  } catch { return null; }
})();
let liveTrouble = 0;           // Google drops and silences in this call (a demo ruined by them is replaced, not spent)
let booted = false;
const bubbles = new Map();
const logLines = [];
const DEMO_SECONDS = 7 * 60;   // the licence server's DEMO.SECONDS; its answer caps the call too
let demo = null;               // the free demo in progress: { demo, token, seconds } from /mock/demo/start
let focusCarried = null;       // the habit the last report set, tested in this interview (progress.js carryFocus)
let coaching = "";             // a pass holder's earlier practice, for the interviewer (coaching.js)
let redrill = null;            // { source } while one question is being answered again (redrill.js)
let reportWriting = false;     // a report is being written: no new interview starts until it has arrived
let googleDrop = false;        // the last drop or silence was Google's (1011, reply timeout), not this connection's
const wheel = new Wheel($("wheel"));
const waitWheel = new Wheel($("wheel-wait"));

// ------------------------------------------------------------------ helpers

function show(id) {
  if (id !== "s-pass" && id !== "s-invite") lastScreen = id;
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("on", s.id === id);
  document.documentElement.dataset.screen = id;      // the report and progress screens take the full width
  window.scrollTo({ top: 0 });
  window.dispatchEvent(new CustomEvent("prep:screen", { detail: { id } }));
  if (id === "s-report") { paintReportPass(); revealReportOffer(); }
}
function notice(id, text, cls = "") { const el = $(id); el.textContent = text || ""; el.className = "notice " + cls; }
function log(name, data) {
  // The DB timeline uses an allowlist; the optional local support log remains separate.
  diagnosticEvent(name, { ...data, ...(data?.error ? { error: errorClass(data.error) } : {}) });
  if (!diagnosticsEnabled) return;
  const t = startedAt ? (nowS() - startedAt).toFixed(1) : "0.0";
  const line = `${t.padStart(6)}  ${name}${data && Object.keys(data).length ? " " + JSON.stringify(data) : ""}`;
  logLines.push(line);
  const el = $("log"); el.textContent += line + "\n"; el.scrollTop = el.scrollHeight;
}
function fmt(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function fmtLong(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
/* What pressing Start on the CV screen does, said under the button: the free demo's terms come before the call. */
function renderStartNote() {
  if (testing()) {
    $("start-note").textContent = `Free Live Sarthi test, up to ${Math.round(DEMO_SECONDS / 60)} minutes. It runs on Google Gemini, which may use it to improve its services. Wear wired earphones; your interviewer speaks first.`;
    return;
  }
  const demoNext = !S.key && passCtx.demoOn && !(S.ent && S.ent.kind === "pass") && !demoUsed.get();
  $("start-note").textContent = demoNext
    ? `Free demo: a ${Math.round(DEMO_SECONDS / 60)}-minute interview, then your report. It runs on Google Gemini, which may use it to improve its services. Use wired earphones if you can; your interviewer speaks first.`
    : "Use wired earphones if you can; your interviewer speaks first.";
}
/* The header's account button: the person's first name once they are signed
   in, "Sign in" until then. pass.js owns the clicks; this only paints. */
function renderAccount() {
  const a = S.ent && S.ent.account, btn = $("acct-btn");
  const raw = a ? ((a.name || "").trim().split(/\s+/)[0] || a.email.split("@")[0]) : "";
  const first = raw && raw.charAt(0).toUpperCase() + raw.slice(1);
  btn.textContent = a ? (first.length > 14 ? first.slice(0, 13) + "…" : first) : "Sign in";
  btn.title = a ? a.email : "Sign in with Google";
  btn.classList.toggle("in", !!a);
  $("acct-name").textContent = a ? (a.name || first) : "";
  $("acct-mail").textContent = a ? a.email : "";
  if (!a) { $("acct-menu").hidden = true; btn.setAttribute("aria-expanded", "false"); }
}
function renderEntitlement() {
  noticeLiveGift(S.ent);
  renderStartNote();
  renderAccount();
  const e = S.ent, el = $("entitle");
  // Nothing known yet: a dash while the server is being asked, and the honest
  // default for a first-time visitor once it is clear nobody is signed in.
  // A first-time visitor is offered the 7-minute demo (25 Sep 2026); the free minutes need a saved key.
  if (!e) { el.textContent = !booted ? "\u2026" : passCtx.demoOn ? "Free demo \u00b7 7 min" : (store.get("ps_from") === "applysarthi" ? "30 min free" : "20 min free"); el.className = "chip"; return; }
  if (e.kind === "demo") { el.textContent = "Free demo · 7 min"; el.className = "chip ok"; return; }
  if (e.kind === "livetest") { el.textContent = "Live Sarthi test"; el.className = "chip ok"; return; }
  if (e.kind === "pass") { el.textContent = `Pass · ${fmtLong(e.secondsLeft)} left`; el.className = "chip ok"; }
  else if (e.account && e.invite?.banked_days > 0) { el.textContent = `${e.invite.banked_days} free days`; el.className = "chip ok"; }
  else if (e.kind === "trial") { el.textContent = `Free · ${fmtLong(e.secondsLeft)} left`; el.className = "chip"; }
  // Signed in, but no Gemini key in this browser yet: no free-minute count to show.
  else if (e.hasTrial === false) { el.textContent = "Get a pass"; el.className = "chip"; }
  else { el.textContent = passCtx.passesOn ? "Get a pass" : "Free minutes used"; el.className = "chip warn"; }
}

/* A Start in this tab is a Live Sarthi test: it came from the Windows app, and the server can run the interviewer.
   Someone who already holds a Prep pass practises on it as usual. */
const testing = () => liveTest && !!passCtx.demoOn && !(S.ent && S.ent.kind === "pass");
/* The CV screen says what this tab is for. Its header has nothing of Prep's to sell (prep/app/index.html ps-livetest). */
function showLiveTestIntro() {
  document.documentElement.classList.add("ps-livetest");
  const cv = $("s-cv");
  cv.querySelector(".label").textContent = "Live Sarthi test";
  cv.querySelector("h1").innerHTML = "Test Live Sarthi with <em>our</em> AI interviewer.";
  cv.querySelector(".lede").textContent = "Keep Live Sarthi running and wear wired earphones. Add your CV and press Start: the interviewer asks you "
    + "questions out loud, and a suggested answer appears in the Live Sarthi window a few seconds after each one. "
    + `The test is free and takes up to ${Math.round(DEMO_SECONDS / 60)} minutes.`;
}
if (liveTest) showLiveTestIntro();

/* What the pass screen and the invite card need from this page. */
const passCtx = {
  state: S, passesOn: false, show, track, log,
  setEntitlement(ent) {
    S.ent = ent; renderEntitlement();
    window.dispatchEvent(new CustomEvent("prep:account"));
    if (ent && ent.kind === "pass") unlockSavedReport();
    if (ent && ent.kind === "pass") { hideOffer("report-offer"); deferredReportOffer = null; }
    paintReportPass();
    if (ent && ent.account) flushOutbox().catch(() => {});
    fillFromMySarthi();                          // signed in: fill; signed out: hide the Save link
    // The server says this once, on the call that created the trial: tell the person where the minutes came from.
    if (ent && ent.welcome) showApplyWelcome(`ApplySarthi bonus added: ${ent.welcome.minutes} extra free minutes, so you have ${Math.round(ent.secondsLeft / 60)} in total.`);
  },
  refresh: () => entitlement(S.hash),
  // An interview keeps running while someone looks at passes; coming back must
  // return to it, never reset it.
  running: () => ["call", "preparing"].includes(phase),
  resume() {
    $("pass-back").textContent = "Back";
    if (["call", "preparing"].includes(phase)) { show("s-live"); return; }
    if (demoPurchase?.hasAnswers || (lastScreen === "s-report" && window.__lastReport)) { show("s-report"); return; }
    if (S.key && S.ent && lastScreen === "s-live") preLive();
    else show(lastScreen === "s-live" || lastScreen === "s-report" ? (S.key ? lastScreen : "s-cv") : lastScreen);
  },
  practise() {
    redrill = null;
    $("pass-back").textContent = "Back";
    if (["call", "preparing"].includes(phase)) { show("s-live"); return; }
    if (S.key && S.ent) preLive(); else if (S.cv || $("cv").value) showKeyStep(); else show("s-cv");
  },
  restoreReport() {
    if (demoPurchase?.reportId) {
      let record;
      try { record = JSON.parse(store.get("ps_last_report", "null")); } catch { /* corrupt storage */ }
      if (record?.id === demoPurchase.reportId) {
        window.__lastReport = record;
        $("report-wait").style.display = "none";
        renderReport(record);
        offerReport("That was your free demo.", record.report, "demo_report");
        if (!pendingPayment()) show("s-report");
      }
    }
    void resumePendingReport();
  },
  paymentResult(status, pending) {
    if (!["demo_call", "demo_exit"].includes(pending?.where) || !demoPurchase) return false;
    if (!demoPurchase.hasAnswers) {
      if (status === "paid") { showKeyStep(); return true; }
      return false;
    }
    const note = $("report-payment-note");
    note.hidden = status === "paid";
    note.textContent = status === "failed" ? "Your payment did not go through. Your interview report is here, and you can try again whenever you're ready."
      : "Your payment has not been confirmed. Your report is here. You can check your pass or try again whenever you're ready.";
    if (!window.__lastReport?.report && !readPendingReport()) {
      $("report-wait").style.display = "none";
      $("report").innerHTML = '<div class="card"><h2>Your interview has ended</h2><p class="muted">The saved report is no longer available on this device. You can still check your pass below.</p></div>';
    }
    show("s-report");
    return true;
  },
};
function currentLanguage() {
  const v = $("language").value;
  return v === "other" ? ($("language-other").value.trim() || "auto") : v;
}
/* Who the interviewer is right now: the voice the candidate picked decides the
 * name in the brief and the pronouns on the screen. */
function who() { return interviewerPersona(S.voice); }
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------------------------------------------------------------- 1. CV

async function restore() {
  $("cv").value = store.get("ps_cv"); $("jd").value = store.get("ps_jd"); $("name").value = store.get("ps_name");
  $("practice-focus").value = store.get("ps_practice_focus", "role");
  $("target-role").value = store.get("ps_target_role");
  $("target-level").value = store.get("ps_target_level");
  updateNoJdOptions();
  const lang = store.get("ps_language", "English");
  if ([...$("language").options].some((o) => o.value === lang)) $("language").value = lang;
  else { $("language").value = "other"; $("language-other").value = lang; $("language-other").style.display = "block"; }
  const voice = store.get("ps_voice");
  if (voice && [...$("voice").options].some((o) => o.value === voice)) $("voice").value = voice;
  $("key").value = store.get("ps_gemini_key");
  // A returning visitor can reach the interview screen without passing through
  // Continue (the Practise button after buying), so S has to match the form now.
  readForm();
  renderEntitlement();
  // A returning visitor must see what they actually own, not the free-minutes
  // placeholder: ask the server before they touch anything.
  const saved = store.get("ps_gemini_key");
  if (saved) {
    S.key = saved;
    S.hash = await keyHash(saved);
    S.ent = await entitlement(S.hash);
    log("entitlement", { kind: S.ent.kind, secondsLeft: S.ent.secondsLeft, source: S.ent.source, at: "load" });
  } else {
    const byAccount = await entitlementBySession();
    if (byAccount) { S.ent = byAccount; log("entitlement", { kind: byAccount.kind, source: "session", at: "load" }); }
  }
  booted = true;
  renderEntitlement();
  fillFromMySarthi();
}

/* My Sarthi (interviewsarthi.com/account/): signed in, the EMPTY boxes fill from the profile saved there, once per
 * sign-in. The Gemini key goes into the key step's box only; it is kept on this device when that step is passed, as
 * a typed key is. Nothing happens when My Sarthi is not open or the person is signed out (mysarthi.js is silent). */
async function fillFromMySarthi() {
  const token = accountSession.get();
  if (!token) { $("save-mysarthi").hidden = true; return; }
  // Once per sign-in (the token changes with each), remembered across page loads in this browser.
  if (store.get("ps_mysarthi_filled") === token) { $("save-mysarthi").hidden = false; return; }
  const profile = await readProfile();
  if (!profile) return;
  store.set("ps_mysarthi_filled", token);
  $("save-mysarthi").hidden = false;
  // A job description is filled only where this browser never had one and no role was chosen instead: a person
  // who practises for a role, or in general, or who emptied the box, keeps that choice.
  let jdNull = false;
  try { jdNull = localStorage.getItem("ps_jd") === null; } catch { /* private mode */ }
  const roleChosen = !!$("target-role").value.trim() || $("practice-focus").value === "general_cv";
  const have = { cv: !!$("cv").value.trim(), jd: !!$("jd").value.trim() || !jdNull || roleChosen, name: !!$("name").value.trim(),
    key: !!($("key").value.trim() || store.get("ps_gemini_key")) };
  const got = await fillFrom(profile, have);
  const done = [];
  if (got.cv && !$("cv").value.trim()) { $("cv").value = got.cv; store.set("ps_cv", got.cv); done.push("CV"); }
  if (got.jd && !$("jd").value.trim()) { $("jd").value = got.jd; store.set("ps_jd", got.jd); updateNoJdOptions(); done.push("job description"); }
  if (got.name && !$("name").value.trim()) { $("name").value = got.name; store.set("ps_name", got.name); done.push("name"); }
  if (got.key && !$("key").value.trim()) { $("key").value = got.key; done.push("Gemini key"); }
  if (done.length) notice("cv-notice", `Filled from My Sarthi: ${done.join(", ")}.`, "ok");
}

$("save-mysarthi").onclick = async () => {
  readForm();
  $("save-mysarthi").disabled = true;
  try {
    const r = await saveFromPrep({ cv: S.cv, jd: S.jd, name: S.name, language: S.language, role: S.targetRole, level: S.targetLevel });
    if (!r.ok) { notice("cv-notice", r.error, "bad"); return; }
    const key = $("key").value.trim() || store.get("ps_gemini_key");
    let withKey = false, keyFailed = false;
    if (key && !r.geminiSaved && confirm("Also keep your Gemini key in My Sarthi, encrypted, for Live Sarthi?")) { withKey = await saveKey(key); keyFailed = !withKey; }
    notice("cv-notice", `Saved to My Sarthi${withKey ? ", with your Gemini key" : ""}. Live Sarthi can fill its setup from it.`
      + (keyFailed ? " The Gemini key could not be saved; try again on the My Sarthi page." : ""), keyFailed ? "" : "ok");
  } finally { $("save-mysarthi").disabled = false; }
};

$("language").onchange = () => { $("language-other").style.display = $("language").value === "other" ? "block" : "none"; };
/* The CV and the JD each take a PDF or a text file from the small button on
 * their label row, or from a file dragged onto the box itself. The file is read
 * here in the browser and its text put into the box, so what the interview
 * reads is always what is on the screen, and still editable. */
function wirePicker({ pick, input, area, noticeId, label, minChars, onText }) {
  const load = async (file) => {
    if (!file) return;
    notice(noticeId, "Reading " + file.name + "…");
    try {
      const text = await readDocFile(file, label);
      if (text.length < minChars) { notice(noticeId, `That file has almost no readable text (a scanned PDF?). Paste the ${label} text instead.`, "bad"); return; }
      $(area).value = text;
      $(pick).classList.add("ok"); $(pick).textContent = "Replace";
      notice(noticeId, `Read ${text.split(/\s+/).length} words from ${file.name}.`, "ok");
      if (onText) onText(text);
    } catch (err) {
      notice(noticeId, err.message, "bad");
    }
  };
  $(pick).onclick = () => $(input).click();
  $(input).onchange = () => { load($(input).files[0]); $(input).value = ""; };   // same file twice still fires
  $(area).ondragover = (e) => { e.preventDefault(); $(area).classList.add("over"); };
  $(area).ondragleave = () => $(area).classList.remove("over");
  $(area).ondrop = (e) => { e.preventDefault(); $(area).classList.remove("over"); load(e.dataTransfer && e.dataTransfer.files[0]); };
}
wirePicker({
  pick: "cvpick", input: "cvfile", area: "cv", noticeId: "cv-notice", label: "CV", minChars: 80,
  onText: (text) => { if (!$("name").value) $("name").value = guessName(text); },
});
wirePicker({ pick: "jdpick", input: "jdfile", area: "jd", noticeId: "jd-notice", label: "JD", minChars: 40, onText: updateNoJdOptions });

function updateNoJdOptions() {
  const noJd = !$("jd").value.trim();
  const general = $("practice-focus").value === "general_cv";
  $("no-jd-options").hidden = !noJd;
  $("target-details").style.display = general ? "none" : "";
  $("no-jd-help").textContent = general
    ? "Practise discussing your experience and skills. This mode does not assess suitability for a specific job."
    : "We’ll practise common skills for this role and level. The report won’t claim a match to a specific employer.";
}
$("jd").oninput = updateNoJdOptions;
$("practice-focus").onchange = updateNoJdOptions;

function readForm() {
  S.cv = tidy($("cv").value); S.jd = tidy($("jd").value); S.name = $("name").value.trim();
  S.practiceFocus = $("practice-focus").value; S.targetRole = $("target-role").value.trim(); S.targetLevel = $("target-level").value;
  S.language = currentLanguage(); S.minutes = Number($("minutes").value) || 12; S.voice = $("voice").value;
}
$("to-key").onclick = async () => {
  redrill = null;
  readForm();
  if (S.cv.length < 80) { notice("cv-notice", "Add your CV first: a file or pasted text.", "bad"); return; }
  try { interviewContext(S); }
  catch (err) { notice("jd-notice", err.message, "bad"); return; }
  notice("jd-notice", "");
  store.set("ps_practice_focus", S.practiceFocus); store.set("ps_target_role", S.targetRole); store.set("ps_target_level", S.targetLevel);
  store.set("ps_cv", S.cv); store.set("ps_jd", S.jd); store.set("ps_name", S.name); store.set("ps_language", S.language); store.set("ps_voice", S.voice);
  track("mock_cv_ready", { words: S.cv.split(/\s+/).length, jd: !!S.jd, language: S.language });
  // The server's config says whether the free demo is on. A click that had to wait for it has lost its user
  // gesture, and iOS Safari keeps audio off without one: that visitor gets the Start button instead of a call.
  const waited = !bootDone;
  if (waited) await booting.catch(() => {});   // a page that failed to set up still lets the visitor try
  // A first-time visitor gets the free demo on our key: no key, no sign-in, straight to the interview.
  // A key comes up only after a pass is bought (the owner's call, 25 Sep 2026). Someone who already
  // has a key keeps the old path untouched.
  // One click from here into the call (owner, 1 Oct 2026): the free demo, and anyone whose own key and time are
  // already known, start at once. The interview screen's Start button remains for Practise again and retries.
  // A Live Sarthi test goes first: it never touches the Prep demo, and it needs no key (3 Oct 2026).
  if (testing()) { S.ent = { kind: "livetest", secondsLeft: DEMO_SECONDS, hasTrial: false }; renderEntitlement(); preLive(); if (!waited) startInterview(); return; }
  if (!S.key && passCtx.demoOn && !(S.ent && S.ent.kind === "pass")) {
    if (!demoUsed.get()) { S.ent = { kind: "demo", secondsLeft: DEMO_SECONDS, hasTrial: false }; renderEntitlement(); preLive(); if (!waited) startInterview(); return; }
    if (passCtx.passesOn) { openPasses("You've had your free demo. A pass gives you unlimited mock interviews."); return; }
  }
  if (S.key && S.ent && ["pass", "trial"].includes(S.ent.kind) && S.ent.secondsLeft > 0) { preLive(); if (!waited) startInterview(); return; }
  showKeyStep();
};

/* The key screen. After a purchase it is the one-minute setup that makes the pass usable. */
function showKeyStep() {
  const paid = S.ent && S.ent.kind === "pass";
  $("key-lede").textContent = paid
    ? "Your pass is active. One last step, about a minute: the interviewer runs on Google's Gemini, on your own free key. It stays in this browser and is sent only to Google, unless you save it to My Sarthi yourself."
    : "The interviewer runs on Google's Gemini, on your own free key. It stays in this browser and is sent only to Google, unless you save it to My Sarthi yourself. If you use Live Sarthi or ApplySarthi, it is the same key.";
  show("s-key");
  if (!$("key").value) $("key").focus();
}

// --------------------------------------------------------------- 2. Key

$("back-cv").onclick = () => show("s-cv");
$("check-key").onclick = async () => {
  const key = $("key").value.trim();
  if (!key) { notice("key-notice", "Paste the key first.", "bad"); return; }
  $("check-key").disabled = true;
  notice("key-notice", "Checking with Google…");
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=" + encodeURIComponent(key), { cache: "no-store" });
    if (res.status === 400 || res.status === 401) throw new Error("Google says this key is not valid. Copy it again from AI Studio.");
    if (res.status === 403) throw new Error("This key exists but is not allowed to use Gemini. Check its restrictions in AI Studio.");
    if (!res.ok && res.status !== 429) throw new Error(`Google answered ${res.status}. Try again in a minute.`);
  } catch (err) {
    notice("key-notice", err.message, "bad"); $("check-key").disabled = false; return;
  }
  S.key = key;
  if ($("remember").checked) store.set("ps_gemini_key", key); else store.del("ps_gemini_key");
  S.hash = await keyHash(key);
  S.ent = await entitlement(S.hash);
  renderEntitlement();
  log("entitlement", { kind: S.ent.kind, secondsLeft: S.ent.secondsLeft, source: S.ent.source });
  track("mock_key_ok", { entitlement: S.ent.kind });
  notice("key-notice", "Key works.", "ok");
  $("check-key").disabled = false;
  preLive();
};

// ---------------------------------------------------------- 3. Interview

function setCaption(hint, line, dim = false) {
  $("hint").textContent = hint;
  if (line !== null) $("line").textContent = line;
  $("caption").classList.toggle("dim", dim);
}

/* Only the current thought fits on a call screen: the last sentence or two. */
function lastLines(text, max = 190) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const parts = clean.split(/(?<=[.?!।])\s+/);
  let out = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    if ((parts[i] + " " + out).length > max && out) break;
    out = (parts[i] + " " + out).trim();
  }
  return out.length > max ? "…" + out.slice(-max) : out;
}

function setLink(state, label) {
  linkState = state;
  const tag = $("livetag");
  tag.textContent = label;
  tag.className = "live" + (state === "live" ? " on" : state === "busy" ? " busy" : "");
}

// ---- microphone help: shown when the mic check fails, or the mic dies mid-call

/* A Bluetooth headset whose microphone is open is in call mode, and this browser cannot
 * send the interviewer to its call-mode output (audio.js _routeOutput). */
const HANDS_FREE_UNSUPPORTED = "Your Bluetooth headset is in call mode and this browser cannot play the interviewer "
  + "through it. Pick your laptop's microphone below, or use wired earphones.";

async function showMicFix(text) {
  $("micfix-text").textContent = text;
  const mics = await AudioIO.listMics();
  $("micselect").innerHTML = mics.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join("");
  if (audio && audio.micId) $("micselect").value = audio.micId;
  $("micfix").style.display = "block";
}
function hideMicFix() { $("micfix").style.display = "none"; }

$("micselect").onchange = async () => {
  if (!audio) return;
  try {
    const info = await audio.useMic($("micselect").value);
    log("mic_switched", { label: info.label, handsFree: info.handsFree, sink: info.sink });
    $("micfix-text").textContent = info.handsFree && info.sink === "unsupported" ? HANDS_FREE_UNSUPPORTED
      : info.handsFree ? `Switched to ${info.label}. Your headset is in call mode now, so the interviewer plays through it in phone quality. Go ahead and answer.`
      : `Switched to ${info.label || "the other microphone"}. Go ahead and answer.`;
  } catch (err) {
    $("micfix-text").textContent = "That microphone could not be opened: " + err.message;
  }
};

function showOffer(id, text) { $(id + "-text").textContent = text; $(id).style.display = "flex"; }
// Use the same country-specific monthly price as checkout, without guessing while config is unavailable.
const monthPrice = () => priceOf("m") || "the checkout price";
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/* The report is where someone decides whether to keep practising. From 20 to 25 Sep 2026 about seven
 * strangers saw the old offer, a small grey "See passes" box below the whole report, and none tapped it.
 * Now it sits right under their score, names their own weakest answer and puts the price on the button. */
function showReportOffer(lead, rep) {
  const scored = (rep.questions || []).filter((q) => Number.isFinite(Number(q.score)) && q.question);
  const weakest = scored.reduce((a, q) => (!a || Number(q.score) < Number(a.score) ? q : a), null);
  const ask = weakest && Number(weakest.score) < 7
    ? ` Your weakest answer was "${clip(weakest.question, 90)}" (${Number(weakest.score)}/10). Practise it again tonight, as many times as you like.`
    : " Practise again tonight, as many times as you like.";
  showOffer("report-offer", `${lead}${ask} A 30-day pass gives you unlimited mock interviews.`);
  $("report-offer-go").textContent = `Get 30 days for ${monthPrice()} →`;
  const top = $("report").querySelector(".rd-top") || $("report").firstElementChild;
  if (top) top.after($("report-offer"));
}
function hideOffer(id) { $(id).style.display = "none"; }

function pendingPayment() { return !!store.get("ps_pending_order") || !!window.__ps?.order; }
function paintReportPass() {
  const active = S.ent?.kind === "pass" && !S.key;
  $("report-pass-active").hidden = !active;
}
$("report-key-setup").onclick = () => showKeyStep();
function offerReport(lead, report, where) {
  deferredReportOffer = { lead, report, where };
  if ($("s-report").classList.contains("on")) revealReportOffer();
}
function revealReportOffer() {
  if (!deferredReportOffer || S.ent?.kind === "pass" || !passCtx.passesOn) return;
  const { lead, report, where } = deferredReportOffer;
  showReportOffer(lead, report);
  track("mock_offer_shown", { where });
  deferredReportOffer = null;
}
function showDemoOffer() {
  $("demo-call-offer").hidden = false;
  $("s-live").classList.add("demo-active");
  document.documentElement.classList.add("demo-call-on");
  $("demo-call-price").textContent = monthPrice();
  $("demo-exit-buy").textContent = `Get unlimited practice · ${monthPrice()}`;
  const benefits = [...$("checkout-what").querySelectorAll("li")];
  $("demo-call-benefits").replaceChildren(...[benefits[0], benefits[2]].filter(Boolean).map((source) => {
    const item = document.createElement("li"); item.textContent = source.textContent; return item;
  }));
  track("mock_offer_shown", { where: "demo_call" });
}
function closeExitCard() {
  exitCardOpen = false;
  $("demo-exit-card").hidden = true;
  $("demo-offer-content").hidden = false;
}
function buyDemo(where) {
  if (phase !== "call" || ending || S.ent?.kind !== "demo") return;
  track("mock_offer_click", { where });
  void openPasses("", { plan: "m", checkout: true, where });
  void endInterview("buy");
}
$("demo-call-buy").onclick = () => buyDemo("demo_call");
$("demo-exit-buy").onclick = () => { track("mock_exit_card", { choice: "buy" }); buyDemo("demo_exit"); };
$("demo-exit-keep").onclick = () => {
  track("mock_exit_card", { choice: "keep" }); closeExitCard();
  sheStoppedAt = nowS(); quietMax = 0;
  refreshWheel(); $("end").focus();
};
$("demo-exit-end").onclick = () => { track("mock_exit_card", { choice: "end" }); closeExitCard(); void endInterview("user"); };
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && exitCardOpen) $("demo-exit-keep").click();
});

function preLive() {
  hideDemoFull();
  phase = "idle";
  closeExitCard();
  $("demo-call-offer").hidden = true;
  $("s-live").classList.remove("demo-active");
  document.documentElement.classList.remove("demo-call-on");
  hideOffer("live-offer"); offerShown = false;
  show("s-live");
  wheel.start(); wheel.setState("idle"); wheel.setLevel(0); wheel.setMic(0);
  $("pre-live").style.display = "grid"; $("youbar").style.display = "none";
  hideMicFix(); $("youline").textContent = "";
  $("transcript").innerHTML = ""; bubbles.clear();
  const length = redrill ? REDRILL_SECONDS : S.minutes * 60;
  $("clock").textContent = fmt(length); $("clock").classList.remove("low");
  setLink("idle", "Ready");
  const p = who();
  setCaption("Your interviewer", `${p.They} speaks first. Answer out loud, like a real call.`);
  $("tip-speaker").textContent = `Use wired earphones if you can. From a loud speaker ${p.they} can hear ${p.themself}. Bluetooth earbuds work best with the laptop's microphone.`;
  $("tip-interrupt").textContent = `You can interrupt, and so can ${p.they}.`;
  if (S.ent.kind === "livetest") {
    $("start").disabled = false;
    const cap = Math.min(S.minutes * 60, DEMO_SECONDS);
    $("clock").textContent = fmt(cap);
    notice("live-notice", `Live Sarthi test, up to ${Math.round(cap / 60)} minutes. Keep Live Sarthi running: after each question, look at its window for the suggested answer. It runs on Google Gemini, which may use it to improve its services.`);
  } else if (S.ent.kind === "demo") {
    $("start").disabled = false;
    const cap = Math.min(S.minutes * 60, DEMO_SECONDS);
    $("clock").textContent = fmt(cap);
    // Free-tier Gemini may use what it hears to improve Google's services; say so before the call, once.
    notice("live-notice", `Your free demo: a ${Math.round(cap / 60)}-minute interview, then your report. It runs on Google Gemini, which may use it to improve its services.`);
  } else if (S.ent.kind === "none") {
    $("start").disabled = true;
    if (passCtx.passesOn) { openPasses("Your free minutes are used up. A 30-day pass gives you unlimited mock interviews. Or invite friends: 7 free days for each friend who buys a pass."); return; }
    notice("live-notice", "Your free minutes are used up. Passes open in a few days.", "bad");
  } else {
    $("start").disabled = false;
    const cap = Math.min(length, S.ent.secondsLeft);
    $("clock").textContent = fmt(cap);
    const why = S.ent.kind === "pass" ? `Your pass ends in ${fmtLong(S.ent.secondsLeft)}` : `You have ${fmtLong(S.ent.secondsLeft)} free left`;
    notice("live-notice", cap < length ? `${why}, so this interview will be ${fmtLong(cap)}.`
      : redrill ? `Answer this again: "${clip(redrill.source.question, 160)}"` : "");
  }
}


/* Both of our keys are running all the interviews they can (6 each, measured). The owner's call: offer the
   visitor their own key right now, or a minute's wait. Either way the demo is not used up. */
let demoWaitTimer = null;
function showDemoFull() {
  hideDemoFull();
  $("demo-full").style.display = "block";
  $("start").disabled = true;
  track("mock_demo_full", {});
}
function hideDemoFull() {
  clearInterval(demoWaitTimer); demoWaitTimer = null;
  $("demo-full").style.display = "none"; $("demo-full-note").textContent = "";
  $("demo-full-key").disabled = false; $("demo-full-wait").disabled = false;
}
$("demo-full-key").onclick = () => { track("mock_demo_full_choice", { choice: "key" }); hideDemoFull(); showKeyStep(); };
$("demo-full-wait").onclick = () => {
  track("mock_demo_full_choice", { choice: "wait" });
  $("demo-full-key").disabled = true; $("demo-full-wait").disabled = true;
  let left = 60;
  const say = () => { $("demo-full-note").textContent = `Trying again in ${left} seconds…`; };
  say();
  demoWaitTimer = setInterval(() => {
    left -= 1;
    if (left > 0) { say(); return; }
    hideDemoFull(); $("start").disabled = false;
    notice("live-notice", "Ready. Press Start the interview.", "ok");
  }, 1000);
};

/* The live engine retains the full transcript for the report. The call shows
 * current captions only; support can explicitly enable the diagnostic view. */
function onTranscript(u, done) {
  if (diagnosticsEnabled) {
    let el = bubbles.get(u);
    if (!el) {
      el = document.createElement("div");
      el.className = "bubble " + u.who;
      el.innerHTML = `<small>${u.who === "interviewer" ? "Interviewer" : (escapeHtml(S.name) || "You")}</small><span></span>`;
      $("transcript").appendChild(el); bubbles.set(u, el);
    }
    el.querySelector("span").textContent = u.text + (u.interrupted ? " …" : "");
  }
  if (u.who === "interviewer") {
    // Google sends your words in one batch when your turn ends, so they land
    // just as the interviewer starts to reply. Leave them up for a few seconds:
    // it reads as "this is what they heard", then it fades.
    if (!youClearTimer && $("youline").textContent) youClearTimer = setTimeout(() => { $("youline").textContent = ""; youClearTimer = null; }, 6000);
    setCaption("Interviewer", lastLines(u.text) + (u.interrupted ? " …" : ""), false);
  } else {
    clearTimeout(youClearTimer); youClearTimer = null;
    $("youline").innerHTML = `<b>${who().They} heard</b>` + escapeHtml(lastLines(u.text, 120));
  }
}

function refreshWheel() {
  if (phase !== "call" || !live) return;
  if (exitCardOpen) { wheel.setState("idle"); return; }
  if (linkState === "busy" && !speaking) { wheel.setState("reconnecting"); return; }
  if (speaking) { wheel.setState("speaking"); return; }
  if (micWarned) { wheel.setState("listening"); return; }
  const quietFor = nowS() - lastVoiceAt;
  if (heardSinceShe && quietFor > 0.9) { wheel.setState("thinking"); setCaption("Thinking", null, true); }
  else { wheel.setState("listening"); setCaption(heardSinceShe ? "Listening" : "Your turn", null, heardSinceShe); }
}

function wireAudio() {
  const bars = [...$("bars").children];
  audio.onPlaying = (playing) => {
    speaking = playing;
    if (live) live.setPlaying(playing);
    if (playing) heardSinceShe = false;
    else { sheStoppedAt = nowS(); quietMax = 0; }
    refreshWheel();
  };
  audio.onLevel = (level) => wheel.setLevel(level * 5);
  audio.onChunk = (pcm, rms) => {
    if (exitCardOpen || ending) return;
    const t = nowS();
    const voiced = rms >= VOICE_RMS;
    micStats.chunks++; if (voiced) micStats.voiced++; if (rms > micStats.maxRms) micStats.maxRms = rms;
    const lvl = Math.min(1, rms * 9);
    wheel.setMic(lvl);
    bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.12, Math.min(1, lvl * BAR_SHAPE[i] * 1.6)).toFixed(2)})`; });
    if (phase !== "call") return;
    voiceLog.push([t, voiced]);
    if (rms > quietMax) quietMax = rms;
    if (voiced && !speaking) {
      lastVoiceAt = t; heardSinceShe = true;
      if (micWarned) { micWarned = false; hideMicFix(); log("mic_back", {}); }
    }
    if (live) live.sendAudio(pcm, rms);
    refreshWheel();
  };
}

$("start").onclick = () => startInterview();

/* Start, in one step (owner, 1 Oct 2026): the microphone, the demo's token and a fresh entitlement side by side,
 * then straight into the call, and the interviewer speaks as soon as it is connected. Nothing waits for an
 * interview plan: that is made in the background for the report only (preparePlan), and a microphone that delivers
 * nothing is caught during the call (onSecond) instead of by a mic check first. On 30 Sep 2026 the old sequence,
 * mic check -> token -> plan -> connect, took 14-18 s from Start to the interviewer's voice, and 42-58 s when the
 * mic check needed help or Gemini hung on the plan. */
async function startInterview() {
  if (reportWriting) { notice("live-notice", "Your last report is still being written. Start the next interview once it is ready.", "bad"); return; }
  // Nothing left to practise with (the demo's report has just arrived): the passes, never a call Google refuses.
  if (!redrill && S.ent && S.ent.kind === "none") { preLive(); return; }
  if (phase !== "idle") return;            // a second click must not start a second call
  // A full interview needs a role or a JD; answering one saved question again does not (it may be on a
  // device where the form was never filled in).
  if (!redrill) {
    try { interviewContext(S); }
    catch (err) { show("s-cv"); notice("jd-notice", err.message, "bad"); return; }
  }
  beginDiagnostics({ kind: redrill ? 'redrill' : S.ent?.kind || 'none', minutes: S.minutes,
    device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop', release: '20261012-models38' });
  phase = "preparing";
  const controller = new AbortController();
  startController = controller;
  const cancelled = () => controller.signal.aborted || startController !== controller;
  const started = performance.now();
  diagnosticEvent('preparation_start', { stage: 'live' });
  hideDemoFull(); hideMicFix();
  $("start").disabled = true;
  notice("live-notice", "");
  $("pre-live").style.display = "none"; $("youbar").style.display = "flex"; $("end").disabled = false;
  setLink("busy", "Connecting");
  setCaption("Connecting", `Calling your interviewer. ${who().They} speaks first.`, true);
  $("left").textContent = "Your time has not started";
  wheel.setState("reconnecting");

  audio = new AudioIO();
  audio.onMicMuted = (muted) => {
    log("mic_track_muted", { muted });
    if (muted && phase !== "idle") showMicFix("Your system reports the microphone as muted. Unmute it, then answer out loud.");
  };
  const isDemo = S.ent.kind === "demo", isTest = S.ent.kind === "livetest";
  if (isDemo || isTest) diagnosticEvent('demo_requested', { stage: isTest ? 'livetest' : 'demo' });
  const [micError, grant, fresh] = await Promise.all([
    audio.start().then(() => null, (err) => err),
    // Asked for only now, at Start: a visitor who never presses it never uses one up.
    isTest ? requestLiveTest() : isDemo ? requestDemo() : null,
    // A pass can expire between loading the page and pressing Start. A demo or a test has no key to look up.
    isDemo || isTest || redrill || !S.hash ? S.ent : entitlement(S.hash),
  ]);
  if (cancelled()) return;
  if (micError) {
    log("mic_error", { error: String(micError) });
    await cancelStart('failed');
    notice("live-notice", "Microphone not available: " + micError.message + ". Allow the mic for this site and try again.", "bad");
    return;
  }
  if (isTest) {
    if (!grant.ok) { diagnosticEvent('demo_refused', { reason: grant.reason }); await testRefused(grant.reason); return; }
    // Held like a demo for its token and length; a test has no plan and no report, so it never reaches the relay.
    demo = { demo: grant.test, token: grant.token, seconds: grant.seconds };
    diagnosticEvent('demo_granted', { demo_id: demo.demo, stage: 'livetest' });
  } else if (isDemo) {
    if (!grant.ok) { diagnosticEvent('demo_refused', { reason: grant.reason }); await demoRefused(grant.reason); return; }
    demo = { ...grant, startedAt: new Date().toISOString() };
    demoReplace.clear();
    diagnosticEvent('demo_granted', { demo_id: demo.demo, stage: 'demo' });
    // Not marked used here: if the call cannot connect, pressing Start again resumes the same demo.
    track("mock_demo_start", {});
  } else {
    S.ent = fresh;
    if (!(S.ent.secondsLeft > 0)) {
      await cancelStart('failed');
      notice("live-notice", "Your practice time has expired. Get a pass before starting.", "bad");
      return;
    }
  }
  log("mic", { label: audio.micLabel, deviceRate: audio.sampleRate, handsFree: audio.handsFree, sink: audio.sink, micPreferred: audio.micPreferred });
  // Bluetooth earbuds (micpick.js): say which microphone was taken instead, or that this
  // browser cannot play through a headset in call mode.
  if (audio.micPreferred) notice("live-notice", `Using ${audio.micLabel || "the laptop's microphone"}, so your Bluetooth earbuds stay in stereo.`, "ok");
  else if (audio.handsFree && audio.sink === "unsupported") showMicFix(HANDS_FREE_UNSUPPORTED);
  micStats = { chunks: 0, voiced: 0, maxRms: 0 };
  wireAudio();
  diagnosticEvent('preparation_ready', { stage: 'live', duration_ms: Math.round(performance.now() - started) });
  startController = null;
  assessmentPlan = null;
  planPending = redrill || isTest ? null : preparePlan();
  startCall();
}

/* The interview plan: the JD's requirements with weak/adequate/strong criteria, made while the interview runs and
 * used only by the report (and so by the progress page). The interviewer works from the CV and JD directly. When no
 * plan can be made, the report scores the six broad areas instead; nobody waits for it. */
const PLAN_WAIT_MS = 20_000;     // the report waits this long at most for a plan still being made
function preparePlan() {
  const started = performance.now();
  diagnosticEvent('preparation_start', { stage: 'plan' });
  return generateInterviewPlan({ apiKey: S.key, cv: S.cv, jd: S.jd,
    minutes: S.minutes, language: S.language, practiceFocus: S.practiceFocus, targetRole: S.targetRole, targetLevel: S.targetLevel,
    transport: demo ? demoTransport(demo.demo, 'plan') : undefined })
    .then((plan) => { diagnosticEvent('preparation_ready', { stage: 'plan', duration_ms: Math.round(performance.now() - started) }); return plan; })
    .catch((err) => {
      diagnosticEvent('preparation_failed', { stage: 'plan', error: errorClass(err), duration_ms: Math.round(performance.now() - started) });
      track("mock_fail_plan", { demo: !!demo, message: String(err && err.message || "").slice(0, 90) });
      return null;
    });
}
const planForReport = () => planPending
  ? Promise.race([planPending, new Promise((r) => setTimeout(() => r(null), PLAN_WAIT_MS))]) : Promise.resolve(null);

async function cancelStart(reason = 'cancelled') {
  diagnosticEvent('preparation_cancelled', { reason });
  startController?.abort(); startController = null;
  phase = "idle";
  if (audio) { await audio.stop(); audio = null; }
  preLive();
}

/* The progress track of the interview about to start, from the form; null for a pasted JD, whose role only the
 * plan reads from it. */
function formTrack() {
  const c = interviewContext(S);
  return c.mode === "job_description" ? null : trackKey({ mode: c.mode, role: c.targetRole, level: c.targetLevel });
}

/* No demo for this visitor right now. Nothing here mentions keys: that step comes after a purchase. */
async function demoRefused(reason) {
  await cancelStart(reason);
  track("mock_demo_refused", { reason });
  if (reason === "full") { showDemoFull(); return; }
  if (reason === "busy") { notice("live-notice", "Lots of people are practising right now. Press Start again in about 20 seconds.", "bad"); return; }
  if (reason === "used") demoUsed.set();
  const text = reason === "used" ? "You've had your free demo. A pass gives you unlimited mock interviews."
    : reason === "unavailable" ? "The free demo isn't available just now. Try again in a few minutes, or start with a pass."
    : "Today's free demos are all used up. Come back tomorrow, or start with a pass.";
  if (passCtx.passesOn) openPasses(text); else notice("live-notice", text, "bad");
}

/* No test interviewer for this Live Sarthi user right now. Never the passes: they are not shopping for Prep. */
async function testRefused(reason) {
  await cancelStart(reason);
  track("mock_demo_refused", { reason });
  const other = "Other ways to test: join your own Meet or Teams call from your phone and ask the questions yourself, or play an interview video on YouTube.";
  notice("live-notice", reason === "full" || reason === "busy" ? "Lots of people are practising right now. Press Start again in a minute."
    : reason === "unavailable" ? "The test interviewer isn't available just now. Try again in a few minutes."
    : reason === "used" ? `You've had today's tests on this PC. ${other}`
    : `Today's tests are all used up. ${other}`, "bad");
}

function startCall() {
  if (phase === "call") return;
  $("youbar").style.display = "flex";
  phase = "call";
  if (S.ent.kind !== "livetest") {
    demoPurchase = null; store.del("ps_demo_purchase");
    $("report-payment-note").hidden = true;
  }
  if (S.ent.kind === "demo" && passCtx.passesOn) showDemoOffer();
  startedAt = nowS(); voiceLog = []; ending = false; bookedSeconds = 0; tickPending = null;
  speaking = false; heardSinceShe = false; lastVoiceAt = 0; sheStoppedAt = 0; quietMax = 0; micWarned = false; liveTrouble = 0;
  trialLeftAtStart = S.ent.secondsLeft;
  plannedSeconds = Math.min(redrill ? REDRILL_SECONDS : S.minutes * 60, S.ent.secondsLeft, demo ? demo.seconds : Infinity);   // free minutes, passes and the demo all stop on the second
  // A pass holder's last report named one habit to fix, and their earlier interviews say what to ask next. A pasted
  // JD's track is not known yet, so role knowledge learnt for another job is not carried into it.
  const passHolder = !redrill && S.ent.kind === "pass";
  const practiceTrack = passHolder ? formTrack() : null;
  focusCarried = passHolder ? carryFocus(knownSummaries(), practiceTrack || "job_description|") : null;
  coaching = passHolder ? coachingBrief(knownSummaries(), { track: practiceTrack }) : "";
  log("call_start", { planned: plannedSeconds });
  setLink("busy", "Connecting");
  setCaption("Connecting", "Calling your interviewer…", true);
  $("left").textContent = "You're on";
  wheel.setState("reconnecting");

  const brief = { candidateName: S.name, cv: S.cv, jd: S.jd, language: S.language, voice: S.voice, minutes: plannedSeconds / 60, focus: focusCarried, coaching };
  live = new GeminiLive({
    apiKey: S.key,
    authToken: demo ? demo.token : "",
    voice: S.voice,
    instructions: () => redrill
      ? buildRedrillInstructions({ candidateName: S.name, language: redrill.source.language || S.language, voice: S.voice, source: redrill.source, cv: S.cv })
      : buildInterviewerInstructions(brief),
    notes: redrill ? redrillNotes() : undefined,
    getInterviewProgress: currentProgress,
    onAudio: (pcm) => !exitCardOpen && !ending && audio && audio.play(pcm),
    onInterrupted: () => audio && audio.clear(),
    onTranscript,
    onStatus: (s) => {
      if (s === "live") {
        setLink("live", "Live");
        notice("live-notice", "");
        setCaption("Connected", "Your interviewer is here. You can continue.");
      }
      else if (s === "connecting" || s === "reconnecting") {
        setLink("busy", s === "connecting" ? "Connecting" : "Reconnecting");
        if (s === "reconnecting") setCaption(googleDrop ? "Google is busy" : "One moment", googleDrop
          ? "Google's voice service dropped. Reconnecting your interviewer. Not your mic, not the app. Your timer is paused and your answers are kept."
          : "Reconnecting. Your practice timer is paused and your answers are kept.", true);
      } else if (s === "failed") endInterview("failed");
      refreshWheel();
    },
    onNotice: (m) => { notice("live-notice", m); log("notice", { m }); },
    onEvent: (name, data) => {
      // Why a call reconnects, for everyone (the diagnostics log is on only with ?diagnostics=1): the owner's
      // own test on 27 Sep 2026 reconnected mid-call and nothing outside the browser could say why.
      if (name === "reconnect") { googleDrop = /^(reply_timeout|setup_timeout|resume_rejected)$/.test(String(data && data.reason)); track("mock_reconnect", { reason: data && data.reason, demo: !!demo }); }
      else if (name === "socket_closed" && data && data.wasConnected) {
        googleDrop = data.code === 1011 || /internal error|unavailable|overloaded|high demand/i.test(String(data.reason || ""));
        track("mock_reconnect", { reason: `closed_${data.code}`, message: String(data.reason || "").slice(0, 90), demo: !!demo });
      }
      if (name === "model_fallback") track("mock_model_fallback", { model: data && data.model, reason: data && data.reason, demo: !!demo });
      if (name === "stall_detected" || name === "model_fallback" || (name === "socket_closed" && data && data.code === 1011)) liveTrouble++;
      const usage = data?.usage;
      log(name, { ...data, stage: 'live',
        ...(name === 'socket_closed' ? { error: errorClass(data?.reason) } : {}),
        ...(usage ? { input_tokens: usage.promptTokenCount, output_tokens: usage.responseTokenCount, total_tokens: usage.totalTokenCount } : {}) });
    },
  });
  live.start();
  track(redrill ? "mock_redrill_start" : "mock_start", { minutes: Math.round(plannedSeconds / 60), language: S.language, entitlement: S.ent.kind, focus: !!focusCarried });
  timer = setInterval(onSecond, 1000);
}

/* The interviewer's clock tool. Since 1 Oct 2026 the interviewer works without the plan (it is made in the
 * background for the report), so the tool answers with time only. */
function currentProgress() {
  if (redrill) return redrillProgress({ plannedSeconds, elapsedSeconds: live ? live.activeSeconds : 0 });
  return interviewProgress({ plannedSeconds, elapsedSeconds: live ? live.activeSeconds : 0,
    entitlementSeconds: S.ent.kind === "pass" ? trialLeftAtStart - (nowS() - startedAt) : Infinity });
}

async function onSecond() {
  if (!live || ending) return;
  const elapsed = live.activeSeconds;
  // Pass expiry remains real clock time; only practice minutes pause.
  const passLeft = trialLeftAtStart - (nowS() - startedAt);
  const remaining = currentProgress().remainingSeconds;
  $("clock").textContent = fmt(remaining);
  $("clock").classList.toggle("low", remaining <= 60);
  if (S.ent.kind === "demo") $("left").textContent = `Free demo · ${fmt(remaining)} left`;
  else if (S.ent.kind === "livetest") $("left").textContent = `Live Sarthi test · ${fmt(remaining)} left`;
  else if (S.ent.kind === "trial") $("left").textContent = `Free · ${fmtLong(Math.max(0, trialLeftAtStart - elapsed))} left`;
  else if (S.ent.kind === "pass") $("left").textContent = `Pass · ${fmtLong(Math.max(0, passLeft))} left`;
  // Free time is nearly gone: this is the moment someone decides to buy.
  if (S.ent.kind === "trial" && passCtx.passesOn && !offerShown && trialLeftAtStart - elapsed <= LOW_FREE_SECONDS) {
    offerShown = true;
    showOffer("live-offer", `About ${Math.max(1, Math.round((trialLeftAtStart - elapsed) / 60))} free minutes left. A pass gives you unlimited mocks, ${monthPrice()} for 30 days.`);
    track("mock_offer_shown", { where: "interview" });
  }
  if (remaining <= 0) { endInterview("time"); return; }
  if (exitCardOpen) return;

  // The interviewer asked, and the microphone has delivered exact digital silence ever since (a mute key or a
  // dead input, not someone thinking), or nothing loud enough to be a voice since the call began: the check that
  // used to run before the call (the mic check, until 1 Oct 2026) now runs here, after the first question.
  const neverHeard = micStats.voiced === 0;
  if (!micWarned && linkState === "live" && !speaking && sheStoppedAt && !heardSinceShe
      && nowS() - sheStoppedAt > 10 && (quietMax < MIC_MUTED_RMS || neverHeard)) {
    micWarned = true;
    const verdict = micStats.maxRms < MIC_DEAD_RMS ? "silent" : "quiet";
    log("mic_silent_in_call", { quietMax: +quietMax.toFixed(6), verdict: neverHeard ? verdict : "silent" });
    track("mock_mic_silent", { verdict: neverHeard ? verdict : "muted" });
    setCaption("Can't hear you", null, true);
    showMicFix(neverHeard
      ? `${who().They} can't hear you yet. ${MIC_HELP[verdict]}`
      : `Your microphone has gone completely silent. Is it muted? ${who().They} is waiting for your answer.`);
  }

  // Book used time against the trial, like the desktop app's 30-second slices.
  if (S.ent.kind === "trial" && !tickPending && Math.floor(elapsed) - bookedSeconds >= TICK_SECONDS) {
    const slice = Math.floor(elapsed) - bookedSeconds; bookedSeconds += slice;
    tickPending = tick(S.hash, slice);
    const r = await tickPending;
    tickPending = null;
    S.ent.secondsLeft = r.secondsLeft;
    log("trial_tick", { slice, left: r.secondsLeft, source: r.source });
    if (r.reward) {
      trialLeftAtStart += r.reward.seconds;
      notice("live-notice", `You and the friend who invited you both just earned ${Math.round(r.reward.seconds / 60)} free minutes.`, "ok");
      track("mock_invite_reward", { seconds: r.reward.seconds });
    }
    if (!ending && r.secondsLeft <= 0) endInterview("trial");
  }
}

$("end").onclick = () => {
  if (phase === "preparing") { cancelStart(); return; }
  if (S.ent?.kind === "demo" && phase === "call" && !ending) {
    if (exitCardOpen) return;
    exitCardOpen = true;
    audio?.clear();
    speaking = false; live?.setPlaying(false); wheel.setState("idle");
    $("demo-offer-content").hidden = true;
    $("demo-exit-card").hidden = false;
    $("demo-exit-buy").textContent = `Get unlimited practice · ${monthPrice()}`;
    $("demo-exit-title").focus({ preventScroll: true });
    return;
  }
  if (confirm(S.ent && S.ent.kind === "livetest" ? "End the test now?" : "End the interview now and get your report?")) endInterview("user");
};

async function endInterview(reason) {
  if (ending) return;
  ending = true;
  clearInterval(timer);
  $("end").disabled = true;
  const elapsed = Math.round(live ? live.activeSeconds : 0);
  log("interview_end", { reason, elapsed });
  log("mic_stats", { chunks: micStats.chunks, voicedChunks: micStats.voiced, maxRms: +micStats.maxRms.toFixed(5), label: audio ? audio.micLabel : "" });
  track("mock_end", { reason, seconds: elapsed });
  const turns = live ? live.transcript.turns.map((u) => ({ ...u })) : [];
  const usage = live ? { ...live.usage } : {};
  if (live) { live.close(); live = null; }
  audio?.clear();
  const stopped = audio ? audio.stop() : Promise.resolve();
  let purchaseJob = null;
  if (reason === "buy") {
    demoUsed.set();
    demoPurchase = { at: Date.now(), hasAnswers: turns.some((u) => u.who === "candidate" && u.text?.trim()), reportId: null };
    store.set("ps_demo_purchase", JSON.stringify(demoPurchase));
    if (demoPurchase.hasAnswers) purchaseJob = rememberPendingReport(makeReportJob(turns, elapsed, usage, true));
    closeExitCard();
  }
  await stopped;
  audio = null;
  phase = "idle";
  if (reason === "buy") refreshPasses();
  wheel.setState("idle"); wheel.setLevel(0); wheel.setMic(0);
  if (reason === "buy") {
    wheel.stop();
    if (purchaseJob) await whileWriting(() => writeReport(turns, elapsed, usage, purchaseJob));
    else { demo = null; S.ent = { ...S.ent, kind: "none", secondsLeft: 0, hasTrial: false }; renderEntitlement(); }
    return;
  }
  // Book the tail of the session.
  if (S.ent.kind === "trial") {
    if (tickPending) await tickPending;
    const slice = Math.max(0, elapsed - bookedSeconds);
    if (slice) { const r = await tick(S.hash, slice); S.ent.secondsLeft = r.secondsLeft; }
    if (S.ent.secondsLeft <= 0) S.ent.kind = "none";
    renderEntitlement();
  }
  if (reason === "failed" && turns.length === 0) track("mock_fail_connect", { demo: !!demo });
  if (S.ent.kind === "livetest") {
    // A test ends on Live Sarthi's next step, never a Prep report. Whether the candidate answered does not matter:
    // Live Sarthi listens to the interviewer through the PC's sound.
    demo = null;
    if (reason === "failed" && turns.length === 0) {
      ending = false; preLive(); notice("live-notice", "The interviewer could not connect. Press Start to try again.", "bad");
      return;
    }
    wheel.stop();
    showLiveTestDone(elapsed);
    return;
  }
  if (reason === "failed" && turns.length === 0 && demo) {
    // Google refused the connection (a key at its limit): the same choice as a full server, never a key message.
    ending = false; preLive(); notice("live-notice", ""); showDemoFull();
    return;
  }
  if (reason === "failed" && turns.length === 0) {
    const why = $("live-notice").textContent || "Gemini refused the session.";
    ending = false; preLive();
    if (S.key) { showKeyStep(); notice("key-notice", why + " Check the key, then continue.", "bad"); return; }
    notice("live-notice", why + " Fix the key or try again.", "bad");
    return;
  }
  if (turns.filter((u) => u.who === "candidate").length === 0) {
    ending = false; preLive();
    const deaf = micStats.maxRms < 0.002;
    diagnosticEvent('no_answers', { deaf, seconds: elapsed });
    track("mock_fail_nomic", { demo: !!demo, deaf, seconds: elapsed });
    if (demo && !deaf && liveTrouble) {
      // Google dropped or silenced the call and heard nothing (3 Oct 2026, an hour of it): the visitor's one
      // demo is not spent on that. The next Start asks the server to replace it.
      demoReplace.set(demo.demo);
      demo = null;
      notice("live-notice", "Google's voice service had trouble during this call and heard none of your answers. Press Start to try again: this attempt does not use up your free demo.", "bad");
      return;
    }
    notice("live-notice", deaf
      ? "Your microphone sent only silence for the whole call, so there is nothing to score. It was muted, or the browser used the wrong one. Check it and try again."
      : "Google did not pick up any of your answers, so there is nothing to score. Check your microphone and try again. If it happens again, contact support@interviewsarthi.com.", "bad");
    return;
  }
  wheel.stop();
  await whileWriting(() => redrill ? writeRedrill(turns, elapsed) : writeReport(turns, elapsed, usage));
}

/* The end of a Live Sarthi test: did it work, and how to have it in the real interview. Live's cheapest pass, as
 * license-server src/core.js PLANS "2d" sells it (rupees through Cashfree, dollars through Dodo). */
const LIVE_2D = { inr: "Rs 99", usd: "$9.99" };
function showLiveTestDone(elapsed) {
  $("lt-price").textContent = `Passes from ${isIntl() ? LIVE_2D.usd : LIVE_2D.inr} for 2 days.`;
  show("s-livetest");
  track("mock_offer_shown", { where: "livetest", seconds: elapsed });
}
$("lt-buy").onclick = () => track("mock_offer_click", { where: "livetest" });
$("lt-again").onclick = () => { ending = false; preLive(); };

// ------------------------------------------------------------- 4. Report

/* While a report is written the report screen offers nothing to press. On 30 Sep 2026 "Practise again", pressed
 * seven seconds into the wait, started a second demo; the first report then landed mid-preparation and switched
 * the demo off, so that interview went to Google with no key: one refused call, then four failed starts. */
async function whileWriting(write) {
  reportWriting = true; $("report-actions").style.display = "none";
  try { await write(); }
  finally { reportWriting = false; $("report-actions").style.display = ""; }
}

/* Google answers "high demand" (503) or hangs (504) in bursts of a few minutes (30 Sep and 5 Oct 2026: both report
 * models at once). The report is then tried again by itself, with the wait and the reason on screen, so nobody takes
 * Google's bad minute for a broken app. The unwritten report stays on this device (ps_pending_report) and is finished
 * the next time the app opens, in a minute or tomorrow. Owner's ask, 5 Oct 2026. */
const REPORT_RETRY_SECONDS = (window.__PREP_TEST && window.__PREP_TEST.retrySeconds) || [20, 30, 45, 60, 60, 60, 60, 60, 60, 60];
const PENDING_REPORT_HOURS = 24;      // older than this the answers are stale, and the pending report is dropped
const DEMO_REPORT_MINUTES = 55;       // the licence server stops answering a demo's report an hour after its start
let reportBusyWake = null;            // ends the current wait early: true = try now, false = stop trying

function rememberPendingReport(job) { store.set("ps_pending_report", JSON.stringify(job)); return job; }
function makeReportJob(turns, elapsed, usage, purchase = false) {
  return { at: new Date().toISOString(), turns, elapsed, usage, metrics: computeMetrics(turns, voiceLog),
    cv: S.cv, jd: S.jd, language: S.language, plan: assessmentPlan, needsPlan: true, focus: focusCarried,
    demo: demo ? { demo: demo.demo, seconds: demo.seconds, startedAt: demo.startedAt } : null, purchase };
}
function forgetPendingReport() { try { localStorage.removeItem("ps_pending_report"); } catch (_) { /* private mode */ } }
function readPendingReport() {
  try { const j = JSON.parse(store.get("ps_pending_report", "null")); return j && Array.isArray(j.turns) && j.turns.length ? j : null; }
  catch { return null; }
}

/* The waiting card while Google is busy: whose fault, what happens next, a countdown, and two choices. */
function reportBusyWait(seconds, err, job) {
  const why = err.network ? "Google could not be reached from your connection" : "Google's servers are busy right now";
  const later = job.demo ? "come back within the hour on this device and it will be written then."
    : "open Prep Sarthi again on this device at any time and it will be written then" + (S.ent && S.ent.kind === "pass" ? ", and saved to Your interviews." : ".");
  $("report-wait").querySelector("h2").textContent = err.network ? "Waiting for your connection" : "Google is busy, not your app";
  waitWheel.setState("reconnecting");
  let box = $("report-busy-actions");
  if (!box) {
    box = document.createElement("div"); box.className = "actions"; box.id = "report-busy-actions";
    box.innerHTML = `<button class="pill" id="report-retry">Try now</button><button class="pill ghost" id="report-later">Stop trying</button>`;
    $("report-wait").appendChild(box);
  }
  return new Promise((resolve) => {
    let left = seconds;
    const paint = () => { $("report-status").innerHTML = `${escapeHtml(why)}. Your answers are safe, and this is not your microphone or this app. Trying again in <b>${left} s</b>. You can wait here, or leave: ${escapeHtml(later)}`; };
    const tick = setInterval(() => { left -= 1; if (left <= 0) done(true); else paint(); }, 1000);
    const done = (go) => { clearInterval(tick); reportBusyWake = null; resolve(go); };
    reportBusyWake = done;
    $("report-retry").onclick = () => { track("mock_report_retry", { demo: !!job.demo, during: "wait" }); done(true); };
    $("report-later").onclick = () => { track("mock_report_later", { demo: !!job.demo }); done(false); };
    paint();
  });
}

/* An interview whose report Google could not write last time (busy or unreachable): finish it now, on the
 * person's own key if they have one since, otherwise through the demo relay while its hour lasts. */
async function resumePendingReport() {
  const job = readPendingReport();
  if (!job) return;
  const ageMin = (Date.now() - Date.parse(job.at || 0)) / 60000;
  const demoAge = (Date.now() - Date.parse(job.demo?.startedAt || job.at)) / 60000;
  const usable = ageMin >= 0 && ageMin <= PENDING_REPORT_HOURS * 60 && (S.key || (job.demo && demoAge >= 0 && demoAge <= DEMO_REPORT_MINUTES));
  if (!usable) { forgetPendingReport(); return; }
  // A demo visitor has no entitlement until Start is pressed (line above startInterview): give the report the one it had.
  if (!S.key && !S.ent) { S.ent = { kind: "demo", secondsLeft: 0, hasTrial: false }; renderEntitlement(); }
  track("mock_report_resume", { demo: !!job.demo && !S.key, minutes: Math.round(ageMin) });
  await whileWriting(() => writeReport(job.turns, job.elapsed, job.usage, job));
}

async function writeReport(turns, elapsed, usage, pending = null) {
  const reportStarted = performance.now();
  diagnosticEvent('report_start', { stage: 'report', resumed: !!pending });
  const job = pending || rememberPendingReport(makeReportJob(turns, elapsed, usage));
  deferredReportOffer = null; hideOffer("report-offer");
  if (!(job.purchase && ($("s-pass").classList.contains("on") || pendingPayment()))) show("s-report");
  $("report").innerHTML = ""; $("report-wait").style.display = "block";
  $("report-wait").querySelector("h2").textContent = pending ? "Finishing your report" : "Writing your report";
  $("report-status").textContent = pending ? `From your interview at ${new Date(pending.at).toLocaleString()}. About twenty seconds.` : "Scoring every answer against your CV. About twenty seconds.";
  const stale = $("report-busy-actions"); if (stale) stale.remove();
  waitWheel.start(); waitWheel.setState("thinking");
  const metrics = job.metrics;
  // Save the answers before waiting for the in-flight plan or contacting Google.
  if (job.needsPlan) {
    job.plan = (await planForReport()) || job.plan;
    delete job.needsPlan;
    rememberPendingReport(job);
  }
  const transport = job.demo && !S.key ? demoTransport(job.demo.demo) : undefined;    // a buyer since then writes it on their own key
  let result, err;
  for (let attempt = 0; ; attempt++) {
    try {
      result = await generateReport({ apiKey: S.key, transport, cv: job.cv, jd: job.jd, language: job.language, transcript: turns, metrics, minutes: Math.round(elapsed / 60), assessmentPlan: job.plan, previousFocus: job.focus });
      break;
    } catch (e) {
      err = e;
      const wait = (e.busy || e.network) ? REPORT_RETRY_SECONDS[attempt] : 0;
      diagnosticEvent('report_failed', { stage: 'report', error: errorClass(e), attempt: attempt + 1, busy: !!e.busy, retrying: !!wait, duration_ms: Math.round(performance.now() - reportStarted) });
      if (!wait) break;
      if (attempt === 0) track("mock_report_busy", { demo: !!job.demo, message: String(e.message || "").slice(0, 90) });
      if (!(await reportBusyWait(wait, e, job))) break;         // "Stop trying"
      $("report-wait").querySelector("h2").textContent = "Writing your report"; waitWheel.setState("thinking");
    }
  }
  if (!result) {
    void flushDiagnostics();
    track("mock_fail_report", { demo: !!job.demo, message: String(err && err.message || "").slice(0, 90), busy: !!err.busy });
    waitWheel.stop(); $("report-wait").style.display = "none";
    if (!err.busy && !err.network) forgetPendingReport();       // waiting would not change this answer
    const reason = err.busy ? "Google's servers are busy: their side, not your microphone or this app."
      : err.network ? "Google could not be reached from your connection." : escapeHtml(err.message);
    const keep = err.busy || err.network ? ` It will also be written by itself the next time you open Prep Sarthi on this device${job.demo && !S.key ? " within the hour" : ""}.` : "";
    $("report").innerHTML = `<div class="card"><h2 style="font-size:28px">${err.busy ? "Google is busy right now" : "The report could not be written"}</h2><p class="muted">${reason}</p><p class="muted">Your answers are kept. Try again now, or download your transcript below.${keep}</p><div class="actions"><button class="pill" id="report-retry">Write my report again</button></div></div>`;
    // The same interview again, not a new one: both Hyderabad demos that lost their report on 30 Sep were redone in full.
    $("report-retry").onclick = () => { track("mock_report_retry", { demo: !!job.demo }); void whileWriting(() => writeReport(turns, elapsed, usage, job)); };
    window.__lastReport = { turns, metrics, elapsed };
    if (job.demo && S.ent?.kind !== "pass") offerReport("Your interview answers are saved.", { questions: [] }, "demo_report");
    return;
  }
  waitWheel.stop(); $("report-wait").style.display = "none";
  diagnosticEvent('report_ready', { stage: 'report', model: result.model, duration_ms: Math.round(performance.now() - reportStarted) });
  void flushDiagnostics();
  const record = { id: "iv-" + crypto.randomUUID(), at: new Date().toISOString(), elapsed, language: job.language, model: result.model,
    rubric: RUBRIC_VERSION, demo: !!job.demo, report: result.report, metrics, transcript: turns, usage,
    ...(focusCarried ? { focus_carried: focusCarried } : {}) };
  // Owner, 1 Oct 2026: the free demo's report is shown in full, like every other (it was locked from 26 Sep).
  // "+8 since last time": against this person's earlier interviews in the current pass (progress.js).
  try { record.changes = reportChanges(summarize(record), knownSummaries(), currentPeriod()); } catch (_) { /* no badges */ }
  window.__lastReport = record;
  saveHistory(record);
  if (job.purchase && demoPurchase) {
    demoPurchase.reportId = record.id;
    store.set("ps_demo_purchase", JSON.stringify(demoPurchase));
  }
  forgetPendingReport();
  renderReport(record);
  announceReport(record);
  if (job.demo) {
    // The demo is over: this is the moment to offer the pass. A second demo is not offered.
    track("mock_demo_end", { score: result.report.overall_score });
    demoUsed.set();
    demo = null;
    if (!S.ent || S.ent.kind === "demo") S.ent = { ...S.ent, kind: "none", secondsLeft: 0, hasTrial: false };
    renderEntitlement();
    if (passCtx.passesOn && S.ent.kind !== "pass") {
      offerReport("That was your free demo.", result.report, "demo_report");
    } else hideOffer("report-offer");
    track("mock_report", { score: result.report.overall_score, questions: (result.report.questions || []).length, model: result.model });
    // Just seen their score: the moment to pass the app on. The link is this browser's, no key or sign-in needed.
    deviceInvite().then((r) => { S.deviceInvite = r.invite; renderInvite($("invite-report"), result.report.overall_score); }).catch(() => {});
    return;
  }
  if (S.ent.kind !== "pass") { const fresh = await entitlement(S.hash); if (fresh.source === "server") { S.ent = fresh; renderEntitlement(); } }
  renderInvite($("invite-report"), result.report.overall_score);
  if (S.ent.kind !== "pass" && passCtx.passesOn) {
    const left = Math.round((S.ent.secondsLeft || 0) / 60);
    offerReport(left > 0 ? `You have ${left} free minute${left === 1 ? "" : "s"} left.` : "Your free minutes are used up.", result.report, "report");
  } else hideOffer("report-offer");
  track("mock_report", { score: result.report.overall_score, questions: (result.report.questions || []).length, model: result.model });
}

/* One question answered again (redrill.js): judged against the old answer, saved to the account with history
 * on, and handed to the page as prep:redrill. A page that draws it calls preventDefault(); otherwise a plain
 * card is shown so the flow never ends on an empty screen. */
async function writeRedrill(turns, elapsed) {
  const reportStarted = performance.now();
  diagnosticEvent('report_start', { stage: 'redrill' });
  const source = redrill.source;
  redrill = null;
  show("s-report");
  $("report").innerHTML = ""; $("report-wait").style.display = "block";
  waitWheel.start(); waitWheel.setState("thinking");
  let out;
  try {
    out = await compareAnswers({ apiKey: S.key, source, transcript: turns, language: source.language || S.language });
  } catch (err) {
    diagnosticEvent('report_failed', { stage: 'redrill', error: errorClass(err), duration_ms: Math.round(performance.now() - reportStarted) });
    void flushDiagnostics();
    track("mock_fail_redrill", { message: String(err && err.message || "").slice(0, 90) });
    waitWheel.stop(); $("report-wait").style.display = "none";
    $("report").innerHTML = `<div class="card"><h2 style="font-size:28px">Your new answer could not be judged</h2><p class="muted">${escapeHtml(err.message)}</p><p class="muted">Try again in a minute.</p></div>`;
    window.__lastReport = { turns, elapsed };
    return;
  }
  waitWheel.stop(); $("report-wait").style.display = "none";
  diagnosticEvent('report_ready', { stage: 'redrill', model: out.model, duration_ms: Math.round(performance.now() - reportStarted) });
  void flushDiagnostics();
  const item = redrillItem({ id: "rd-" + crypto.randomUUID(), at: new Date().toISOString(), source, transcript: turns, model: out.model, result: out.result, elapsed });
  window.__lastRedrill = item;
  window.__lastReport = { at: item.at, turns };                 // Download gives the new transcript
  track("mock_redrill_done", { before: item.summary.score_before, after: item.summary.score_after });
  const drawn = !window.dispatchEvent(new CustomEvent("prep:redrill", { cancelable: true, detail: { item } }));
  if (!drawn) {
    const r = item.summary, li = (arr) => (arr || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    $("report").innerHTML = `<div class="card"><span class="label">Answered again</span><h3>${escapeHtml(r.question)}</h3>
      <p><b>Before:</b> ${r.score_before ?? "?"} / 10 · <b>Now:</b> ${r.score_after ?? "?"} / 10</p><p class="verdict">${escapeHtml(r.verdict)}</p>
      <p class="said">Last time: ${escapeHtml(source.before.text || source.before.gist)}</p><p class="said">This time: ${escapeHtml(item.body.after.text)}</p>
      ${r.improved.length ? `<span class="label">Better</span><ul class="clean">${li(r.improved)}</ul>` : ""}
      ${r.still_missing.length ? `<span class="label">Still missing</span><ul class="clean bad">${li(r.still_missing)}</ul>` : ""}</div>`;
  }
  saveItem(item).catch(() => {});
}

/* The report, as a dashboard (report-view.js). progress-view.js adds its tools after prep:report-rendered. */
function renderReport(r) {
  $("s-report").insertBefore($("report-offer"), $("invite-report"));
  $("report").innerHTML = reportHtml(r);
  wireReport($("report").querySelector(".rd"));
  window.dispatchEvent(new CustomEvent("prep:report-rendered", { detail: { record: r, locked: false } }));
  paintReportPass();
}

/* A pass was just bought (or found): a demo report saved locked before 1 Oct 2026 opens in full and joins the
 * account's history. The payment page reloads the app, so the report is read back from storage. */
function unlockSavedReport() {
  let r = window.__lastReport;
  if (!r || !r.report) { try { r = JSON.parse(store.get("ps_last_report", "null")); } catch (_) { r = null; } }
  if (!r || !r.report || !r.locked) return;
  r.locked = false;
  window.__lastReport = r;
  saveHistory(r);
  renderReport(r);
  hideOffer("report-offer");
  const btn = $("see-full-report");
  if (btn) { btn.style.display = "inline-flex"; btn.onclick = () => { track("mock_unlock_view", {}); show("s-report"); window.scrollTo(0, 0); }; }
}

/* This browser keeps the latest full report and a short list of summaries (history.js); the account keeps
 * every report once the person has switched history on. A locked demo report goes to the account only
 * after a pass unlocks it (unlockSavedReport). */
function saveHistory(record) {
  // Reports from before 29 Sep 2026 have no id: the same one history.js gives them when importing.
  if (!record.id) record.id = `iv-l-${String(record.at).replace(/[^0-9TZ]/g, "")}`;
  try { store.set("ps_last_report", JSON.stringify(record)); } catch (_) { /* storage full or off */ }
  return saveInterview(record).then((r) => r.state).catch(() => "retry");
}

/* A finished report, for the progress screens: prep:report carries the record (with .changes, the badges)
 * and, once known, where its save stands (history.js statusOf / HISTORY_EVENTS give live updates). A pass
 * holder's month analysis is brought up to date in the background afterwards. */
function announceReport(record) {
  window.dispatchEvent(new CustomEvent("prep:report", { detail: { record } }));
  if (S.ent && S.ent.kind === "pass" && S.key && !record.demo) {
    refreshAnalyses({ apiKey: S.key, language: S.language }).catch((err) => log("analysis_failed", { message: String(err && err.message || err) }));
  }
}

const currentPeriod = () => { const p = knownPeriods().find((x) => x.current); return p ? { start: p.start, end: p.end, ...("from" in p ? { from: p.from } : {}) } : null; };

$("again").onclick = () => { ending = false; redrill = null; preLive(); };
$("download").onclick = () => {
  const r = window.__lastReport;
  if (!r) return;
  const lines = [`Prep Sarthi report, ${new Date(r.at || Date.now()).toLocaleString()}`, ""];
  if (r.report) {
    lines.push(`Practice score: ${r.report.overall_score === null ? "Not enough evidence" : `${r.report.overall_score}/100`}`, r.report.verdict, "", assessmentText(r.report), "", "What worked:", ...(r.report.strengths || []).map((x) => "- " + x), "", "What hurt:", ...(r.report.weaknesses || []).map((x) => "- " + x), "");
    for (const q of r.report.questions || []) lines.push(`Q: ${q.question}`, `  Score ${q.score}/10. You said: ${q.answer_gist}`, `  Missing: ${q.what_was_missing}`, `  Stronger: ${q.better_answer}`, "");
    lines.push("Practise next:", ...(r.report.practice_next || []).map((x, i) => `${i + 1}. ${x}`), "");
  }
  lines.push("Transcript:", ...(r.transcript || r.turns || []).map((u) => `${u.who === "interviewer" ? "Interviewer" : "You"}: ${u.text}`));
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "prep-sarthi-report.txt"; a.click();
};

$("copydiag").onclick = async () => {
  const text = [`Prep Sarthi diagnostics ${new Date().toISOString()}`, navigator.userAgent, `page ${location.host}${location.pathname}`, "", ...logLines].join("\n");
  try { await navigator.clipboard.writeText(text); $("copydiag-note").textContent = "Copied. Paste it in an email or chat."; }
  catch (_) {
    const area = document.createElement("textarea"); area.value = text; area.style.cssText = "width:100%;height:160px;margin-top:10px";
    $("copydiag").parentElement.appendChild(area); area.select();
    $("copydiag-note").textContent = "Select all and copy.";
  }
};

$("live-offer-go").onclick = () => { track("mock_offer_click", { where: "interview" }); openPasses(); };
$("report-offer-go").onclick = () => { track("mock_offer_click", { where: "report" }); openPasses("", { plan: "m" }); };

/* ApplySarthi's "Practise this interview" arrives as ?from=applysarthi&job=source:id, and the Windows app's
 * try-it guide as ?from=livesarthi. The job's public listing is
 * read from ApplySarthi and put in the JD box, so the mock interview is for that exact role. Only the public
 * job crosses over, never anything from the person's ApplySarthi account. The address is cleaned afterwards. */
const APPLY_API = "https://apply.interviewsarthi.com";
function showApplyWelcome(text) {
  let el = document.getElementById("apply-welcome");
  if (!el) {
    const lede = document.querySelector("#s-cv .lede"); if (!lede) return;
    el = document.createElement("div"); el.id = "apply-welcome"; el.className = "notice ok";
    el.style.cssText = "margin:12px 0 0;padding:10px 14px;border:1px solid currentColor;border-radius:10px;font-weight:500";
    lede.after(el);
  }
  el.textContent = text;
}
/* The ATS resume checker on this site hands over the CV it just read and the job or role it was checked
 * against, so its "Practise this interview" needs no second upload. Same site and this tab only
 * (sessionStorage); read once, then deleted. Nothing leaves the device until the person presses Start, exactly
 * as with a CV they paste here themselves. */
const ATS_HANDOFF = "sarthi_ats_handoff";
function takeAtsHandoff() {
  let h = null;
  try { h = JSON.parse(sessionStorage.getItem(ATS_HANDOFF) || "null"); sessionStorage.removeItem(ATS_HANDOFF); }
  catch (_) { h = null; }
  if (!h || typeof h.cv !== "string" || h.cv.trim().length < 80 || !(Date.now() - Number(h.at || 0) < 30 * 60 * 1000)) return false;
  $("cv").value = h.cv.slice(0, 30000);
  const jd = typeof h.jd === "string" ? h.jd.trim() : "", role = typeof h.role === "string" ? h.role.trim() : "";
  $("jd").value = jd.slice(0, 12000);
  if (!jd && role) { $("practice-focus").value = "role"; $("target-role").value = role.slice(0, 150); }
  if (!$("name").value) $("name").value = guessName(h.cv);
  updateNoJdOptions();
  showApplyWelcome(jd ? "Your CV and the job came from the ATS checker. Check them, then start your free mock interview."
    : role ? `Your CV came from the ATS checker, set up to practise for ${role}. Check it, then start your free mock interview.`
    : "Your CV came from the ATS checker. Check it, then start your free mock interview.");
  track("mock_from_ats", { target: jd ? "jd" : role ? "role" : "cv" });
  try { if (location.search) history.replaceState(null, "", location.pathname + location.hash); } catch (_) { /* cosmetic */ }
  return true;
}

async function loadJobFromApply() {
  const q = new URLSearchParams(location.search);
  const job = q.get("job") || "", fromApply = q.get("from") === "applysarthi", fromLive = q.get("from") === "livesarthi";
  if (q.has("job") || q.has("from")) {
    const clean = new URL(location.href); clean.searchParams.delete("job"); clean.searchParams.delete("from");
    history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
  }
  if (fromApply) showApplyWelcome("Welcome from ApplySarthi. Your free 7-minute mock interview is ready.");
  // The Windows app's try-it guide sends new users here to test it on one PC (26 Sep 2026): Prep's interviewer
  // asks, Interview Sarthi hears her through the PC's sound and shows answers. The CV screen already says so
  // (showLiveTestIntro); only a CV is needed, so the role questions are skipped unless a role was filled in before.
  // GA4 counted these arrivals as mock_from_live until 3 Oct 2026.
  if (fromLive) track("livetest_open", {});
  if (liveTest && !$("target-role").value.trim() && !$("jd").value.trim()) { $("practice-focus").value = "general_cv"; updateNoJdOptions(); }
  const i = job.indexOf(":");
  if (i <= 0) return;
  try {
    const res = await fetch(`${APPLY_API}/api/jd?source=${encodeURIComponent(job.slice(0, i))}&source_id=${encodeURIComponent(job.slice(i + 1))}`, { cache: "no-store" });
    if (!res.ok) return;
    const j = await res.json();
    if (!j.text) return;
    const title = String(j.title || "").trim(), company = String(j.company || "").trim();
    const head = [title, company && `at ${company}`, j.location && `(${j.location})`].filter(Boolean).join(" ");
    $("jd").value = `${head}\n\n${j.text}`; store.set("ps_jd", $("jd").value);
    updateNoJdOptions();
    notice("jd-notice", `Loaded from ApplySarthi: ${title || "your job"}${company ? " at " + company : ""}. Your interviewer will ask about this job.`, "ok");
    track("apply_job_loaded", {});
  } catch (_) { /* the box stays as it was; the JD can still be pasted by hand */ }
}

/* What the progress screens can ask of this page. Everything else they need is in history.js (saved
 * interviews, settings, delete, export), progress.js (the numbers) and insights.js (the month analysis). */
async function startRedrill(interviewId, questionIndex) {
  if (!S.ent || S.ent.kind !== "pass") throw new Error("Answering a question again needs a pass.");
  if (["call", "preparing"].includes(phase)) throw new Error("An interview is running.");
  const record = await getInterview(interviewId);
  const source = record && redrillSource(record, Number(questionIndex));
  if (!source) throw new Error("That question could not be found in the saved interview.");
  redrill = { source };
  track("mock_redrill_open", {});
  if (!S.key) { showKeyStep(); return source; }         // the key screen's check leads on to preLive
  preLive();
  return source;
}
async function openInterview(id) {
  const r = await getInterview(id);
  if (!r || !r.report) throw new Error("That interview could not be found.");
  window.__lastReport = r;
  $("report-wait").style.display = "none";
  hideOffer("report-offer");
  renderReport(r);
  show("s-report");
  return r;
}
window.prepApp = {
  startRedrill, openInterview,
  navigate(id) {
    if (!["s-progress", "s-comparison", "s-cv"].includes(id)) return;
    if (["call", "preparing"].includes(phase) || ending && $("report-wait").style.display !== "none") {
      throw new Error("Finish your interview and wait for its report before opening progress.");
    }
    if (id === "s-cv") { redrill = null; ending = false; }
    show(id);
  },
  openPasses: () => openPasses(),
  cancelRedrill() { redrill = null; },
  /** Who is here and what they own, for deciding what the progress screens show. */
  state: () => ({
    signedIn: !!(S.ent && S.ent.account), account: (S.ent && S.ent.account) || null,
    pass: !!(S.ent && S.ent.kind === "pass"), expiresAt: (S.ent && S.ent.expiresAt) || null,
    hasKey: !!S.key, language: S.language, name: S.name, phase, redrill: redrill ? redrill.source : null,
  }),
  /** Bring the saved month analyses up to date now (force: even if the saved one is recent). */
  refreshAnalyses: (o = {}) => refreshAnalyses({ apiKey: S.key, language: S.language, ...o }),
  events: HISTORY_EVENTS,
};

window.addEventListener("pagehide", () => {
  // Leaving while the interview is being prepared, or in the middle of it, is the drop-off to watch.
  if (phase === "preparing") track("mock_abandon_preparing", { demo: !!demo });
  else if (live && !ending) track("mock_abandon_call", { demo: !!demo, seconds: Math.round(live.activeSeconds || 0) });
  startController?.abort(); if (live) live.close();
});
rememberInvite();
rememberSource();
const booting = restore().then(() => { if (!takeAtsHandoff()) return loadJobFromApply(); })
  .then(() => initPasses(passCtx)).then(renderEntitlement);
let bootDone = false;
booting.then(() => { bootDone = true; }, () => {});
// Saves that could not reach the server last time, and any weekly or end-of-pass review now due.
booting.then(() => {
  flushOutbox().catch(() => {});
  if (S.ent && S.ent.kind === "pass" && S.key) refreshAnalyses({ apiKey: S.key, language: S.language }).catch(() => {});
  window.dispatchEvent(new CustomEvent("prep:ready"));
});
