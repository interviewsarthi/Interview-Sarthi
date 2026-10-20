/* Live Sarthi refer-a-friend, on the website (owner, 27 Sep 2026).
 *
 * A friend's link is interviewsarthi.com/live/?ref=K7M2QXA. This remembers the code in the browser, so
 * it survives the Microsoft Store install and the app's own Buy button (which opens this site), and adds
 * it to every checkout link on the page (license.interviewsarthi.com/buy?plan=...&ref=...). The licence
 * server does the rest: when the friend activates the pass they bought, both people get a Free
 * Interview Day by email.
 *
 * On /live/ it also fills in the "Got a code from a friend?" box and shows a slim banner once a real
 * code is applied. A code is checked with the licence server before it is shown as applied; an unknown
 * one is forgotten quietly. Nothing here is sent to analytics except that a code was applied.
 */
(function () {
  "use strict";

  var SERVER = "https://license.interviewsarthi.com";
  var STORE = "sarthi_ref";
  var KEEP_DAYS = 90;
  var CODE = /^[A-HJ-NP-Z2-9]{7}$/;

  function read(raw) {
    var c = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
    return CODE.test(c) ? c : "";
  }
  function saved() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE) || "null");
      if (v && read(v.code) && Date.now() - v.at < KEEP_DAYS * 864e5) return v.code;
    } catch (e) { }
    return "";
  }
  function save(code) {
    try {
      if (code) localStorage.setItem(STORE, JSON.stringify({ code: code, at: Date.now() }));
      else localStorage.removeItem(STORE);
    } catch (e) { }
  }
  function track(name, params) {
    if (window.sarthiTrack) window.sarthiTrack(name, params || {});
  }

  function carry(code) {
    var links = document.querySelectorAll('a[href*="license.interviewsarthi.com/buy"]');
    for (var i = 0; i < links.length; i++) {
      try {
        var u = new URL(links[i].href);
        if (code) u.searchParams.set("ref", code); else u.searchParams.delete("ref");
        links[i].href = u.toString();
      } catch (e) { }
    }
  }

  function banner(code) {
    if (document.getElementById("ref-banner") || !document.getElementById("pricing")) return;
    var bar = document.createElement("div");
    bar.id = "ref-banner";
    bar.setAttribute("role", "status");
    // Not sticky: the Live page's nav already holds the top of the screen.
    bar.style.cssText = "position:relative;z-index:1;background:#ecfdf5;border-bottom:1px solid #a7d9c4;color:#065f46;" +
      "font:600 14px/1.4 Inter,'Segoe UI',system-ui,sans-serif;padding:9px 16px;text-align:center";
    bar.innerHTML = "&#127873; Your friend's invite code <b></b> is applied. Buy any pass and activate it: you both get a free interview day. " +
      "<a href='#pricing' style='color:#047857;text-decoration:underline'>See the passes</a>";
    bar.querySelector("b").textContent = code;
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function showApplied(code) {
    var box = document.getElementById("ref-applied");
    if (box) {
      box.hidden = false;
      var b = document.getElementById("ref-applied-code");
      if (b) b.textContent = code;
    }
    var input = document.getElementById("ref-input");
    if (input && !input.value) input.value = code;
    banner(code);
  }

  function check(code) {
    return fetch(SERVER + "/referral/code/" + encodeURIComponent(code))
      .then(function (r) { return r.json(); })
      .then(function (d) { return Boolean(d && d.valid); });
  }

  function apply(code, how) {
    carry(code);
    check(code).then(function (ok) {
      if (!ok) { save(""); carry(""); return false; }
      save(code);
      showApplied(code);
      if (how !== "remembered") track("referral_applied", { method: how });   // once per code, not per visit
      return true;
    }).catch(function () { /* offline or the server is busy: the code still rides on the buy links */ });
  }

  function start() {
    var q = new URLSearchParams(location.search);
    var fromLink = read(q.get("ref"));
    var code = fromLink || saved();
    if (code) apply(code, fromLink ? "link" : "remembered");

    // "Got a code from a friend?" on the Live pricing section.
    var form = document.getElementById("ref-form");
    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var input = document.getElementById("ref-input");
        var msg = document.getElementById("ref-msg");
        var typed = read(input && input.value);
        if (!typed) { if (msg) msg.textContent = "An invite code is 7 letters and numbers, like K7M2QXA."; return; }
        if (msg) msg.textContent = "Checking…";
        check(typed).then(function (ok) {
          if (!ok) { if (msg) msg.textContent = "That code was not found. Check it with your friend."; return; }
          if (msg) msg.textContent = "";
          save(typed);
          carry(typed);
          showApplied(typed);
          track("referral_applied", { method: "typed" });
        }).catch(function () { if (msg) msg.textContent = "Could not check the code just now. Try again in a minute."; });
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
