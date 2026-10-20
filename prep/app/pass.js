/* Prep Sarthi: the pass screen, the account panel and the invite card.
 *
 * Buying, in the order a buyer expects it:
 *   1. see both passes and press Buy
 *   2. say who you are (Google, so the pass follows the person not the browser)
 *      and leave a number for the receipt
 *   3. pay through Cashfree
 *   4. come back to your own account, not to another pay form
 * Nothing renews by itself.
 *
 * Inviting: every key has a link. The share text never carries the score
 * unless the person ticks it themselves, and the tick is only offered for a
 * score worth showing.
 */

import { LICENSE_API, LOCAL, claimLiveGift, config, deviceInvite, inviteLink, invitedBy, orderStatus, session, signIn, startFreeDays, startOrder } from "./billing.js?v=20261009-live-gift";
import { reportPaidOrder } from "./purchase-analytics.js?v=20261006-demo-buy";

const $ = (id) => document.getElementById(id);
const PENDING = "ps_pending_order";
const SCORE_WORTH_SHARING = 70;

let ctx = null;          // { state, setEntitlement, show, track, log, resume, practise }
let cfg = null;
let googleReady = null;   // the one in-flight or finished attempt to draw Google's button
let step = "choose";     // choose | checkout | signin (a buyer on a new device, not buying)
const PHONE = "ps_phone";
let extendOpen = false;
let offerWhere = null;
let claimingGift = false;
let noticeAccount = null;
const seenGiftNotices = new Set();

/* One load per address, and the promise only settles when the script has
 * really run. Two callers asking at once share the same wait, instead of the
 * second racing ahead and finding nothing loaded yet. */
const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src; el.async = true;
      el.onload = resolve;
      el.onerror = () => { scripts.delete(src); el.remove(); reject(new Error("could not load " + src)); };
      document.head.appendChild(el);
    }));
  }
  return scripts.get(src);
}
function say(text, cls = "") { const el = $("pass-notice"); el.textContent = text || ""; el.className = "notice " + cls; }
function when(isoTime) { return new Date(isoTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }); }
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function planOf(id) { return (cfg && cfg.plans && cfg.plans[id]) || null; }

// Called wherever entitlement changes, including a gift claimed on page load.
export function noticeLiveGift(ent) {
  const notice = $("live-gift-notice");
  const account = ent?.account?.sub || ent?.account?.email || null;
  if (account !== noticeAccount) { notice.hidden = true; noticeAccount = account; }
  const gift = ent?.live_gift;
  if (!account || !gift?.just_claimed) return;
  const token = JSON.stringify([account, gift.claimed_at, gift.days]);
  let hash = 2166136261;
  for (const c of token) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const once = "ps_live_gift_notice_" + (hash >>> 0).toString(36);
  if (seenGiftNotices.has(once)) return;
  try { if (localStorage.getItem(once)) return; localStorage.setItem(once, "1"); } catch (_) { /* memory still stops repeats */ }
  seenGiftNotices.add(once);
  $("live-gift-notice-text").textContent = giftNoticeText(ent, gift);
  notice.hidden = false;
  $("live-gift-notice-close").onclick = () => { notice.hidden = true; };
}
function giftNoticeText(ent, gift) {
  return `Prep Sarthi (₹99) included with your Live Sarthi month: ${gift.days} free days added. ` + (ent.kind === "pass"
    ? `They have been added to your running pass, now ending ${when(ent.expiresAt)} (IST).`
    : "They are waiting in your account. Open Passes and press Start my free days when you are ready.");
}
function daysLeft(seconds) {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
  if (d >= 1) return `${d} day${d > 1 ? "s" : ""}${h ? ` ${h} h` : ""} left`;
  if (h >= 1) return `${h} hour${h > 1 ? "s" : ""} left`;
  return `${Math.max(1, Math.floor(seconds / 60))} min left`;
}

/* Cashfree collects only in India; everyone else is sent to Dodo, which charges
 * in dollars. The worker decides which from the visitor's country and says so in
 * /mock/config, so the app never has to guess. Rupees are the safe default: if
 * the config call failed we are almost certainly talking to an Indian reader. */
function intl() { return !!(cfg && cfg.region && cfg.region !== "in"); }

function money(plan) {
  if (!plan) return "";
  return intl() ? "$" + (Number(plan.usd || 0) / 100).toFixed(2) : "Rs " + plan.amount;
}

