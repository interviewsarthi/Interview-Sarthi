/* Live Sarthi on the phone: where the candidate is in the answer, from the words the phone hears. */

export const FILLERS = new Set(["um", "umm", "uh", "uhh", "hmm", "er", "erm", "ah", "mm"]);
const COMMON = new Set("the a an and or to of in on is it i that so we was for with as at be this you my our they he she but".split(" "));
const NEAR = 60;   // words ahead looked at for a short match

export const norm = (w) => String(w || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/* The same word, allowing a different ending ("caching"/"cache") or one wrong letter. */
export function close(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && a.startsWith(b.slice(0, 4)) && b.startsWith(a.slice(0, 4)) && Math.abs(a.length - b.length) <= 3) return true;
  if (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 1) {
    let i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      d++;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
      if (d > 1) return false;
    }
    return d + (a.length - i) + (b.length - j) <= 1;
  }
  return false;
}

/* Word number where the heard words h end in the answer, searching content positions [from, to); -1 if nowhere.
 * maxSkips: answer words that may be skipped in between (the candidate dropped a word). */
function find(words, idx, h, from, to, maxSkips) {
  for (let p = from; p < to; p++) {
    let q = p, last = -1, ok = true, skips = 0;
    for (let j = 0; j < h.length; j++) {
      if (q < idx.length && close(h[j], words[idx[q]])) { last = idx[q]; q++; }
      else if (skips < maxSkips && j > 0 && q + 1 < idx.length && close(h[j], words[idx[q + 1]])) { last = idx[q + 1]; q += 2; skips++; }
      else { ok = false; break; }
    }
    if (ok) return last;
  }
  return -1;
}

const real = (w) => w.length >= 4 && !COMMON.has(w);

/**
 * The new cursor (number of answer words said) after hearing `heard` (normalized, newest last), never moving back.
 * Close by (the next ~60 words): 4 words with one dropped word allowed, or 3 or 2 words word for word that carry
 * real content. Further on (a big jump forward): 4 in a row.
 */
export function advance(words, heard, cursor) {
  const idx = [];
  for (let i = 0; i < words.length; i++) if (words[i] && !FILLERS.has(words[i])) idx.push(i);
  if (!idx.length || !heard.length) return cursor;
  const start = idx.findIndex((i) => i >= cursor);
  if (start < 0) return cursor;
  const nearFrom = Math.max(0, start - 3), nearTo = Math.min(idx.length, start + NEAR);
  const tries = [[4, 1, 1], [3, 0, 2], [2, 0, 2]];     // [words, skips allowed, real words needed]
  for (const [k, skips, need] of tries) {
    if (heard.length < k) continue;
    const h = heard.slice(-k);
    if (h.filter(real).length < need) continue;
    const last = find(words, idx, h, nearFrom, nearTo, skips);
    if (last >= 0) return Math.max(cursor, last + 1);
  }
  if (heard.length >= 4 && nearTo < idx.length) {
    const h = heard.slice(-4);
    if (h.filter(real).length >= 2) {
      const last = find(words, idx, h, nearTo - 3, idx.length, 0);
      if (last >= 0) return Math.max(cursor, last + 1);
    }
  }
  return cursor;
}

/* The heard words kept for matching: normalized, fillers out, the last 12. */
export function addHeard(list, piece) {
  for (const w of String(piece || "").split(/\s+/)) { const x = norm(w); if (x && !FILLERS.has(x)) list.push(x); }
  return list.length > 12 ? list.slice(-12) : list;
}

/* A new piece can end with words that are not in the answer (the candidate starts improvising mid-piece): try every
 * word of it as the end of what was read, and keep the furthest place. */
export function hear(words, heard, cursor, piece) {
  const fresh = String(piece || "").split(/\s+/).map(norm).filter((x) => x && !FILLERS.has(x));
  const all = heard.concat(fresh);
  let best = cursor;
  for (let n = 0; n < Math.max(1, fresh.length); n++) {
    const end = all.length - n;
    best = Math.max(best, advance(words, all.slice(Math.max(0, end - 12), end), cursor));
  }
  return { heard: all.slice(-12), cursor: best };
}
