/* ATS resume check: what a parser can read in a CV, and how the CV matches a job.
 *
 * Pure functions and no DOM. The page (assets/ats-checker.js) reads the file inside the browser and hands
 * over the text plus what it saw of the layout; tests/ats_engine.test.mjs runs this same file under Node.
 * Nothing here sends anything anywhere.
 *
 * The framing follows apply/guides/ats-resume-format-india.html: no ATS computes a score. This one adds up
 * the failures that actually happen (a file with no text, columns read across, contact details lost,
 * headings a parser does not recognise, dates it cannot read) and the Indian CV habits that waste the
 * first screen a recruiter sees. The job match is the same dictionary ApplySarthi uses to read skills off
 * job descriptions (Job-Hunt jobhunt/skillvocab.py, exported to assets/ats-skills.json), so a skill counts
 * here exactly when it counts there.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SarthiATS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- skills, as skillvocab.py reads them */

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&"); }

  /* One alternation for the whole vocabulary, longest spelling first so "react native" beats "react".
   * Canonical names of two characters or fewer ("R", "Go", "C#") are matched case-sensitively with
   * stricter neighbours, because "r" and "go" are ordinary words. Mirrors skillvocab._compile(). */
  function compileVocab(data) {
    var lookup = {}, plain = {}, letters = {};
    Object.keys(data.vocab).forEach(function (canon) {
      [canon].concat(data.vocab[canon]).forEach(function (spelling) {
        lookup[spelling.toLowerCase()] = canon;
        (canon.length <= 2 ? letters : plain)[spelling] = 1;
      });
    });
    function alternation(set) {
      return Object.keys(set).sort(function (a, b) { return b.length - a.length; }).map(esc).join("|");
    }
    var ambiguous = {};
    Object.keys(data.ambiguous || {}).forEach(function (canon) {
      var pair = data.ambiguous[canon];
      ambiguous[canon] = new RegExp(pair[0], pair[1] || "");
    });
    return {
      lookup: lookup,
      big: new RegExp("(?<![A-Za-z0-9+#.])(?:" + alternation(plain) + ")(?![A-Za-z0-9+#])", "gi"),
      small: Object.keys(letters).length
        ? new RegExp("(?<![A-Za-z0-9+#.&/])(?:" + alternation(letters) + ")(?![A-Za-z0-9+#&/])", "g") : null,
      ambiguous: ambiguous,
      maxScan: data.max_scan || 20000
    };
  }

  /* Canonical skill names named in the text, most-mentioned first (skillvocab.skills_in). */
  function skillsIn(vocab, text, limit, scan) {
    text = String(text || "").replace(/<[^>]+>/g, " ").slice(0, scan || vocab.maxScan);
    if (!text) return [];
    var tally = {}, m;
    [vocab.big, vocab.small].forEach(function (rx) {
      if (!rx) return;
      rx.lastIndex = 0;
      while ((m = rx.exec(text))) {
        var canon = vocab.lookup[m[0].toLowerCase()];
        if (canon) tally[canon] = (tally[canon] || 0) + 1;
      }
    });
    Object.keys(vocab.ambiguous).forEach(function (canon) {
      if (tally[canon] && !vocab.ambiguous[canon].test(text)) delete tally[canon];
    });
    return Object.keys(tally)
      .sort(function (a, b) { return tally[b] - tally[a] || (a < b ? -1 : a > b ? 1 : 0); })
      .slice(0, limit || 12);
  }

  /* ---------------------------------------------------------------- reading the CV's text */

  var BULLET = /^[\s\u2022\u25CF\u25AA\u25A0\u25E6\u25CB\u25C6\u25BA\u27A2\u27A4\u2713\u2714\u00B7\u2023\u2043\u2219*\-\u2013\u2014>]+/;
  var EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  /* An Indian mobile in any common grouping: 9876543210, 98765 43210, 987-654-3210, +91 98765 43210, 0987... */
  var PHONE_IN = /(?<!\d)(?:(?:\+|00)?91[\s.-]?|0)?[6-9](?:[\s.-]?\d){9}(?!\d)/;
  var PHONE_INTL = /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/;
  var LINKEDIN_URL = /linkedin\.com\/in\/[A-Za-z0-9_%\-]+/i;
  var JUNK = /[\uE000-\uF8FF\uFFFD]|\(cid:\d+\)/g;

  var HEADINGS = {
    experience: /^(?:(?:work|professional|relevant|industry|employment|career)\s+)?(?:experience|experiences|employment(?:\s+history)?|work\s+history|career\s+history|internships?(?:\s+experience)?)$/i,
    education: /^(?:education(?:al)?(?:\s+(?:qualifications?|background|details))?|academic\s+(?:background|qualifications?|details|profile|record)|qualifications?|scholastic\s+(?:record|profile))$/i,
    skills: /^(?:(?:technical|key|core|professional|it|soft|relevant|technology)\s+)?(?:skills?(?:\s+(?:&|and)\s+(?:tools|technologies|abilities))?|skill\s*set|competenc(?:y|ies)|expertise|technologies|tools(?:\s+(?:&|and)\s+technologies)?|tech\s+stack)$/i,
    summary: /^(?:(?:professional|career|executive|profile)\s+)?(?:summary|profile|objective|career\s+objective|about(?:\s+me)?|overview)$/i,
    projects: /^(?:(?:academic|key|personal|major|notable|selected)\s+)?projects?$/i
  };

  /* "E X P E R I E N C E" -> "EXPERIENCE": letter-spaced headings are common in designed templates. */
  function headingText(line) {
    var t = line.replace(BULLET, "").replace(/[:\-–|_.]+$/, "").trim();
    if (/^(?:[A-Za-z] ){3,}[A-Za-z]$/.test(t)) t = t.replace(/ /g, "");
    return t.replace(/\s+/g, " ");
  }

  function findHeadings(lines) {
    var found = {};
    lines.forEach(function (line) {
      var t = headingText(line);
      if (!t || t.length > 45 || t.split(" ").length > 5) return;
      Object.keys(HEADINGS).forEach(function (k) { if (!found[k] && HEADINGS[k].test(t)) found[k] = t; });
    });
    return found;
  }

  var VERBS = ("accelerated achieved acquired addressed administered advised analysed analyzed architected " +
    "arranged assembled assessed audited authored automated balanced boosted budgeted built calculated " +
    "championed cleaned closed coached collaborated compiled completed composed computed conceived conducted " +
    "configured consolidated constructed consulted contributed controlled converted coordinated created cut " +
    "debugged decreased defined delivered deployed derived designed developed devised diagnosed directed " +
    "documented doubled drafted drove edited eliminated enabled engineered enhanced established evaluated " +
    "examined executed expanded expedited facilitated finalised finalized forecast forecasted formulated " +
    "founded generated grew guided halved handled headed hired identified implemented improved increased " +
    "initiated innovated inspected installed instituted integrated interviewed introduced invented investigated " +
    "launched led lowered maintained managed mapped maximised maximized measured mentored merged migrated " +
    "minimised minimized modelled modeled modernised modernized monitored motivated negotiated onboarded " +
    "operated optimised optimized orchestrated organised organized oversaw owned partnered performed piloted " +
    "pioneered planned prepared presented prevented prioritised prioritized processed produced programmed " +
    "promoted proposed prototyped provided published raised ran rebuilt recommended reconciled recruited " +
    "redesigned reduced refactored refined remodelled reorganised replaced reported researched resolved " +
    "restructured revamped reviewed revised scaled scheduled secured selected served shipped simplified " +
    "sold solved spearheaded standardised standardized steered streamlined strengthened structured " +
    "supervised supported surpassed tested tracked trained transformed translated tripled troubleshot " +
    "tuned unified upgraded utilised utilized validated verified won wrote").split(" ");
  var VERB = {};
  VERBS.forEach(function (v) { VERB[v] = 1; });
  var WEAK = /^(?:responsible\s+for|worked\s+on|working\s+on|involved\s+in|assisted(?:\s+(?:in|with))?|helped(?:\s+(?:in|with))?|duties\s+included|participated\s+in|was\s+part\s+of|part\s+of|tasked\s+with)\b/i;

  /* Whole month names only: "marketing 10" must not read as March 2010. */
  var MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\\.?";
  var DATE_NAMED = new RegExp("\\b" + MONTH + "[\\s,'’-]*(?:19|20)?\\d{2}\\b", "gi");
  var DATE_NUMERIC = /\b(?:0?[1-9]|1[0-2])[\/.-](?:19|20)\d{2}\b/g;
  var YEAR_RANGE = /\b(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:19|20)\d{2}|present|current|now|till\s+date|ongoing)\b/gi;

  var PERSONAL = [
    ["date of birth", /\b(?:date\s+of\s+birth|d\.?o\.?b\.?)\s*[:\-]/i],
    ["marital status", /\bmarital\s+status\b/i],
    ["father’s name", /\bfather'?’?s?\s+name\b/i],
    ["religion", /\breligion\s*[:\-]/i],
    ["gender", /\b(?:gender|sex)\s*[:\-]\s*(?:male|female|m|f)\b/i],
    ["nationality", /\bnationality\s*[:\-]/i],
    ["passport number", /\bpassport\s+(?:no|number)\b/i]
  ];

  function count(rx, text) { var m = String(text).match(rx); return m ? m.length : 0; }

  /* A line describing work: long enough to be a sentence, not contact details, not a heading. */
  function statementLines(lines) {
    return lines.map(function (l) { return l.replace(BULLET, "").trim(); }).filter(function (l) {
      return l.split(/\s+/).length >= 6 && !EMAIL.test(l) && !PHONE_IN.test(l) && !/^https?:/i.test(l);
    });
  }

  /* A figure that says how much or how many, not a date or a year. */
  function hasResultNumber(line) {
    var t = line.replace(DATE_NAMED, " ").replace(DATE_NUMERIC, " ").replace(YEAR_RANGE, " ")
                .replace(/\b(?:19|20)\d{2}\b/g, " ");
    return /\d/.test(t) || /\b(?:double|doubled|tripled|halved)\b/i.test(t);
  }

  /* ---------------------------------------------------------------- the score */

  function check(id, title, weight, earned, status, detail) {
    return { id: id, title: title, weight: weight, earned: Math.max(0, Math.min(weight, earned)),
             status: status, detail: detail };
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

  /**
   * input: { text, kind: "pdf"|"docx"|"text", pages, columns: share of lines in a second column or null,
   *          tables: count or null, images: bool or null, links: [urls] }
   */
  function analyse(input) {
    var text = String(input.text || "").replace(/\r\n?/g, "\n");
    var kind = input.kind || "text";
    var lines = text.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var compact = text.replace(/\s+/g, "");
    var words = (text.match(/\S+/g) || []).length;
    var groups = [];

    if (compact.length < 200) {
      var why = kind === "pdf"
        ? "This PDF has almost no text in it, so it is probably a scan or an image. An ATS sees a blank page. Export it again from Word or Google Docs as a PDF, and check that you can select the text."
        : "There is almost no text here. Upload the CV itself, or paste all of its text.";
      groups.push({ id: "read", title: "Can an ATS read it?", checks: [check("text", "Text an ATS can read", 100, 0, "fail", why)] });
      return finish(groups, { words: words, lines: lines.length, statements: 0 }, true);
    }

    /* Can an ATS read it? (35) */
    var read = [];
    read.push(check("text", "Text an ATS can read", 15, 15, "pass",
      "Found " + plural(words, "word") + " of real text, so a parser has something to read."));
    if (kind === "pdf" && input.columns != null) {
      read.push(input.columns >= 0.3
        ? check("columns", "One column", 10, 0, "warn",
            "This looks like a two-column layout. Many parsers read straight across the page, mixing the two columns line by line. Open “What the parser sees” below: if your sections are jumbled, move to one column.")
        : check("columns", "One column", 10, 10, "pass", "Reads as a single column, top to bottom."));
    } else if (kind === "docx" && input.tables != null) {
      read.push(input.tables > 0
        ? check("columns", "No layout tables", 10, 5, "warn",
            "This file uses " + plural(input.tables, "table") + ". In a table the order of cells decides the reading order, which is rarely the order you see. Keep tables for small grids, not for the page layout.")
        : check("columns", "No layout tables", 10, 10, "pass", "No tables, so the reading order is the order you see."));
    } else {
      read.push(check("columns", "Layout", 10, 0, "na", "Not checked: pasted text has no layout. Upload the file to check columns and tables."));
    }
    var junk = count(JUNK, text);
    read.push(junk >= 5 && junk / compact.length > 0.004
      ? check("junk", "No unreadable characters", 5, junk / compact.length > 0.02 ? 0 : 2, junk / compact.length > 0.02 ? "fail" : "warn",
          plural(junk, "character") + " came out unreadable. These are usually icons drawn with a special font (phone, email and location symbols) or a font the PDF did not embed. Write labels in words: “Phone”, “Email”.")
      : check("junk", "No unreadable characters", 5, 5, "pass", "Every character came out as readable text."));
    if (input.pages) {
      read.push(input.pages <= 2
        ? check("length", "Length", 5, 5, "pass", plural(input.pages, "page") + ". Recruiters read the first page closely; two is the usual limit.")
        : input.pages === 3
          ? check("length", "Length", 5, 3, "warn", "3 pages. Fine with 10 or more years of experience; otherwise cut to two.")
          : check("length", "Length", 5, 1, "fail", input.pages + " pages. Cut to two: older roles need a line each, not a paragraph."));
    } else {
      read.push(words <= 1000
        ? (words < 180
          ? check("length", "Length", 5, 3, "warn", "Only " + words + " words. Most CVs need more detail about what you did in each role.")
          : check("length", "Length", 5, 5, "pass", plural(words, "word") + ", about the length of one or two pages."))
        : check("length", "Length", 5, words > 1500 ? 1 : 3, words > 1500 ? "fail" : "warn",
            plural(words, "word") + ", probably three pages or more. Two pages is the usual limit."));
    }
    groups.push({ id: "read", title: "Can an ATS read it?", checks: read });

    /* Contact details (15) */
    var contact = [];
    var lostHint = kind === "docx"
      ? " If it is in the page header, move it into the body: many parsers, and this checker, never read Word headers."
      : kind === "pdf" ? " If it is in a header, an image or an icon, write it as plain text in the body of page 1." : "";
    contact.push(EMAIL.test(text)
      ? check("email", "Email address", 6, 6, "pass", "Found your email address.")
      : check("email", "Email address", 6, 0, "fail", "No email address found." + lostHint));
    contact.push(PHONE_IN.test(text) || PHONE_INTL.test(text)
      ? check("phone", "Phone number", 6, 6, "pass", "Found your phone number.")
      : check("phone", "Phone number", 6, 0, "fail", "No phone number found. Recruiters in India call before they email." + lostHint));
    var linkedLink = (input.links || []).some(function (u) { return LINKEDIN_URL.test(u); });
    contact.push(LINKEDIN_URL.test(text)
      ? check("linkedin", "LinkedIn address", 3, 3, "pass", "Found your LinkedIn address written out.")
      : /linked\s?in/i.test(text) || linkedLink
        ? check("linkedin", "LinkedIn address", 3, 1, "warn", "“LinkedIn” appears only as a word or a clickable link. Write the address itself (linkedin.com/in/your-name): a parser keeps the text, not the link.")
        : check("linkedin", "LinkedIn address", 3, 0, "warn", "No LinkedIn address. Add linkedin.com/in/your-name next to your phone number."));
    groups.push({ id: "contact", title: "Contact details", checks: contact });

    /* Sections a parser recognises (20) */
    var h = findHeadings(lines);
    var sections = [];
    sections.push(h.experience
      ? check("experience", "Experience section", 7, 7, "pass", "Found the heading “" + h.experience + "”.")
      : h.projects
        ? check("experience", "Experience section", 7, 4, "warn", "No “Experience” or “Internships” heading, only “" + h.projects + "”. That is fine for a fresher; add internships under their own plain heading if you have any.")
        : check("experience", "Experience section", 7, 0, "fail", "No heading a parser recognises as work history. Use “Experience” or “Work Experience”, not a creative title."));
    sections.push(h.education
      ? check("education", "Education section", 5, 5, "pass", "Found the heading “" + h.education + "”.")
      : check("education", "Education section", 5, 0, "fail", "No “Education” heading found. Without it, your degree may land in the wrong field."));
    sections.push(h.skills
      ? check("skills", "Skills section", 5, 5, "pass", "Found the heading “" + h.skills + "”.")
      : check("skills", "Skills section", 5, 1, "warn", "No “Skills” heading. Recruiters search by skill; give them one plain list."));
    sections.push(h.summary
      ? check("summary", "Summary at the top", 3, 3, "pass", "Found “" + h.summary + "”.")
      : check("summary", "Summary at the top", 3, 1, "warn", "No summary. Two or three lines at the top saying what you do and for how long help a recruiter decide in seconds."));
    groups.push({ id: "sections", title: "Sections a parser recognises", checks: sections });

    /* What the lines say (20) */
    var st = statementLines(lines);
    var content = [];
    content.push(st.length >= 6
      ? check("detail", "Detail about your work", 5, 5, "pass", plural(st.length, "line") + " describe what you did.")
      : check("detail", "Detail about your work", 5, st.length >= 3 ? 3 : 0, st.length >= 3 ? "warn" : "fail",
          "Only " + plural(st.length, "line") + " describe your work. Give each role three to five bullet points."));
    var withNumbers = st.filter(hasResultNumber).length;
    var share = st.length ? withNumbers / st.length : 0;
    content.push(st.length < 3
      ? check("numbers", "Results in numbers", 7, 0, "fail", "Too little detail to show results. Add bullets that say how much, how many or how fast.")
      : share >= 0.25
        ? check("numbers", "Results in numbers", 7, 7, "pass", withNumbers + " of " + st.length + " lines carry a number. That is what makes a claim believable.")
        : check("numbers", "Results in numbers", 7, share >= 0.1 ? 4 : 1, share >= 0.1 ? "warn" : "fail",
            "Only " + withNumbers + " of " + st.length + " lines carry a number. Add how much, how many or how fast (users, time saved, money, accuracy), and only where it is true."));
    var weak = st.filter(function (l) { return WEAK.test(l); });
    var strong = st.filter(function (l) { return VERB[(l.match(/^[A-Za-z]+/) || [""])[0].toLowerCase()]; });
    content.push(st.length < 3
      ? check("verbs", "Lines start with what you did", 4, 1, "warn", "Start each bullet with what you did: built, led, cut, launched.")
      : weak.length >= 3
        ? check("verbs", "Lines start with what you did", 4, 1, "warn",
            plural(weak.length, "line") + " start with phrases like “" + weak[0].match(WEAK)[0] + "”. Start with what you did instead: “Built”, “Led”, “Cut”.")
        : strong.length / st.length >= 0.3
          ? check("verbs", "Lines start with what you did", 4, 4, "pass", strong.length + " of " + st.length + " lines start with an action word.")
          : check("verbs", "Lines start with what you did", 4, 2, "warn", "Few lines start with an action word. Lead with the verb: “Automated the monthly report”, not “The monthly report was automated”."));
    var named = count(DATE_NAMED, text), numeric = count(DATE_NUMERIC, text), ranges = count(YEAR_RANGE, text);
    content.push(named + numeric + ranges === 0
      ? check("dates", "Dates a parser can read", 4, 0, "fail", "No dates found. Without them a parser cannot tell how long you worked anywhere. Write “Mar 2023 – Present”.")
      : named && numeric
        ? check("dates", "Dates a parser can read", 4, 2, "warn", "Dates are written two ways (like “Mar 2023” and “03/2023”). Pick one format and use it everywhere.")
        : check("dates", "Dates a parser can read", 4, 4, "pass", "Dates are written one way throughout."));
    groups.push({ id: "content", title: "What your lines say", checks: content });

    /* Indian CV habits that cost first-page space (10) */
    var personal = PERSONAL.filter(function (p) { return p[1].test(text); }).map(function (p) { return p[0]; });
    var habits = [];
    var photo = input.images ? " Page 1 also has an image; if it is a photo, it is not needed for most private-sector roles." : "";
    habits.push(personal.length
      ? check("personal", "No personal details", 5, personal.length >= 3 ? 0 : 2, personal.length >= 3 ? "fail" : "warn",
          "Found " + personal.join(", ") + ". Not needed for most private-sector jobs, and they push your experience down the first page." + photo)
      : check("personal", "No personal details", 5, 5, input.images ? "warn" : "pass",
          input.images ? "No date of birth or marital status." + photo : "No date of birth, marital status or father’s name taking up space."));
    /* "I hereby declare", or "Declaration" as a heading: not "GST declarations" in a finance CV. */
    habits.push(/\bi\s+hereby\s+declare\b|^\s*declaration\s*:?\s*$/im.test(text)
      ? check("declaration", "No declaration line", 3, 0, "warn", "There is a declaration (“I hereby declare…”). It is a habit from paper forms; parsers ignore it and recruiters do not look for it.")
      : check("declaration", "No declaration line", 3, 3, "pass", "No declaration taking up space."));
    habits.push(/^(?:curriculum\s+vitae|resume|résumé|cv|bio[\s-]?data)\.?$/i.test(headingText(lines[0] || ""))
      ? check("title", "Your name as the title", 2, 0, "warn", "The CV starts with “" + headingText(lines[0]) + "”. Put your name there instead; it is the field every parser looks for first.")
      : check("title", "Your name as the title", 2, 2, "pass", "Starts with your details, not the word “Resume”."));
    groups.push({ id: "habits", title: "Indian CV habits worth dropping", checks: habits });

    /* Two columns is the failure the ATS guide calls the single biggest fix. The detection is a
     * heuristic, so it stays a warning, but a CV that may be read across its columns is never
     * called "Ready to send". */
    var twoColumns = read.some(function (c) { return c.id === "columns" && c.status === "warn" && kind === "pdf"; });
    return finish(groups, { words: words, lines: lines.length, statements: st.length }, false, twoColumns ? 79 : 100);
  }

  /* Out of 100 across the checks that could run: pasted text has no layout to judge, and must not get
   * those points free. A file that was read gets every check, so its score is the plain sum. */
  function finish(groups, stats, unreadable, cap) {
    var earned = 0, weight = 0, all = [];
    groups.forEach(function (g) {
      g.checks.forEach(function (c) {
        if (c.status !== "na") { earned += c.earned; weight += c.weight; }
        all.push(c);
      });
    });
    var score = Math.min(weight ? Math.round(100 * earned / weight) : 0, cap || 100);
    var band = score >= 85 ? "ready" : score >= 70 ? "good" : score >= 50 ? "work" : "fix";
    var fixes = all.filter(function (c) { return c.status === "fail" || c.status === "warn"; })
      .sort(function (a, b) { return (b.weight - b.earned) - (a.weight - a.earned); })
      .slice(0, 3);
    return { score: score, band: band, unreadable: unreadable, groups: groups, fixes: fixes, stats: stats };
  }

  /* ---------------------------------------------------------------- the job match */

  /* Words a job description repeats that are about the job, not about hiring. */
  var STOP = ("a about above across after again against all also among an and any are as at be because been before being " +
    "below between both but by can could did do does doing down during each either etc ever every for from further " +
    "get gets getting had has have having he her here hers him his how however i if in into is it its itself just " +
    "least less like make makes many may me more most much must my no nor not now of off on once one only or other " +
    "our ours out over own per same shall she should so some such than that the their theirs them then there these " +
    "they this those through to too under until up upon us very via was we were what when where whether which while " +
    "who whom whose why will with within without would yet you your yours " +
    // hiring boilerplate
    "ability able apply applicant applicants application benefit benefits bonus candidate candidates career careers " +
    "company culture day days degree desired diverse diversity employee employees employer employment environment " +
    "equal excellent experience experienced familiarity good great help hiring hybrid ideal including india join " +
    "job jobs key knowledge level location looking new office opportunity opportunities passion passionate plus " +
    "position preferred professional qualification qualifications related remote required requirement requirements " +
    "responsibilities responsibility responsible role roles salary skill skills strong success successful support " +
    "team teams time understanding using well work working world year years " +
    // words every company uses about itself
    "best build building business businesses class complex deliver delivering drive driven driving dynamic ensure excellence " +
    "exciting global impact innovative innovation local make making mission need needs operate organisation " +
    "organisations organization organizations own ownership part " +
    "people relentless technical thrive value values within " +
    // equal-opportunity, pay and location boilerplate, long in postings from US companies
    "accommodation accommodations applicable base based benefits city color compensation disability eligible " +
    "equity gender holidays inclusion inclusive insurance national notice offer offers orientation origin paid " +
    "policy privacy protected race range religion sexual status veteran visit york").split(" ");
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = 1; });

  /* "dashboards" and "dashboard" are one term; "business" keeps its s. */
  function stem(w) { return w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w; }

  /* Up to 10 words the description repeats, in the form it first used them, most repeated first. */
  function jobTerms(jd, skills, exclude) {
    var skip = {};
    (skills || []).forEach(function (s) { s.toLowerCase().split(/[^a-z0-9+#.]+/).forEach(function (w) { skip[w] = 1; }); });
    (exclude || []).forEach(function (w) { skip[w.toLowerCase()] = 1; });
    var tally = {}, first = {}, shown = {}, i = 0;
    (String(jd).toLowerCase().match(/[a-z][a-z+#\-]{3,}/g) || []).forEach(function (w) {
      w = w.replace(/-+$/, "");
      var base = stem(w);
      if (w.length < 4 || STOPSET[w] || skip[w] || STOPSET[base] || skip[base]) return;
      tally[base] = (tally[base] || 0) + 1;
      if (!(base in first)) { first[base] = i++; shown[base] = w; }
    });
    return Object.keys(tally).filter(function (b) { return tally[b] >= 2; })
      .sort(function (a, b) { return tally[b] - tally[a] || first[a] - first[b]; })
      .slice(0, 10).map(function (b) { return shown[b]; });
  }

  function hasWord(textLower, w) {
    return new RegExp("(?<![a-z])" + esc(stem(w)) + "(?:s|es|ed|ing)?(?![a-z])").test(textLower);
  }

  function bandOf(p) { return p >= 75 ? "strong" : p >= 50 ? "partial" : "weak"; }

  /**
   * Compare a CV with a job description, or with the skills a role's postings name most.
   *   matchJob(vocab, cvText, { jd: "...", exclude: ["acme"] })
   *   matchJob(vocab, cvText, { role: { label, skills: [[name, share], ...] } })
   */
  function matchJob(vocab, cvText, target) {
    var cvSkills = {};
    skillsIn(vocab, cvText, 500, 100000).forEach(function (s) { cvSkills[s] = 1; });
    var want, terms = [];
    if (target.role) {
      want = target.role.skills.filter(function (p) { return p[1] >= 10; }).slice(0, 10).map(function (p) { return p[0]; });
    } else {
      want = skillsIn(vocab, target.jd || "", 20);
      terms = jobTerms(target.jd || "", want, target.exclude);
    }
    var lower = String(cvText || "").toLowerCase();
    var sk = { found: [], missing: [] }, tm = { found: [], missing: [] };
    want.forEach(function (s) { (cvSkills[s] ? sk.found : sk.missing).push(s); });
    terms.forEach(function (w) { (hasWord(lower, w) ? tm.found : tm.missing).push(w); });
    /* The percentage counts dictionary skills only: that half is the one checked against ApplySarthi.
     * Repeated words are advice, shown beside it; a description naming fewer than three skills (often a
     * sales, HR or operations role) gets the words and no percentage rather than a number built on two. */
    var enough = want.length >= 3;
    var percent = enough ? Math.round(100 * sk.found.length / want.length) : null;
    return { kind: target.role ? "role" : "jd", enough: enough, percent: percent,
             band: enough ? bandOf(percent) : "none", skills: sk, terms: tm };
  }

  return { compileVocab: compileVocab, skillsIn: skillsIn, analyse: analyse, matchJob: matchJob,
           findHeadings: findHeadings, jobTerms: jobTerms, hasResultNumber: hasResultNumber };
});
