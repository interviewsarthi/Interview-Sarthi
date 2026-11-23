/* Live Sarthi on the phone: the screens. */

import { loadSetup, saveSetup, deviceId, reasonText, LOCAL, post } from "./api.js?v=20261123-phone";
import { readCvFile, readCvText, checkKey } from "./cv.js?v=20261123-phone";
import { Mic } from "./mic.js?v=20261123-phone";
import { PhoneLive } from "./engine.js?v=20261123-phone";
import { answerHtml, partialView, esc } from "./protocol.js?v=20261123-phone";

const $ = (id) => document.getElementById(id);
const SCREENS = ["s-gate", "s-start", "s-key", "s-gemini", "s-cv", "s-ready", "s-live", "s-ended"];
function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; document.body.classList.toggle("interview", id === "s-live"); if (id !== "s-live") document.documentElement.classList.remove("light"); else setTheme(!!loadSetup().light); window.scrollTo(0, 0); }
function notice(id, text, kind = "") { const el = $(id); el.hidden = !text; el.textContent = text || ""; el.className = "notice" + (kind ? " " + kind : ""); }
const track = (name, data = {}) => { try { if (window.gtag) window.gtag("event", name, data); } catch (_) { /* no analytics */ } };

// ── phones and tablets only ──────────────────────────────────────────────────────────────────────────────────────
function isPhoneOrTablet() {
  const ua = navigator.userAgent || "";
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;   // an iPad asking for the desktop site
}

const S = { live: null, mic: null, wake: null, allowance: null, tick: null, prevKeyScreen: "s-start" };

// ── setup ────────────────────────────────────────────────────────────────────────────────────────────────────────
$("go-trial").onclick = () => { saveSetup({ trial: true }); S.prevKeyScreen = "s-start"; showGemini(); track("liveweb_trial_pick"); };
$("go-pass").onclick = () => { $("lic").value = loadSetup().licenseKey || ""; show("s-key"); $("lic").focus(); };
for (const b of document.querySelectorAll("[data-back]")) b.onclick = () => show(b.dataset.back);
$("gem-back").onclick = () => show(S.prevKeyScreen);

$("lic-next").onclick = () => {
  const key = $("lic").value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^IS-[A-Z0-9-]{8,}$/.test(key)) return notice("lic-notice", "That doesn't look like a pass key. It starts with IS- and is in your email.", "bad");
  notice("lic-notice", "");
  saveSetup({ licenseKey: key, trial: false });
  S.prevKeyScreen = "s-key";
  showGemini();
};

function showGemini() { $("gem").value = loadSetup().geminiKey || ""; show("s-gemini"); }

$("gem-next").onclick = async () => {
  const key = $("gem").value.trim();
  if (!key) return notice("gem-notice", "Paste the key first.", "bad");
  $("gem-next").disabled = true; notice("gem-notice", "Checking with Google…");
  const r = await checkKey(key);
  $("gem-next").disabled = false;
  if (r === "bad") return notice("gem-notice", "Google says this key isn't valid. Copy it again from Google AI Studio.", "bad");
  if (r === "blocked") return notice("gem-notice", "This key exists but isn't allowed to use Gemini. Make a new key in Google AI Studio.", "bad");
  if (r === "offline") return notice("gem-notice", "Couldn't reach Google. Check your internet and try again.", "bad");
  saveSetup({ geminiKey: key });
  notice("gem-notice", "");
  track("liveweb_key_ok");
  showCv();
};

function showCv() {
  const s = loadSetup();
  fillStyle(s);
  $("cv-done").hidden = !s.cv;
  if (s.cv) $("cv-okline").textContent = `✓ Resume read${s.cvName ? ": " + s.cvName : ""}. Choose again to replace it.`;
  notice("cv-notice", "");
  show("s-cv");
}

