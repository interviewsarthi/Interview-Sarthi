/* The ATS resume checker page: reads a CV inside the browser and shows what a parser would see.
 *
 * The file never leaves this tab. PDF.js and Mammoth (loaded from cdnjs only when a file is chosen) turn it
 * into text here, and assets/ats-engine.js scores it. The one request that carries anything job-related is
 * the public job description fetched by id when a visitor arrives from an ApplySarthi job
 * (?job=source:id), the same call Prep Sarthi makes. analytics.js keeps session recording off these pages,
 * because the parser view below prints the CV on screen.
 */
(function () {
  "use strict";
  var ATS = window.SarthiATS;
  var root = document.getElementById("checker");
  if (!ATS || !root) return;

  var ASSETS = new URL(".", (document.currentScript && document.currentScript.src) || location.href);
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  var MAMMOTH = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";
  var APPLY = "https://apply.interviewsarthi.com";
  var MAX_BYTES = 5 * 1024 * 1024, MAX_PAGES = 6;

  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $("ats-file"), drop = $("ats-drop"), fileName = $("ats-filename"), paste = $("ats-text"),
      jdBox = $("ats-jd"), roleSel = $("ats-role"), goBtn = $("ats-go"), statusEl = $("ats-status"),
      out = $("ats-result"), fromEl = $("ats-from");

  var state = { cv: null, source: "", job: null, last: null };
  var dataReady = fetch(new URL("ats-skills.json", ASSETS)).then(function (r) {
    if (!r.ok) throw new Error("skills " + r.status);
    return r.json();
  }).then(function (data) { return { data: data, vocab: ATS.compileVocab(data) }; });

  function track(name, params) {
    try { if (window.sarthiTrack) window.sarthiTrack(name, params || {}); } catch (e) { /* never block the check */ }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function say(text, isError) {
    statusEl.textContent = text || "";
    statusEl.className = "ats-status" + (isError ? " err" : "");
  }

  var loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src; s.async = true; s.crossOrigin = "anonymous";
        s.onload = resolve;
        s.onerror = function () { delete loaded[src]; reject(new Error("load")); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  /* ---------------------------------------------------------------- PDF */

  /* The text in the order the file stores it, which is the order a simple parser reads. A two-column
   * CV comes out interleaved here exactly as it does for those parsers, so "What the parser sees" shows it. */
  function streamText(items) {
    var s = "", lastY = null, lastEnd = null;
    items.forEach(function (it) {
      if (typeof it.str !== "string") return;
      var x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
      if (lastY !== null && it.str) {
        if (Math.abs(y - lastY) > h * 0.5) { if (!/\n$/.test(s)) s += "\n"; }
        else if (lastEnd !== null && x - lastEnd > h * 0.15 && !/\s$/.test(s) && !/^\s/.test(it.str)) s += " ";
      }
      s += it.str;
      if (it.hasEOL) s += "\n";
      if (it.str.trim()) { lastY = y; lastEnd = x + it.width; }
    });
    return s;
  }

  /* How many lines have text starting at the same point in the middle of the page (a second column),
   * on a page where other lines start at the left margin. Right-aligned dates start further right than
   * 62% of the width, and centred headings do not share one start point, so neither counts. */
  function columnHits(items, width) {
    var rows = {};
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var key = Math.round(it.transform[5] / 3);
      (rows[key] = rows[key] || []).push({ x: it.transform[4], end: it.transform[4] + it.width });
    });
    var starts = {}, lines = 0, left = 0;
    Object.keys(rows).forEach(function (k) {
      var r = rows[k].sort(function (a, b) { return a.x - b.x; });
      lines++;
      if (r[0].x < 0.2 * width) left++;
      var seg = [r[0].x];
      for (var i = 1; i < r.length; i++) if (r[i].x - r[i - 1].end > 0.04 * width) seg.push(r[i].x);
      var seen = {};
      seg.forEach(function (x) {
        if (x > 0.22 * width && x < 0.62 * width) {
          var b = Math.round(x / (0.015 * width));
          if (!seen[b]) { seen[b] = 1; starts[b] = (starts[b] || 0) + 1; }
        }
      });
    });
    var best = 0;
    Object.keys(starts).forEach(function (b) {
      b = +b;
      best = Math.max(best, (starts[b] || 0) + (starts[b - 1] || 0) + (starts[b + 1] || 0));
    });
    return { lines: lines, hits: lines && left >= 0.15 * lines ? best : 0 };
  }

  function readPdf(buf) {
    return loadScript(PDFJS + "pdf.min.js").then(function () {
      var lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
      // isEvalSupported off: the documented mitigation for CVE-2024-4367 in PDF.js 3.x.
      return lib.getDocument({ data: buf, isEvalSupported: false }).promise.then(function (doc) {
        var n = Math.min(doc.numPages, MAX_PAGES), texts = [], links = [], images = false, lines = 0, hits = 0;
        var chain = Promise.resolve();
        for (var p = 1; p <= n; p++) {
          (function (p) {
            chain = chain.then(function () { return doc.getPage(p); }).then(function (page) {
              var width = page.getViewport({ scale: 1 }).width;
              return page.getTextContent().then(function (tc) {
                texts.push(streamText(tc.items));
                var c = columnHits(tc.items, width);
                lines += c.lines; hits += c.hits;
                return page.getAnnotations().catch(function () { return []; });
              }).then(function (ann) {
                ann.forEach(function (a) { if (a.url) links.push(a.url); });
                if (p !== 1) return;
                return page.getOperatorList().then(function (ops) {
                  var O = lib.OPS;
                  images = ops.fnArray.some(function (fn) {
                    return fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat;
                  });
                }).catch(function () {});
              });
            });
          })(p);
        }
        return chain.then(function () {
          return { text: texts.join("\n"), kind: "pdf", pages: doc.numPages,
                   columns: lines >= 10 ? hits / lines : 0, images: images, links: links };
        });
      });
    });
  }

  /* ---------------------------------------------------------------- Word */

  function readDocx(buf) {
    return loadScript(MAMMOTH).then(function () {
      return window.mammoth.convertToHtml({ arrayBuffer: buf });
    }).then(function (res) {
      var doc = new DOMParser().parseFromString(res.value, "text/html"), lines = [];
      doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li").forEach(function (el) {
        if (el.tagName === "P" && el.closest("li")) return;
        var c = el.cloneNode(true);
        c.querySelectorAll("ul,ol").forEach(function (n) { n.remove(); });
        var t = c.textContent.replace(/\s+/g, " ").trim();
        if (t) lines.push((el.tagName === "LI" ? "• " : "") + t);
      });
      return { text: lines.join("\n"), kind: "docx", pages: null, tables: doc.querySelectorAll("table").length,
               images: doc.querySelectorAll("img").length > 0,
               links: Array.prototype.map.call(doc.querySelectorAll("a[href]"), function (a) { return a.getAttribute("href"); }) };
    });
  }

  function readFile(file) {
    var name = (file.name || "").toLowerCase();
    if (file.size > MAX_BYTES) return Promise.reject(new Error("big"));
    if (/\.doc$/.test(name)) return Promise.reject(new Error("doc"));
    var reader = /\.pdf$/.test(name) || file.type === "application/pdf" ? readPdf
      : /\.docx$/.test(name) ? readDocx : null;
    if (!reader) return Promise.reject(new Error("type"));
    return file.arrayBuffer().then(reader);
  }

  var ERRORS = {
    big: "This file is over 5 MB. Export the CV again as a PDF: most CVs are well under 1 MB.",
    doc: "Old Word .doc files can't be read here. Save it as .docx or PDF, or paste the text below.",
    type: "Choose a PDF or a Word (.docx) file, or paste your CV's text below.",
    load: "The file reader didn't load. Check your connection and try again, or paste your CV's text below.",
    PasswordException: "This PDF is locked with a password. An ATS can't open it either: save an unlocked copy and try that.",
    InvalidPDFException: "This file couldn't be read as a PDF. Export it again from Word or Google Docs."
  };

  function chooseFile(file) {
    if (!file) return;
    fileName.hidden = false;
    fileName.textContent = file.name;
    say("Reading " + file.name + "…");
    readFile(file).then(function (cv) {
      state.cv = cv; state.source = "file";
      run();
    }).catch(function (e) {
      var key = (e && (e.name in ERRORS ? e.name : e.message)) || "";
      say(ERRORS[key] || "This file couldn't be read. Export it again as a PDF, or paste your CV's text below.", true);
      track("ats_error", { reason: ERRORS[key] ? key : "other" });
    });
  }

  /* ---------------------------------------------------------------- the result */

  var VERDICT = {
    ready: ["Ready to send", "An ATS can read this CV, and every main section is where a parser looks for it."],
    good: ["Good, with a few fixes", "A parser can read it. The points below will make it stronger."],
    work: ["Needs work", "Parts of this CV will be lost or skipped. Start with the fixes below."],
    fix: ["Fix this before you apply", "A parser will lose important parts of this CV. Fix the first points below before you send it anywhere."]
  };
  var ICON = { pass: ["✓", "Passed"], warn: ["!", "Worth fixing"], fail: ["✕", "Problem"], na: ["–", "Not checked"] };

  /* "DevOps and cloud engineer" -> "DevOps and cloud engineer", "Data analyst" -> "data analyst": names
   * with capitals inside (DevOps, QA, AI/ML) keep them. Same rule as apply_pages/ats.py in_sentence(). */
  function inSentence(label) {
    return label.split(" ").map(function (w) { return /[A-Z]/.test(w.slice(1)) ? w : w.toLowerCase(); }).join(" ");
  }

  function chips(list, cls) {
    return list.map(function (s) { return '<span class="chip ' + cls + '">' + esc(s) + "</span>"; }).join("");
  }

  function matchHtml(m, target) {
    if (!m) {
      return '<div class="ats-match"><h3>Job match</h3><p>Paste a job description above, or choose a role, to see ' +
        "which of its skills your CV is missing.</p></div>";
    }
    var sk = m.skills, tm = m.terms;
    var words = tm.missing.length
      ? '<p class="ats-chips"><span class="ats-k">Words the description repeats that your CV never uses</span>' +
        chips(tm.missing, "miss") + "</p>" : "";
    var note = '<p class="note">Add a skill or a word only where it describes work you really did. A recruiter ' +
      "will ask about every line.</p>";
    if (!m.enough) {
      if (!tm.found.length && !tm.missing.length) {
        return '<div class="ats-match"><h3>Job match</h3><p>This description is too short to compare with. ' +
          "Paste the whole job description, including the requirements.</p></div>";
      }
      return '<div class="ats-match"><h3>Words this job repeats</h3><p>The description names too few skills from ' +
        "our list to give a percentage, which is usual outside technical roles. Your CV uses " + tm.found.length +
        " of the " + (tm.found.length + tm.missing.length) + " words it repeats most.</p>" + words + note + "</div>";
    }
    var what = m.kind === "role" ? esc(inSentence(target.role.label)) + " postings" : "this job";
    return '<div class="ats-match ats-m-' + m.band + '"><h3>Match with ' + what + ": " + m.percent + "%</h3>" +
      "<p>" + sk.found.length + " of " + (sk.found.length + sk.missing.length) + " skills found.</p>" +
      (sk.found.length ? '<p class="ats-chips"><span class="ats-k">In your CV</span>' + chips(sk.found, "ok") + "</p>" : "") +
      (sk.missing.length ? '<p class="ats-chips"><span class="ats-k">' +
        (m.kind === "role" ? "Named often in these postings, not in your CV" : "Missing") + "</span>" +
        chips(sk.missing, "miss") + "</p>" : "") +
      words + note + "</div>";
  }

  /* The job match in the top card, beside the health score. Health is about the file and does not move when
   * the job does; without this row, choosing a role looked like it changed nothing (owner, 2 Oct 2026). */
  var FIT = { strong: "Strong fit", partial: "Partial fit", weak: "Weak fit" };
  function fitHtml(m, target) {
    var see = ' <button type="button" class="ats-linkbtn" data-tab="1">See the job match</button>';
    if (!m) {
      return '<div class="ats-fit ats-f-none"><p>This score is about how readable your CV is, for any job. ' +
        "Paste a job description or pick a role to see how well it fits.</p></div>";
    }
    if (!m.enough) {
      return '<div class="ats-fit ats-f-none"><p>This job names too few skills from our list for a match score.' + see + "</p></div>";
    }
    var what = m.kind === "role" ? esc(inSentence(target.role.label)) + " postings" : "this job";
    var sk = m.skills, total = sk.found.length + sk.missing.length;
    var missing = sk.missing.length
      ? " Missing: " + sk.missing.slice(0, 3).map(esc).join(", ") +
        (sk.missing.length > 3 ? " and " + (sk.missing.length - 3) + " more" : "") + "."
      : " Every skill it names is in your CV.";
    return '<div class="ats-fit ats-f-' + m.band + '"><div class="ats-fit-num"><b>' + m.percent + '%</b><span>match</span></div>' +
      '<div><p class="ats-fit-title">' + FIT[m.band] + " for " + what + "</p><p>" + sk.found.length + " of " + total +
      " skills found." + missing + see + "</p></div></div>";
  }

  /* Which role a pasted description is for: the role whose common skills it names most, when one clearly
   * leads (three or more shared skills, ahead of every other role). Otherwise no guess. */
  function guessRole(m, roles) {
    if (!m || m.kind !== "jd") return null;
    var named = {}, best = null, bestN = 0, second = 0;
    m.skills.found.concat(m.skills.missing).forEach(function (s) { named[s] = 1; });
    Object.keys(roles).forEach(function (slug) {
      var n = roles[slug].skills.filter(function (p) { return p[1] >= 10 && named[p[0]]; }).length;
      if (n > bestN) { second = bestN; bestN = n; best = slug; } else if (n > second) second = n;
    });
    return bestN >= 3 && bestN > second ? best : null;
  }

  /* What to do next, by what the visitor gave us and how the CV did (owner, 2 Oct 2026: "see every logic, what
   * should happen where"; the leading checkers were studied the same day). One main button per situation,
   * each label naming where it goes, and "sign in" said before the click, never after:
   *   unreadable file              -> how to export a readable PDF        | paste the text instead
   *   no job, no role              -> check it against a job (same page)  | jobs that fit this CV (ApplySarthi)
   *   role / pasted job, below 75% -> fix the missing skills (same page)  | that role's jobs in India
   *   role / pasted job, 75%+      -> practise this interview (Prep)      | that role's jobs in India
   *   job from ApplySarthi, < 75%  -> tailor my CV for this job           | practise this interview
   *   job from ApplySarthi, 75%+   -> practise this interview             | tailor it · view job and apply
   * Practise hands this CV and job to Prep Sarthi inside the browser (same site), so nothing is uploaded twice.
   * ApplySarthi links go through its /go/ counter; it lands only on its own lists or the app. */
  function goApply(slot, extra) { return APPLY + "/go/apply?slot=" + slot + (extra || ""); }

  function nextHtml(res, m, target, roles) {
    var j = state.job, act = "";
    var btn = function (cls, label, attrs) { return '<a class="cta' + cls + '" ' + attrs + ">" + label + "</a>"; };
    var main = function (label, attrs) { return btn("", label, attrs); };
    var second = function (label, attrs) { return btn(" ghost", label, attrs); };
    var live = '<p class="alsotry">Interview booked? <a href="/live/" data-act="live">Live Sarthi</a> shows answer ' +
      "hints during the call (Windows, 30 minutes free).</p>";
    var signIn = '<p class="ats-cost">ApplySarthi is free. You sign in with Google or email and upload your CV there; ' +
      "this page never uploads it.</p>";
    if (res.unreadable) {
      return '<div class="ats-next" data-next="unreadable"><h3>Next: get a file an ATS can read</h3>' +
        "<p>Export your CV again from Word or Google Docs as a PDF, then check it here. Or paste its text below to see " +
        "the rest of the checks now.</p><p class=\"ats-btns\">" +
        main("How to make a PDF an ATS can read", 'href="../guides/ats-resume-format-india.html" data-act="guide"') +
        '<button type="button" class="cta ghost" data-act="paste">Paste the text instead</button></p></div>';
    }
    var role = target && target.role ? { slug: target.slug, r: target.role } : null;
    if (!role && !j) { var g = guessRole(m, roles); if (g) role = { slug: g, r: roles[g], guessed: true }; }
    var roleName = role ? esc(inSentence(role.r.label)) : "";
    var good = !!(m && m.enough && m.band === "strong");
    var prepLabel = role && !(m && m.kind === "jd") && !j ? "Practise a " + roleName + " interview" : "Practise this interview";
    var prep = main(prepLabel + " (free 7-min demo)", 'href="/prep/app/?from=ats" data-act="prep"');
    var prepSecond = second(prepLabel, 'href="/prep/app/?from=ats" data-act="prep"');
    if (j) {
      var jq = "&source=" + encodeURIComponent(j.source) + "&id=" + encodeURIComponent(j.id);
      var tailor = 'href="' + goApply("ats_tailor", jq) + '" data-act="tailor"';
      var view = second("View job and apply", 'href="' + APPLY + "/go/job/" + encodeURIComponent(j.source) + "/" +
        encodeURIComponent(j.id) + '" target="_blank" rel="noopener" data-act="view"');
      var name = esc(j.title || "this job") + (j.company ? " at " + esc(j.company) : "");
      return good
        ? '<div class="ats-next" data-next="job-ready"><h3>Next: practise the ' + name + " interview</h3>" +
          "<p>Your CV already fits this job well. Rehearse it out loud with Prep Sarthi, using your CV and this job.</p>" +
          '<p class="ats-btns">' + prep + second("Tailor my CV for this job", tailor) + view + "</p>" + live + "</div>"
        : '<div class="ats-next" data-next="job-fix"><h3>Next: tailor your CV for ' + name + "</h3>" +
          "<p>ApplySarthi rewrites your CV for this job, using only what your CV already says, and gives you a clean " +
          "one-column PDF. Sign in, upload your CV, and it is made for you.</p>" +
          '<p class="ats-btns">' + main("Tailor my CV for this job, free", tailor) + prepSecond + "</p>" + signIn + live + "</div>";
    }
    var list = role
      ? second("See " + roleName + " jobs in India", 'href="' + goApply(role.guessed ? "ats_similar" : "ats_role",
          "&to=" + encodeURIComponent(role.r.jobs)) + '" data-act="list"')
      : second("Find jobs in India", 'href="' + goApply("ats_all", "&to=" + encodeURIComponent("/jobs-in/india")) + '" data-act="list"');
    var listNote = '<p class="ats-cost">On ApplySarthi, open a job and press <b>Tailor my CV for this job</b>. Free; ' +
      "you sign in and upload your CV there.</p>";
    if (!m) {
      return '<div class="ats-next" data-next="no-job"><h3>Next: check it against a job</h3>' +
        "<p>A CV is only as good as its fit to the job. Paste a job description, or pick a role, and see which " +
        "skills recruiters for it will not find in your CV.</p>" +
        '<p class="ats-btns"><button type="button" class="cta" data-act="job">Check it against a job</button>' +
        second("See jobs that fit this CV", 'href="' + goApply("ats_fit", "&want=matches") + '" data-act="fit"') +
        "</p>" + signIn + live + "</div>";
    }
    if (good) {
      return '<div class="ats-next" data-next="ready"><h3>Next: practise the interview</h3>' +
        "<p>Your CV covers what " + (role && !role.guessed && m.kind === "role" ? roleName + " postings" : "this job") +
        " ask for. Rehearse it out loud with Prep Sarthi, using this CV" + (m.kind === "jd" ? " and this job" : "") + ".</p>" +
        '<p class="ats-btns">' + prep + list + "</p>" + listNote + live + "</div>";
    }
    return '<div class="ats-next" data-next="fix"><h3>Next: add the skills you are missing</h3>' +
      "<p>Recruiters search by these words. Add each one you have really used, in the role where you used it, then " +
      "check your CV again.</p>" +
      '<p class="ats-btns"><button type="button" class="cta" data-act="fix">Fix the missing skills</button>' + list + "</p>" +
      listNote + live + "</div>";
  }

  /* Below the missing skills in the Job match tab: how to fix them, and the way back to a fresh check. */
  function fixHtml(m) {
    if (!m || (m.enough && m.band === "strong") || !(m.skills.missing.length || m.terms.missing.length)) return "";
    return '<div class="ats-fix"><h3>How to fix it</h3><ol>' +
      "<li>Open your CV in Word or Google Docs.</li>" +
      "<li>For each missing skill you have really used, name it in the job where you used it (" +
      '"Automated regression tests in Selenium") and add it to your Skills list.</li>' +
      "<li>Save it as a PDF and check it again here.</li></ol>" +
      '<p class="ats-btns"><button type="button" class="cta" data-act="recheck">Check my updated CV</button></p>' +
      '<p class="note">Never add a skill you have not used. A recruiter will ask about every line.</p></div>';
  }

  /* Prep Sarthi is on this site: hand it the CV and the job inside this tab, so it opens ready to start. */
  function handToPrep(target) {
    var j = state.job, jd = jdBox.value.trim(), role = "";
    if (j && jd) jd = [j.title, j.company && "at " + j.company].filter(Boolean).join(" ") + "\n\n" + jd;
    if (!jd && target && target.role) role = inSentence(target.role.label);
    try {
      sessionStorage.setItem("sarthi_ats_handoff", JSON.stringify({ cv: state.cv ? state.cv.text : "", jd: jd.length >= 80 ? jd : "",
                                                                    role: role, at: Date.now() }));
    } catch (e) { /* Prep still opens; the visitor adds the CV there */ }
  }

  function render(res, m, target, cv, roles) {
    var v = res.unreadable ? ["An ATS can't read this file", res.groups[0].checks[0].detail] : VERDICT[res.band];
    var html = '<div class="ats-summary"><span class="ats-eyebrow">RESUME HEALTH</span><div class="ats-score ats-b-' + res.band + '"><div class="ats-num"><b>' + res.score +
      "</b><span>/100</span></div><div><p class=\"ats-verdict\">" + esc(v[0]) + "</p><p>" + esc(v[1]) + "</p></div></div>" +
      '<div class="ats-meter" aria-hidden="true"><i style="width:' + res.score + '%"></i></div>';
    if (!res.unreadable) html += fitHtml(m, target);
    html += '</div><div class="ats-tabs" role="tablist" aria-label="Resume report">' +
      ['Overview', 'Job match', 'All checks', 'Parser view'].map(function (label, i) {
        return '<button type="button" role="tab" id="ats-tab-' + i + '" aria-controls="ats-panel-' + i +
          '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? '0' : '-1') + '">' + label + '</button>';
      }).join('') + '</div><div class="ats-panel" role="tabpanel" id="ats-panel-0" aria-labelledby="ats-tab-0">';
    if (!res.unreadable && res.fixes.length) {
      html += '<h3 class="ats-sub">Fix these first</h3><ol class="ats-fixes">' + res.fixes.map(function (c) {
        return "<li><b>" + esc(c.title) + ".</b> " + esc(c.detail) + "</li>";
      }).join("") + "</ol>";
    }
    if (!res.fixes.length && !res.unreadable) html += '<div class="ats-clear"><h3>No priority fixes</h3><p>Your CV passed the main checks. Review the job match before applying.</p></div>';
    html += '</div><div class="ats-panel" role="tabpanel" id="ats-panel-1" aria-labelledby="ats-tab-1" hidden>';
    html += res.unreadable ? '<p>Upload a readable CV to compare skills.</p>' : matchHtml(m, target) + fixHtml(m);
    html += '</div><div class="ats-panel" role="tabpanel" id="ats-panel-2" aria-labelledby="ats-tab-2" hidden><div class="ats-check-grid">';
    res.groups.forEach(function (g) {
      var got = 0, of = 0;
      g.checks.forEach(function (c) { if (c.status !== "na") { got += c.earned; of += c.weight; } });
      html += '<div class="ats-group"><h3>' + esc(g.title) + "<span>" + Math.round(got) + " / " + of + "</span></h3><ul>" +
        g.checks.map(function (c) {
          var ic = ICON[c.status];
          return '<li class="ats-' + c.status + '"><i aria-label="' + ic[1] + '" role="img">' + ic[0] + "</i><b>" +
            esc(c.title) + "</b> " + esc(c.detail) + "</li>";
        }).join("") + "</ul></div>";
    });
    html += '</div></div><div class="ats-panel" role="tabpanel" id="ats-panel-3" aria-labelledby="ats-tab-3" hidden><details open class="ats-seen"><summary>What the parser sees</summary><p class="note">The text as it ' +
      "comes out of your file, in the order a simple parser reads it. If sections are mixed together or your " +
      "phone number is missing here, an ATS has the same problem.</p><pre>" +
      esc((cv.text || "").slice(0, 8000)) + ((cv.text || "").length > 8000 ? "\n…" : "") + "</pre></details>";
    // The next step sits under the tabs, not inside Overview: it must stay in view whichever tab is open.
    html += "</div>" + nextHtml(res, m, target, roles);
    var previousTab = out.querySelector('[role="tab"][aria-selected="true"]');
    var activeIndex = previousTab ? Number(previousTab.id.replace("ats-tab-", "")) : 0;
    out.innerHTML = html;
    out.hidden = false;
    $("ats-empty").hidden = true;
    var tabs = out.querySelectorAll('[role="tab"]');
    function selectTab(index) {
      tabs.forEach(function (tab, i) {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
        $("ats-panel-" + i).hidden = i !== index;
      });
    }
    selectTab(activeIndex);
    out.querySelectorAll("[data-act]").forEach(function (el) {
      el.addEventListener("click", function () {
        var a = el.getAttribute("data-act");
        track("ats_next", { action: a, state: (out.querySelector(".ats-next") || {}).getAttribute ?
          out.querySelector(".ats-next").getAttribute("data-next") : "" });
        if (a === "prep") handToPrep(target);
        else if (a === "fix") { selectTab(1); tabs[1].focus(); }
        else if (a === "recheck") fileInput.click();
        else if (a === "job") { jdBox.scrollIntoView({ behavior: "smooth", block: "center" }); jdBox.focus(); }
        else if (a === "paste") {
          var d = paste.closest("details"); if (d) d.open = true;
          paste.scrollIntoView({ behavior: "smooth", block: "center" }); paste.focus();
        }
      });
    });
    out.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = Number(btn.getAttribute("data-tab"));
        selectTab(i);
        tabs[i].focus();
      });
    });
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { selectTab(i); });
      tab.addEventListener('keydown', function (e) {
        var next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (next !== null) { e.preventDefault(); selectTab(next); tabs[next].focus(); }
      });
    });
  }

  function target() {
    var jd = jdBox.value.trim();
    if (jd.length >= 80) {
      return { jd: jd, exclude: state.job && state.job.company ? state.job.company.split(/\s+/) : [] };
    }
    return roleSel.value ? { role: null, slug: roleSel.value } : null;
  }

  function run() {
    if (state.source !== "file") {
      state.cv = paste.value.trim() ? { text: paste.value, kind: "text" } : null;
      state.source = "paste";
    }
    if (!state.cv) {
      out.hidden = true;
      $("ats-empty").hidden = false;
      say("Choose your CV first, or paste its text.", true);
      return;
    }
    say("Checking…");
    dataReady.then(function (d) {
      var t = target();
      if (t && t.slug) t.role = d.data.roles[t.slug] || null;
      if (t && t.slug && !t.role) t = null;
      var res = ATS.analyse(state.cv);
      var m = !res.unreadable && t ? ATS.matchJob(d.vocab, state.cv.text, t) : null;
      render(res, m, t, state.cv, d.data.roles);
      say("");
      var sig = res.score + "|" + (m ? m.kind + m.percent : "none") + "|" + state.source;
      if (sig !== state.last) {
        state.last = sig;
        track("ats_check", { file_kind: state.cv.kind, score_band: res.band,
                             match: m ? m.kind : "none", match_band: m && m.enough ? m.band : "none" });
      }
      if (!statusEl.textContent && out.getBoundingClientRect().top > window.innerHeight) {
        out.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }).catch(function () {
      say("The checker couldn't load its skill list. Check your connection and try again.", true);
    });
  }

  /* ---------------------------------------------------------------- arriving from an ApplySarthi job */

  function loadJob() {
    var q = new URLSearchParams(location.search), job = q.get("job") || "";
    var m = job.match(/^([a-z0-9_]{1,40}):(.{1,200})$/i);
    if (!m) return;
    fetch(APPLY + "/api/jd?source=" + encodeURIComponent(m[1]) + "&source_id=" + encodeURIComponent(m[2]))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.text) return;
        state.job = { source: m[1], id: m[2], company: j.company || "", title: j.title || "" };
        if (!jdBox.value.trim()) jdBox.value = j.text;
        fromEl.hidden = false;
        fromEl.textContent = "Comparing with " + (j.title || "this job") + (j.company ? " at " + j.company : "") +
          ", from ApplySarthi.";
        if (state.cv) run();
      }).catch(function () { /* the visitor can still paste the description */ });
  }

  /* ---------------------------------------------------------------- wiring */

  fileInput.addEventListener("change", function () { chooseFile(fileInput.files && fileInput.files[0]); });
  ["dragenter", "dragover"].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (t) {
    drop.addEventListener(t, function () { drop.classList.remove("drag"); });
  });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    chooseFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  paste.addEventListener("input", function () { state.source = "paste-edit"; rerun(); });
  goBtn.addEventListener("click", run);
  var again;
  function rerun() {
    clearTimeout(again);
    if (state.cv && !out.hidden) again = setTimeout(run, 500);
  }
  jdBox.addEventListener("input", rerun);
  roleSel.addEventListener("change", rerun);
  loadJob();
})();
