/* Prep Sarthi's Help and the "Was this useful?" rating (owner's MCQs, 21 Oct 2026).
 *
 * Until then the only way to report a problem in Prep was an email address at the bottom of the page. This module is
 * the logic; the screens (the Help panel, the rating row under a report, the reply dot) are drawn by support-view.js
 * from window.prepApp.support and the prep:support* events. A report goes to the licence server's support chat, the
 * one Live Sarthi's Help uses (license-server src/support.js, supportprep.js): the bot answers first, the Sarthi team
 * when it cannot, and the reply shows here and, with an email, by email with a link to the conversation page.
 *
 * A report carries: the problem and the words typed; an email (none typed and signed in: the server uses the Google
 * account's); what this page knows (browser, pass kind, the last interview, the microphone, the message on screen);
 * the ids of the last interviews' timelines (diagnostics.js) with their tokens, so the server can read them; and,
 * unless "Include what was said in this interview" is unticked (it is ticked by default, the owner's choice), that
 * interview's transcript. Never the CV, the job description or the Gemini key.
 *
 * Events on `target` (window):
 *   prep:support        detail = state(): after every change (sent, a poll brought news, an error)
 *   prep:support-open   detail = { problem, from, reportId }: a "Report this" button or open() asked for the panel
 *   prep:support-reply  detail = { unread }: a reply came that this person has not seen
 */

export const PROBLEMS = [
  { code: "prep_voice", label: "Mic or interviewer voice problem" },
  { code: "prep_report", label: "Report missing or score feels wrong" },
  { code: "prep_payment", label: "Payment, pass or sign-in" },
  { code: "prep_key", label: "Gemini key problem" },
  { code: "prep_other", label: "Something else" },
  { code: "prep_idea", label: "An idea or suggestion" },
];
// Never buttons: "Tell us what went wrong" after a Not useful or Partly rating sends these.
export const RATED = { no: "prep_rated_no", partly: "prep_rated_partly" };
export const RATINGS = ["yes", "partly", "no"];
const CODES = new Set([...PROBLEMS.map((p) => p.code), ...Object.values(RATED)]);
const OPEN = ["new", "bot_answered", "waiting_you", "you_replied"];
const TICKET_KEY = "ps_support_ticket_v1", ID_KEY = "ps_support_id", RATINGS_KEY = "ps_ratings_v1";
const FORGET_CLOSED_DAYS = 7;          // the server reopens a closed conversation for a week; after that, a new one
const RATINGS_KEPT = 50;
const TEXT_MAX = 2000;
const TURNS_MAX = 400;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const DAY = 86_400_000;

/** The last interviews' attempt ids and tokens, newest first, as diagnostics.js keeps them in storage. */
export function recentAttempts(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const list = JSON.parse(storage?.getItem("ps_diagnostic_ids_v1") || "[]");
    return (Array.isArray(list) ? list : [])
      .filter((a) => a && /^[a-f0-9-]{36}$/.test(a.id) && /^[a-f0-9]{64}$/.test(a.token) && now - a.started < 30 * DAY)
      .sort((a, b) => b.started - a.started).slice(0, 3).map(({ id, token }) => ({ id, token }));
  } catch { return []; }
}

/** Browser, system and device from a user agent, in the words the Sarthi team uses. */
export function browserInfo(ua = "") {
  const v = (re) => { const m = ua.match(re); return m ? m[1].split(".")[0] : ""; };
  const browser = /SamsungBrowser\//.test(ua) ? `Samsung Internet ${v(/SamsungBrowser\/([\d.]+)/)}`
    : /Edg(?:A|iOS)?\//.test(ua) ? `Edge ${v(/Edg(?:A|iOS)?\/([\d.]+)/)}`
      : /OPR\//.test(ua) ? `Opera ${v(/OPR\/([\d.]+)/)}`
        : /Firefox\/|FxiOS\//.test(ua) ? `Firefox ${v(/(?:Firefox|FxiOS)\/([\d.]+)/)}`
          : /CriOS\//.test(ua) ? `Chrome ${v(/CriOS\/([\d.]+)/)}`
            : /Chrome\//.test(ua) ? `Chrome ${v(/Chrome\/([\d.]+)/)}`
              : /Safari\//.test(ua) ? `Safari ${v(/Version\/([\d.]+)/)}` : "";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows NT/.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const device = /Mobi|Android|iPhone|iPod/.test(ua) ? "phone" : /iPad|Tablet/.test(ua) ? "tablet" : "computer";
  return { browser: browser.trim(), os, device };
}