function fillStyle(s) {
  $("nm").value = s.name || ""; $("lvl").value = s.level || ""; $("len").value = s.length; $("eng").value = s.english;
  $("lang").value = s.language; $("code").value = s.code; $("jd").value = s.jd || ""; $("stories").value = s.stories || "";
  $("pay-cur").value = s.pay.current_ctc || ""; $("pay-exp").value = s.pay.expected_ctc || ""; $("pay-not").value = s.pay.notice || ""; $("pay-off").value = s.pay.offers || "";
}

const CV_ERRORS = {
  cv_too_big: "That file is over 8 MB. Use a smaller PDF, or paste the text.",
  cv_type: "Use a PDF, a photo of your resume, or a text file. Or paste the text.",
  cv_unreadable: "Couldn't read any text in that file. Try a clearer photo, or paste the text.",
  cv_short: "That's too short for a resume. Paste the whole thing.",
};

async function useCv(result, label) {
  const s = saveSetup({ cv: result.text, cvName: label, name: loadSetup().name || result.name, field: result.field,
    level: loadSetup().level || result.level, terms: result.terms });
  fillStyle(s);
  $("cv-okline").textContent = `✓ Resume read${label ? ": " + label : ""}.`;
  $("cv-done").hidden = false;
  notice("cv-notice", "");
  track("liveweb_cv_ok");
}

$("cv-file").onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  notice("cv-notice", "Reading your resume…");
  try { await useCv(await readCvFile(file, loadSetup().geminiKey), file.name); }
  catch (err) { notice("cv-notice", CV_ERRORS[err.reason] || reasonText(err.reason), "bad"); }
};
$("cv-paste-go").onclick = async () => {
  notice("cv-notice", "Reading your resume…");
  try { await useCv(await readCvText($("cv-paste").value, loadSetup().geminiKey), "pasted text"); }
  catch (err) { notice("cv-notice", CV_ERRORS[err.reason] || reasonText(err.reason), "bad"); }
};

$("cv-save").onclick = () => {
  const name = $("nm").value.trim();
  if (!name) { $("nm").focus(); return notice("cv-notice", "Add your name: answers are spoken as you.", "bad"); }
  saveSetup({ name, level: $("lvl").value, length: $("len").value, english: $("eng").value, language: $("lang").value, code: $("code").value,
    jd: $("jd").value.trim(), stories: $("stories").value.trim(),
    pay: { current_ctc: $("pay-cur").value.trim(), expected_ctc: $("pay-exp").value.trim(), notice: $("pay-not").value.trim(), offers: $("pay-off").value.trim() } });
  showReady();
};

$("edit-setup").onclick = () => { const s = loadSetup(); S.prevKeyScreen = s.trial ? "s-start" : "s-key"; s.trial ? showGemini() : show("s-start"); };

// ── ready ────────────────────────────────────────────────────────────────────────────────────────────────────────
function setupComplete(s) { return !!(s.geminiKey && s.cv && s.name && (s.trial || s.licenseKey)); }

function showReady() {
  const s = loadSetup();
  $("allow").textContent = s.trial ? "Free: 20 minutes on this phone." : `Pass ${s.licenseKey.slice(0, 7)}… ready.`;
  $("buy-link").hidden = !s.trial;
  notice("start-notice", "");
  show("s-ready");
}

$("start").onclick = async () => {
  LOG.length = 0; logSent = 0;
  const s = loadSetup();
  $("start").disabled = true;
  notice("start-notice", "Starting…");
  S.mic = new Mic({ cleanup: !!s.micCleanup });
  try { await S.mic.start(); }
  catch (_) { $("start").disabled = false; return notice("start-notice", "Allow the microphone for this page: your browser asks once. In settings, look for Microphone under this site.", "bad"); }
  await keepAwake();
  S.live = new PhoneLive({ setup: loadSetup, device: deviceId(), onCards: renderCards, onHeard: (t) => { $("hearing").textContent = t ? "Hearing: " + t.slice(-140) : ""; },
    onStatus: setState, onAllowance: setAllowance, onEnd: ended, onEvent: logEvent });
  S.mic.onChunk = (pcm, rms) => { if (S.live) S.live.sendAudio(pcm, rms); level(rms); };
  S.mic.onState = (st) => { logEvent("mic", { state: st }); if (st === "ended") askResume(); };
  const r = await S.live.start();
  $("start").disabled = false;
  if (!r.ok) {
    await stopAll();
    if (r.reason === "trial_over") { $("buy-link").hidden = false; }
    return notice("start-notice", reasonText(r.reason), "bad");
  }
  notice("start-notice", "");
  S.logTimer = setInterval(() => flushLog(S.live), 30000);
  renderCards([]);
  show("s-live");
  track("liveweb_start", { kind: r.kind });
};

