/* Prep Sarthi: the report as a dashboard (owner, 1 Oct 2026: "understandable in one glance", charts where they
 * help, nothing hidden). The free demo shows the whole report too; the pass offer sits beside it.
 *
 * reportHtml(record) is pure: a saved report record in, HTML out. The top row answers "how did I do" (the score,
 * its band, six numbers); skills, the next thing to work on and the question scores come next; every detail
 * (what was said, what was missing, a stronger answer, the evidence) opens in place instead of making the page
 * long. Charts are plain HTML so they stay sharp, readable and printable; each value is also in text or a table.
 *
 * Contracts kept for progress-view.js: question rows are `.q[data-qi]` (the retake button is appended to them), and
 * the page dispatches prep:report-rendered after drawing (app.js renderReport).
 */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mmss = (s) => { s = Math.max(0, Math.round(Number(s) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const one = (x) => (Math.round(x * 10) / 10).toString();

const ICONS = {
  good: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  mid: '<path d="M4 16l5-5 4 4 7-7"/><path d="M15 8h5v5"/>',
  low: '<path d="M12 7v6"/><path d="M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>',
  none: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};
const icon = (name, cls = "rd-ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/* The overall score's band: status colour, icon and words always together, never colour alone. */
export function band(score) {
  if (num(score) === null) return { id: "none", label: "Not enough evidence" };
  if (score >= 70) return { id: "good", label: "Strong" };
  if (score >= 50) return { id: "mid", label: "Getting there" };
  return { id: "low", label: "Needs work" };
}
const PRIORITY = { essential: "Essential", preferred: "Preferred", inferred: "Inferred" };
const FOCUS = { fixed: ["good", "Fixed"], improved: ["mid", "Improved"], still_open: ["low", "Still open"], not_tested: ["none", "Not tested"] };

function kpi(label, value, sub = "", extra = "") {
  return `<div class="rd-kpi"><span class="rd-kpi-label">${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}${extra}</div>`;
}

/* A small column chart: one series, one hue, an optional reference line or band, value on each cap. */
function columns({ title, unit, values, labels, ref = null, refBand = null, refLabel = "", digits = 0, cap = null }) {
  const shown = values.map((v) => (v === null ? null : cap ? Math.min(v, cap) : v));
  const max = Math.max(1, ...shown.filter((v) => v !== null), ref || 0, refBand ? refBand[1] : 0) * 1.12;
  const pct = (v) => clamp((v / max) * 100, 0, 100);
  const fmt = (v) => (digits ? one(v) : String(Math.round(v)));
  const shade = refBand ? `<div class="rd-band" style="bottom:${pct(refBand[0])}%;height:${pct(refBand[1]) - pct(refBand[0])}%"></div>` : "";
  const line = ref !== null ? `<div class="rd-ref" style="bottom:${pct(ref)}%"></div>` : "";
  const cols = values.map((v, i) => v === null
    ? `<div class="rd-col rd-col-empty" tabindex="0" aria-label="${esc(labels[i])}: no value"><b>–</b></div>`
    : `<div class="rd-col" tabindex="0" aria-label="${esc(labels[i])}: ${fmt(v)} ${esc(unit)}" data-tip="${esc(labels[i])} · ${fmt(v)} ${esc(unit)}"><b>${fmt(v)}${cap && v > cap ? "+" : ""}</b><i style="height:${pct(shown[i])}%"></i></div>`).join("");
  const xs = labels.map((l) => `<span>${esc(l.replace(/^Answer /, ""))}</span>`).join("");
  const key = refBand ? `<span class="rd-key rd-key-band"></span>${esc(refLabel)}` : ref !== null ? `<span class="rd-key rd-key-line"></span>${esc(refLabel)}` : "";
  return `<figure class="rd-chart"><figcaption><b>${esc(title)}</b><span>${esc(unit)}${key ? ` · ${key}` : ""}</span></figcaption>
    <div class="rd-plot">${shade}${line}<div class="rd-cols">${cols}</div></div><div class="rd-xaxis" aria-hidden="true">${xs}</div></figure>`;
}

function hero(rep, r) {
  const score = num(rep.overall_score);
  const b = band(score);
  const c = r.changes && r.changes.score;
  const delta = c && c.same_role_as_last && num(c.since_last) !== null
    ? `<span class="rd-delta ${c.since_last > 0 ? "up" : c.since_last < 0 ? "down" : ""}">${c.since_last > 0 ? "▲" : c.since_last < 0 ? "▼" : "="} ${Math.abs(c.since_last)} since last time</span>` : "";
  const groups = (r.changes && r.changes.groups || []).filter((g) => !g.first_time && num(g.since_last) !== null && g.since_last !== 0)
    .sort((a, b2) => Math.abs(b2.since_last) - Math.abs(a.since_last)).slice(0, 3);
  return `<section class="rd-card rd-hero rd-${b.id}">
    <div class="rd-hero-top"><span class="label">Practice score</span>${delta}</div>
    <div class="rd-score"><b>${score === null ? "–" : score}</b><span>/ 100</span></div>
    <span class="rd-status">${icon(b.id)}${esc(b.label)}</span>
    <div class="rd-meter" role="img" aria-label="${score === null ? "No score" : `${score} out of 100`}; 70 and above is strong">
      <i style="width:${score === null ? 0 : score}%"></i><span class="rd-mark" style="left:70%"></span></div>
    <div class="rd-meter-scale" aria-hidden="true"><span>0</span><span class="rd-at" style="left:70%">70 · strong</span><span>100</span></div>
    <p class="rd-verdict">${esc(rep.verdict)}</p>
    ${groups.length ? `<p class="rd-changes">Since last time: ${groups.map((g) => `${esc(g.label)} <b class="${g.since_last > 0 ? "up" : "down"}">${g.since_last > 0 ? "+" : "−"}${one(Math.abs(g.since_last))}</b>`).join(" · ")}</p>` : ""}
  </section>`;
}

function kpis(rep, r) {
  const m = r.metrics || {};
  const qs = (rep.questions || []).filter((q) => q && q.question);
  const scoreOf = (q) => clamp(Number(q.score) || 0, 0, 10);
  const weakest = qs.length ? qs.reduce((w, q, i) => (scoreOf(q) < scoreOf(qs[w]) ? i : w), 0) : -1;
  const cand = num(m.candidateTalkSeconds) || 0, intv = num(m.interviewerTalkSeconds) || 0;
  const share = cand + intv ? Math.round((cand / (cand + intv)) * 100) : null;
  return `<section class="rd-kpis" aria-label="Key numbers">
    ${kpi("Answers scored", String(qs.length), weakest >= 0 ? `Weakest: Q${weakest + 1} · ${scoreOf(qs[weakest])}/10` : "")}
    ${kpi("Speaking pace", num(m.avgWpm) !== null ? `${m.avgWpm}<em>wpm</em>` : "–", "Comfortable: 120–160")}
    ${kpi("Pause before answering", num(m.avgResponseDelay) !== null ? `${one(m.avgResponseDelay)}<em>s</em>` : "–", num(m.longestPause) ? `Longest silence ${one(m.longestPause)} s` : "")}
    ${kpi("Filler words", String(num(m.fillersTotal) ?? 0), `${one(num(m.fillersPerMinute) || 0)} per minute`)}
    ${kpi("You spoke", share === null ? "–" : `${share}<em>%</em>`, "of the talking time",
      share === null ? "" : `<span class="rd-mini" aria-hidden="true"><i style="width:${share}%"></i></span>`)}
    ${kpi("Interview length", mmss(r.elapsed), num(m.interruptions) ? `${m.interruptions} interruption${m.interruptions === 1 ? "" : "s"}` : "")}
  </section>`;
}

function skills(rep, transcript) {
  const rows = rep.requirements || rep.competencies || [];
  if (!rows.length) return "";
  const body = rows.map((c) => {
    const score = num(c.score);
    const tags = [c.priority && PRIORITY[c.priority] ? `<em class="rd-tag">${PRIORITY[c.priority]}</em>` : "",
      c.status === "limited" && score !== null ? `<em class="rd-tag rd-tag-soft">Limited evidence</em>` : ""].join("");
    const evidence = (c.evidence_turns || []).map((n) => transcript[n - 1] && transcript[n - 1].text
      ? `<blockquote>${esc(transcript[n - 1].text)}</blockquote>` : "").join("");
    return `<details class="rd-skill">
      <summary><span class="rd-skill-name">${esc(c.label)}${tags}</span>
        <span class="rd-bar${score === null ? " rd-bar-none" : ""}" role="img" aria-label="${esc(c.label)}: ${score === null ? "not assessed" : `${score} out of 10`}">
          ${score === null ? "<span>Not assessed</span>" : `<i style="width:${score * 10}%"></i>`}<span class="rd-mark" style="left:70%"></span></span>
        <b class="rd-val">${score === null ? "–" : score}</b>${icon("chevron", "rd-chev")}</summary>
      <div class="rd-more">
        <p>${esc(c.explanation)}</p>
        ${c.source_quote ? `<p class="rd-src"><span>From the job description</span>${esc(c.source_quote)}</p>` : ""}
        ${c.assessment_method === "work_sample" ? `<p class="rd-src"><span>Practical test still needed</span>A spoken answer covers the reasoning only. ${esc(c.next_assessment || "Complete a relevant work sample.")}</p>` : ""}
        ${evidence ? `<div class="rd-evidence"><span>What you said</span>${evidence}</div>` : ""}
      </div></details>`;
  }).join("");
  const target = rep.plan ? `${esc(rep.plan.role)}${rep.plan.level ? ` · ${esc(rep.plan.level)}` : ""}` : "";
  const unresolved = (rep.unresolved_essentials || []);
  return `<section class="rd-card rd-skills">
    <header class="rd-card-head"><div><h3>Skills</h3><p>${target ? `${target} · ` : ""}out of 10 · the line marks 7, a strong answer</p></div></header>
    <div class="rd-skill-list">${body}</div>
    <p class="rd-foot-note">${esc(rep.coverage || "")}${unresolved.length ? ` · Still to show: ${unresolved.map((u) => esc(String(u).split(":")[0])).join(", ")}` : ""}</p>
  </section>`;
}

function plan(rep) {
  const f = rep.next_focus, check = rep.focus_check;
  const fc = check && FOCUS[check.status];
  const next = (rep.practice_next || []).filter(Boolean);
  if (!f && !next.length && !fc) return "";
  return `<section class="rd-card rd-plan">
    <header class="rd-card-head"><div><h3>Work on next</h3><p>The one habit that would lift your next interview</p></div></header>
    ${f && f.issue ? `<div class="rd-focus"><p class="rd-focus-issue">${esc(f.issue)}</p>${f.drill ? `<p class="rd-focus-drill"><b>Try this:</b> ${esc(f.drill)}</p>` : ""}</div>` : ""}
    ${fc ? `<p class="rd-check rd-${fc[0]}">${icon(fc[0])}<span><b>Last time's focus: ${fc[1]}.</b> ${esc(check.note || "")}</span></p>` : ""}
    ${next.length ? `<ol class="rd-steps">${next.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
  </section>`;
}

function questions(rep) {
  const qs = rep.questions || [];
  if (!qs.length) return `<section class="rd-card"><h3>Question by question</h3><p class="muted">No scored questions.</p></section>`;
  const scoreOf = (q) => clamp(Number(q.score) || 0, 0, 10);
  const weakest = qs.reduce((w, q, i) => (w < 0 || scoreOf(q) < scoreOf(qs[w]) ? i : w), -1);
  const rows = qs.map((q, i) => {
    const s = scoreOf(q);
    return `<details class="q rd-q" data-qi="${i}"${i === weakest ? " open" : ""}>
      <summary><span class="rd-qn">Q${i + 1}</span><span class="rd-qt">${esc(q.question)}${i === weakest ? ' <em class="rd-tag rd-tag-warn">Weakest</em>' : ""}</span>
        <span class="rd-bar" role="img" aria-label="${s} out of 10"><i style="width:${s * 10}%"></i><span class="rd-mark" style="left:70%"></span></span>
        <b class="rd-val">${s}<small>/10</small></b>${icon("chevron", "rd-chev")}</summary>
      <div class="rd-more rd-qa">
        <div><span class="rd-k">What you said</span><p>${esc(q.answer_gist)}</p></div>
        <div><span class="rd-k">What was missing</span><p>${esc(q.what_was_missing)}</p></div>
        <div class="rd-better"><span class="rd-k">A stronger answer</span><p>${esc(q.better_answer)}</p></div>
      </div></details>`;
  }).join("");
  return `<section class="rd-card rd-questions">
    <header class="rd-card-head"><div><h3>Question by question</h3><p>Score out of 10 · open a question to see what was missing and a stronger answer</p></div></header>
    <div class="rd-q-list">${rows}</div></section>`;
}

function delivery(rep, r) {
  const m = r.metrics || {};
  const d = rep.delivery || {};
  // A one-word "yes" has no pace worth charting; the table still lists every answer.
  const answers = (m.answers || []).map((a, i) => ({ ...a, n: i + 1 })).filter((a) => (a.words || 0) >= 5 && (a.seconds || 0) >= 2);
  const shown = answers.slice(-16);
  const labels = shown.map((a) => `Answer ${a.n}`);
  const charts = shown.length >= 2 ? `<div class="rd-charts">
      ${columns({ title: "Pause before each answer", unit: "seconds", values: shown.map((a) => num(a.responseDelay)), labels, ref: 3, refLabel: "aim under 3 s", digits: 1 })}
      ${columns({ title: "Speaking pace", unit: "words per minute", values: shown.map((a) => num(a.wpm)), labels, refBand: [120, 160], refLabel: "comfortable 120–160", cap: 260 })}
    </div>` : "";
  const notes = [["Pace", d.pace], ["Fillers", d.fillers], ["Confidence", d.confidence], ["Structure", d.structure]].filter(([, t]) => t);
  const table = (m.answers || []).length ? `<details class="rd-table"><summary>All answers as a table</summary><div class="rd-scroll"><table>
      <thead><tr><th>Answer</th><th>Words</th><th>Length</th><th>Pause before</th><th>Pace</th><th>Fillers</th></tr></thead>
      <tbody>${m.answers.map((a, i) => `<tr><td>${i + 1}</td><td>${a.words}</td><td>${one(a.seconds)} s</td><td>${a.responseDelay === null ? "–" : `${one(a.responseDelay)} s`}</td><td>${a.wpm} wpm</td><td>${a.fillers}</td></tr>`).join("")}</tbody>
    </table></div></details>` : "";
  if (!charts && !notes.length) return "";
  return `<section class="rd-card rd-delivery">
    <header class="rd-card-head"><div><h3>How you sounded</h3><p>Measured from your microphone, answer by answer</p></div></header>
    ${charts}
    ${notes.length ? `<dl class="rd-notes">${notes.map(([k, t]) => `<div><dt>${k}</dt><dd>${esc(t)}</dd></div>`).join("")}</dl>` : ""}
    ${table}
  </section>`;
}

function strengths(rep) {
  const good = (rep.strengths || []).filter(Boolean), bad = (rep.weaknesses || []).filter(Boolean);
  if (!good.length && !bad.length) return "";
  const list = (xs, kind) => xs.map((x) => `<li>${icon(kind)}<span>${esc(x)}</span></li>`).join("");
  return `<section class="rd-card rd-sw">
    <div><h3>What worked</h3><ul class="rd-list rd-good">${list(good, "good")}</ul></div>
    <div><h3>What hurt</h3><ul class="rd-list rd-low">${list(bad, "low")}</ul></div>
  </section>`;
}

/** The whole report, as one dashboard. */
export function reportHtml(r) {
  const rep = r.report || {};
  const when = r.at ? new Date(r.at) : null;
  const sub = [when && !isNaN(when) ? when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "",
    mmss(r.elapsed), `${(rep.questions || []).length} questions`, r.language || ""].filter(Boolean).join(" · ");
  const title = rep.plan && rep.plan.role && rep.plan.mode !== "general_cv" ? rep.plan.role : "Mock interview";
  return `<div class="rd">
    <header class="rd-head"><span class="label">Interview report</span><h2>${esc(title)}</h2><p>${esc(sub)}</p></header>
    <div class="rd-top">${hero(rep, r)}${kpis(rep, r)}</div>
    <div class="rd-row">${skills(rep, r.transcript || [])}${plan(rep)}</div>
    ${questions(rep)}
    <div class="rd-row">${delivery(rep, r)}${strengths(rep)}</div>
    <p class="rd-fine">Practice feedback from Google Gemini, not a hiring decision. Scores cover only what this interview tested.</p>
  </div>`;
}

/* One floating readout for every chart mark: on hover and on keyboard focus, the same text. `root` is the
 * dashboard (.rd) just drawn; a redraw brings a new one. */
export function wireReport(root) {
  if (!root || root.dataset.rdWired) return;
  root.dataset.rdWired = "1";
  const tip = document.createElement("div");
  tip.className = "rd-tip"; tip.setAttribute("role", "status"); tip.hidden = true;
  root.appendChild(tip);
  const show = (el) => {
    const text = el && el.dataset.tip;
    if (!text) { tip.hidden = true; return; }
    tip.textContent = text;
    tip.hidden = false;
    const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    tip.style.left = `${a.left - b.left + a.width / 2}px`;
    tip.style.top = `${a.top - b.top - 8}px`;
  };
  root.addEventListener("pointerover", (e) => show(e.target.closest("[data-tip]")));
  root.addEventListener("pointerleave", () => { tip.hidden = true; });
  root.addEventListener("focusin", (e) => show(e.target.closest("[data-tip]")));
  root.addEventListener("focusout", () => { tip.hidden = true; });
}
