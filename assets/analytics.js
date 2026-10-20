/* Interview Sarthi: website analytics.
 *
 * Paste your two IDs below and the site starts reporting. A value left as its
 * placeholder simply keeps that tool switched off, so this file is safe to ship
 * before you have signed up for either.
 *
 *   GA4_ID      analytics.google.com  ->  Admin  ->  Data streams  ->  your web
 *               stream  ->  Measurement ID.  Looks like G-ABCD1234EF.
 *   CLARITY_ID  clarity.microsoft.com ->  new project  ->  Settings  ->  Setup
 *               ->  the id inside the install snippet. Looks like abcd1234ef.
 *
 * What this reports: page views, plus the three steps of the funnel:
 * download_click, begin_checkout, purchase. Nothing about the app itself is
 * touched; the desktop app still sends nothing anywhere.
 */
(function () {
  "use strict";

  // The homepage routes legacy links and receipts before any tracking starts.
  if (window.sarthiHomeRedirecting) return;

  var GA4_ID = "G-CCFHWPJD9K";
  var CLARITY_ID = "yb9mq7tzkq";

  // Local previews must not pollute live country or conversion reports.
  var localPreview = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(location.hostname);
  var gaOn = !localPreview && GA4_ID.indexOf("XXXX") === -1;
  var clarityOn = !localPreview && CLARITY_ID.indexOf("XXXX") === -1;

  /* ---- Google Analytics 4 ---- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  /* Remove receipt/query secrets from the browser URL before either analytics
   * SDK can read it. Keep the key in memory for the existing receipt handler. */
  var incomingParams = new URLSearchParams(location.search);
  var licenceKey = incomingParams.get("license_key");
  var privateReturn = incomingParams.has("license_key");
  if (privateReturn) {
    try { history.replaceState(null, "", location.pathname + location.hash); }
    catch (e) { gaOn = false; clarityOn = false; }
  }

  // Only the planned outreach codes are accepted, never arbitrary UTM text.
  // Target market is the intended campaign audience, not the visitor's country.
  function outreachCampaign(values) {
    if (!values) return null;
    var campaign = /^international_(us|uk)_(live|prep)$/.exec(values.name || "");
    var content = /^(software|data|cloud)-(post|community|review|newsletter)-0[1-5]$/.exec(values.content || "");
    var channels = {
      linkedin: ["social", "post"], reddit: ["referral", "community"],
      facebook: ["referral", "community"], career_creator: ["referral", "review"],
      career_newsletter: ["email", "newsletter"]
    };
    if (!Object.prototype.hasOwnProperty.call(channels, values.source)) return null;
    var channel = channels[values.source];
    if (!campaign || !content || values.medium !== channel[0] || content[2] !== channel[1]) return null;
    return {source: values.source, medium: values.medium, name: values.name,
      content: values.content, market: campaign[1], product: campaign[2]};
  }
  function outreachPayload(campaign) {
    return campaign ? {outreach_campaign: campaign.name, outreach_source: campaign.source,
      outreach_content: campaign.content, target_market: campaign.market} : {};
  }
  var receiptPage = location.pathname === "/thanks.html";
  var newOutreach = !privateReturn && !receiptPage ? outreachCampaign({
    source: incomingParams.get("utm_source"), medium: incomingParams.get("utm_medium"),
    name: incomingParams.get("utm_campaign"), content: incomingParams.get("utm_content")
  }) : null;
  var outreach = newOutreach;
  try {
    var storedOutreach = JSON.parse(sessionStorage.getItem("sarthi_outreach") || "null");
    var age = storedOutreach && Date.now() - storedOutreach.at;
    var externalReferrer = false;
    try { externalReferrer = new URL(document.referrer).origin !== location.origin; } catch (e) { }
    // An unrelated new campaign or external referral must not inherit the old placement.
    if (!outreach && !incomingParams.has("utm_source") && !externalReferrer &&
        storedOutreach && age >= 0 && age < 30 * 60 * 1000) {
      outreach = outreachCampaign(storedOutreach.campaign);
    }
    if (gaOn && !privateReturn && !receiptPage) {
      if (outreach) sessionStorage.setItem("sarthi_outreach", JSON.stringify({campaign: outreach, at: Date.now()}));
      else sessionStorage.removeItem("sarthi_outreach");
    }
  } catch (e) { /* A blocked or malformed store never stops navigation. */ }

  if (gaOn) {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA4_ID;
    document.head.appendChild(s);
    gtag("js", new Date());
    var gaConfig = {
      anonymize_ip: true,
      page_location: location.origin + location.pathname,
      page_referrer: safeReferrer(document.referrer)
    };
    // Hosted checkout is part of the purchase, not a new acquisition source.
    if (receiptPage) {
      try {
        if (["api.cashfree.com", "payments.cashfree.com", "checkout.cashfree.com",
             "checkout.dodopayments.com"].indexOf(new URL(document.referrer).hostname) !== -1) {
          gaConfig.ignore_referrer = true;
          gaConfig.page_referrer = "";
        }
      } catch (e) { }
    }
    if (newOutreach) {
      gaConfig.campaign_source = newOutreach.source;
      gaConfig.campaign_medium = newOutreach.medium;
      gaConfig.campaign_name = newOutreach.name;
      gaConfig.campaign_content = newOutreach.content;
    }
    /* Preserve the known LinkedIn product campaign without exposing arbitrary query
     * values, receipt keys or email addresses in page_location. GA4 uses these
     * campaign fields for session attribution and subsequent funnel events. */
    var socialCreative = incomingParams.get("utm_content") || "";
    if (!privateReturn && location.pathname !== "/thanks.html" &&
        incomingParams.get("utm_source") === "linkedin" &&
        incomingParams.get("utm_medium") === "social" &&
        incomingParams.get("utm_campaign") === "linkedin_product_growth" &&
        /^li-\d{8}-(?:apply|prep|live|jobs)-[a-z0-9-]{1,80}$/.test(socialCreative)) {
      gaConfig.campaign_source = "linkedin";
      gaConfig.campaign_medium = "social";
      gaConfig.campaign_name = "linkedin_product_growth";
      gaConfig.campaign_content = socialCreative;
    }
    /* AI assistants tag their links (ChatGPT adds utm_source=chatgpt.com), but page_location above drops the
     * query and ChatGPT's apps send no referrer, so those visits counted as (direct): about half of ChatGPT's
     * visitors in Sep 2026. Only a recognised assistant is passed on, never the raw value. */
    var aiHosts = { chatgpt: "chatgpt.com", claude: "claude.ai", perplexity: "perplexity.ai",
                    gemini: "gemini.google.com", copilot: "copilot.microsoft.com" };
    var aiCampaign = aiHosts[aiSource(incomingParams.get("utm_source"))];
    if (aiCampaign && !gaConfig.campaign_source && !privateReturn && location.pathname !== "/thanks.html") {
      gaConfig.campaign_source = aiCampaign;
      gaConfig.campaign_medium = "ai-assistant";  // the medium GA4 itself gives referrer-tagged AI visits
    }
    gtag("config", GA4_ID, gaConfig);
  }

  /* ---- Microsoft Clarity ---- */
  /* Receipt content can include a license key; never record that page.
   * The Prep Sarthi app shows interview captions and the report, which are the
   * visitor's own CV and words; session recording never runs there either. */
  /* The app moved from /mock/app to /prep/app on 23 Sep 2026. Both are still checked:
   * the old path keeps a redirect stub, and a visitor sitting on it for the moment
   * before the redirect fires must not be recorded either. */
  var inPrepApp = location.pathname.indexOf("/prep/app") === 0 ||
                  location.pathname.indexOf("/mock/app") === 0;
  /* The refer-a-friend page takes a licence key to look up the invite code: never recorded either. */
  var inLivePass = /^\/live\/pass(?:\/|$)/.test(location.pathname);
  var keyPage = location.pathname === "/thanks.html" || location.pathname === "/live/invite.html" || inLivePass;
  /* The ATS resume checker prints the visitor's CV on screen ("What the parser sees"): never recorded. */
  var cvPage = location.pathname.indexOf("/apply/ats-resume-checker/") === 0;
  if (clarityOn && !privateReturn && !inPrepApp && !keyPage && !cvPage) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1;
      t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", CLARITY_ID);
  }

  /* ---- Funnel events ----
   * Named so the same call reaches both tools: GA4 gets a gtag event, Clarity
   * gets a tag you can filter recordings by. */
  function track(name, params) {
    // Receipt attribution comes from the checkout's saved placement, not a new visit.
    var context = name === "purchase" ? {} : outreachPayload(outreach);
    if (gaOn) gtag("event", name, Object.assign(context, params || {}));
    if (clarityOn && window.clarity) window.clarity("set", name, "yes");
  }
  if (newOutreach) track("outreach_visit", outreachPayload(newOutreach));

  function safeReferrer(value) {
    try { var url = new URL(value); return url.origin + url.pathname; }
    catch (e) { return ""; }
  }

  function aiSource(value) {
    var aliases = {
      "chatgpt": "chatgpt", "chatgpt.com": "chatgpt", "chat.openai.com": "chatgpt",
      "claude": "claude", "claude.ai": "claude",
      "perplexity": "perplexity", "perplexity.ai": "perplexity",
      "gemini": "gemini", "gemini.google.com": "gemini",
      "copilot": "copilot", "copilot.microsoft.com": "copilot"
    };
    return aliases[String(value || "").toLowerCase().replace(/^www\./, "")] || "";
  }
  var referralSource = aiSource(incomingParams.get("utm_source"));
  if (!referralSource) {
    try { referralSource = aiSource(new URL(document.referrer).hostname); } catch (e) { }
  }
  /* One event per source per browser tab session. Attribution is a signal,
   * not proof of an AI recommendation. No raw referrer/query values are sent. */
  if (referralSource && !privateReturn && location.pathname !== "/thanks.html") {
    var referralOnce = "ai_referral_" + referralSource;
    var shouldReport = true;
    try {
      shouldReport = !sessionStorage.getItem(referralOnce);
      if (shouldReport && gaOn) sessionStorage.setItem(referralOnce, "1");
    } catch (e) { /* Storage denied: still permit this page's event. */ }
    if (shouldReport && gaOn) gtag("event", "ai_referral_visit", {
      ai_source: referralSource, landing_page: location.pathname
    });
  }

  /* The passes, keyed by the plan code in the checkout link
   * (license.interviewsarthi.com/buy?plan=30d), so a price change on the site
   * does not silently desync the reported revenue. Rupee prices: the value
   * is what the report is for, not what a foreign card was charged.
   * Only 2d and 30d are sold since 25 Sep 2026. The two withdrawn passes stay
   * here, at the price they were sold for, so a key bought before then still
   * reports its value when it reaches thanks.html. No page links to them. */
  var PASSES = {
    "2d": { name: "2-Day Pass", value: 99 },
    "30d": { name: "1-Month Pass", value: 299 },
    "7d": { name: "7-Day Pass", value: 399 },
    "90d": { name: "3-Month Pass", value: 1999 }
  };
  /* The licence server names the pass by its label ("1-Month Pass"). */
  function passByName(label) {
    for (var code in PASSES) {
      if (PASSES[code].name === label) return { id: code, name: label, value: PASSES[code].value };
    }
    return null;
  }

  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";

    // Measure which app a visitor chooses from any marketing page. Never send
    // link queries, CV text, keys, email or a full destination URL.
    try {
      var target = new URL(href, location.href);
      var product = "", kind = "product_page";
      var ours = target.origin === location.origin || target.origin === "https://interviewsarthi.com";
      if (target.hostname === "apply.interviewsarthi.com" && /^https?:$/.test(target.protocol)) {
        product = "apply"; kind = "application";
      } else if (ours) {
        var productPath = target.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "");
        if (productPath === "/apply") product = "apply";
        if (productPath === "/prep" || productPath === "/mock") product = "prep";
        if (productPath === "/live" || productPath === "/live/international.html") product = "live";
        if (productPath === "/prep/app" || productPath === "/mock/app") {
          product = "prep"; kind = "application";
        }
      }
      if (product && !privateReturn && location.pathname !== "/thanks.html" && !inPrepApp) {
        track("product_click", {
          product: product, destination_kind: kind,
          placement: a.closest(".quick-pick") ? "quick_pick" : a.closest(".app-strip") ? "guide_strip" : a.closest(".promo") ? "guide_box" : a.closest("header, nav") ? "navigation" : a.closest("#products") ? "product_card" :
            a.closest("#plans, #pricing") ? "pricing" : a.closest("footer") ? "footer" : "page"
        });
      }
    } catch (e) { /* Invalid or non-web links still navigate normally. */ }

    /* Both install paths count as a download: the Microsoft Store listing and
     * the direct .exe on GitHub Releases. */
    if (href.indexOf("releases/latest/download") !== -1 ||
        href.indexOf("apps.microsoft.com") !== -1) {
      /* platform.js gates this anchor on non-Windows devices: the tap opens a
       * "send me the link" sheet instead of downloading, so it is not a
       * download. The sheet's own "Download anyway" link is ungated and still
       * lands here. */
      if (a.hasAttribute("data-gated")) return;
      track("download_click", {
        /* where on the page the click came from, so you can tell whether the
         * hero, the pricing table or the closing CTA is doing the work */
        placement: a.closest("nav") ? "nav" : (a.closest("section") ? "section" : "page"),
        /* which install path: the Store listing or the direct installer */
        method: href.indexOf("apps.microsoft.com") !== -1 ? "store" : "exe"
      });
      return;
    }

    /* Every buy button goes to license.interviewsarthi.com/buy?plan=30d (or 2d), which
     * sends the buyer on to Dodo or Cashfree. The plan code names the pass. */
    var buy = href.match(/license\.interviewsarthi\.com\/buy\?plan=(\d+d)\b/);
    if (buy) {
      var pass = PASSES[buy[1]] || { name: buy[1], value: 0 };
      var region = new URL(href, location.href).searchParams.get("region");
      var currency = region === "intl" ? "USD" : "INR";
      var usdPrices = { "2d": 9.99, "30d": 29.99 };
      var value = currency === "USD" ? usdPrices[buy[1]] : pass.value;
      /* Park it so the purchase event on thanks.html can report the amount.
       * The return trip carries the key (Dodo) or an order id (Cashfree),
       * never the product. */
      try {
        localStorage.setItem("pending_pass", JSON.stringify({
          id: buy[1], name: pass.name, value: value, currency: currency,
          campaign: outreach, at: Date.now()
        }));
      } catch (e) { /* private mode: the purchase still reports, without value */ }
      track("begin_checkout", {
        currency: currency,
        value: value,
        items: [{ item_id: buy[1], item_name: pass.name, price: value, quantity: 1 }]
      });
    }
  }, true);

  /* A purchase reaches thanks.html one of two ways. Dodo sends the buyer back
   * with ?license_key=..., read here on load. The licence server (Cashfree)
   * sends ?order_id=..., and thanks.html calls window.sarthiReportPurchase
   * once its poll has the key. The key itself is a secret and is never sent
   * on; localStorage just stops a page refresh double-counting. */
  function reportPurchase(key, passLabel) {
    if (!key) return;
    /* A short non-reversible hash of the key. It gives GA4 a transaction_id to
     * deduplicate on and lets a second purchase report, without the key itself
     * ever leaving the page. */
    var txid = (function (str) {
      var h = 5381;
      for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
      return "t" + (h >>> 0).toString(36);
    })(key);

    var pending = null;
    try { pending = JSON.parse(localStorage.getItem("pending_pass") || "null"); } catch (e) { }
    /* A buyer who paid on another device, or in private mode, has nothing
     * parked; the licence server's pass label fills the gap. */
    if (!(pending && pending.value) && passLabel) pending = passByName(passLabel);

    var payload = { transaction_id: txid };
    if (pending && pending.at && Date.now() - pending.at >= 0 && Date.now() - pending.at < 24 * 60 * 60 * 1000) {
      Object.assign(payload, outreachPayload(outreachCampaign(pending.campaign)));
    }
    if (pending && pending.value) {
      payload.currency = pending.currency || "INR";
      payload.value = pending.value;
      payload.items = [{
        item_id: pending.id, item_name: pending.name,
        price: pending.value, quantity: 1
      }];
    }

    /* Keyed to the licence, so buying a second pass in the same browser still
     * reports; only a refresh of the same receipt is suppressed. */
    var once = "purchase_reported_" + txid;
    try {
      if (!localStorage.getItem(once)) {
        localStorage.setItem(once, "1");
        localStorage.removeItem("pending_pass");
        track("purchase", payload);
      }
    } catch (e) {
      track("purchase", payload);
    }
  }
  window.sarthiReportPurchase = reportPurchase;
  window.sarthiTrack = track;
  if (licenceKey) reportPurchase(licenceKey, "");

  /* ---- Sarthi chat ----
   * The assistant bubble, served by the chat service on apply.interviewsarthi.com (sarthi-chat, its own
   * process on the VM). Loaded here because every page loads this file. It waits for the page to finish
   * loading, and hides itself on the pages its own settings list (the Prep interview app). */
  /* Like the measurement above, it must never stop the page: any failure here is silent. */
  try {
    if (inLivePass) return;
    var chat = document.createElement("script");
    chat.src = "https://apply.interviewsarthi.com/chat/widget.js";
    chat.defer = true;
    if (chat.setAttribute) chat.setAttribute("data-site", "main");
    (document.body || document.head).appendChild(chat);
  } catch (e) { /* no chat on this page */ }
})();
