/* Live Sarthi on the phone: turning the model's words into an answer card. */

const WRAPPING = /^[`"' ]+|[`"' ]+$/g;
const JUNK = /<[^<>]{0,40}>|\{[^{}]{0,40}\}/g;
const HAS_LETTERS = /[A-Za-zऀ-ॿ]/;
const MADE_UP = /^\s*\[\s*made[\s-]*up(?:\s+(?:example|story))?\s*\]\s*:?\s*/i;
const CLAIM = /\[\[(?=[^\[\]`\n]*?\w\s+\w)([^\[\]`\n]+?)\]\]/g;
const FENCE = /```([a-zA-Z0-9_+#-]*)\n?([\s\S]*?)```/;
const TRAILING_CHECKIN = new RegExp(
  "\\s*(?:(?:so[, ]+)?(?:does (?:that|this) make sense|is (?:that|this) clear|" +
  "(?:i )?hope (?:that|this) helps|hope that answers (?:it|your question)|" +
  "let me know if you (?:need|want|have)[^.?!]*|" +
  "(?:do you|would you like me to|want me to|should i)[^.?!]*(?:more detail|" +
  "deeper|elaborate|examples?|further)[^.?!]*|happy to (?:go deeper|elaborate)" +
  "[^.?!]*)[.?!]*\\s*)+$", "i");

const LEAD_TOKEN = /^\s*(?:<[^<>]{0,40}>|\{[^{}]{0,40}\})/;
const VERDICTS = ["ANSWER:", "NO_ANSWER", "NO ANSWER"];

/** [the text without tags the model put in front of its verdict ("<speaker:Name>ANSWER: ..."), still unknown].
 * A tag is dropped only when a verdict follows (or may still follow), or it is a speaker tag; other markup stays.
 * Still unknown: an unclosed tag at the start may become one. */
function dropLeadTags(text) {
  let rest = text;
  for (;;) {
    const m = rest.match(LEAD_TOKEN);
    if (!m) break;
    const after = rest.slice(m[0].length).trimStart().replace(/^[`"' ]+/, "");
    const probe = after.toUpperCase();
    const verdictAhead = !probe || VERDICTS.some((v) => probe.startsWith(v) || v.startsWith(probe));
    if (!(verdictAhead || m[0].trim().toLowerCase().startsWith("<speaker"))) break;
    rest = after;
  }
  const head = rest.trimStart();
  const unknown = !!head && "<{".includes(head[0]) && !head.slice(0, 42).includes(head[0] === "<" ? ">" : "}") && head.length <= 41;
  return [rest, unknown];
}

/** Streaming: null while the verdict is unknown, "" for NO_ANSWER, otherwise the visible answer so far. */
export function stripAnswerPrefix(partial) {
  const [rest, unknown] = dropLeadTags(String(partial || "").trimStart().replace(/^[`"' ]+/, ""));
  if (unknown) return null;  // "<speak": a tag still arriving, nothing to show yet
  const cleaned = rest.trimStart().replace(/^[`"' ]+/, "");
  const probe = cleaned.toUpperCase();
  if (probe.startsWith("NO_ANSWER") || probe.startsWith("NO ANSWER")) return "";
  if (probe.startsWith("ANSWER:")) return cleaned.slice(7).trimStart().replace(/^[`"' ]+/, "") || null;
  if (probe.length < 9 && ("NO_ANSWER".startsWith(probe) || "ANSWER:".startsWith(probe))) return null;
  return cleaned;
}

/** The parts of an answer for the card: words, the made-up label, sentences to defend, code. null = no answer. */
export function parseAnswer(text) {
  let cleaned = dropLeadTags(String(text || "").trim().replace(WRAPPING, ""))[0].trim().replace(WRAPPING, "");
  const probe = cleaned.toUpperCase();
  if (!cleaned || probe.startsWith("NO_ANSWER") || probe.startsWith("NO ANSWER")) return null;
  if (probe.startsWith("ANSWER:")) cleaned = cleaned.slice(7).trim().replace(/^[`"' ]+/, "");
  if (!HAS_LETTERS.test(cleaned.replace(JUNK, ""))) return null;
  let madeUp = false;
  const m = cleaned.match(MADE_UP);
  if (m) { madeUp = true; cleaned = cleaned.slice(m[0].length); }
  let code = "", codeTag = "";
  const fence = cleaned.match(FENCE);
  if (fence) {
    code = fence[2].trim(); codeTag = fence[1];
    cleaned = (cleaned.slice(0, fence.index) + " " + cleaned.slice(fence.index + fence[0].length)).trim();
  }
  const claims = [];
  for (const c of cleaned.matchAll(CLAIM)) if (c[1].trim()) claims.push(c[1].trim());
  cleaned = cleaned.replace(CLAIM, "$1").replace(/\[\[([^\[\]`\n]{1,60}?)\]\]/g, "$1").trim().replace(TRAILING_CHECKIN, "").trimEnd();
  if (!cleaned && !code) return null;
  return { answer: cleaned, madeUp, claims, code, codeTag };
}

/** An answer that stops mid-sentence (a cut or stalled turn). */
export function looksCutShort(text) {
  const t = String(text || "").trim().replace(/["'*)\]_`]+$/, "");
  if (!t) return false;
  if (/```/.test(t) && (t.match(/```/g) || []).length % 2 === 1) return true;
  return !/[.!?।॥]$/.test(t);
}

/** Worth asking the code writer: the question reads like a coding task, or the answer promises code. */
const ASKS = /\b(write|implement|coding|snippet|program|script|sql|regex|pseudo-?code|likho|likhiye|likh ke)\b|\b(?:a|the|this|your) (?:function|method|class|query|code)\b|\bcode (?:for|to|that|it|this)\b/i;
const SAYS = /write it like this|here'?s the code|the code (?:would|is)|i'?d write|code like this/i;
export function wantsCode(question, card) {
  if (card && card.code) return true;
  if (card && SAYS.test(card.answer || "")) return true;
  return ASKS.test(question || "");
}

/** The code writer's reply: { code, explain, lang } or null for NO_CODE. */
export function parseCode(text) {
  const t = String(text || "").trim();
  if (!t || /^NO_CODE/i.test(t)) return null;
  const fences = [...t.matchAll(/```([a-zA-Z0-9_+#-]*)\n?([\s\S]*?)```/g)].filter((f) => f[2].trim());
  if (!fences.length) return null;
  const code = fences.length === 1 ? fences[0][2].replace(/^\n+|\s+$/g, "")
    : fences.map((f) => `── ${f[1] || "Code"} ──\n${f[2].replace(/^\n+|\s+$/g, "")}`).join("\n\n");
  let rest = t;
  for (const f of fences) rest = rest.replace(f[0], " ");
  return { code, explain: rest.split(/\s+/).join(" ").trim(), lang: (fences[0][1] || "").toLowerCase() };
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ESC[c]);

/** The answer as HTML: **key phrases** bold, [[claims]] marked, line breaks kept. Text is escaped first. */
export function answerHtml(text, claims = []) {
  let html = esc(text);
  for (const c of claims) {
    const e = esc(c);
    if (e && html.includes(e)) html = html.replace(e, `<mark class="claim">${e}</mark>`);
  }
  html = html.replace(/\*\*([^*\n]{1,120})\*\*/g, "<b>$1</b>").replace(/\*\*/g, "");
  return html.replace(/\n/g, "<br>");
}

/** Streaming view of a partial answer, before parseAnswer can run on the whole. */
export function partialView(visible) {
  let t = String(visible || "");
  let madeUp = false;
  const m = t.match(MADE_UP);
  if (m) { madeUp = true; t = t.slice(m[0].length); }
  const claims = [...t.matchAll(CLAIM)].map((c) => c[1].trim());
  t = t.replace(CLAIM, "$1").replace(/\[\[|\]\]/g, "");
  return { text: t, madeUp, claims };
}