// ── listening ────────────────────────────────────────────────────────────────────────────────────────────────────
function setState(st) {
  $("dot").className = "dot " + (st === "live" ? "on" : st === "ended" ? "" : "wait");
  $("state").textContent = st === "ended" ? "Stopped" : "Listening";
}

function setAllowance(a) {
  S.allowance = { ...(S.allowance || {}), ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== null)) };
  clearInterval(S.tick);
  const paint = () => {
    const al = S.allowance || {};
    if (al.free_seconds_left !== undefined && al.free_seconds_left !== null && (al.kind === "trial" || !al.expires_at)) {
      const left = Math.max(0, Math.round(al.free_seconds_left - (Date.now() - al.at) / 1000));
      $("left").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} free left`;
    } else if (al.expires_at) {
      const d = new Date(al.expires_at);
      $("left").textContent = "Pass until " + d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    }
  };
  paint(); S.tick = setInterval(paint, 1000);
}

let levelSmooth = 0;
function level(rms) { levelSmooth = levelSmooth * 0.7 + Math.min(1, rms * 12) * 0.3; $("level").style.width = Math.round(levelSmooth * 100) + "%"; }

// ── text size: one button cycles through four sizes; the menu nudges ─────────────────────────────────────────────
const SIZES = [20, 24, 28, 32];
function setSize(px) {
  const s = saveSetup({ textSize: Math.max(16, Math.min(36, px)) });
  document.documentElement.style.setProperty("--answer-size", s.textSize + "px");
  scrollHint();
}
$("size").onclick = () => { const cur = loadSetup().textSize || 24; setSize(SIZES.find((x) => x > cur) || SIZES[0]); };
$("smaller").onclick = () => setSize((loadSetup().textSize || 24) - 2);
$("bigger").onclick = () => setSize((loadSetup().textSize || 24) + 2);
setSize(loadSetup().textSize || 24);

// ── light screen for a bright room ───────────────────────────────────────────────────────────────────────────────
function setTheme(light) {
  document.documentElement.classList.toggle("light", !!light);
  $("theme-btn").textContent = light ? "Dark screen (less glare)" : "Light screen (for a bright room)";
  saveSetup({ light: !!light });
}
$("theme-btn").onclick = () => { setTheme(!loadSetup().light); closeSheets(); };

// ── sheets ───────────────────────────────────────────────────────────────────────────────────────────────────────
function openSheet(id) { closeSheets(); $(id).hidden = false; }
function closeSheets() { for (const id of ["sheet-earlier", "sheet-menu", "sheet-stop"]) $(id).hidden = true; }
for (const sh of document.querySelectorAll(".sheet")) sh.addEventListener("click", (e) => { if (e.target === sh || e.target.closest("[data-close]")) closeSheets(); });
$("menu").onclick = () => openSheet("sheet-menu");
$("stop").onclick = () => openSheet("sheet-stop");
$("stop-yes").onclick = async () => { closeSheets(); await stopAll(); ended("stopped"); };

// ── the answer on screen: only the newest, big; earlier ones behind a button ─────────────────────────────────────
const LANG_LABEL = { cpp: "C++", javascript: "JS", sql: "SQL", python: "Python", java: "Java" };
function viewOf(c) {
  const v = c.view || partialView(c.text);
  return { words: c.view ? c.view.answer : v.text, madeUp: c.view ? c.view.madeUp : v.madeUp, claims: c.view ? c.view.claims : v.claims };
}
/* The bold phrases, as glanceable talking points. */
function keyPoints(words) {
  const out = [];
  for (const m of String(words || "").matchAll(/\*\*([^*\n]{2,60})\*\*/g)) { const t = m[1].trim(); if (t && !out.includes(t)) out.push(t); }
  return out.slice(0, 5);
}
/* The opening (the gist, at least 8 words up to a sentence end) a little bigger, the rest as it is. */
function answerBody(words, claims) {
  const t = String(words || "");
  const re = /[.!?](?=\s+[A-Z"'(]|\s*$)/g;
  let m, cut = -1;
  while ((m = re.exec(t))) {
    const head = t.slice(0, m.index + 1);
    if (head.split(/\s+/).length >= 8) { cut = m.index + 1; break; }
    if (m.index > 320) break;
  }
  if (cut < 0 || (t.slice(0, cut).match(/\*\*/g) || []).length % 2) return answerHtml(t, claims);
  return `<span class="gist">${answerHtml(t.slice(0, cut), claims)}</span>${answerHtml(t.slice(cut).trimStart(), claims)}`;
}
let shownId = null;
function renderCards(cards) {
  S.cards = cards;
  const c = cards[0];
  $("waiting").hidden = !!c;
  $("earlier-btn").hidden = cards.length < 2;
  $("earlier-btn").textContent = `Earlier answers (${cards.length - 1})`;
  if (!c) { $("cards").innerHTML = ""; shownId = null; scrollHint(); return; }
  const streaming = c.state === "streaming" || c.state === "continuing";
  const { words, madeUp, claims } = viewOf(c);
  const points = keyPoints(words);
  let body = `<p class="q">${esc(c.question ? c.question.slice(-220) : "")}</p>`;
  if (points.length) body += `<div class="points">${points.map((p) => `<span>${esc(p)}</span>`).join("")}</div>`;
  if (madeUp) body += `<span class="tag">Made-up example</span>`;
  body += `<p class="answer${streaming ? " cursor" : ""}">${answerBody(words, claims)}</p>`;
  if (c.code) body += `<pre>${esc(c.code)}</pre>` + (c.codeExplain ? `<p class="explain">${esc(c.codeExplain)}</p>` : "")
    + `<div class="langs">${Object.keys(LANG_LABEL).map((l) => `<button data-card="${c.id}" data-lang="${l}">${LANG_LABEL[l]}</button>`).join("")}</div>`;
  else if (c.codeState === "writing") body += `<p class="more">Writing the code…</p>`;
  const fresh = shownId !== c.id;
  $("cards").innerHTML = `<article class="${fresh ? "focus" : "focus still"}">${body}</article>`;
  if (fresh) { shownId = c.id; window.scrollTo({ top: 0 }); }
  scrollHint();
}
/* A long answer: tap the lower half to move down a screen, the upper half to move back. */
function scrollHint() {
  const long = document.documentElement.scrollHeight > window.innerHeight + 40 && !$("s-live").hidden;
  $("scroll-hint").hidden = !long || window.scrollY > 40;
}
window.addEventListener("scroll", scrollHint, { passive: true });
$("cards").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-lang]");
  if (b) { if (S.live) S.live.recode(b.dataset.card, b.dataset.lang); return; }
  const page = window.innerHeight * 0.7;
  window.scrollBy({ top: e.clientY > window.innerHeight / 2 ? page : -page, behavior: "smooth" });
});
$("scroll-hint").onclick = () => window.scrollBy({ top: window.innerHeight * 0.7, behavior: "smooth" });
function earlierHtml(list) {
  return list.map((c) => { const { words } = viewOf(c); return `<button class="sheet-item" data-id="${c.id}"><small>${esc((c.question || "").slice(-120))}</small>${esc(String(words || "").replace(/\*\*/g, "").slice(0, 140))}…</button>`; }).join("");
}
$("earlier-btn").onclick = () => {
  $("earlier-list").innerHTML = `<h3>Earlier answers</h3>${earlierHtml((S.cards || []).slice(1))}<button class="btn" data-close>Close</button>`;
  openSheet("sheet-earlier");
};
$("earlier-list").addEventListener("click", (e) => {
  const b = e.target.closest(".sheet-item[data-id]");
  if (!b || !S.cards) return;
  const i = S.cards.findIndex((c) => c.id === b.dataset.id);
  if (i > 0) { const [c] = S.cards.splice(i, 1); S.cards.unshift(c); renderCards(S.cards); }
  closeSheets();
});

// photo of the question
$("snap").onclick = () => $("snap-file").click();
$("snap-file").onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file || !S.live) return;
  try { await S.live.snap(await jpegBase64(file, 1280, 0.72)); } catch (_) { logEvent("snap_failed", {}); }
};
async function jpegBase64(file, maxW, quality) {
  const bmp = await createImageBitmap(file).catch(() => null);
  const img = bmp || await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, maxW / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality).split(",")[1];
}

async function stopAll() {
  const live = S.live; S.live = null;
  clearInterval(S.logTimer);
  if (live) { await flushLog(live); await live.stop(); await flushLog(live); }
  if (S.mic) { await S.mic.stop(); S.mic = null; }
  clearInterval(S.tick);
  releaseWake();
}

function ended(reason) {
  stopAll();
  const free = reason === "trial_over";
  $("end-title").textContent = free ? "Your free minutes are up" : reason === "stopped" ? "Interview ended" : "Listening stopped";
  $("end-text").textContent = reason === "stopped" ? "Good luck! Your answers from this interview are below until you leave this page." : reasonText(reason);
  $("end-buy").hidden = !(free || reason === "pass_ended");
  $("end-list").innerHTML = (S.cards || []).length ? `<h3>Answers from this interview</h3>${earlierHtml(S.cards)}` : "";
  show("s-ended");
  track("liveweb_end", { reason });
}
$("end-again").onclick = () => showReady();

// ── keeping the phone listening ──────────────────────────────────────────────────────────────────────────────────
async function keepAwake() {
  try { if ("wakeLock" in navigator) { S.wake = await navigator.wakeLock.request("screen"); S.wake.addEventListener("release", () => logEvent("wake_released", {})); } }
  catch (_) { logEvent("wake_failed", {}); }
}
function releaseWake() { try { if (S.wake) S.wake.release(); } catch (_) { /* gone */ } S.wake = null; }

document.addEventListener("visibilitychange", async () => {
  if (!S.live) return;
  logEvent("visibility", { state: document.visibilityState });
  if (document.visibilityState !== "visible") return;
  await keepAwake();
  const ok = S.mic && await S.mic.revive().catch(() => false);
  if (!ok) askResume();
});
function askResume() { if (S.live) $("tap-resume").hidden = false; }
$("resume").onclick = async () => {
  const ok = S.mic && await S.mic.revive().catch(() => false);
  if (ok) { $("tap-resume").hidden = true; await keepAwake(); }
};

// ── event log ──────────────────────────────────────────────────────────────────────────────────────────────────────
const LOG = [];
function logEvent(name, data) {
  LOG.push({ t: Math.round(performance.now()), name, ...data });
  if (LOG.length > 500) LOG.shift();
  if (LOCAL) console.debug("[live]", name, data);
}
window.__liveLog = LOG;
let logSent = 0;
async function flushLog(live) {
  if (!live || !live.session || logSent >= LOG.length) return;
  const batch = LOG.slice(logSent, logSent + 100);
  const r = await post("/live/web/log", { session_id: live.session.id, session_token: live.session.token, events: batch }, { timeout: 10000 });
  if (r.ok) logSent += batch.length;
}

// ── first screen ─────────────────────────────────────────────────────────────────────────────────────────────────
(function boot() {
  if (!isPhoneOrTablet()) { show("s-gate"); track("liveweb_gate"); return; }
  const s = loadSetup();
  if (setupComplete(s)) return showReady();
  show("s-start");
  track("liveweb_open");
})();
