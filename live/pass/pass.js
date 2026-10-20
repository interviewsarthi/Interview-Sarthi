(function () {
  "use strict";
  const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  const API = LOCAL ? "https://interview-sarthi-license-test.interview-sarthi-license.workers.dev" : "https://license.interviewsarthi.com";
  const $ = (id) => document.getElementById(id);
  const KEY_STORE = "ls_pass_key", ORDER_STORE = "ls_upgrade_order";
  const returned = window.__livePassReturn || {};
  let key = returned.key || read(KEY_STORE), orderId = returned.order || read(ORDER_STORE);
  delete window.__livePassReturn;
  let current = null, polling = false, paying = false, generation = 0, paymentCheck = 0;
  const paidReported = new Set();
  let cashfreeScript = null;
  const dates = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  function when(iso) { return iso ? dates.format(new Date(iso)) : ""; }
  function read(name) { try { return sessionStorage.getItem(name) || ""; } catch (_) { return ""; } }
  function save(name, value) { try { value ? sessionStorage.setItem(name, value) : sessionStorage.removeItem(name); } catch (_) {} }
  function track(name, params) { if (window.sarthiTrack) window.sarthiTrack(name, params); }
  function say(message, bad = false) { $("notice").textContent = message; $("notice").className = "notice" + (bad ? " bad" : ""); }
  function paymentButtons(show, retry = false) { $("payment-actions").hidden = !show; $("retry-payment").hidden = !retry; }
  function clearOrder() { save(ORDER_STORE, ""); }

  // The shared script excludes this personal page from recording and chat.
  if (!window.__livePassPrivateURL) {
    const analytics = document.createElement("script");
    analytics.src = "/assets/analytics.js"; analytics.onload = start;
    analytics.onerror = start; document.head.appendChild(analytics);
  } else start();

  async function request(path, body) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    try {
      const res = await fetch(API + path, { method: body ? "POST" : "GET", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: abort.signal,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await res.json();
      if (!res.ok) { const err = new Error(data.error || "Could not check your pass. Please try again."); err.status = res.status; throw err; }
      return data;
    } catch (err) {
      if (err.status) throw err;
      throw new Error("Could not reach the server just now. Please try again.");
    } finally { clearTimeout(timer); }
  }

  function paint(data, afterPayment = false) {
    current = data;
    const p = data.pass, u = data.upgrade || {};
    $("lookup-card").hidden = true; $("pass-card").hidden = false;
    $("pass-label").textContent = p.label;
    const states = {
      active: "Active until " + when(p.ends_at),
      not_activated: "Not activated yet: activate by " + when(p.activate_by),
      ended: "Ended on " + when(p.ends_at),
      expired_unused: "Not activated in time: activation deadline was " + when(p.activate_by),
      disabled: "This pass is disabled."
    };
    $("pass-state").textContent = states[p.state] || p.state;
    $("activation-help").hidden = p.state !== "not_activated";
    $("computers").textContent = `${p.devices_used} of ${p.devices_max} computers`;
    $("email-hint").textContent = p.email_hint ? "Bought with " + p.email_hint : "";
    $("pass-prep").hidden = !data.prep_gift;
    if (data.prep_gift) $("pass-prep").textContent = `Prep Sarthi (₹99) included free for ${data.prep_gift.days} days.${data.prep_gift.claimed ? " Your free days have been added to your Prep account." : " Sign in to Prep with the same Gmail, or paste this Live key on its Passes screen."}`;
    $("upgrade-card").hidden = !u.eligible || afterPayment;
    $("unavailable-card").hidden = !!u.eligible || afterPayment;
    if (u.eligible) {
      $("comeback").hidden = u.kind !== "comeback";
      $("upgrade-end").textContent = u.starts_on_activation ? "30 days from when you activate" : "Your pass will end on " + when(u.ends_after);
      $("upgrade-prep").hidden = !(u.prep_gift_days > 0);
      $("upgrade-prep").textContent = u.prep_gift_days > 0 ? `Prep Sarthi (₹99) included free for ${u.prep_gift_days} days` : "";
      $("offer-until").textContent = "Open until " + when(u.offer_until);
      $("upgrade-window").textContent = u.kind === "comeback" ? "You have 7 days from your email to use this offer. If your pass has ended, you get 30 days from payment. You can upgrade each key once." : "You can upgrade before you activate, or within 3 days (72 hours) of first activation. Your pass ends 30 days after first activation. You can upgrade each key once.";
    } else {
      $("unavailable-message").textContent = u.message || "There is no upgrade available for this pass.";
      $("buy-links").hidden = !["window", "expired", "plan", "india_only"].includes(u.reason);
    }
    track("pass_view", { state: p.state, eligible: !!u.eligible, kind: u.kind || "" });
  }

  async function lookup(afterPayment = false) {
    if (!key) { $("lookup-card").hidden = false; return; }
    const thisGeneration = generation;
    $("lookup-button").disabled = true;
    if (!afterPayment) say("Checking your pass…");
    try {
      const data = await request("/pass?key=" + encodeURIComponent(key));
      if (generation !== thisGeneration) return;
      paint(data, afterPayment);
      if (!afterPayment) say("");
      return data;
    } catch (err) {
      if (generation !== thisGeneration) return;
      if (!afterPayment) { $("lookup-card").hidden = false; say(err.message, true); }
    } finally { $("lookup-button").disabled = false; }
  }

  function loadCashfree() {
    if (!cashfreeScript) cashfreeScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => fail(), 15000);
      function fail() { clearTimeout(timeout); script.remove(); cashfreeScript = null; reject(new Error("Secure checkout could not load. Please try again.")); }
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = fail;
      document.head.appendChild(script);
    });
    return cashfreeScript;
  }

  async function pay() {
    if (paying || polling || !key || !current?.upgrade?.eligible) return;
    paying = true; $("upgrade-pay").disabled = true; paymentButtons(false); $("payment-back").hidden = true;
    track("upgrade_click", { kind: current.upgrade.kind });
    say("Opening secure checkout…");
    try {
      const order = await request("/upgrade", { key });
      orderId = order.order_id; save(ORDER_STORE, orderId); save(KEY_STORE, key);
      await loadCashfree();
      const result = await window.Cashfree({ mode: order.mode }).checkout({ paymentSessionId: order.payment_session_id, redirectTarget: "_self" });
      if (result?.error) throw new Error(result.error.message || "Checkout did not open. Please try again.");
    } catch (err) {
      if (err.status === 409) await lookup();
      say(err.message, true);
    } finally { paying = false; $("upgrade-pay").disabled = false; }
  }

  function reportPaid(order, kind) {
    if (paidReported.has(order)) return;
    const once = "ls_upgrade_paid_" + order;
    if (read(once)) return;
    paidReported.add(order); save(once, "1");
    track("upgrade_paid", { kind, value: 200, currency: "INR" });
  }

  async function success(result, checkingOrder) {
    clearOrder(); paymentButtons(false); $("payment-back").hidden = true; say("");
    $("upgrade-card").hidden = true; $("unavailable-card").hidden = true;
    $("success").hidden = false;
    $("success-end").textContent = result.started ? "Active until " + when(result.ends_at) : "Your 30 days start when you activate" + (result.activate_by ? ". Activate by " + when(result.activate_by) + "." : ".");
    $("success-devices").textContent = `${result.devices_max} computers`;
    reportPaid(checkingOrder, result.kind);
    const data = await lookup(true);
    const gift = result.prep_gift || data?.prep_gift;
    $("success-prep").hidden = !gift;
    if (gift) $("success-prep-text").textContent = "Prep Sarthi (₹99) is included: open Prep Sarthi and sign in with " + (data?.pass?.email_hint || "the same Gmail used to buy Live") + ".";
    $("success-title").focus();
  }

  async function checkPayment() {
    if (polling || !orderId) return;
    const thisCheck = ++paymentCheck, checkingOrder = orderId;
    if (key) $("lookup-card").hidden = true;
    polling = true; $("upgrade-card").hidden = true; $("unavailable-card").hidden = true;
    $("payment-back").hidden = !key;
    paymentButtons(false); say("Confirming your payment… keep this page open.");
    const deadline = Date.now() + 180000;
    try {
      while (Date.now() < deadline && thisCheck === paymentCheck) {
        let result;
        try { result = await request("/upgrade/orders/" + encodeURIComponent(checkingOrder)); }
        catch (err) { if (thisCheck !== paymentCheck) return; say(err.message, true); paymentButtons(true); return; }
        if (thisCheck !== paymentCheck) return;
        if (result.status === "paid") { await success(result, checkingOrder); return; }
        if (["failed", "not_found", "duplicate"].includes(result.status)) {
          clearOrder(); $("payment-back").hidden = true;
          if (key) await lookup();
          say(result.status === "duplicate" ? result.message : result.status === "failed" ? "The payment did not go through. You can try again." : "We could not find that payment. Check the link in your email, or reply to your key email.", true);
          paymentButtons(false);
          $("retry-payment").hidden = !(result.status === "failed" && current?.upgrade?.eligible);
          $("payment-actions").hidden = $("retry-payment").hidden;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (thisCheck !== paymentCheck) return;
      clearOrder(); $("payment-back").hidden = true;
      const latestPass = key ? await lookup() : null;
      if (thisCheck !== paymentCheck) return;
      if (!key || latestPass) say("Paid? It can take a few minutes; we email you as soon as it is done.");
      paymentButtons(true);
    } finally { if (thisCheck === paymentCheck) polling = false; }
  }

  async function backToPass() {
    if (!key || paying) return;
    paymentCheck++; polling = false; orderId = ""; clearOrder();
    $("payment-back").hidden = true; paymentButtons(false);
    await lookup();
  }

  $("lookup").onsubmit = async (event) => {
    event.preventDefault();
    if (polling || paying) return;
    key = $("key").value.trim(); if (!key) return;
    generation++; save(KEY_STORE, key); save(ORDER_STORE, ""); orderId = "";
    $("key").value = ""; current = null; $("success").hidden = true;
    $("pass-card").hidden = true; $("upgrade-card").hidden = true; $("unavailable-card").hidden = true; $("payment-back").hidden = true; paymentButtons(false);
    await lookup();
  };
  $("change-key").onclick = () => {
    if (polling || paying) return;
    generation++; key = ""; current = null; orderId = ""; save(KEY_STORE, ""); clearOrder();
    for (const id of ["pass-card", "upgrade-card", "unavailable-card", "success"]) $(id).hidden = true;
    $("lookup-card").hidden = false; $("payment-back").hidden = true; paymentButtons(false); say(""); $("key").focus();
  };
  $("upgrade-pay").onclick = pay; $("retry-payment").onclick = pay;
  $("check-payment").onclick = checkPayment;
  $("back-to-pass").onclick = backToPass;
  async function start() {
    if (returned.key && !returned.order) { orderId = ""; clearOrder(); }
    if (orderId) { save(ORDER_STORE, orderId); await checkPayment(); }
    else await lookup();
  }
})();
