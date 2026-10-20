/* Interview Sarthi: platform gate for the download buttons.
 *
 * The app is a Windows .exe, but (GA4, Aug 2026) four of five download clicks
 * happen on phones, mostly Instagram traffic, where the installer downloads
 * and then does nothing. This script relabels every download CTA on
 * non-Windows devices and, on tap, offers to send the link to the visitor's
 * PC instead of serving them a dead file.
 *
 * Rules it lives by:
 *   - Windows visitors see no change at all. Detection fails OPEN: any UA we
 *     cannot classify is treated as Windows, because a wrong gate costs a
 *     sale and a wrong pass-through costs nothing.
 *   - The .exe href never leaves the DOM. Crawlers, right-click -> copy link
 *     and "Download anyway" all keep working; we only change the label and
 *     intercept the tap.
 *   - Gated anchors get data-gated="1", which tells analytics.js NOT to count
 *     the tap as download_click: nothing was downloaded. The sheet's own
 *     "Download anyway" link is ungated, so a real override still counts.
 *
 * Events reported (gtag if present, plus a Clarity tag):
 *   mobile_gate_shown   the sheet opened            { placement }
 *   mobile_link_sent    they sent/copied the link   { method: share|copy }
 *   download_anyway     they overrode the gate
 *
 * The shared URL carries utm_source=self_share, so the desktop sessions it
 * brings back are visible in GA4 as their own source. That number, not
 * download_click, is how to judge whether this gate earns its keep.
 */
