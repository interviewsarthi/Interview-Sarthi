/* Live Sarthi on the phone: the listening engine. */

import { API, post, promptBody } from "./api.js?v=20261123-login";
import { stripAnswerPrefix, parseAnswer, looksCutShort, wantsCode, parseCode } from "./protocol.js?v=20261128-tag";

const TOKEN_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=";
const MODELS = ["gemini-3.8-live", "gemini-3.1-flash-live-preview"];
const SETTLE_S = 3;
const STALL_S = 15;
const DEAF_S = 25;
const SETUP_S = 12;
const BACKLOG_BLOCKS = 100;
const VOICED = 0.006;
const MAX_CARDS = 12;
const MEMORY_MAX = 60;
const EARLY_WORDS = 8;
const EARLY_MAX_WORDS = 25;
const REPEAT_WINDOW_MS = 25000;
const QUESTION_CUE = /\?|\b(how|why|what|which|when|where|who|explain|elaborate|example|detail|more|again|repeat|sure|really|mean|tell)\b/i;

const now = () => performance.now() / 1000;
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

export class PhoneLive {
  /**
   * @param {object} o
   * @param {() => object} o.setup      the saved setup (api.loadSetup)
   * @param {string} o.device
   * @param {(cards:object[]) => void} o.onCards
   * @param {(text:string) => void} [o.onHeard]
   * @param {(state:string) => void} [o.onStatus]   "starting" | "live" | "quiet-repair" | "ended"
   * @param {(info:object) => void} [o.onAllowance]  { kind, free_seconds_left, expires_at }
   * @param {(reason:string) => void} [o.onEnd]     the interview cannot go on (reason code for api.reasonText)
   * @param {(name:string, data:object) => void} [o.onEvent]
   */
  constructor(o) {
    Object.assign(this, { setupOf: o.setup, device: o.device, onCards: o.onCards, onHeard: o.onHeard || (() => {}), onHeardPiece: o.onHeardPiece || (() => {}),
      onStatus: o.onStatus || (() => {}), onAllowance: o.onAllowance || (() => {}), onEnd: o.onEnd || (() => {}),
      onEvent: o.onEvent || (() => {}) });
    this.cards = []; this.memory = []; this.heard = ""; this.turn = null;
    this.ws = null; this.connected = false; this.stopped = false; this.session = null; this.model = MODELS[0];
    this.backlog = []; this.lastServer = 0; this.lastVoiced = 0; this.lastOutput = 0; this.connectedAt = 0;
    this.attemptAt = null; this.goAway = false; this.failures = 0; this.modelSwitches = 0; this.timers = [];
    this.reconnecting = false; this.beatTimer = null;
  }

  // ── start / stop ─────────────────────────────────────────────────────────────────────────────────────────────
  async start() {
    this.onStatus("starting");
    const s = this.setupOf();
    const body = { ...promptBody(s), device: this.device, model: this.model };
    if (!s.trial && s.licenseKey) body.license_key = s.licenseKey;
    const r = await post("/live/web/start", body);
    if (!r.ok) { this.stopped = true; this.onStatus("ended"); return { ok: false, reason: r.error || "google" }; }
    this.session = { id: r.session_id, token: r.session_token };
    this.model = r.model || this.model;
    this.onAllowance({ kind: r.kind, free_seconds_left: r.free_seconds_left, expires_at: r.expires_at, at: Date.now() });
    this.watchdog = setInterval(() => this._check(), 1000);
    this.beatTimer = setInterval(() => this._beat(), (r.beat_seconds || 60) * 1000);
    this._connect(r.token);
    this._event("session_start", { kind: r.kind, model: this.model });
    return { ok: true, kind: r.kind };
  }

