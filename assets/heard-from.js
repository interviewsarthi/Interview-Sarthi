/* "Where did you first hear about us?" -- one optional question shown once a payment is confirmed:
 * on thanks.html (Live Sarthi) and on Prep Sarthi's paid screen. The answer is stored on the licence
 * server against the paid order (license-server/src/survey.js), so the owner can tell whether people see a
 * reel, find no link, and search the name instead: that is why Google and ChatGPT get a second question.
 *
 *   window.sarthiHeardFrom({ mount, api, order, key, product: "Interview Sarthi", track })
 *
 * Styling borrows the host page's colour tokens (--accent, --line, --muted, ...) with fallbacks, so it sits
 * naturally on both sites. Nothing here may get in the way of the key or the pass: every failure is quiet. */
(function () {
  "use strict";
  if (window.sarthiHeardFrom) return;

  var I = {
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>',
    youtube: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none"/>',
    google: '<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5l-4.9-4.9"/>',
    chatgpt: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    friend: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.1c2.6.2 4.5 2.2 4.5 5"/>',
    linkedin: '<rect x="3" y="3" width="18" height="18" rx="3.5"/><path d="M8 10.5v6M8 7.6v.1M12 16.5v-3.4c0-1.6 1-2.6 2.3-2.6s2.2.9 2.2 2.6v3.4M12 10.5v6"/>',
    other: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
    both: '<rect x="2.5" y="4" width="11" height="11" rx="3.2"/><rect x="10.5" y="9" width="11" height="11" rx="3.2"/>',
    no: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 15.5l7-7"/>',
    unsure: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 014.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17v.1"/>',
    tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };
  // Brand tints on the icons only; labels stay in the page's ink colour.
  var TINT = { instagram: "#D6336C", youtube: "#E02424", google: "#2F6FEB", chatgpt: "#0E9F6E",
    friend: "#7C3AED", linkedin: "#0A66C2", other: "#64748B", both: "#B45309", no: "#64748B", unsure: "#64748B" };

  var SOURCES = [
    ["instagram", "Instagram"], ["youtube", "YouTube"], ["google", "Google search"],
    ["chatgpt", "ChatGPT or other AI"], ["friend", "Friend or colleague"], ["linkedin", "LinkedIn"],
    ["other", "Somewhere else"],
  ];
  var SEEN = [["instagram", "Yes, on Instagram"], ["youtube", "Yes, on YouTube"], ["both", "Yes, on both"],
    ["no", "No"], ["unsure", "I don't remember"]];
  var SEEN_WIDE = { unsure: 1 };
  var ASKS_SEEN = { google: 1, chatgpt: 1 };

  var CSS = [
    ".hf{--hf-ink:var(--text,var(--ink,#0f172a));--hf-muted:var(--muted,#5b6b81);--hf-line:var(--line,#e6eaf1);",
    "--hf-accent:var(--accent,#2563eb);--hf-card:var(--card,#fff);--hf-wash:var(--wash,#eef3ff);--hf-ok:var(--ok,#059669);",
    "margin:22px 0 0;padding:18px 18px 16px;border:1px solid var(--hf-line);border-radius:14px;background:var(--hf-card);",
    "color:var(--hf-ink);font-family:Inter,\"Segoe UI\",system-ui,-apple-system,sans-serif;text-align:left;",
    "box-shadow:0 1px 2px rgba(15,23,42,.04)}",
    ".hf *{box-sizing:border-box}",
    ".hf-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 4px}",
    ".hf-kick{font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--hf-accent)}",
    ".hf-skip{border:0;background:none;padding:6px 2px;font:500 13px inherit;font-family:inherit;color:var(--hf-muted);cursor:pointer}",
    ".hf-skip:hover{color:var(--hf-ink);text-decoration:underline}",
    ".hf h3{margin:0 0 3px;font-size:17px;line-height:1.35;font-weight:700;font-family:inherit;color:var(--hf-ink)}",
    ".hf-why{margin:0 0 14px;font-size:13.5px;color:var(--hf-muted);line-height:1.45}",
    ".hf-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
    "@media(min-width:560px){.hf-grid.hf-src{grid-template-columns:repeat(3,minmax(0,1fr))}}",
    ".hf-opt{display:flex;align-items:center;gap:10px;min-height:46px;padding:9px 12px;border:1px solid var(--hf-line);",
    "border-radius:11px;background:var(--hf-card);color:var(--hf-ink);font:500 14px/1.25 inherit;font-family:inherit;",
    "text-align:left;cursor:pointer;transition:border-color .15s,background .15s,transform .1s}",
    ".hf-opt:hover{border-color:var(--hf-accent)}",
    ".hf-opt.hf-wide{grid-column:1/-1}",
    "@media(max-width:479px){.hf{padding:16px 14px 14px}.hf-opt{gap:8px;padding:9px 10px;font-size:13.5px}}",
    ".hf-opt:active{transform:scale(.98)}",
    ".hf-opt:focus-visible,.hf-skip:focus-visible,.hf-send:focus-visible,.hf-in:focus-visible,.hf-link:focus-visible{outline:2px solid var(--hf-accent);outline-offset:2px}",
    ".hf-opt svg{flex:0 0 20px;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}",
    ".hf-opt[aria-pressed=true]{border-color:var(--hf-accent);background:var(--hf-wash);box-shadow:inset 0 0 0 1px var(--hf-accent)}",
    ".hf-opt[disabled]{cursor:default}",
    ".hf-grid.hf-busy .hf-opt:not([aria-pressed=true]){opacity:.45}",
    ".hf-more{margin:14px 0 0;padding:14px 0 0;border-top:1px dashed var(--hf-line)}",
    ".hf-more p{margin:0 0 10px;font-size:14.5px;font-weight:600}",
    ".hf-row{display:flex;gap:8px}",
    ".hf-in{flex:1;min-width:0;min-height:44px;padding:10px 12px;border:1px solid var(--hf-line);border-radius:10px;",
    "font:15px inherit;font-family:inherit;color:var(--hf-ink);background:var(--hf-card)}",
    ".hf-send{min-height:44px;padding:0 18px;border:0;border-radius:10px;background:var(--hf-accent);color:#fff;",
    "font:600 14px inherit;font-family:inherit;cursor:pointer}",
    ".hf-send[disabled]{opacity:.6;cursor:default}",
    ".hf-err{margin:10px 0 0;font-size:13px;color:#b42318}",
    ".hf-done{display:flex;align-items:center;gap:12px}",
    ".hf-done .hf-ok{flex:0 0 36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;",
    "background:color-mix(in srgb,var(--hf-ok) 12%,transparent);color:var(--hf-ok)}",
    ".hf-done .hf-ok svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}",
    ".hf-done b{display:block;font-size:15px}",
    ".hf-done span{font-size:13.5px;color:var(--hf-muted)}",
    ".hf-link{border:0;background:none;padding:0;font:inherit;color:var(--hf-accent);cursor:pointer;text-decoration:underline}",
    ".hf-in-anim{animation:hf-in .22s ease-out}",
    "@keyframes hf-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}",
    "@media(prefers-reduced-motion:reduce){.hf-in-anim{animation:none}.hf-opt{transition:none}}",
  ].join("");

  function icon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" style="color:' + (TINT[name] || "currentColor") + '">' + I[name] + "</svg>";
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* private mode */ }
    return null;
  }

  window.sarthiHeardFrom = function (o) {
    var mount = o && o.mount;
    var ref = (o && (o.order || o.key)) || "";
    if (!mount || !o.api || !ref) return;
    var memo = "hf_" + ref;
    if (store(memo)) return;                       // answered or skipped on this device already
    if (!document.getElementById("hf-css")) { var st = el("style"); st.id = "hf-css"; st.textContent = CSS; document.head.appendChild(st); }
    var product = o.product || "Interview Sarthi";
    var track = typeof o.track === "function" ? o.track : function (n, p) { if (window.sarthiTrack) window.sarthiTrack(n, p); };
    var picked = null;

    var box = el("section", "hf hf-in-anim");
    box.setAttribute("aria-labelledby", "hf-q");
    mount.innerHTML = "";
    mount.appendChild(box);

    function ask() {
      picked = null;
      box.innerHTML =
        '<div class="hf-top"><span class="hf-kick">One quick question</span><button type="button" class="hf-skip">Skip</button></div>' +
        '<h3 id="hf-q">Where did you first hear about ' + product + "?</h3>" +
        '<p class="hf-why">Optional, one tap. It tells a small team where to keep showing up.</p>';
      var grid = el("div", "hf-grid hf-src");
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-labelledby", "hf-q");
      SOURCES.forEach(function (s) {
        // "Somewhere else" takes the last row whole, so the grid never ends on a lone chip.
        var b = el("button", "hf-opt" + (s[0] === "other" ? " hf-wide" : ""), icon(s[0]) + "<span>" + s[1] + "</span>");
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () { choose(s[0], b, grid); });
        grid.appendChild(b);
      });
      box.appendChild(grid);
      box.querySelector(".hf-skip").addEventListener("click", function () {
        store(memo, "skip");
        track("heard_from_skip", {});
        box.remove();
      });
    }

    function press(grid, b) {
      Array.prototype.forEach.call(grid.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    }

    function choose(source, b, grid) {
      picked = source;
      press(grid, b);
      var old = box.querySelector(".hf-more");
      if (old) old.remove();
      if (ASKS_SEEN[source]) return follow(source === "google" ? "Before you searched" : "Before you asked the AI");
      if (source === "other") return otherBox();
      send({ source: source }, grid);
    }

    // The question the whole survey exists for.
    function follow(lead) {
      var more = el("div", "hf-more hf-in-anim");
      more.innerHTML = '<p id="hf-q2">' + lead + ", had you seen " + product + " on Instagram or YouTube?</p>";
      var g = el("div", "hf-grid");
      g.setAttribute("role", "group");
      g.setAttribute("aria-labelledby", "hf-q2");
      SEEN.forEach(function (s) {
        var b = el("button", "hf-opt" + (SEEN_WIDE[s[0]] ? " hf-wide" : ""), icon(s[0]) + "<span>" + s[1] + "</span>");
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () { press(g, b); send({ source: picked, seen: s[0] }, g); });
        g.appendChild(b);
      });
      more.appendChild(g);
      box.appendChild(more);
      g.firstChild.focus({ preventScroll: true });
      more.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    function otherBox() {
      var more = el("div", "hf-more hf-in-anim");
      more.innerHTML = '<p><label for="hf-other">Where was it? (optional)</label></p>' +
        '<form class="hf-row"><input class="hf-in" id="hf-other" maxlength="80" autocomplete="off" placeholder="e.g. a WhatsApp group, a college senior">' +
        '<button class="hf-send" type="submit">Send</button></form>';
      box.appendChild(more);
      var form = more.querySelector("form");
      var input = more.querySelector("input");
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        send({ source: "other", other: input.value.trim() }, more.querySelector(".hf-row"));
      });
      input.focus({ preventScroll: true });
    }

    function busy(scope, on) {
      Array.prototype.forEach.call(scope.querySelectorAll("button,input"), function (x) { x.disabled = on; });
      Array.prototype.forEach.call(box.querySelectorAll(".hf-grid"), function (g) { g.classList.toggle("hf-busy", on); });
    }

    function send(answer, scope) {
      var err = box.querySelector(".hf-err");
      if (err) err.remove();
      busy(box, true);
      var body = { source: answer.source };
      if (answer.seen) body.seen = answer.seen;
      if (answer.other) body.other = answer.other;
      if (o.order) body.order_id = o.order; else body.license_key = o.key;
      fetch(o.api.replace(/\/+$/, "") + "/survey", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        store(memo, "done");
        track("heard_from", { source: answer.source, seen_social: answer.seen || "" });
        done();
      }).catch(function () {
        busy(box, false);
        var e = el("p", "hf-err");
        e.setAttribute("role", "alert");
        e.textContent = "That did not save. Tap your answer again, or skip, your pass is not affected.";
        (scope.closest(".hf-more") || box).appendChild(e);
      });
    }

    function done() {
      box.innerHTML = '<div class="hf-done hf-in-anim" role="status"><div class="hf-ok">' + '<svg viewBox="0 0 24 24" aria-hidden="true">' + I.tick + "</svg>" +
        "</div><div><b>Thanks, that really helps.</b><span>Answered wrong? <button type=\"button\" class=\"hf-link\">Change it</button></span></div></div>";
      box.querySelector(".hf-link").addEventListener("click", function () { ask(); var f = box.querySelector(".hf-opt"); if (f) f.focus(); });
    }

    ask();
  };
})();