(function () {
  "use strict";

  var isWindows = navigator.userAgentData
    ? navigator.userAgentData.platform === "Windows"
    : /Windows NT/.test(navigator.userAgent || "");
  if (isWindows) return;

  var onThanks = /\/thanks\.html$/.test(location.pathname);
  var SITE = "https://interviewsarthi.com/live/?utm_source=self_share&utm_medium=mobile_handoff" +
    "&utm_content=" + (onThanks ? "post_purchase" : "free");
  /* A friend's invite code (assets/ref.js) lives in this phone's browser. The link sent to the PC
   * carries it, so the checkout there still knows the friend; otherwise the code would have to be
   * typed again on the laptop. Read at share time: ref.js loads after this script. */
  function site() {
    var code = "";
    try {
      var q = new URLSearchParams(location.search).get("ref") || "";
      var saved = JSON.parse(localStorage.getItem("sarthi_ref") || "null");
      code = (q || (saved && saved.code) || "").toUpperCase().replace(/[\s-]/g, "");
    } catch (e) { }
    return /^[A-HJ-NP-Z2-9]{7}$/.test(code) ? SITE + "&ref=" + code : SITE;
  }

  /* On thanks.html the buyer's key is in the URL (analytics.js and the page
   * itself read it the same way); carrying it in the share message means the
   * handoff to their PC survives even if the receipt email goes to spam. */
  var key = onThanks
    ? (new URLSearchParams(location.search).get("license_key") || "").split(",")[0].trim()
    : "";
  function shareText() {
    return key
      ? "Interview Sarthi license key: " + key + ". Install on your Windows PC: " + site()
      : "Interview Sarthi: real-time interview help on your Windows PC. Install from here: " + site();
  }

  var CSS = [
    ".pf-note{margin-top:10px;font-size:13px;color:#b45309;text-align:center}",
    ".pf-veil{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:70;",
    "opacity:0;transition:opacity .18s ease}",
    ".pf-veil.on{opacity:1}",
    ".pf-sheet{position:fixed;left:0;right:0;bottom:0;z-index:71;background:#fff;",
    "max-width:520px;margin:0 auto;border-radius:18px 18px 0 0;",
    "padding:22px 20px calc(18px + env(safe-area-inset-bottom,0px));",
    "box-shadow:0 -12px 40px rgba(15,23,42,.25);transform:translateY(103%);",
    "transition:transform .22s ease;color:#0f172a;",
    "font-family:Inter,'Segoe UI',system-ui,-apple-system,sans-serif}",
    ".pf-sheet.on{transform:none}",
    ".pf-sheet h3{margin:0 0 6px;font-size:18px}",
    ".pf-sheet p{margin:0 0 16px;font-size:14px;color:#5b6b81;line-height:1.5}",
    ".pf-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;",
    "padding:13px 16px;border-radius:10px;border:0;background:#2563eb;color:#fff;",
    "font:600 15px/1.2 Inter,'Segoe UI',system-ui,sans-serif;cursor:pointer;",
    "text-decoration:none;margin:0 0 10px;box-sizing:border-box}",
    ".pf-btn.ghost{background:#fff;border:1px solid #d4dbe6;color:#0f172a}",
    ".pf-alt{display:block;text-align:center;font-size:13.5px;color:#5b6b81;",
    "text-decoration:underline;padding:6px;cursor:pointer}"
  ].join("");

  function report(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
    if (typeof window.clarity === "function") window.clarity("set", name, "yes");
  }

  /* Same placement logic as analytics.js, so the two datasets line up. */
  function placement(a) {
    return a.closest("nav") ? "nav" : (a.closest("section") ? "section" : "page");
  }

  var sheet, veil;

  function buildSheet(exeHref) {
    veil = document.createElement("div");
    veil.className = "pf-veil";
    veil.hidden = true;

    sheet = document.createElement("div");
    sheet.className = "pf-sheet";
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Get the download link");

    var canShare = typeof navigator.share === "function";
    sheet.innerHTML =
      "<h3>Interview Sarthi runs on Windows PCs</h3>" +
      "<p>" + (onThanks
        ? "Your pass is active. Now get the installer onto your Windows PC."
        : "This device can't run the installer. Send yourself the link and open it on your PC.") +
      "</p>" +
      (canShare ? "<button class='pf-btn' data-act='share'>Send myself the link</button>" : "") +
      "<button class='pf-btn ghost' data-act='copy'>Copy the link</button>" +
      "<a class='pf-alt' data-act='anyway' href='" + exeHref + "'>Download the .exe anyway →</a>";

    veil.addEventListener("click", closeSheet);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !sheet.hidden) closeSheet();
    });

    sheet.addEventListener("click", function (ev) {
      var act = ev.target.getAttribute && ev.target.getAttribute("data-act");
      if (act === "share") {
        navigator.share({ title: "Interview Sarthi", text: shareText(), url: site() })
          .then(function () { report("mobile_link_sent", { method: "share" }); closeSheet(); })
          .catch(function () { /* cancelled the share sheet, not an event */ });
      } else if (act === "copy") {
        copy(shareText(), ev.target);
      } else if (act === "anyway") {
        /* Leave the click alone: the href is the real .exe, and analytics.js
         * counts it as download_click because this anchor is not data-gated. */
        report("download_anyway", {});
        closeSheet();
      }
    });

    document.body.appendChild(veil);
    document.body.appendChild(sheet);
  }

  function copy(text, btn) {
    var done = function () {
      report("mobile_link_sent", { method: "copy" });
      btn.textContent = "Copied ✓";
      setTimeout(closeSheet, 900);
    };
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(done)
      .catch(function () {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* give up quietly */ }
        document.body.removeChild(ta);
      });
  }

  function openSheet(from) {
    veil.hidden = false;
    sheet.hidden = false;
    /* two frames so the transition actually runs from the hidden state */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        veil.classList.add("on");
        sheet.classList.add("on");
      });
    });
    report("mobile_gate_shown", { placement: placement(from) });
  }

  function closeSheet() {
    veil.classList.remove("on");
    sheet.classList.remove("on");
    setTimeout(function () { veil.hidden = true; sheet.hidden = true; }, 220);
  }

  function build() {
    /* Both install paths are dead ends on a phone: the .exe will not run, and
     * the Store listing cannot install a Windows desktop app either. Gate both. */
    var anchors = document.querySelectorAll(
      "a[href*='releases/latest/download'], a[href*='apps.microsoft.com']");
    if (!anchors.length) return;

    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    /* The sheet's override link should be the real installer, not the Store
     * page, so hunt for an .exe href and fall back to the first anchor. */
    var exeHref = anchors[0].getAttribute("href");
    for (var j = 0; j < anchors.length; j++) {
      var h = anchors[j].getAttribute("href") || "";
      if (h.indexOf("releases/latest/download") !== -1) { exeHref = h; break; }
    }
    buildSheet(exeHref);

    var noted = false;
    for (var i = 0; i < anchors.length; i++) {
      (function (a) {
        a.setAttribute("data-gated", "1");
        /* Keep any icon; swap only the wording. Nav is tight on space. */
        var label = a.closest("nav") ? "Get the link"
          : (onThanks ? "Send the link to my PC" : "Windows only: send me the link");
        var svg = a.querySelector("svg");
        a.textContent = "";
        if (svg) a.appendChild(svg);
        a.appendChild(document.createTextNode(label));

        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          openSheet(a);
        });

        /* One plain-words note under the first real CTA (not the nav one). */
        if (!noted && !a.closest("nav")) {
          noted = true;
          var host = a.closest(".ctas, .ctarow, .dl") || a;
          var note = document.createElement("div");
          note.className = "pf-note";
          note.textContent = "Runs on Windows 10/11 PCs. The installer won't run on a phone.";
          host.parentNode.insertBefore(note, host.nextSibling);
        }
      })(anchors[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
