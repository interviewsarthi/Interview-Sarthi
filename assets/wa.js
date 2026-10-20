/* Interview Sarthi: floating "ask on WhatsApp" button.
 *
 * One script on every page rather than markup in nineteen files: the button,
 * its styles and its analytics event all live here, so changing the number or
 * the wording is a one-line edit in one place.
 *
 * The prefilled message carries the page name. Someone asking from the Cluely
 * comparison has a different question from someone asking on Installing, and
 * knowing which before you reply is most of a good answer.
 */
(function () {
  "use strict";

  var NUMBER = "919205231999";           /* country code + number, digits only */
  var LABEL = "Ask on WhatsApp";

  var CSS = [
    ".wa-fab{position:fixed;right:18px;bottom:18px;z-index:60;display:inline-flex;",
    "align-items:center;gap:9px;padding:11px 16px 11px 13px;border-radius:999px;",
    "background:#25D366;color:#0b2e18;font:600 14px/1 'Segoe UI',system-ui,sans-serif;",
    "text-decoration:none;box-shadow:0 8px 24px rgba(15,23,42,.28);",
    "transition:transform .15s ease,box-shadow .15s ease}",
    ".wa-fab:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(15,23,42,.34)}",
    ".wa-fab svg{width:22px;height:22px;flex:0 0 auto}",
    /* On a phone the label would crowd the thumb zone and overlap page text,
       so below 600px it collapses to the icon alone. */
    "@media(max-width:600px){.wa-fab{padding:13px;right:14px;bottom:14px}",
    ".wa-fab span{display:none}}",
    "@media print{.wa-fab{display:none}}"
  ].join("");

  var ICON = '<svg viewBox="0 0 24 24" fill="#0b2e18" aria-hidden="true">' +
    '<path d="M12 2a10 10 0 00-8.6 15l-1.3 4.8 4.9-1.3A10 10 0 1012 2zm0 1.8a8.2 8.2 0 016.9 12.6l-.2.3.8 2.8-2.9-.8-.3.2A8.2 8.2 0 1112 3.8z"/>' +
    '<path d="M9.2 7.6c.2-.4.4-.4.6-.4h.5c.2 0 .4 0 .6.4l.7 1.7c.1.2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.2.3.7 1.2 1.5 1.9.9.8 1.7 1.1 2 1.2.2.1.4 0 .6-.1l.6-.8c.2-.2.3-.2.6-.1l1.6.7c.3.2.5.2.5.4 0 .3 0 1-.3 1.5-.4.4-1.1.9-1.7.9-.5 0-1.9.1-3.9-1.2-2.2-1.4-3.6-3.8-3.7-4-.1-.2-.9-1.2-.9-2.3 0-1.1.6-1.7 1-2z"/></svg>';

  function build() {
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    /* Page name from the <title>, before the first separator: "Pricing",
       "Installing", "Interview Sarthi vs Cluely". Titles use ":" or "|"; a
       title with neither is used whole. */
    var name = (document.title.split(/[:|]/)[0] || "").trim() || location.pathname;

    var link = document.createElement("a");
    link.className = "wa-fab";
    link.href = "https://wa.me/" + NUMBER + "?text=" +
      encodeURIComponent("Hi, I have a question about Interview Sarthi (" + name + ")");
    link.target = "_blank";
    link.rel = "noopener";
    link.setAttribute("aria-label", LABEL);
    link.innerHTML = ICON + "<span>" + LABEL + "</span>";
    link.addEventListener("click", function () {
      if (typeof window.gtag === "function") {
        window.gtag("event", "whatsapp_click", { page_name: name });
      }
    });
    document.body.appendChild(link);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
