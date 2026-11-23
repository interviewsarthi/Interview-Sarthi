/* Live Sarthi on the phone: reading the resume. */

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash"];
const MAX_CHARS = 24000;
const MAX_FILE = 8 * 1024 * 1024;

let pdfjsPromise = null;
const pdfjs = () => (pdfjsPromise ||= import(PDFJS).then((lib) => { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return lib; }));

async function pdfText(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 8); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = "", lastY = null; const out = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform ? Math.round(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ""; }
      line += (line && !line.endsWith(" ") && item.str && !item.str.startsWith(" ") ? " " : "") + item.str;
      lastY = y;
    }
    if (line) out.push(line);
    pages.push(out.join("\n"));
  }
  return tidy(pages.join("\n\n"));
}

export function tidy(text) {
  return String(text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim().slice(0, MAX_CHARS);
}

const SYSTEM = "You read a CV for a job interview assistant. Keep every employer, role, date range, project name, " +
  "technology and number exactly as written. Never add or embellish anything. Reply with JSON only.";

function prompt(withText) {
  const today = new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });
  return `Return JSON with exactly this shape:
{
  "name": "the candidate's name exactly as written on the CV",
  ${withText ? '"text": "every word of the CV as plain text, in reading order, one line per line, contact details left out",\n  ' : ""}"field": "the candidate's field in 2-5 words, as an interviewer would name it (e.g. 'backend engineering', 'digital marketing', 'nursing')",
  "level": "the candidate's PAID work experience in years -- count job dates only (not internships, college projects or education) and round DOWN -- then exactly one of: 'fresher' (under 1 year), '1-3' (1 to under 3 years), '3-8' (3 to under 8 years), '8+' (8 years or more)",
  "vocabulary": ["30-60 terms an interviewer in this field would say and a transcriber might mishear: tools, methods, acronyms, product and company names -- every one from the CV first"]
}

Today is ${today}: a job dated to 'present' runs until ${today}.`;
}

async function gemini(key, parts, maxTokens) {
  let last = "google";
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: "application/json" } }),
      });
      if (r.status === 400 || r.status === 401 || r.status === 403) { last = "gemini_key"; break; }
      if (!r.ok) { last = r.status === 429 ? "gemini_quota" : "google"; continue; }
      const d = await r.json();
      const text = ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []).map((p) => p.text || "").join("");
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch (_) { last = "google"; }
  }
  throw Object.assign(new Error(last), { reason: last });
}

const LEVELS = ["fresher", "1-3", "3-8", "8+"];
function clean(meta, text) {
  const vocab = Array.isArray(meta.vocabulary) ? meta.vocabulary.map((v) => String(v).trim()).filter((v) => v && v.length < 40) : [];
  let name = String(meta.name || "").split(/\s+/).join(" ").trim().slice(0, 60);
  if (name && name === name.toUpperCase()) name = name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return { text: tidy(text), name, field: String(meta.field || "").trim().slice(0, 60),
    level: LEVELS.includes(String(meta.level || "").trim()) ? String(meta.level).trim() : "", terms: [...new Set(vocab)].slice(0, 60) };
}

const toB64 = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** A chosen file (PDF, photo or text) -> { text, name, field, level, terms }. Throws with .reason. */
export async function readCvFile(file, key) {
  if (file.size > MAX_FILE) throw Object.assign(new Error("too big"), { reason: "cv_too_big" });
  const nm = (file.name || "").toLowerCase();
  const isPdf = nm.endsWith(".pdf") || file.type === "application/pdf";
  const isImage = /^image\//.test(file.type || "") || /\.(jpe?g|png|webp|heic)$/.test(nm);
  const isText = /\.(txt|md|text)$/.test(nm) || /^text\//.test(file.type || "");
  if (!isPdf && !isImage && !isText) throw Object.assign(new Error("type"), { reason: "cv_type" });
  let text = "";
  if (isText) text = tidy(await file.text());
  else if (isPdf) { try { text = await pdfText(file); } catch (_) { text = ""; } }
  if (text.length > 200) return clean(await gemini(key, [{ text: prompt(false) + "\n\nCV:\n" + text }], 3000), text);
  const mime = isPdf ? "application/pdf" : (file.type && file.type !== "image/heic" ? file.type : "image/jpeg");
  const meta = await gemini(key, [{ inlineData: { mimeType: mime, data: await toB64(file) } }, { text: prompt(true) }], 8000);
  if (!String(meta.text || "").trim()) throw Object.assign(new Error("unreadable"), { reason: "cv_unreadable" });
  return clean(meta, meta.text);
}

/** Pasted CV text -> the same shape. */
export async function readCvText(raw, key) {
  const text = tidy(raw);
  if (text.length < 50) throw Object.assign(new Error("short"), { reason: "cv_short" });
  try { return clean(await gemini(key, [{ text: prompt(false) + "\n\nCV:\n" + text }], 3000), text); }
  catch (e) { if (e.reason === "gemini_key") throw e; return { text, name: "", field: "", level: "", terms: [] }; }
}

/** Does Google accept this key? "ok" | "bad" | "blocked" | "limit" | "offline" */
export async function checkKey(key) {
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=" + encodeURIComponent(key), { cache: "no-store" });
    if (r.ok) return "ok";
    if (r.status === 400 || r.status === 401) return "bad";
    if (r.status === 403) return "blocked";
    if (r.status === 429) return "limit";
    return "offline";
  } catch (_) { return "offline"; }
}