/** A "Report this" button next to a message with no problem of its own: pick one from the message's words. */
export function guessProblem(text = "") {
  if (/microphone|\bmic\b|hear|answers|silence|voice/i.test(text)) return "prep_voice";
  if (/\bkey\b|gemini/i.test(text)) return "prep_key";
  if (/pass|payment|expired|sign.?in|paid/i.test(text)) return "prep_payment";
  if (/report/i.test(text)) return "prep_report";
  return "prep_other";
}

/**
 * @param {object} o
 * @param {string} o.api           the licence server
 * @param {() => Promise<object>|object} o.context  what the page knows now (app.js supportContext)
 * @param {() => string} [o.session]  the Prep sign-in session, if any
 */
export function createSupport({ api, context, session = () => "", storage = globalThis.localStorage, fetcher = (...a) => fetch(...a),
  now = Date.now, random = (n) => crypto.getRandomValues(new Uint8Array(n)), schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t), track = () => {}, target = globalThis.window, visible = () => globalThis.document?.visibilityState !== "hidden" } = {}) {
  const read = (k, d) => { try { const v = JSON.parse(storage?.getItem(k) ?? "null"); return v ?? d; } catch { return d; } };
  const write = (k, v) => { try { if (v === null) storage?.removeItem(k); else storage?.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

  // The conversation this browser has open: { id, number, token, status, seen, closedAt }. Messages are not kept.
  let ticket = read(TICKET_KEY, null);
  if (!(ticket && /^t_[a-f0-9]{16}$/.test(ticket.id) && /^[a-f0-9]{32}$/.test(ticket.token))) ticket = null;
  let messages = [], expected = "", sending = false, error = "", watching = false, timer = null, pollMs = 4000, polling = null;
  let lastContext = {};

  const emit = (name, detail) => { try { target?.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* no window */ } };
  const lastSeq = () => (messages.length ? messages[messages.length - 1].seq : 0);
  const unread = () => (ticket ? messages.filter((m) => (m.from === "owner" || m.from === "bot") && m.seq > (ticket.seen || 0)).length : 0);
  const isOpen = () => !!ticket && OPEN.includes(ticket.status);
  const save = () => write(TICKET_KEY, ticket);

  function browserId() {
    let id = "";
    try { id = storage?.getItem(ID_KEY) || ""; } catch { /* private mode */ }
    if (!/^[a-f0-9]{32}$/.test(id)) {
      id = [...random(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
      try { storage?.setItem(ID_KEY, id); } catch { /* a new id each visit then */ }
    }
    return id;
  }

  function state() {
    return {
      problems: PROBLEMS,
      ticket: ticket ? { id: ticket.id, number: ticket.number, status: ticket.status } : null,
      open: isOpen(),
      messages: messages.slice(),
      unread: unread(),
      expected_reply: expected,
      sending, error,
      // For the form: the signed-in email to show, and whether there is an interview whose words can go along.
      email: lastContext.email || "",
      hasTranscript: !!(lastContext.transcript && lastContext.transcript.length),
      interviewAt: lastContext.interviewAt || null,
    };
  }
  const changed = () => emit("prep:support", state());

  async function call(method, path, body, auth) {
    const headers = { ...(body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) };
    const res = await fetcher(api + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, data };
  }

  function take(view, { replace = false } = {}) {
    if (!view || !view.ticket) return;
    const before = unread();
    ticket = { ...ticket, id: view.ticket.id, number: view.ticket.number, status: view.ticket.status };
    if (!OPEN.includes(ticket.status)) ticket.closedAt = ticket.closedAt || now();
    else delete ticket.closedAt;
    const fresh = (view.messages || []).filter((m) => replace || m.seq > lastSeq());
    messages = replace ? fresh : messages.concat(fresh);
    if (view.expected_reply) expected = view.expected_reply;
    if (view.poll_after_ms) pollMs = Math.max(1500, Math.min(60_000, view.poll_after_ms));
    if (watching) ticket.seen = lastSeq();
    save();
    if (unread() > before) emit("prep:support-reply", { unread: unread() });
  }

  /** What the page knows, as the server reads it (supportprep.js prepFacts). */
  function facts(c, from) {
    const info = browserInfo(c.userAgent || "");
    const out = {
      app: { release: c.release, device: info.device, browser: info.browser, os: info.os, screen: c.screen, online: c.online },
      access: { kind: c.kind, signed_in: !!c.signedIn, own_key: !!c.hasKey, demo_used: !!c.demoUsed, language: c.language, minutes: c.minutes },
    };
    if (c.lastInterview) out.last_interview = c.lastInterview;
    if (c.mic) out.mic = c.mic;
    if (c.notice) out.notice = String(c.notice).slice(0, 300);
    if (from) out.from = from;
    return out;
  }

  /** Send a problem. Joins the conversation already open from this browser, as the server does. */
  async function send({ problem, text = "", email = "", includeTranscript = true, from = "", reportId = null } = {}) {
    if (sending) return { ok: false, error: "Already sending." };
    const code = CODES.has(problem) ? problem : "prep_other";
    const typed = String(email || "").trim();
    if (typed && !EMAIL.test(typed)) { error = "That email address does not look right."; changed(); return { ok: false, error }; }
    sending = true; error = ""; changed();
    try {
      const c = lastContext = (await context()) || {};
      const said = includeTranscript && Array.isArray(c.transcript) ? c.transcript.slice(0, TURNS_MAX)
        .map((u) => ({ who: u.who === "interviewer" ? "interviewer" : "candidate", text: String(u.text || "") })).filter((u) => u.text.trim()) : [];
      const body = {
        install_id: browserId(), source: code.startsWith("prep_rated_") ? "prep_rating" : "prep", problem: code,
        text: String(text || "").trim().slice(0, TEXT_MAX), email: typed, session: session() || undefined,
        app_version: c.release, facts: facts(c, from), attempts: c.attempts || [],
        ...(said.length ? { transcript: said, interview_at: c.interviewAt || undefined } : {}),
        ...(reportId ? { report_id: reportId } : {}),
      };
      const r = await call("POST", "/support/tickets", body);
      if (!r.ok || !r.data.token) {
        error = r.status === 429 && r.data.error ? r.data.error : "Could not send. Check your connection and try again.";
        return { ok: false, error };
      }
      ticket = { id: r.data.ticket.id, number: r.data.ticket.number, token: r.data.token, status: r.data.ticket.status, seen: 0 };
      take(r.data, { replace: true });
      track("mock_help_sent", { problem: code, transcript: said.length > 0, from: from || "panel" });
      if (watching) loop();
      return { ok: true, number: ticket.number };
    } catch {
      error = "Could not send. Check your connection and try again.";
      return { ok: false, error };
    } finally { sending = false; changed(); }
  }

  /** Bring the conversation up to date. A ticket the server no longer knows is forgotten. */
  async function poll({ full = false } = {}) {
    if (!ticket) return state();
    if (polling) return polling;
    polling = (async () => {
      try {
        const after = full ? 0 : lastSeq();
        const seen = watching ? Math.max(ticket.seen || 0, lastSeq()) : ticket.seen || 0;
        const r = await call("GET", `/support/tickets/${ticket.id}?after=${after}&seen=${seen}`, null, ticket.token);
        if (r.status === 404) { forget(); return state(); }
        if (r.ok) take(r.data, { replace: full });
      } catch { /* the next poll tries again */ }
      finally { polling = null; }
      changed();
      return state();
    })();
    return polling;
  }

  async function act(body) {
    if (!ticket) return { ok: false };
    try {
      const r = await call("POST", `/support/tickets/${ticket.id}/messages`, { ...body, after: lastSeq() }, ticket.token);
      if (r.status === 409 && r.data.new_problem) {
        forget();
        error = "This conversation was closed more than a week ago. Send your problem again as a new one.";
        return { ok: false, error };
      }
      if (!r.ok) { error = "Could not send. Check your connection and try again."; return { ok: false, error }; }
      error = "";
      take(r.data);
      return { ok: true };
    } catch {
      error = "Could not send. Check your connection and try again.";
      return { ok: false, error };
    } finally { changed(); }
  }
  const write_ = (text) => (String(text || "").trim() ? act({ kind: "text", text: String(text).trim().slice(0, TEXT_MAX) }) : Promise.resolve({ ok: false }));
  const solved = () => act({ kind: "solved" }).then((r) => { track("mock_help_solved", {}); return r; });
  const notSolved = () => act({ kind: "not_solved" }).then((r) => { track("mock_help_not_solved", {}); return r; });

  /** The panel is open (true) or closed (false): while open, the conversation is polled and counts as seen. */
  function watch(on) {
    watching = !!on;
    if (!watching) { cancel(timer); timer = null; return; }
    if (ticket) { ticket.seen = lastSeq(); save(); }
    void refreshContext();
    loop();
  }
  function loop() {
    cancel(timer); timer = null;
    if (!watching || !ticket) return;
    const tick = async () => {
      if (!watching) return;
      if (visible() && isOpen()) await poll();
      timer = schedule(tick, isOpen() ? pollMs : 30_000);
    };
    timer = schedule(tick, pollMs);
  }

  /** At page load: a conversation from an earlier visit is read back, and a reply not seen yet is announced. */
  async function checkReplies() {
    if (!ticket) return state();
    if (ticket.closedAt && now() - ticket.closedAt > FORGET_CLOSED_DAYS * DAY) { forget(); return state(); }
    await poll({ full: true });
    if (unread()) emit("prep:support-reply", { unread: unread() });
    return state();
  }

  /** Forget the conversation on this browser (a closed one, or "New problem" after it was solved). */
  function forget() {
    ticket = null; messages = []; expected = ""; save(); changed();
  }
  const newProblem = () => { if (!isOpen()) forget(); return state(); };

  async function refreshContext() {
    try { lastContext = (await context()) || {}; } catch { /* keep the last one */ }
    changed();
  }

  /** Ask for the panel: a "Report this" button, the rating's "Tell us what went wrong", or the top bar's Help. */
  function open({ problem = "", from = "", reportId = null, notice = "" } = {}) {
    const code = problem === "auto" ? guessProblem(notice) : CODES.has(problem) ? problem : "";
    track("mock_help_open", { from: from || "panel", problem: code || "none" });
    void refreshContext();
    emit("prep:support-open", { problem: code, from, reportId });
  }

  // ---- the rating under a report

  const ratings = () => read(RATINGS_KEY, {});
  /** What this browser rated a report, if anything: { rating, words }. */
  const ratingFor = (reportId) => (reportId && ratings()[reportId]) || null;

  /** Yes, Partly or No (saved on the click), then the words with a second call for the same report. */
  async function rate(rating, { words = "", reportId = null } = {}) {
    if (!RATINGS.includes(rating)) return { ok: false };
    const c = lastContext = (await context()) || {};
    const id = reportId || c.reportId;
    if (!id) return { ok: false };
    const all = ratings();
    all[id] = { rating, words: rating === "yes" && !words ? "" : String(words || (all[id] && all[id].words) || ""), at: now() };
    write(RATINGS_KEY, Object.fromEntries(Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, RATINGS_KEPT)));
    track("mock_rating", { rating, words: !!words });
    try {
      const r = await call("POST", "/mock/rating", { report_id: id, rating, words: String(words || "").slice(0, 1000) || undefined,
        kind: c.kind, score: c.lastInterview && Number.isInteger(c.lastInterview.score) ? c.lastInterview.score : undefined,
        release: c.release, attempt_id: c.attempts && c.attempts[0] ? c.attempts[0].id : undefined, device: browserId(), session: session() || undefined });
      return { ok: r.ok };
    } catch { return { ok: false }; }
  }

  /** "Report this" buttons anywhere on the page (data-support="prep_report" or "auto", data-support-from="..."). */
  function wire(root = globalThis.document) {
    root?.addEventListener("click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-support]") : null;
      if (!b) return;
      e.preventDefault();
      const box = b.closest(".notice");
      const said = box ? [...box.childNodes].filter((n) => n !== b && n.nodeType === 3).map((n) => n.textContent).join(" ") : "";
      open({ problem: b.dataset.support, from: b.dataset.supportFrom || "", notice: said });
    });
  }

  return { problems: PROBLEMS, state, send, poll, write: write_, solved, notSolved, watch, checkReplies, newProblem, forget,
    open, rate, ratingFor, wire, browserId };
}
