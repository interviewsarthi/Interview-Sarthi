/* The 60-minute interview (22 Oct 2026).
 *
 * Prep was built for interviews of up to 18 minutes. Over a full hour the interviewer closed early, re-asked the same
 * CV points (70 to 140 questions an hour from one CV) and, after a backup-model switch, looped two questions. Eleven
 * 1-hour test runs (Prep interviewing, Live Sarthi answering, every question read by hand) settled this setup:
 *
 * - the app leads the topics: right after each interviewer question a context-only note names the next topic not
 *   asked yet (from the interview plan, topped up from the CV), with two follow-up notes between new topics;
 * - topics are checked against everything asked, by words and by meaning (Gemini embeddings: the same question
 *   reworded scored 0.83-0.95, different questions 0.69-0.75), and a question that repeats one asked 3+ minutes
 *   earlier gets an immediate note to withdraw it ("Actually, we covered that");
 * - the hour runs as three 20-minute parts, each a fresh session started silently right after a question, on the main
 *   voice model, with the part's focus, the last few turns and the whole list of questions already asked.
 *
 * Notes are sent the moment the interviewer's turn ends: sent 0.2 s later (after the meaning check) they made the
 * voice model ask its question a second time (11 times in one hour).
 */

export const LONG_INTERVIEW_SECONDS = 45 * 60;          // 45+ planned minutes run as a long interview
export const isLongInterview = (plannedSeconds) => plannedSeconds >= LONG_INTERVIEW_SECONDS;

const PART_SECONDS = 20 * 60;
const PART_FOCUS = [
  "the introduction, one project walkthrough and the first role questions",
  "technical depth for the role: other projects from the CV not discussed yet, system design, trade-offs, failure handling and practical scenarios",
  "behaviour and judgment (collaboration, disagreement, mistakes, learning, ownership, pressure) mixed with practical scenarios; the candidate's questions and the close come only after the app's closing note",
];
const TEXT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];   // the interview plan's models (plan-request.js)
const EMBED_MODEL = "gemini-embedding-2";
const TOPIC_MEANING = 0.78;      // a suggested topic this close to any asked question is dropped
const REPEAT_MEANING = 0.86;     // an asked question this close to one asked 3+ minutes earlier is withdrawn
const REPEAT_GAP_S = 180;
const GUARD_REARM_S = 25;
const API = "https://generativelanguage.googleapis.com/v1beta/models/";

export const REPEAT_REQUEST_RE = /didn'?t (quite |really )?(catch|hear|understand|get)|could you (please )?(repeat|say that again)|(let'?s )?try (that|it) again|one more time|come again|no entend|lost the connection/i;

const STOPWORDS = new Set(("about after again also answer asked been before between both could describe detail does from have how into " +
  "just like made make more most other over regarding said should some specific such than that their them then there these they this " +
  "those through tell under using walk well were what when where which while with would your yours project projects topic").split(" "));

function contentWords(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, "")));
}
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };
function cosine(a, b) { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); }
const topicCore = (c) => String(c).replace(/^New topic:\s*/i, "").replace(/^[^:?]{1,60}:\s*/, "");
const embKey = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 600);

/* The question sentence of an interviewer turn ("…, so what were the main challenges?" names its topic before). */
function questionOf(text) {
  const sents = String(text).split(/(?<=[.!?])\s+/), qi = sents.map((x) => x.includes("?")).lastIndexOf(true);
  if (qi < 0) return "";
  let q = sents[qi].trim();
  if (contentWords(q).size < 6 && qi > 0) q = sents[qi - 1].trim() + " " + q;
  return q;
}