  async stop(reason = "stopped") {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.watchdog); clearInterval(this.beatTimer);
    for (const t of this.timers) clearTimeout(t);
    this._closeSocket();
    this.onStatus("ended");
    if (this.session) await post("/live/web/stop", { session_id: this.session.id, session_token: this.session.token }, { timeout: 8000 });
    this._event("session_end", { reason, cards: this.cards.length });
  }

  async _beat() {
    if (this.stopped || !this.session) return;
    const r = await post("/live/web/beat", { session_id: this.session.id, session_token: this.session.token }, { timeout: 15000 });
    if (r.status === 200 && r.ok === true) this.onAllowance({ free_seconds_left: r.free_seconds_left, expires_at: r.expires_at, at: Date.now() });
    if (r.status === 200 && r.ok === false) return this._end(r.reason || "session_ended");
    if (r.status === 410) return this._end("session_ended");
    if (r.status === 0) this._event("beat_failed", {});
  }

  _end(reason) { this._event("ended_by_server", { reason }); this.stop(reason); this.onEnd(reason); }

  // ── audio in ─────────────────────────────────────────────────────────────────────────────────────────────────
  sendAudio(pcm, rms) {
    if (this.stopped) return;
    const t = now();
    if (rms >= VOICED) this.lastVoiced = t;
    const msg = JSON.stringify({ realtimeInput: { audio: { data: b64(pcm), mimeType: "audio/pcm;rate=16000" } } });
    if (!this.connected || !this.ws || this.ws.readyState !== 1) {
      this.backlog.push(msg); if (this.backlog.length > BACKLOG_BLOCKS) this.backlog.shift();
      return;
    }
    if (this.ws.bufferedAmount > 256000) { this._event("audio_dropped", {}); return; }
    try { this.ws.send(msg); } catch (_) { this._repair("send_error"); }
  }

  // ── connection ───────────────────────────────────────────────────────────────────────────────────────────────
  _connect(token) {
    if (this.stopped) return;
    this.attemptAt = now(); this.connected = false; this.goAway = false;
    let ws;
    try { ws = new WebSocket(TOKEN_URL + encodeURIComponent(token)); } catch (_) { return this._repair("connect_error"); }
    this.ws = ws;
    ws.onopen = () => { if (this.ws === ws) ws.send(JSON.stringify({ setup: { model: `models/${this.model}` } })); };
    ws.onmessage = async (e) => {
      if (this.ws !== ws || this.stopped) return;
      const text = typeof e.data === "string" ? e.data : await (e.data.text ? e.data.text() : new Response(e.data).text());
      let m; try { m = JSON.parse(text); } catch (_) { return; }
      this._handle(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws || this.stopped) return;
      const reason = String(e.reason || "");
      this._event("socket_closed", { code: e.code, reason: reason.slice(0, 120), wasConnected: this.connected });
      this.connected = false;
      if (/quota|resource.exhausted|rate.limit/i.test(reason)) return this._end("gemini_quota");
      if (/model.*(not found|not supported|unavailable)|not found.*model/i.test(reason)) this._switchModel("model_unavailable");
      this._repair(e.code === 1011 ? "google_dropped" : "closed");
    };
  }

  _closeSocket() {
    const ws = this.ws; this.ws = null; this.connected = false;
    if (ws) { try { ws.close(); } catch (_) { /* gone */ } }
  }

  _switchModel(why) {
    if (this.modelSwitches >= 2) return false;
    this.modelSwitches++;
    this.model = MODELS[(MODELS.indexOf(this.model) + 1) % MODELS.length];
    this._event("model_fallback", { model: this.model, why });
    return true;
  }

  async _repair(why) {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    this._closeAnswerTurn("repair");
    this._closeSocket();
    this.onStatus("quiet-repair");
    this._event("reconnect", { why, attempt: this.failures + 1 });
    const wait = this.failures === 0 ? 0 : Math.min(8, 2 ** (this.failures - 1));
    this.failures++;
    if (this.failures >= 3 && why !== "planned") this._switchModel("unstable");
    await sleep(wait * 1000);
    if (this.stopped) { this.reconnecting = false; return; }
    const r = await post("/live/web/token", { ...promptBody(this.setupOf(), this.memory.slice(-MEMORY_MAX)), session_id: this.session.id, session_token: this.session.token, model: this.model });
    this.reconnecting = false;
    if (this.stopped) return;
    if (r.ok && r.token) { this.model = r.model || this.model; return this._connect(r.token); }
    if (["trial_over", "pass_ended", "gemini_key", "gemini_quota", "gemini_billing", "session_ended", "session"].includes(r.error)) return this._end(r.error === "session" ? "session_ended" : r.error);
    this._repair("token_failed");
  }

  _check() {
    if (this.stopped) return;
    const t = now();
    if (!this.connected) {
      if (this.attemptAt !== null && !this.reconnecting && t - this.attemptAt > SETUP_S) this._repair("setup_timeout");
      return;
    }
    const turn = this.turn;
    if (turn && turn.card && !turn.closed && t - this.lastOutput >= SETTLE_S && !looksCutShort(turn.card.text)) this._closeAnswerTurn("settled");
    else if (turn && turn.card && !turn.closed && t - this.lastOutput >= STALL_S) { this._closeAnswerTurn("stalled"); return this._repair("stall"); }
    if (t - this.connectedAt > 30 && t - this.lastVoiced < 8 && t - this.lastServer > DEAF_S) return this._repair("deaf");
    if (this.goAway && !(turn && turn.card && !turn.closed) && t - this.lastVoiced > 1.5) return this._repair("planned");
  }

  // ── what Google sends ────────────────────────────────────────────────────────────────────────────────────────
  _handle(m) {
    const t = now();
    this.lastServer = t;
    if (m.setupComplete !== undefined) {
      this.connected = true; this.attemptAt = null; this.connectedAt = t; this.failures = 0;
      this.onStatus("live");
      this._event("connected", { model: this.model });
      for (const msg of this.backlog.splice(0)) { try { this.ws.send(msg); } catch (_) { break; } }
      return;
    }
    if (m.goAway) {
      this.goAway = true;
      const left = parseFloat(m.goAway.timeLeft);
      this.timers.push(setTimeout(() => { if (this.goAway && !this.stopped) this._repair("deadline"); }, Math.max(0, (Number.isFinite(left) ? left - 3 : 1)) * 1000));
      this._event("go_away", {});
      return;
    }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.inputTranscription && sc.inputTranscription.text) {
      this.heard += sc.inputTranscription.text;
      if (this.heard.length > 1500) this.heard = this.heard.slice(-1500);
      this.onHeard(this.heard.trim());
      try { this.onHeardPiece(sc.inputTranscription.text); } catch (_) { /* UI */ }
    }
    if (sc.outputTranscription && sc.outputTranscription.text) this._said(sc.outputTranscription.text, t);
    if (sc.interrupted) this._closeAnswerTurn("interrupted");
    if (sc.turnComplete) {
      if (this.turn && !this.turn.closed) this._closeAnswerTurn("complete");
      this.turn = null;
      this.heard = "";
      if (this.pendingContext) { const text = this.pendingContext; this.pendingContext = ""; this._context(text, true); }
    }
  }

  _said(piece, t) {
    if (!this.turn) this.turn = { raw: "", card: null, closed: false, no: false, question: this.heard.trim() };
    const turn = this.turn;
    if (turn.closed || turn.no) return;
    turn.raw += piece;
    this.lastOutput = t;
    const visible = stripAnswerPrefix(turn.raw);
    if (visible === null) return;
    if (visible === "") { turn.no = true; this._event("no_answer", {}); return; }
    if (!turn.card) {
      const last = this.cards[0];
      if (last && !last.photo && Date.now() - last.started < REPEAT_WINDOW_MS && words(turn.question) < 4 && !QUESTION_CUE.test(turn.question)) {
        turn.no = true; this._event("repeat_dropped", { heard_words: words(turn.question) }); return;
      }
      turn.card = { id: Math.random().toString(36).slice(2), question: turn.question || "", text: "", started: Date.now(), state: "streaming" };
      this.cards.unshift(turn.card);
      if (this.cards.length > MAX_CARDS) this.cards.length = MAX_CARDS;
      this._event("answer_start", { heard_words: words(turn.question) });
    }
    const card = turn.card;
    if (card.early) return;
    card.text = visible;
    const n = words(visible);
    if ((n >= EARLY_WORDS && /[.!?।]["')*\]]*\s*$/.test(visible.trim())) || n >= EARLY_MAX_WORDS) {
      card.early = true;
      this._event("early_continue", { words: n });
      this._continue(card);
    }
    this._render();
  }

  _closeAnswerTurn(how) {
    const turn = this.turn;
    if (!turn || turn.closed) return;
    turn.closed = true;
    const card = turn.card;
    if (!card) return;
    if (card.early) { this._event("answer_end", { how, early: true }); return; }
    const cut = looksCutShort(card.text);
    this._event("answer_end", { how, words: words(card.text), cut });
    if (cut || how === "interrupted" || how === "stalled" || how === "repair") return this._continue(card);
    this._finish(card);
  }

  async _continue(card) {
    card.state = "continuing"; this._render();
    const s = this.setupOf();
    const body = { ...promptBody(s), session_id: this.session.id, session_token: this.session.token, kind: "continue",
      question: card.question || "(the interviewer's last question)", partial: card.text, earlier: this.memory.slice(-3).map((x) => x.a) };
    const base = card.text.trimEnd();
    const sentenceEnd = /[.!?।]["')*\]]*$/.test(base);
    const tidy = (raw) => {
      let rest = String(raw || "").replace(/^\s+/, "");
      const v = stripAnswerPrefix(rest);
      if (v === null) return "";
      rest = v;
      if (/^\W*D(O(N(E)?)?)?\W*$/i.test(rest.trim())) return "";   // "DONE" (or its start): nothing to add
      if (sentenceEnd) { rest = rest.replace(/^[.…\s]+/, ""); rest = rest.charAt(0).toUpperCase() + rest.slice(1); }
      return rest;
    };
    let raw = "", got = false;
    // streamed: the words are added below as they are written, nothing above them moves
    try {
      const ac = new AbortController();
      const first = setTimeout(() => ac.abort(), 12000);
      const r = await fetch(API + "/live/web/text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, stream: true }), cache: "no-store", signal: ac.signal });
      if (r.ok && r.body && /text\/plain/.test(r.headers.get("content-type") || "")) {
        clearTimeout(first);
        const reader = r.body.getReader(), dec = new TextDecoder();
        const idle = () => setTimeout(() => ac.abort(), 15000);
        let t = idle();
        for (;;) {
          const { done, value } = await reader.read();
          clearTimeout(t);
          if (done) break;
          t = idle();
          raw += dec.decode(value, { stream: true });
          const rest = tidy(raw);
          if (rest) { card.text = base + " " + rest; got = true; this._render(); }
        }
        clearTimeout(t);
      } else {
        clearTimeout(first);
        // a server that answers in one piece: use it as it is
        const d = r.ok ? await r.json().catch(() => ({})) : {};
        if (d && d.text) { raw = d.text; const rest = tidy(raw); if (rest) { card.text = base + " " + rest; got = true; this._render(); } }
      }
    } catch (_) { /* falls back below */ }
    if (got || /^\W*DONE\W*$/i.test(raw.trim())) {
      this._event("continued", { words: got ? words(tidy(raw)) : 0, done: !got });
      if (got) this._context("CONTEXT ONLY, no reply: the candidate's full answer to the last question, which they are saying aloud now: " + card.text);
      return this._finish(card);
    }
    // not streamed (an old server, a dropped stream): one request for the whole rest
    const r = await post("/live/web/text", body, { timeout: 35000 });
    const rest = r.ok && r.text ? tidy(r.text) : "";
    if (r.ok && r.text && !rest) {
      this._event("continued", { words: 0, done: true });
    } else if (rest) {
      card.text = base + " " + rest;
      this._event("continued", { words: words(rest) });
      this._context("CONTEXT ONLY, no reply: the candidate's full answer to the last question, which they are saying aloud now: " + card.text);
    } else {
      this._event("continue_failed", { reason: r.error || "" });
      if (card.early && this.turn && this.turn.card === card && !this.turn.closed) {
        card.early = false; card.state = "streaming";
        const visible = stripAnswerPrefix(this.turn.raw);
        if (visible) card.text = visible;
        this._render();
        return;
      }
    }
    this._finish(card);
  }

  _finish(card) {
    const parsed = parseAnswer(card.text);
    if (parsed) Object.assign(card, { view: parsed });
    card.state = "done";
    this.memory.push({ q: card.question, a: (parsed && parsed.answer) || card.text });
    if (this.memory.length > MEMORY_MAX) this.memory.shift();
    this._render();
    if (wantsCode(card.question, parsed)) this._code(card, parsed);
  }

  async _code(card, parsed, force = "") {
    card.codeState = "writing"; this._render();
    const s = this.setupOf();
    const lastCode = this.cards.find((c) => c !== card && c.codeLang);
    const r = await post("/live/web/text", { ...promptBody(s), session_id: this.session.id, session_token: this.session.token, kind: "code",
      question: card.question, spoken: (parsed && parsed.answer) || card.text, last_code_language: lastCode ? lastCode.codeLang : "", force }, { timeout: 40000 });
    const out = r.ok && parseCode(r.text);
    if (out) Object.assign(card, { code: out.code, codeExplain: out.explain, codeLang: out.lang, codeState: "done" });
    else card.codeState = parsed && parsed.code ? "done" : "none";
    if (!out && parsed && parsed.code) card.code = parsed.code;
    this._event("code", { ok: !!out });
    this._render();
  }

  /* A photo of the laptop screen. */
  async snap(jpegBase64) {
    if (!this.session) return { ok: false };
    const card = { id: Math.random().toString(36).slice(2), question: "Reading your photo…", text: "", started: Date.now(), state: "continuing", photo: true };
    this.cards.unshift(card); this._render();
    const r = await post("/live/web/text", { ...promptBody(this.setupOf()), session_id: this.session.id, session_token: this.session.token, kind: "snap",
      image: jpegBase64, context: this.memory.slice(-6).flatMap((x) => [`Interviewer: ${x.q}`, `Candidate: ${x.a}`]) }, { timeout: 45000 });
    const res = r.ok && r.result;
    if (!res || res.kind === "other" || !(res.answer || res.code)) {
      card.question = "Couldn't read a question in that photo";
      card.text = "Hold the phone straight, close enough that the text is sharp, and try again.";
      card.state = "done"; card.failed = true; this._render(); this._event("snap", { ok: false });
      return { ok: false };
    }
    card.question = res.question || "From your photo";
    card.text = res.answer || "";
    card.view = parseAnswer("ANSWER: " + (res.answer || "")) || { answer: res.answer || "", claims: [], madeUp: false };
    if (res.code) Object.assign(card, { code: res.code, codeState: "done" });
    card.state = "done";
    this.memory.push({ q: card.question + (res.seen ? `\n(on screen: ${String(res.seen).slice(0, 1500)})` : ""), a: res.answer || res.code || "" });
    this._context(`CONTEXT ONLY, no reply: the interviewer's screen shows: ${String(res.seen || "").slice(0, 2000)}\nThe candidate's answer: ${res.answer || ""}`);
    this._render(); this._event("snap", { ok: true, kind: res.kind });
    return { ok: true };
  }

  recode(cardId, lang) {
    const card = this.cards.find((c) => c.id === cardId);
    if (card) this._code(card, card.view, lang);
  }

  _context(text, now_ = false) {
    if (!now_ && this.turn && !this.turn.closed) { this.pendingContext = text; return; }
    if (!this.connected || !this.ws) return;
    try { this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: false } })); } catch (_) { /* repaired by the watchdog */ }
  }

  _render() { try { this.onCards(this.cards); } catch (_) { /* UI */ } }
  _event(name, data) { try { this.onEvent(name, data); } catch (_) { /* UI */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function b64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
