/* Prep Sarthi: read the CV, or the job description, in the browser.
 *
 * PDF text comes out through pdf.js (loaded from cdnjs only when a PDF is
 * chosen). .txt and .md are read as-is. A scanned PDF has no text layer; the
 * caller gets an empty string and asks the user to paste instead. Nothing here
 * leaves the device: the text is only sent to Gemini when the interview starts.
 */

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const MAX_CHARS = 20000;

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
  }
  return pdfjsPromise;
}

/** @param {string} label  what the file is, for the error message: "CV" or "JD". */
export async function readDocFile(file, label = "CV") {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return readPdf(file);
  if (/\.(txt|md|text)$/.test(name) || /^text\//.test(file.type || "")) return tidy(await file.text());
  throw new Error(`Use a PDF or a plain text file, or paste the ${label} text.`);
}

async function readPdf(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 8); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "", lastY = null, out = [];
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
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

/* A name guess for the greeting: the first short line that looks like a name. */
export function guessName(cvText) {
  const heading = /\b(curriculum|vitae|resume|cv|profile|summary|objective|contact|address|email|phone)\b/i;
  for (const raw of String(cvText || "").split("\n").slice(0, 6)) {
    const line = raw.trim();
    if (heading.test(line)) continue;
    // "Riya Sharma" or "RIYA SHARMA": two to four words, letters only.
    if (/^[A-Z][a-z.'-]+(?: [A-Z][a-z.'-]+){1,3}$/.test(line) || /^[A-Z][A-Z.'-]+(?: [A-Z][A-Z.'-]+){1,3}$/.test(line)) {
      const first = line.split(" ")[0];
      return first[0] + first.slice(1).toLowerCase();
    }
  }
  return "";
}