/* Names and technical terms from the CV, so the interviewer expects them (Live gives its speech recognition the same). */
export function speechTermsFrom(cv) {
  const skip = new Set(("The And For With From Into Built Designed Made Used Rebuilt Moved Added Not Team Our This That When Then Stack " +
    "Flow Data Chat Sync Plans Numbers Brokers Signal Trade Risk Reliability Dashboard Language Earlier Score Style Lines Project Professional " +
    "Experience Education Core Skills Summary Bachelor College University India New Delhi Junior Independent Self Engineer Developer Inc Private " +
    "Limited Present Jan Jun May Oct Implemented Integrated Replaced Reduced Roughly Cut Concentrated Combined Diversified Scaled Encoded Pre " +
    "Grounded Increased Deployed Validated Agentic Generative Python").split(" "));
  const counts = new Map();
  for (const m of String(cv || "").matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[-.+/][A-Za-z0-9]+)*\b/g)) {
    const w = m[0];
    if (w.length < 3 || skip.has(w)) continue;
    const mixed = /[A-Z]/.test(w.slice(1)) || /\d/.test(w) || /[-.+/]/.test(w);   // LangGraph, gpt-4o, YOLOv8, FastAPI
    if (!mixed && !/^[A-Z]/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + (mixed ? 2 : 1));
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 45).map(([w]) => w);
}

/* Every interview: after two requests to repeat in a row, the next unclear answer means "let's move on". */
export function createHearingCheck(live, onEvent = () => {}) {
  let notCaught = 0;
  return (u) => {
    const text = String(u.text || "");
    if (REPEAT_REQUEST_RE.test(text)) {
      if (++notCaught === 2 && live.sendText("(App note: you have asked the candidate to repeat twice. If you still cannot understand the next answer, do not ask again: say briefly \"Let's move on\" and ask a new question. Never mention this note.)", { turnComplete: false })) onEvent("hearing_note", {});
    } else if (text.includes("?")) notCaught = 0;
  };
}