// The price of a pass as the pass sheet shows it (rupees in India, dollars elsewhere), or "" before config loads.
export function priceOf(id) { return money(planOf(id)); }
// Whether this visitor pays in dollars: for prices this sheet does not hold (Live Sarthi's, on its test's end).
export const isIntl = () => intl();

export async function initPasses(context) {
  ctx = context;
  try { cfg = await config(); } catch (_) { cfg = null; }
  const testLogin = LOCAL && cfg && !cfg.google_client_id;
  ctx.passesOn = !!(cfg && (cfg.google_client_id || testLogin));
  ctx.demoOn = !!(cfg && cfg.demo);          // the licence server offers the free demo only while a key pays for it
  if (cfg && cfg.plans) {
    for (const [id, p] of Object.entries(cfg.plans)) {
      const el = document.querySelector(`.plan[data-plan="${id}"]`);
      if (el) el.querySelector(".price").textContent = money(p);
    }
  }
  // Dodo asks for whatever it needs on its own page, so an international buyer
  // is never shown a field demanding a 10-digit Indian mobile number.
  if (intl()) {
    const methods = document.getElementById("pay-methods");
    if (methods) methods.textContent = "Card through Dodo Payments.";
    const phone = $("phone");
    phone.style.display = "none";
    phone.required = false;
    const label = phone.previousElementSibling;
    if (label) label.style.display = "none";
  }
  $("entitle").onclick = () => openPasses();
  // The header's Sign in / name button (owner, 3 Oct 2026): sign-in stays
  // optional, but the way in should not hide inside the pass screen.
  if (ctx.passesOn) $("acct").style.display = "inline-flex";
  const acctMenu = (open) => { const want = open === undefined ? $("acct-menu").hidden : open; $("acct-menu").hidden = !want; $("acct-btn").setAttribute("aria-expanded", String(want)); };
  $("acct-btn").onclick = () => {
    if (ctx.state.ent && ctx.state.ent.account) { acctMenu(); return; }
    ctx.track("mock_signin_click", { where: "header" });
    openPasses("", { signin: true });
  };
  document.addEventListener("click", (e) => { if (!$("acct").contains(e.target)) acctMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") acctMenu(false); });
  $("open-invite").onclick = () => openInvite();
  $("pass-back").onclick = () => ctx.resume();
  $("invite-back").onclick = () => ctx.resume();
  $("go-practise").onclick = () => ctx.practise();
  $("pass-running-back").onclick = () => ctx.resume();
  $("extend").onclick = () => { extendOpen = true; step = "choose"; paint(); $("buy-block").scrollIntoView({ behavior: "smooth", block: "center" }); };
  for (const el of document.querySelectorAll(".plan")) el.onclick = () => choosePlan(el.dataset.plan);
  $("buy-cta").onclick = () => { step = "checkout"; say(""); paint(); };
  $("have-pass").onclick = () => { step = "signin"; say(""); paint(); };
  $("checkout-back").onclick = () => { step = "choose"; say(""); paint(); };
  try { $("phone").value = localStorage.getItem(PHONE) || ""; } catch (_) { /* private mode */ }
  $("pay").onclick = pay;
  const signOut = () => { session.clear(); ctx.setEntitlement({ ...ctx.state.ent, account: null, invite: null, live_gift: null, kind: ctx.state.ent && ctx.state.ent.hasTrial ? (ctx.state.ent.trialLeft > 0 ? "trial" : "none") : "none", secondsLeft: (ctx.state.ent && ctx.state.ent.trialLeft) || 0, expiresAt: null }); step = "choose"; extendOpen = false; paint(); };
  $("signout").onclick = signOut;
  $("signout2").onclick = signOut;
  $("acct-out").onclick = () => { acctMenu(false); signOut(); };
  $("start-days").onclick = startDays;
  $("free-days-buy").onclick = () => { extendOpen = true; step = "choose"; paint(); $("buy-block").scrollIntoView({ behavior: "smooth", block: "center" }); };
  $("live-gift-form").onsubmit = claimGift;
  if (testLogin) {
    $("testlogin").style.display = "block";
    $("testlogin-go").onclick = () => onGoogle("test:" + ($("testlogin-email").value.trim() || "tester@example.com"));
  }
  const asked = window.__ps || {};
  choosePlan(asked.buy || ctx.state.plan || "m");
  if (asked.buy || asked.order) {
    // The head put the right screen up; from here the app owns it.
    if (asked.buy) { step = "checkout"; ctx.show("s-pass"); }
    document.documentElement.classList.remove("ps-pass", "ps-checkout", "ps-confirm");
  }
  ctx.restoreReport?.();
  if (await resumePendingOrder()) return;
  if (asked.buy) {
    ctx.track("mock_buy_link", { plan: asked.buy });
    await openPasses("", { plan: asked.buy, checkout: true });
  }
}

// ------------------------------------------------------------------ passes

function choosePlan(id) {
  ctx.state.plan = id;
  for (const el of document.querySelectorAll(".plan")) el.classList.toggle("on", el.dataset.plan === id);
  const p = planOf(id);
  if (p) {
    $("buy-cta").textContent = `Buy the ${p.label.replace("-Day Pass", "-day pass")} →`;
    $("pay").textContent = `Pay ${money(p)} →`;
    $("checkout-plan").textContent = `${p.label} · ${money(p)}`;
  }
}

/**
 * @param {string} [message]
 * @param {{plan?: "m", checkout?: boolean, signin?: boolean}} [opts]  the pricing page's buttons
 *        open the app straight at checkout for the pass that was clicked; the
 *        header's Sign in button lands on the sign-in step alone
 */
export async function openPasses(message, opts = {}) {
  offerWhere = ["demo_call", "demo_exit"].includes(opts.where) ? opts.where : null;
  ctx.show("s-pass");
  say(message || "");
  if (opts.plan && planOf(opts.plan)) choosePlan(opts.plan);
  if (opts.checkout) { step = "checkout"; if (ctx.state.ent && (ctx.state.ent.kind === "pass" || ctx.state.ent.invite?.banked_days > 0)) extendOpen = true; }
  if (opts.signin) { step = "signin"; extendOpen = false; }
  if (!ctx.passesOn) {
    $("pass-body").style.display = "none";
    say("Passes open in a few days.", "");
    return;
  }
  $("pass-body").style.display = "block";
  paint();
  ctx.track("mock_pass_view", { signed_in: !!(ctx.state.ent && ctx.state.ent.account), has_pass: ctx.state.ent && ctx.state.ent.kind === "pass" });
  await showGoogleButton();
}

const BLOCKED = "Google sign-in did not load. An ad blocker or Brave Shields usually causes this: allow accounts.google.com for this site, or open it in another browser, then try again.";

/* Draw Google's button once. Every caller shares one attempt, so a second
 * call can never report a failure the first one is still working through. */
function showGoogleButton() {
  if (!cfg || !cfg.google_client_id) return Promise.resolve();
  if (googleReady) return googleReady;
  googleReady = loadScript("https://accounts.google.com/gsi/client").then(() => {
    if (!window.google || !window.google.accounts) throw new Error("blocked");
    window.google.accounts.id.initialize({ client_id: cfg.google_client_id, callback: (r) => onGoogle(r.credential), ux_mode: "popup" });
    window.google.accounts.id.renderButton($("gbutton"), { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", width: 300 });
    // A blocker can let the script through and still stop the button drawing.
    setTimeout(() => { if (!$("gbutton").childElementCount) say(BLOCKED, "bad"); }, 1500);
  }).catch(() => {
    googleReady = null;            // let a later visit try again
    say(BLOCKED, "bad");
  });
  return googleReady;
}

function paint() {
  const ent = ctx.state.ent || {};
  // Cashfree takes over the page, which would end a running interview with no
  // report. Say so, and keep the pay buttons out of reach until it is over.
  const running = !!(ctx.running && ctx.running());
  $("pass-running").style.display = running ? "flex" : "none";
  $("buy-cta").disabled = running;
  $("pay").disabled = running;
  const account = ent.account;
  const live = ent.kind === "pass";
  const banked = (ent.invite && ent.invite.banked_days) || 0;
  const freeReady = !!account && banked > 0;

  // Your account, when a pass is running.
  $("account-card").style.display = live ? "block" : "none";
  if (live) {
    $("pass-who").textContent = account ? account.email : "";
    $("pass-days").textContent = daysLeft(ent.secondsLeft);
    $("pass-until").textContent = `Unlimited mocks until ${when(ent.expiresAt)}`;
    const inv = ent.invite;
    $("pass-stats").textContent = inv
      ? `${inv.friends_tried} friend${inv.friends_tried === 1 ? "" : "s"} tried it through your link · ${inv.friends_bought} bought a pass`
      : "";
    $("extend").textContent = extendOpen ? "Choosing…" : "Extend my pass";
  }

  // Buying: hidden behind "Extend" once a pass is live.
  const buying = (!live && !freeReady) || extendOpen;
  const signinOnly = step === "signin" && !account;
  if (step === "signin" && account) step = "choose";       // signed in: nothing left to ask
  $("buy-block").style.display = buying && step === "choose" ? "block" : "none";
  $("live-month-included").hidden = live;
  $("checkout").style.display = buying && (step === "checkout" || signinOnly) ? "block" : "none";
  $("pass-signin").style.display = account ? "none" : "block";
  $("pass-pay").style.display = account && !signinOnly ? "block" : "none";
  $("have-pass-row").style.display = account ? "none" : "block";
  $("checkout-label").textContent = signinOnly ? "Welcome back" : "You are buying";
  $("checkout-plan").style.display = signinOnly ? "none" : "block";
  $("checkout-what").style.display = signinOnly ? "none" : "block";
  $("checkout-back").textContent = signinOnly ? "Back" : "Change";
  $("signin-why").textContent = signinOnly
    ? "Sign in with the Google account you bought with, and your pass appears here."
    : "Sign in with Google first, so your pass follows you to any phone or laptop.";
  if (account) $("pass-who2").textContent = `Signed in as ${account.email}`;

  // Words at the top follow the state, so the page never asks for money twice.
  $("pass-kicker").textContent = live ? "Your account" : freeReady ? "Free days" : "Passes";
  $("pass-title").innerHTML = live ? 'Your pass is <em>live.</em>' : freeReady ? 'Your free days are <em>ready.</em>' : 'Unlimited mocks, <em>one payment.</em>';
  $("pass-lede").textContent = live
    ? "Practise as much as you like until it ends. Buying again adds the days on top, and nothing renews by itself."
    : freeReady ? "Start them when you are ready to practise. Your free days wait until you press Start."
      : "No subscription, and it never renews by itself. The clock starts when you pay, and the pass ends exactly on time.";

  // Arrived through a friend's link: the first pass is a week longer, so say so where the price is.
  const note = $("invited-note");
  if (note) note.style.display = !live && invitedBy() ? "block" : "none";

  $("freedays").style.display = banked > 0 ? "block" : "none";
  $("free-days-buy").hidden = !account;
  if (banked > 0) {
    const gift = ent.live_gift;
    const friends = Number(ent.invite?.friends_bought || 0) > 0 || banked > Number(gift?.total_days || gift?.days || 0);
    $("freedays-text").textContent = gift
      ? friends ? `${banked} free days waiting (from your Live Sarthi month pass and friends).`
        : `You have ${banked} free days from your Live Sarthi month pass.`
      : `You have ${banked} free day${banked > 1 ? "s" : ""} from friends who bought a pass.`;
    $("start-days").textContent = account ? `Start my ${banked} free day${banked > 1 ? "s" : ""}` : "Sign in above to start them";
    $("start-days").disabled = !account;
  }
  $("live-gift-claim").hidden = !account;
  if (!account) {
    $("live-gift-claim").open = false;
    $("live-gift-key").value = "";
    $("live-gift-error").textContent = "";
  }
  if (buying && (step === "checkout" || signinOnly)) showGoogleButton();
}
export function refreshPasses() { if (ctx) paint(); }

async function claimGift(event) {
  event.preventDefault();
  if (claimingGift || !ctx.state.ent?.account) return;
  const key = $("live-gift-key").value.trim();
  if (!key) return;
  claimingGift = true;
  const claimingSession = session.get();
  const button = $("live-gift-submit"), status = $("live-gift-error");
  button.disabled = true; status.className = "notice"; status.textContent = "Checking your Live key…";
  try {
    const result = await claimLiveGift(key, ctx.state.hash);
    if (session.get() !== claimingSession) return;
    ctx.setEntitlement(result.entitlement);
    paint();
    $("live-gift-key").value = "";
    status.className = "notice ok";
    status.textContent = result.alreadyYours ? "This key's free days are already in your account." : "Your free days have been added.";
  } catch (err) {
    status.className = "notice bad"; status.textContent = err.message;
    if (err.status === 401) {
      session.clear(); ctx.setEntitlement({ ...ctx.state.ent, account: null, invite: null, live_gift: null, kind: ctx.state.ent.hasTrial && ctx.state.ent.trialLeft > 0 ? "trial" : "none", secondsLeft: ctx.state.ent.trialLeft || 0, expiresAt: null });
      paint(); say(err.message, "bad");
    }
  } finally { claimingGift = false; button.disabled = false; }
}

/* A Google account is all it takes. No Gemini key is needed to sign in or to
 * buy; the key only matters once an interview starts. */
async function onGoogle(credential) {
  const cameToSignIn = step === "signin";
  say("Signing you in…");
  try {
    ctx.setEntitlement(await signIn(credential, ctx.state.hash));
    ctx.track("mock_sign_in", { with_key: !!ctx.state.hash, to_buy: !cameToSignIn });
    const live = ctx.state.ent.kind === "pass";
    const freeReady = (ctx.state.ent.invite?.banked_days || 0) > 0;
    if (cameToSignIn) { step = "choose"; say(live ? "Welcome back. Your pass is live." : freeReady ? "Signed in. You have free days ready to start." : "Signed in. Choose a pass below.", live || freeReady ? "ok" : ""); }
    else say("");
    paint();
    if (!cameToSignIn && !live) $("phone").focus();
  } catch (err) { say(err.message, "bad"); }
}

async function pay() {
  if (ctx.running?.()) return;
  const abroad = intl();
  const phone = $("phone").value.replace(/\D/g, "");
  if (!abroad && phone.length < 10) { say("Enter your 10-digit mobile number. Cashfree needs it for the receipt.", "bad"); return; }
  $("pay").disabled = true;
  say("Opening secure checkout…");
  try {
    const order = await startOrder(ctx.state.plan || "m", abroad ? "" : phone);
    try {
      localStorage.setItem(PENDING, JSON.stringify({
        order_id: order.order_id, hash: ctx.state.hash || null,
        gateway: order.gateway || "cashfree", at: Date.now(),
        amount: order.amount, currency: order.currency || "INR",
        ...(offerWhere ? { where: offerWhere } : {}),
      }));
      if (!abroad) localStorage.setItem(PHONE, phone.slice(-10));
    } catch (_) { /* private mode */ }
    ctx.track("begin_checkout", {
      product: "prep-sarthi", plan: ctx.state.plan || "m",
      value: order.amount, currency: order.currency || "INR",
    });
    // Dodo hosts its own checkout page, so there is no SDK to load: leaving the
    // site IS the checkout, and the return URL brings the payment back with it.
    if (order.checkout_url) { window.location.href = order.checkout_url; return; }
    await loadScript("https://sdk.cashfree.com/js/v3/cashfree.js");
    window.Cashfree({ mode: order.mode }).checkout({ paymentSessionId: order.payment_session_id, redirectTarget: "_self" });
  } catch (err) {
    if (/mobile number/i.test(String(err.message || ""))) {
      const phoneEl = $("phone");
      phoneEl.style.display = "";
      const label = phoneEl.previousElementSibling;
      if (label) label.style.display = "";
    }
    say(err.status === 401 ? "Your sign-in expired. Sign in again." : err.message, "bad");
    if (err.status === 401) { session.clear(); ctx.setEntitlement({ ...ctx.state.ent, account: null }); paint(); }
    $("pay").disabled = false;
  }
}

/* "Where did you first hear about us?", once, below the pass card after a payment (assets/heard-from.js, src/survey.js).
 * Loaded only now, and any failure is silent: it must never stand between a buyer and their pass. */
function askHeardFrom(orderId) {
  import("/assets/heard-from.js?v=20260928").then(() => {
    if (window.sarthiHeardFrom) window.sarthiHeardFrom({ mount: $("heard-from"), api: LICENSE_API, order: orderId, product: "Prep Sarthi", track: ctx.track });
  }).catch(() => { /* no survey */ });
}

/* Back from Cashfree (or the tab was closed mid-payment): ask until it is settled. */
async function resumePendingOrder() {
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PENDING) || "null"); } catch (_) { /* corrupt */ }
  const fromUrl = (window.__ps || {}).order;
  const paymentId = (window.__ps || {}).payment;
  if (fromUrl) {
    const sameOrder = pending && pending.order_id === fromUrl;
    pending = {
      order_id: fromUrl, hash: (pending && pending.hash) || null,
      at: (pending && pending.at) || Date.now(),
      gateway: (pending && pending.gateway) || null,
      payment_id: paymentId || (pending && pending.payment_id) || null,
      amount: sameOrder ? pending.amount : undefined,
      currency: sameOrder ? pending.currency : undefined,
      where: sameOrder ? pending.where : undefined,
    };
    // Written back because Dodo's payment_id lives only in the URL, and the head
    // script clears the URL: a reload would otherwise lose the reference.
    try { localStorage.setItem(PENDING, JSON.stringify(pending)); } catch (_) { /* private mode */ }
  }
  if (!pending || !session.get() || Date.now() - (pending.at || 0) > 3600_000) {
    document.documentElement.classList.remove("ps-pass", "ps-confirm");
    if (fromUrl) { ctx.show("s-pass"); $("pass-body").style.display = "block"; paint(); say("That payment could not be matched to this browser. If money left your account, sign in below with the same Google account and your pass will be there.", ""); ctx.paymentResult?.("pending", pending); return true; }
    return false;
  }
  ctx.state.hash = ctx.state.hash || pending.hash;
  ctx.show("s-pass");
  $("pass-body").style.display = "none";
  // Cashfree sends people back with ?order_id= after a payment, good or bad.
  // Arriving without it means they pressed Back on Cashfree's page: ask a few
  // times in case the money did move, then stop pretending something is pending.
  const cameBackByHand = !fromUrl;
  say(cameBackByHand ? "Checking whether a payment went through…" : "Confirming your payment… keep this page open.");
  for (let i = 0; i < (cameBackByHand ? 3 : 40); i++) {
    let r;
    try { r = await orderStatus(pending.order_id, pending.hash, pending.payment_id); } catch (_) { r = { status: "pending" }; }
    if (r.status === "paid") {
      try { localStorage.removeItem(PENDING); } catch (_) { /* ignore */ }
      ctx.setEntitlement(r.entitlement);
      await reportPaidOrder(pending, r, ctx.track);
      step = "choose"; extendOpen = false;
      $("pass-body").style.display = "block"; paint();
      say(`Paid. Your ${r.plan} is live. Practise as much as you like.`, "ok");
      askHeardFrom(pending.order_id);
      $("pass-back").textContent = "Back";
      ctx.paymentResult?.("paid", pending);
      return true;
    }
    if (r.status === "failed") {
      try { localStorage.removeItem(PENDING); } catch (_) { /* ignore */ }
      step = "choose";
      $("pass-body").style.display = "block"; paint();
      say("That payment did not go through, and nothing was charged. You can try again.", "bad");
      ctx.paymentResult?.("failed", pending);
      return true;
    }
    await new Promise((ok) => setTimeout(ok, 2500));
  }
  if (cameBackByHand) {
    try { localStorage.removeItem(PENDING); } catch (_) { /* ignore */ }
    step = "checkout";
    $("pass-body").style.display = "block"; paint();
    say(pending.gateway === "dodo"
      ? "We could not confirm a payment for that order. If money did leave your account, your pass will appear here within a few minutes; nothing else is needed from you."
      : "That payment was not completed, and nothing was charged. You can pay whenever you are ready.", "");
    ctx.paymentResult?.("pending", pending);
    return true;
  }
  $("pass-body").style.display = "block"; paint();
  say("The payment is still being confirmed. If money left your account, your pass will appear here within a few minutes. Otherwise write to support@interviewsarthi.com.", "");
  ctx.paymentResult?.("pending", pending);
  return true;
}

async function startDays() {
  try {
    await startFreeDays();
    ctx.setEntitlement(await ctx.refresh());
    $("live-gift-notice").hidden = true;
    extendOpen = false; step = "choose";
    paint();
    say("Your free days have started. Unlimited mocks until they end.", "ok");
    ctx.track("mock_free_days_started", {});
  } catch (err) { say(err.message, "bad"); }
}

// ------------------------------------------------------------------ invites

export async function openInvite() {
  ctx.show("s-invite");
  // Nobody is sent to the key screen for this: the key comes up only after a pass is bought (owner, 25 Sep 2026).
  if (!currentInvite()) {
    try { ctx.state.deviceInvite = (await deviceInvite()).invite; }
    catch (err) {
      $("invite-full").innerHTML = `<div class="card invite"><span class="label">Invite a friend</span><h2>Give a week, get a week.</h2>
        <p class="muted">${err.status === 403 ? "Do your free 7-minute demo first. Then you get a link to send your friends."
          : "Your invite link could not be loaded just now. Please try again in a minute."}</p></div>`;
      ctx.track("mock_invite_view", { from: "nav", code: false });
      return;
    }
  }
  renderInvite($("invite-full"), null);
  ctx.track("mock_invite_view", { from: "nav" });
}

/* The invite this person shares: their key's (a pass holder who has set up the app), else their browser's (the demo). */
export function currentInvite() {
  const ent = ctx.state.ent;
  if (ent && ent.invite && ent.invite.code) return ent.invite;
  return ctx.state.deviceInvite && ctx.state.deviceInvite.code ? ctx.state.deviceInvite : null;
}

/** Draw the invite card into `host`. `score` is only ever used if the person ticks the box. */
export function renderInvite(host, score) {
  const inv = currentInvite();
  if (!inv) { host.innerHTML = ""; return; }   // never show a link without a code
  const link = inviteLink(inv.code);
  // "Give a week, get a week" (owner, 27 Sep 2026): made for the one-month pass.
  const rules = inv.rules || { inviter_days: 7, friend_days: 7 };
  const brag = Number(score) >= SCORE_WORTH_SHARING;
  host.innerHTML = `
    <div class="card invite">
      <span class="label">Invite a friend</span>
      <h2>Give a week, get a week.</h2>
      <p class="muted">Send your link to friends with interviews coming up. They get the free demo like you did, and if they buy a pass, their first month lasts ${30 + Number(rules.friend_days)} days and you get ${rules.inviter_days} free days. You don't need a pass of your own: your free days wait for you until you start them. Every friend who buys counts.</p>
      <input type="text" class="invite-link" readonly value="${escapeHtml(link)}">
      ${brag ? `<label class="check"><input type="checkbox" class="with-score"> Include my score (${Number(score)}) in the message</label>` : ""}
      <div class="actions">
        <a class="pill share-wa" target="_blank" rel="noopener">Share on WhatsApp</a>
        <button class="pill ghost share-copy">Copy link</button>
        ${navigator.share ? `<button class="pill ghost share-more">More…</button>` : ""}
      </div>
      <p class="muted invite-stats">${Number(inv.friends_bought || 0)} friend${Number(inv.friends_bought) === 1 ? "" : "s"} bought a pass through your link${inv.banked_days ? ` · ${inv.banked_days} free days waiting for you: open Passes to start them` : ""}</p>
    </div>`;
  const text = () => {
    const withScore = brag && host.querySelector(".with-score") && host.querySelector(".with-score").checked;
    return (withScore
      ? `I scored ${Number(score)}/100 in a mock interview with an AI that had read my CV. Try yours, the first one is free (and through my link a pass gives you an extra week): `
      : `I just did a mock interview with an AI that had actually read my CV. It asks follow-ups like a real interviewer. Try yours, the first one is free (and through my link a pass gives you an extra week): `) + link;
  };
  const wa = host.querySelector(".share-wa");
  const setWa = () => { wa.href = "https://wa.me/?text=" + encodeURIComponent(text()); };
  setWa();
  wa.onclick = () => ctx.track("mock_invite_share", { via: "whatsapp" });
  const box = host.querySelector(".with-score"); if (box) box.onchange = setWa;
  host.querySelector(".invite-link").onclick = (e) => e.target.select();
  host.querySelector(".share-copy").onclick = async (e) => {
    try { await navigator.clipboard.writeText(text()); e.target.textContent = "Copied"; } catch (_) { host.querySelector(".invite-link").select(); e.target.textContent = "Select and copy"; }
    ctx.track("mock_invite_share", { via: "copy" });
  };
  const more = host.querySelector(".share-more");
  if (more) more.onclick = () => { navigator.share({ text: text() }).catch(() => {}); ctx.track("mock_invite_share", { via: "native" }); };
}