/* A JSON array of questions, also from code-fenced or broken JSON (both text models returned broken JSON once). */
export function parseQuestionList(txt) {
  try { const a = JSON.parse(txt); if (Array.isArray(a)) return a; } catch (_) { /* fall through */ }
  const m = String(txt).match(/\[[\s\S]*\]/);
  if (m) { try { const a = JSON.parse(m[0]); if (Array.isArray(a)) return a; } catch (_) { /* fall through */ } }
  const lines = String(txt).split("\n").map((s) => s.replace(/^[\s\d.)"'[\],-]+|["',\]]+$/g, "").trim()).filter((s) => s.length > 25 && s.includes("?"));
  return lines.length ? lines : null;
}

/**
 * @param {object} o
 * @param {string} o.apiKey            the candidate's own Gemini key (topic top-ups and the meaning check)
 * @param {string} o.cv
 * @param {string} [o.targetRole]
 * @param {string} [o.targetLevel]
 * @param {number} o.plannedSeconds
 * @param {Promise<object|null>} [o.plan]  the interview plan being made for the report
 * @param {function} o.progress        () => the app clock snapshot (interviewProgress)
 * @param {function} [o.onEvent]       (name, data) => void   diagnostics
 * @param {function} [o.fetch]
 */
export function createLongInterview(o) {
  const doFetch = o.fetch || ((...a) => fetch(...a));
  const onEvent = o.onEvent || (() => {});
  const parts = Math.min(3, Math.ceil(o.plannedSeconds / PART_SECONDS));
  let live = null, timer = null, planNow = null;
  if (o.plan && o.plan.then) o.plan.then((p) => { planNow = p; }, () => {});

  const askedLog = [];                       // {q, at, w, vec}
  let pool = null, refilling = false, lastRefill = -1e9, refillWait = 150;
  const embCache = new Map(), embDone = new Map();
  let lastGuardAt = -1e9, lastPushed = null;
  let sinceTopic = 1, blockStartAt = -1e9, pendingTopic = null, pendingFollowUp = false, lastTopicFor = "";
  let partNow = 1, partDue = null;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

  function askedSoFar(limit = 20) {
    const seen = new Set(), out = [];
    for (const u of (live ? live.transcript.turns : [])) {
      if (u.who !== "interviewer" || !String(u.text).includes("?")) continue;
      const q = String(u.text).split(/(?<=[.!?])\s+/).filter((x) => x.includes("?")).at(-1).trim().slice(0, 160);
      const key = q.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      if (!seen.has(key)) { seen.add(key); out.push(q); }
    }
    return out.slice(-limit);
  }

  function embed(text) {
    const k = embKey(text);
    if (!embCache.has(k)) embCache.set(k, (async () => {
      try {
        const r = await doFetch(`${API}${EMBED_MODEL}:embedContent?key=${encodeURIComponent(o.apiKey)}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: k }] }, taskType: "SEMANTIC_SIMILARITY" }) });
        const j = await r.json(); const v = j && j.embedding && j.embedding.values;
        if (!r.ok || !Array.isArray(v)) { onEvent("hour_embed_error", { status: r.status }); embCache.delete(k); return null; }
        embDone.set(k, v); return v;
      } catch (e) { onEvent("hour_embed_error", { message: String(e).slice(0, 100) }); embCache.delete(k); return null; }
    })());
    return embCache.get(k);
  }

  function alreadyCovered(prompt) {
    const tw = contentWords(topicCore(prompt));
    if (tw.size < 3) return false;
    if (askedSoFar(500).some((q) => { const qw = contentWords(q), n = overlap(tw, qw); return n >= 3 && n / Math.min(tw.size, qw.size || 1) >= 0.5; })) return true;
    if (askedLog.some((a) => { const n = overlap(tw, a.w); return n >= 5 && n / Math.min(tw.size, a.w.size) >= 0.6; })) return true;
    const v = embDone.get(embKey(topicCore(prompt)));
    if (v) for (const a of askedLog) if (a.vec && cosine(v, a.vec) >= TOPIC_MEANING) return true;
    return false;
  }

  function ensurePool() {
    if (pool) return;
    pool = [];
    const reqs = planNow && Array.isArray(planNow.requirements) ? planNow.requirements : [];
    const lists = reqs.map((r) => [r.question, ...(Array.isArray(r.followups) ? r.followups : [])].filter(Boolean)
      .map((q) => `${r.label}: ${String(q).slice(0, 180)}`));
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) pool.push(l[i]);   // area by area
    pool.forEach((c) => embed(topicCore(c)));
    if (!pool.length) refill();   // the plan can time out: top up from the CV
  }

  async function refill() {
    if (refilling || now() - lastRefill < refillWait) return;
    refilling = true; lastRefill = now(); refillWait = 20;   // a failed top-up is retried after 20 s
    const asked = askedSoFar(60).concat(pool || []).slice(-70);
    const role = [o.targetRole, o.targetLevel].filter(Boolean).join(", ") || "the candidate's target role";
    const prompt = `You prepare an interviewer for a ${role} practice interview. Using the candidate CV below, write 12 NEW broad opening questions, each opening a different area for a 2-3 question discussion: 9 about the candidate's own projects and the core skills of the role (each on a different project area: design choices, a hard problem, a trade-off, a practical scenario built on that project), and 3 behavioural or general questions (collaboration, mistakes, learning, ownership, working under pressure) that the candidate can answer from the work in the CV. Mix them, with one behavioural or general question after every three project questions. Avoid narrow trivia such as exact parameters, colour spaces, isolation levels or library internals. Each must be NOT covered by the already-asked list. Never repeat or reword an already-asked question. One sentence each. Reply with a JSON array of 12 strings only.\n\nALREADY ASKED:\n${asked.map((q, i) => (i + 1) + ". " + q).join("\n")}\n\nCANDIDATE CV:\n${String(o.cv || "").slice(0, 12000)}`;
    try {
      for (const model of TEXT_MODELS) {
        try {
          const r = await doFetch(`${API}${model}:generateContent?key=${encodeURIComponent(o.apiKey)}`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.8, maxOutputTokens: 3000, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } } }) });
          const j = await r.json();
          const txt = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
          const arr = parseQuestionList(txt);
          if (r.ok && Array.isArray(arr) && arr.length) {
            pool.push(...arr.map((q) => "New topic: " + String(q).slice(0, 180)));
            arr.forEach((q) => embed(String(q).slice(0, 180)));
            refillWait = arr.length >= 4 ? 150 : 20;
            onEvent("hour_topic_refill", { model, added: arr.length });
            return;
          }
          onEvent("hour_topic_refill_error", { model, status: r.status });
        } catch (e) { onEvent("hour_topic_refill_error", { model, message: String(e).slice(0, 100) }); }
      }
    } finally { refilling = false; }
  }

  function nextTopic() {
    ensurePool();
    let next = null;
    while (pool.length) { const c = pool.shift(); if (alreadyCovered(c)) onEvent("hour_topic_dropped", {}); else { next = c; break; } }
    if (pool.length < 8) refill();
    return next ? topicCore(next) : null;
  }

  /* Right after each interviewer question: a follow-up note twice, then a new topic. */
  function topicNote(u) {
    const text = String(u.text || "");
    if (!text.includes("?") || text === lastTopicFor || live.stopped) return;
    lastTopicFor = text;
    if (o.progress().canWrapUp || REPEAT_REQUEST_RE.test(text)) return;
    if (++sinceTopic < 3) {
      pendingTopic = null; pendingFollowUp = true;
      if (live.sendText("(App note for your next turn, after the candidate has answered: ask one follow-up question on what they just said, such as why they chose that, what went wrong, the trade-off, or what they would change. Stay on this topic; do not start a new one. Never mention this note.)", { turnComplete: false })) onEvent("hour_followup_note", { n: sinceTopic });
      return;
    }
    sinceTopic = 0; blockStartAt = live.activeSeconds; pendingFollowUp = false;
    const topic = nextTopic();
    pendingTopic = topic;
    const note = topic
      ? `(App note for your next turn, after the candidate has answered: move on to this new topic, not covered yet, in your own words: ${topic}. Never mention this note.)`
      : "(App note for your next turn, after the candidate has answered: ask about a practical scenario or a behavioural theme not discussed yet; do not return to a project question already asked. Never mention this note.)";
    if (live.sendText(note, { turnComplete: false })) onEvent("hour_topic_note", { generic: !topic });
  }

  function sendGuardNote(item, hit, how) {
    lastGuardAt = item.at;
    sinceTopic = 0; blockStartAt = live.activeSeconds; pendingFollowUp = false;   // its replacement is a new topic
    const mins = Math.max(1, Math.round((item.at - hit.at) / 60));
    const topic = nextTopic() || "a practical scenario from the candidate's CV";
    pendingTopic = topic;
    const answering = live._now() - live._lastVoiced < 1.5;
    const note = answering
      ? `(App note: you asked that question about ${mins} minutes ago and the candidate answered it then. After this reply, do not return to it: acknowledge briefly and ask a new question, for example about: ${topic}. Never mention this note.)`
      : `(App note: you asked that question about ${mins} minutes ago and the candidate already answered it. Say briefly that you will move on, for example "Actually, we covered that. Let me ask something else.", then ask one new question, for example about: ${topic}. Never mention this note.)`;
    if (live.sendText(note, { turnComplete: !answering })) { onEvent("hour_repeat_withdrawn", { how, mins, answering }); return true; }
    return false;
  }

  /* An asked question that repeats one from 3+ minutes ago, by words (now) or by meaning (a moment later). */
  function wordGuard(u) {
    const q = questionOf(u.text);
    if (!q) return false;
    const at = live.activeSeconds, w = contentWords(q);
    let hit = null;
    if (w.size >= 3 && !/\b(repeat|clarify|say that again|still there|hear me)\b/i.test(q)) for (const a of askedLog) {
      if (at - a.at < REPEAT_GAP_S || a.at >= blockStartAt) continue;   // follow-ups on the current topic are fine
      const n = overlap(w, a.w);
      if (n >= 5 && n / Math.min(w.size, a.w.size) >= 0.6) { hit = a; break; }
    }
    const item = { q, at, w, vec: null };
    askedLog.push(item); lastPushed = item;
    embed(q).then((v) => { if (v) item.vec = v; });
    if (!hit || at - lastGuardAt < GUARD_REARM_S || live.stopped) return false;
    return sendGuardNote(item, hit, "words");
  }

  async function meaningGuard() {
    const item = lastPushed; lastPushed = null;
    if (!item || live.stopped || /\b(repeat|clarify|say that again|still there|hear me|catch)\b/i.test(item.q)) return false;
    const v = item.vec || await Promise.race([embed(item.q), new Promise((r) => setTimeout(() => r(null), 1500))]);
    if (!v || live.stopped) return false;
    item.vec = v;
    let best = null, bs = 0;
    for (const a of askedLog) {
      if (a === item || !a.vec || item.at - a.at < REPEAT_GAP_S || a.at >= blockStartAt) continue;
      const s = cosine(v, a.vec); if (s > bs) { bs = s; best = a; }
    }
    if (!best || bs < REPEAT_MEANING || item.at - lastGuardAt < GUARD_REARM_S) return false;
    return sendGuardNote(item, best, "meaning");
  }

  function part() {
    if (parts <= 1) return null;
    const n = Math.min(parts, 1 + Math.floor((live ? live.activeSeconds : 0) / PART_SECONDS));
    return { n, of: parts, focus: PART_FOCUS[Math.min(n, PART_FOCUS.length) - 1], asked: n > 1 ? askedSoFar(80).map((q) => q.slice(0, 100)) : [] };
  }

  /* A part switch starts from the last 8 turns (the already-asked list is in the part's brief). */
  function partContext() {
    const turns = live ? live.transcript.turns.slice(-8) : [];
    if (!turns.length) return "";
    return "THE LAST FEW TURNS OF THIS SAME INTERVIEW (continue from here; do not repeat a question already asked):\n" +
      turns.map((u) => `${u.who === "interviewer" ? "You (interviewer) said" : "Candidate said"}: ${u.text}${u.interrupted ? " [cut off]" : ""}`).join("\n");
  }

  function checkPart() {
    if (!live || live.stopped) return;
    const p = part();
    if (p && p.n !== partNow && !partDue) partDue = p;
    if (!partDue || !live.quietAfterQuestion()) return;
    const due = partDue; partDue = null; partNow = due.n;
    const carry = pendingTopic
      ? ` For your next question, after the answer: if the answer left an important gap, ask one short follow-up about it; otherwise ask, in your own words, about this topic not covered yet: ${pendingTopic}.`
      : pendingFollowUp ? " For your next question, after the answer: ask one follow-up on what the candidate just said, on the same topic." : "";
    const note = `(Part ${due.n} of ${due.of} of this interview starts now in a fresh session. Your last question is in the turns above and the candidate is about to answer it: do not speak now, do not greet or recap. Listen to the answer, then continue with this part's focus.${carry})`;
    if (live.refreshForPart(note)) onEvent("hour_part", { part: due.n, of: due.of, active: Math.round(live.activeSeconds) });
  }

  return {
    part,
    partContext,
    /* The clock tool and the 2-minute clock note: the no-close rule and the last 12 questions asked. */
    progress(p, args) {
      if (!p || p.canWrapUp) return p;
      const out = { ...p, long: true };
      if (args && args.forNote) out.already_asked = askedSoFar().slice(-12).map((q) => q.slice(0, 110));
      return out;
    },
    /* Call with every finished interviewer turn. */
    async onInterviewerTurn(u) {
      if (!live || live.stopped) return;
      lastPushed = null;
      if (wordGuard(u)) return;
      topicNote(u);              // at once: a late note made the voice model repeat its question
      await meaningGuard();
    },
    attach(session) {
      live = session;
      clearInterval(timer);
      timer = setInterval(checkPart, 200);
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
