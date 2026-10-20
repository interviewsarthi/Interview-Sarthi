/* My Sarthi: everything one person has with Interview Sarthi, after a Google sign-in (owner, 9 Oct 2026).
 *
 * The server side is the licence worker's /account routes (AI-Helps_SAAS license-server/src/account.js and the
 * modules it routes to). Sign-in is Prep Sarthi's own: the same Google button, the same 30-day session in the same
 * localStorage key, so someone signed in to Prep is signed in here too.
 *
 * Every piece of text from the server is set with textContent, never as HTML: a Live interview's transcript is
 * whatever the interviewer said. No analytics script runs on this page. */

const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const API = LOCAL ? "https://interview-sarthi-license-test.interview-sarthi-license.workers.dev" : "https://license.interviewsarthi.com";
const $ = (id) => document.getElementById(id);

const mem = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } },
};
const tab = {
  get(k) { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch { /* private mode */ } },
};
const session = { get: () => mem.get("ps_session"), set: (v) => mem.set("ps_session", v), clear: () => mem.set("ps_session", "") };

let wantConnect = Boolean(window.__msConnect) || tab.get("ms_connect") === "1";
delete window.__msConnect;
let data = null, profile = null, jds = [], liveItems = [], readerId = "";

const full = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const short = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const when = (iso) => (iso ? full.format(new Date(iso)) : "");
const day = (iso) => (iso ? short.format(new Date(iso)) : "");
// The owner's approved wording, 10 Oct 2026 (licence worker consent version "2026-10-10-past"). Not a word changes
// without changing that version too.
const KEEP_TEXT = "Your Live interviews from a connected PC are kept here. When you switch this on, each connected PC sends the " +
  "interviews from the past year already on it, once, and after that each interview when it ends. Kept: what the app heard from " +
  "the call, the screen text it read and every answer it showed you, with the date, length and language. The app does not " +
  "transcribe your microphone for this (lines older versions took from it are left out), and no audio or screenshot is ever " +
  "sent. Interviews are deleted after 365 days; delete any of them here at any time and it is not sent again. Switching this " +
  "off stops new ones and deletes nothing. Kept only to show them to you, unless you also tick the next box.";
const IMPROVE_TEXT = "Sarthi may read your kept interviews, not linked to your account's name or email, to improve Live Sarthi's " +
  "answers. Keeping works without this; untick it at any time.";

/* A node: el("p", { class: "fine", text: "..." }, child, ...). Strings become text, never markup. */
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
  return e;
}

/* A link from the server, only if it is https or a path on this site: never javascript: or data:. */
function safe(url) {
  const u = String(url || "");
  return /^https:\/\//i.test(u) || (u.startsWith("/") && !u.startsWith("//")) ? u : null;
}

function say(message, bad = false) {
  $("notice").textContent = message || "";
  $("notice").className = "notice" + (bad ? " bad" : "");
  if (message) $("notice").scrollIntoView({ block: "nearest" });
}

/* Reads only: sending them twice changes nothing. Owner's connection, 10 Oct 2026: about 1 in 3 requests got stuck
 * on the way to the server while the next went straight through, so a read that gets no answer is sent once more. */
const RETRY_READS = new Set(["/account", "/account/live/get", "/account/live/list", "/account/profile", "/mock/config"]);

async function call(path, body = {}, options = {}) {
  try { return await callOnce(path, body, options); }
  catch (err) {
    if (err.status || !RETRY_READS.has(path)) throw err;          // a "no" from the server is final
    return callOnce(path, body, options);
  }
}

async function callOnce(path, body = {}, { auth = true } = {}) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 12000);
  try {
    const res = await fetch(API + path, { method: "POST", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: abort.signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify(auth ? { session: session.get(), ...body } : body) });
    let out = {};
    try { out = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) { const err = new Error(out.error || "Something went wrong. Please try again."); err.status = res.status; throw err; }
    return out;
  } catch (err) {
    if (err.status) throw err;
    throw new Error("Could not reach the server just now. Please try again.");
  } finally { clearTimeout(timer); }
}

async function act(button, work) {
  if (button) button.disabled = true;
  try { return await work(); }
  catch (err) {
    if (err.status === 401) { session.clear(); showSignedOut(); say("Your sign-in ended. Sign in again.", true); return null; }
    say(err.message, true); return null;
  } finally { if (button) button.disabled = false; }
}

// ------------------------------------------------------------------ sign-in

function show(view) {
  $("signed-out").hidden = view !== "out";
  $("signed-in").hidden = view !== "in";
  $("closed").hidden = view !== "closed";
  $("loading").hidden = view !== "loading";
  $("bell").hidden = view !== "in";
  if (view !== "in") $("bell-panel").hidden = true;
}

async function showSignedOut() {
  show("out");
  if (wantConnect) say("Sign in to connect your PC to My Sarthi.");
  if (LOCAL) $("test-login").hidden = false;
  try {
    const cfg = await call("/mock/config", {}, { auth: false });
    if (!cfg.google_client_id) return;
    await new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const s = el("script", { src: "https://accounts.google.com/gsi/client", async: true, onload: resolve, onerror: reject });
      document.head.append(s);
    });
    window.google.accounts.id.initialize({ client_id: cfg.google_client_id, callback: (r) => signedIn(r.credential), ux_mode: "popup" });
    window.google.accounts.id.renderButton($("gbutton"), { theme: "filled_blue", size: "large", shape: "pill", text: "continue_with", width: 300 });
  } catch {
    say("Google sign-in did not load. Turn off any content blocker for this page and reload.", true);
  }
}

async function signedIn(idToken) {
  const out = await act(null, () => call("/mock/auth/google", { id_token: idToken }, { auth: false }));
  if (!out || !out.session) return;
  session.set(out.session);
  say("");
  await load();
}

$("test-login").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("test-email").value.trim();
  if (email) signedIn(`test:${email}`);
});

// ------------------------------------------------------------------ the page

async function load() {
  // The first load says so while it waits (owner, 10 Oct 2026: a 20-second answer left the page blank). A reload
  // after an action keeps the account on screen instead.
  const first = !data;
  let slow = null;
  if (first) {
    show("loading");
    $("loading-text").textContent = "Loading your account…";
    $("loading-retry").hidden = true;
    $("loading-slow").hidden = true;
    slow = setTimeout(() => { $("loading-slow").hidden = false; }, 6000);
  }
  try {
    data = await call("/account");
  } catch (err) {
    if (err.status === 401) { session.clear(); return showSignedOut(); }
    if (err.status === 404) return show("closed");
    if (first) {
      $("loading-text").textContent = err.message;
      $("loading-slow").hidden = true;
      $("loading-retry").hidden = false;
      return;
    }
    return say(err.message, true);
  } finally {
    clearTimeout(slow);
  }
  show("in");
  render();
  if (wantConnect) openConnect();
}

function unavailable(name) { return (data.unavailable || []).includes(name); }
function missing(target) {
  const tag = target.tagName === "UL" ? "li" : "p";
  target.replaceChildren(el(tag, { class: tag === "li" ? "empty" : "fine", text: "Couldn't load this part. Reload the page to try again." }));
}

function render() {
  const a = data.account;
  $("hello").textContent = a.name ? `Hi, ${a.name.split(" ")[0]}` : "Your account";
  $("hello-sub").textContent = `Signed in as ${a.email}`;
  $("account-line").textContent = `Signed in with Google as ${a.email}${a.name ? ` (${a.name})` : ""}.`;
  renderBell();
  renderKeys();
  renderInterviews();
  renderPcs();
  renderProfileSummary();
  renderPrep();
  renderPurchases();
  renderTickets();
  renderInvite();
  renderHome();
  // The first draw opens the section the link names (or Home); a redraw after an action stays where the person is.
  showPane(pane || paneFromHash());
}

// ------------------------------------------------------------------ one section at a time (owner, 10 Oct 2026)

const PANES = ["home", "live", "interviews", "profile", "prep", "purchases", "help", "invite", "apply", "account"];
let pane = "";

function paneFromHash() {
  const name = location.hash.slice(1);
  return PANES.includes(name) ? name : "home";
}

function showPane(name, scroll = false) {
  if (!PANES.includes(name) || $(name).hidden) name = "home";      // Invite only exists with an invite code
  pane = name;
  for (const p of PANES) $(p).classList.toggle("on", p === name);
  for (const link of $("menu").querySelectorAll("a[data-pane]")) {
    const on = link.dataset.pane === name;
    link.classList.toggle("on", on);
    if (on) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  // On a phone the menu is a row of tabs wider than the screen: bring the chosen one into view.
  const chosen = $("menu").querySelector(`a[data-pane="${name}"]`);
  if (chosen) $("menu").scrollTo({ left: chosen.offsetLeft - 16, behavior: "smooth" });
  if (scroll) {
    // A long section was scrolled down: start the new one at its top, menu in view.
    const top = $("dash").getBoundingClientRect().top + window.scrollY - 8;
    if (window.scrollY > top) window.scrollTo({ top });
  }
}

function go(name) {
  if (location.hash !== `#${name}`) history.pushState(null, "", `#${name}`);
  showPane(name, true);
}

$("menu").addEventListener("click", (e) => {
  const link = e.target.closest("a[data-pane]");
  if (!link) return;
  e.preventDefault();                       // no jump down the page: the section replaces the one shown
  go(link.dataset.pane);
});
window.addEventListener("popstate", () => { if (data) showPane(paneFromHash(), true); });

// ------------------------------------------------------------------ home: where everything stands, one tile each

function tile(title, value, detail, ...buttons) {
  return el("div", { class: "card tile" },
    el("p", { class: "eyebrow", text: title }),
    el("p", { class: "value", text: value }),
    detail ? el("p", { class: "fine", text: detail }) : null,
    el("div", { class: "actions" }, buttons));
}
function open(name, label = "Open") {
  return el("button", { class: "btn ghost", type: "button", text: label, onclick: () => go(name) });
}
const COULD_NOT = "Couldn't load this part. Reload the page to try again.";

function renderHome() {
  const box = $("home-tiles");
  box.replaceChildren();

  // Live Sarthi: the pass that matters most (active, then waiting to be activated, then the newest).
  if (unavailable("live")) box.append(tile("Live Sarthi", "—", COULD_NOT, open("live")));
  else {
    const keys = data.live.keys;
    const rank = { active: 0, not_activated: 1 };
    const best = keys.slice().sort((a, b) => (rank[a.pass.state] ?? 2) - (rank[b.pass.state] ?? 2))[0];
    box.append(best
      ? tile("Live Sarthi", best.pass.label, (STATES[best.pass.state] || (() => best.pass.state))(best.pass) +
          (keys.length > 1 ? ` · ${keys.length} passes in your account` : ""), open("live", "See your passes"))
      : tile("Live Sarthi", "No pass yet", "Bought with another email? Add its key.", open("live")));
  }

  // Live interviews kept here.
  const iv = data.live && data.live.interviews;
  if (unavailable("live_interviews") || !iv) box.append(tile("Live interviews", "—", COULD_NOT, open("interviews")));
  else {
    const n = iv.recent.length;
    const value = !iv.enabled ? "Not kept" : n ? `${n}${iv.more ? "+" : ""} kept` : "None yet";
    const detail = !iv.enabled ? "Switch on keeping to read your interviews here, on your phone too."
      : n ? `Latest: ${when(iv.recent[0].started_at)}` : "They appear here after your next interview on a connected PC.";
    box.append(tile("Live interviews", value, detail, open("interviews", n ? "Read them" : "Open")));
  }

  // Profile: what the apps fill their empty boxes from.
  const p = data.profile;
  if (unavailable("profile") || !p) box.append(tile("Your profile", "—", COULD_NOT, open("profile")));
  else {
    const parts = [];
    if (p.cv) parts.push("resume");
    if (p.jds.length) parts.push(`${p.jds.length} job description${p.jds.length === 1 ? "" : "s"}`);
    if (p.examples) parts.push("examples");
    if (p.gemini.saved) parts.push("Gemini key");
    box.append(tile("Your profile", parts.length ? `${parts.length} of 4 saved` : "Nothing saved yet",
      parts.length ? `Saved: ${parts.join(", ")}.` : "Save your resume, job description and Gemini key once; the apps fill from it.",
      open("profile", parts.length ? "Edit profile" : "Add your profile")));
  }

  // PCs connected to this account.
  if (unavailable("pcs")) box.append(tile("Your PCs", "—", COULD_NOT, open("interviews")));
  else {
    const pcs = data.live.pcs || [];
    box.append(tile("Your PCs", pcs.length ? `${pcs.length} connected` : "None connected",
      pcs.length ? pcs.map((pc) => pc.name).join(", ") : "In Live Sarthi: settings → 5. My Sarthi → Connect.",
      el("button", { class: "btn ghost", type: "button", text: "Connect a PC", onclick: () => { go("interviews"); openConnect(); } }),
      pcs.length ? open("interviews", "Manage") : null));
  }

  // Prep Sarthi.
  const pr = data.prep;
  if (unavailable("prep") || !pr) box.append(tile("Prep Sarthi", "—", COULD_NOT, open("prep")));
  else box.append(tile("Prep Sarthi", pr.pass.valid ? "Pass active" : "No pass",
    pr.pass.valid ? `Until ${when(pr.pass.expires_at)}` : pr.banked_days ? `${pr.banked_days} free days waiting.` : "Practise out loud with an AI interviewer.",
    open("prep")));

  // Help: open conversations first.
  if (unavailable("support")) box.append(tile("Help", "—", COULD_NOT, open("help")));
  else {
    const t = data.support || [];
    const openOnes = t.filter((x) => x.open).length, replied = t.filter((x) => x.open && x.replied).length;
    box.append(tile("Help", openOnes ? `${openOnes} open` : "All clear",
      replied ? `We replied to ${replied}.` : openOnes ? "We'll reply in the app and here." : "No open conversations.", open("help")));
  }
}

// ------------------------------------------------------------------ the bell

function renderBell() {
  const n = data.notices || { items: [], unread: 0 };
  $("bell").hidden = unavailable("notices");
  $("bell-count").hidden = !n.unread;
  $("bell-count").textContent = String(n.unread);
  const list = $("bell-list");
  list.replaceChildren();
  if (!n.items.length) list.append(el("li", {}, el("p", { text: "Nothing new." })));
  for (const item of n.items) {
    list.append(el("li", { class: item.unread ? "unread" : "" },
      el("b", { text: item.title }),
      item.body ? el("p", { text: item.body }) : null,
      item.until ? el("p", { text: `Until ${when(item.until)}` }) : null,
      safe(item.link) ? el("a", { href: safe(item.link), text: "Open →" }) : null));
  }
}

$("bell").addEventListener("click", async () => {
  const open = $("bell-panel").hidden;
  $("bell-panel").hidden = !open;
  $("bell").setAttribute("aria-expanded", String(open));
  if (open && data && data.notices && data.notices.unread) {
    $("bell-count").hidden = true;
    data.notices.unread = 0;
    call("/account/notices/seen").catch(() => {});
    setTimeout(() => { for (const n of data.notices.items) n.unread = false; renderBell(); $("bell-count").hidden = true; }, 1500);
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("bell-panel").hidden) { $("bell-panel").hidden = true; $("bell").setAttribute("aria-expanded", "false"); } });

// ------------------------------------------------------------------ Live Sarthi

const STATES = {
  active: (p) => `Active until ${when(p.ends_at)}`,
  not_activated: (p) => `Not activated yet: activate by ${when(p.activate_by)}. Its days start when you activate it in the app.`,
  ended: (p) => `Ended on ${when(p.ends_at)}`,
  expired_unused: (p) => `Not activated in time: the deadline was ${when(p.activate_by)}`,
  disabled: () => "This pass is disabled. Write to support@interviewsarthi.com.",
};

function copyButton(text, label = "Copy") {
  return el("button", { class: "text-button", type: "button", text: label, onclick: async (e) => {
    try { await navigator.clipboard.writeText(text); e.target.textContent = "Copied"; setTimeout(() => { e.target.textContent = label; }, 1500); }
    catch { say(text); }
  } });
}

function renderKeys() {
  const box = $("live-keys");
  if (unavailable("live")) return missing(box);
  box.replaceChildren();
  const keys = data.live.keys;
  if (!keys.length) {
    box.append(el("div", { class: "card" },
      el("p", { text: "No Live Sarthi pass on this Google account yet. If you bought one with another email, add its key below." }),
      el("a", { class: "btn ghost", href: "/live/", text: "About Live Sarthi →" })));
    return;
  }
  for (const k of keys) box.append(keyCard(k));
}

function keyCard(k) {
  const p = k.pass;
  const card = el("div", { class: "card pass-card" },
    el("div", { class: "card-top" },
      el("p", { class: "eyebrow", text: "Live Sarthi" }),
      k.how === "pasted" ? el("span", { class: "tag", text: "Added by key" }) : null),
    el("h3", { class: "pass-name", text: p.label }),
    el("p", { class: "state", text: (STATES[p.state] || (() => p.state))(p) }),
    el("div", { class: "keyline" }, el("code", { text: k.key }), copyButton(k.key, "Copy key")),
    el("div", { class: "details" },
      el("span", { text: `${p.devices_used} of ${p.devices_max} computer${p.devices_max === 1 ? "" : "s"}` }),
      k.devices && k.devices.length ? el("span", { text: `On: ${k.devices.map((d) => d.name).join(", ")}` }) : null,
      el("span", { text: `Bought ${day(k.created_at)}` })),
    k.prep_gift ? el("p", { class: "gift", text: `Prep Sarthi free for ${k.prep_gift.days} days with this pass.${k.prep_gift.claimed ? " Added to your Prep account." : " Sign in to Prep with this Google account to get it."}` }) : null);
  if (k.upgrade && safe(k.upgrade.url)) card.append(upgradeBox(k.upgrade));
  const actions = el("div", { class: "actions" });
  if (safe(k.manage_url)) actions.append(el("a", { class: "btn ghost", href: safe(k.manage_url), text: "Manage this pass" }));
  if (k.how === "pasted") actions.append(el("button", { class: "btn ghost", type: "button", text: "Remove from my account", onclick: (e) => act(e.target, async () => {
    if (!confirm("Take this key off your My Sarthi account? The pass itself keeps working.")) return;
    await call("/account/unlink", { key: k.key });
    await load();
  }) }));
  if (actions.childElementCount) card.append(actions);
  return card;
}

function upgradeBox(u) {
  return el("div", { class: "upgrade" },
    u.kind === "comeback" ? el("p", { class: "eyebrow", text: "Your ₹99 still counts." }) : null,
    el("h3", { text: `Make this pass a month: ₹${u.amount} more` }),
    el("p", { text: u.starts_on_activation ? `${u.to_label}: 30 days from when you activate, ${u.devices_after} computers.`
      : `${u.to_label} until ${when(u.ends_after)}, ${u.devices_after} computers.` }),
    u.prep_gift_days ? el("p", { class: "gift", text: `Prep Sarthi free for ${u.prep_gift_days} days included.` }) : null,
    el("p", { class: "fine", text: `Open until ${when(u.offer_until)}. India only: paid through Cashfree on your pass page.` }),
    el("a", { class: "btn primary", href: safe(u.url), text: `Upgrade for ₹${u.amount}` }));
}

$("link-form").addEventListener("submit", (e) => {
  e.preventDefault();
  act(e.submitter, async () => {
    const out = await call("/account/link", { key: $("link-key").value });
    $("link-key").value = "";
    say(out.linked ? "Key added." : "That key is already in your account.");
    await load();
  });
});

// ------------------------------------------------------------------ Live interviews and PCs

function renderInterviews() {
  const iv = data.live.interviews;
  $("keep-text").replaceChildren(KEEP_TEXT + " ", el("a", { href: "/privacy.html#my-sarthi", text: "Privacy" }));
  $("improve-text").textContent = IMPROVE_TEXT;
  if (unavailable("live_interviews") || !iv) { missing($("live-list")); return; }
  $("keep-live").checked = iv.enabled;
  // On under the earlier text: the server stopped keeping until the new one is agreed to. Say why the box is empty.
  $("keep-again").hidden = !(!iv.enabled && iv.consent_version && iv.consent_version !== iv.current_consent_version);
  $("improve-live").checked = Boolean(iv.improve);
  $("improve-live").disabled = !iv.enabled;
  $("no-pc").hidden = (data.live.pcs || []).length > 0;
  liveItems = iv.recent.slice();
  paintLiveList(iv.more);
}

function paintLiveList(more) {
  const list = $("live-list");
  list.replaceChildren();
  if (!liveItems.length) list.append(el("li", { class: "empty", text: "No Live interviews kept yet." }));
  for (const it of liveItems) {
    list.append(el("li", {},
      el("div", {}, el("b", { text: when(it.started_at) }),
        el("div", { class: "meta", text: `${it.minutes ?? "?"} min · ${it.questions} interviewer lines · ${it.answers} answers shown` })),
      el("div", {},
        el("button", { class: "btn ghost", type: "button", text: "Read", onclick: (e) => act(e.target, () => openReader(it.id)) }))));
  }
  $("live-more").hidden = !more;
  $("live-delete-all").hidden = !liveItems.length;
}

$("keep-live").addEventListener("change", (e) => act(e.target, async () => {
  const wanted = e.target.checked;
  let out;
  try { out = await call("/account/live/prefs", { enabled: wanted }); }
  catch (err) { e.target.checked = !wanted; throw err; }         // the box shows what the server has
  e.target.checked = out.enabled;
  $("improve-live").checked = Boolean(out.improve);
  $("improve-live").disabled = !out.enabled;
  $("keep-again").hidden = true;
  say(out.enabled ? "Your Live interviews will be kept here: the past year's from each connected PC the next time Live Sarthi starts, then each new one."
    : "Switched off. New interviews stay only on your PC; nothing was deleted.");
}));

$("improve-live").addEventListener("change", (e) => act(e.target, async () => {
  const wanted = e.target.checked;
  let out;
  try { out = await call("/account/live/prefs", { improve: wanted }); }
  catch (err) { e.target.checked = !wanted; throw err; }
  e.target.checked = Boolean(out.improve);
  say(out.improve ? "Thank you. Sarthi may read your kept interviews, not linked to your name or email." : "Your kept interviews are for you only.");
}));

$("live-more").addEventListener("click", (e) => act(e.target, async () => {
  const last = liveItems[liveItems.length - 1];
  const out = await call("/account/live/list", { before: last && last.started_at, limit: 20 });
  liveItems = liveItems.concat(out.items);
  paintLiveList(out.more);
}));

$("live-delete-all").addEventListener("click", (e) => act(e.target, async () => {
  if (!confirm("Delete every Live interview kept in My Sarthi? The copies on your PC stay.")) return;
  await call("/account/live/delete", { all: true });
  $("reader").hidden = true;
  await load();
}));

async function openReader(id) {
  const out = await call("/account/live/get", { id });
  readerId = id;
  $("reader-title").textContent = `Interview, ${when(out.item.started_at)}`;
  $("reader-transcript").textContent = out.item.transcript || "(nothing heard)";
  $("reader-answers").textContent = out.item.answers || "(no answers)";
  $("reader").hidden = false;
  $("reader").scrollIntoView({ block: "start" });
}

$("reader-close").addEventListener("click", () => { $("reader").hidden = true; });
$("reader-delete").addEventListener("click", (e) => act(e.target, async () => {
  if (!readerId || !confirm("Delete this interview from My Sarthi? The copy on your PC stays.")) return;
  await call("/account/live/delete", { id: readerId });
  $("reader").hidden = true;
  await load();
}));

function renderPcs() {
  const list = $("pcs");
  if (unavailable("pcs")) return missing(list);
  list.replaceChildren();
  const pcs = data.live.pcs || [];
  if (!pcs.length) list.append(el("li", { class: "empty", text: "No PC connected. In Live Sarthi: settings → 5. My Sarthi → Connect." }));
  for (const pc of pcs) {
    list.append(el("li", {},
      el("div", {}, el("b", { text: pc.name }), el("div", { class: "meta", text: `Connected ${day(pc.linked_at)} · last used ${day(pc.last_used_at)}` })),
      el("button", { class: "btn ghost", type: "button", text: "Disconnect", onclick: (e) => act(e.target, async () => {
        if (!confirm(`Disconnect ${pc.name}? It stops reading your profile and sending interviews.`)) return;
        await call("/account/pcs/remove", { id: pc.id });
        await load();
      }) })));
  }
}

// ------------------------------------------------------------------ connecting a PC (a typed code)

/* The card opens from the app's link (?connect) or the "Connect a PC" button. The code is typed, never carried in a link:
 * a code someone else made cannot connect their PC to this account by a click (owner, 10 Oct 2026). */
function openConnect() {
  wantConnect = false; tab.set("ms_connect", "");
  $("connect-card").hidden = false;
  $("connect-body").replaceChildren();
  $("connect-card").scrollIntoView({ block: "start" });
  $("connect-code").focus();
}
$("connect-open").addEventListener("click", openConnect);

$("connect-form").addEventListener("submit", (e) => {
  e.preventDefault();
  act(e.submitter, async () => {
    const body = $("connect-body");
    const info = await call("/account/connect/check", { user_code: $("connect-code").value });
    const keep = el("input", { type: "checkbox", id: "connect-keep" });
    const improve = el("input", { type: "checkbox", id: "connect-improve", disabled: true });
    keep.addEventListener("change", () => { improve.disabled = !keep.checked; if (!keep.checked) improve.checked = false; });
    const button = el("button", { class: "btn primary", type: "button", text: "Connect this PC" });
    body.replaceChildren(
      el("p", { text: "Is this your PC, showing this code in Live Sarthi right now?" }),
      el("p", { class: "pc", text: info.name }),
      el("p", { class: "code", text: info.user_code }),
      el("label", { class: "switch", for: "connect-keep" }, keep, el("span", { text: "Keep my Live interviews in My Sarthi" })),
      el("p", { class: "fine" }, KEEP_TEXT + " ", el("a", { href: "/privacy.html#my-sarthi", text: "Privacy" })),
      el("label", { class: "switch", for: "connect-improve" }, improve, el("span", { text: "Also let Sarthi read them to improve Live Sarthi's answers (optional)" })),
      el("p", { class: "fine", text: IMPROVE_TEXT }),
      el("div", { class: "actions" }, button,
        el("button", { class: "btn ghost", type: "button", text: "Not my PC", onclick: () => { body.replaceChildren(); $("connect-card").hidden = true; } })));
    button.addEventListener("click", () => act(button, async () => {
      const out = await call("/account/connect", { user_code: info.user_code, live_history: keep.checked, improve: keep.checked && improve.checked });
      body.replaceChildren(el("p", { text: `Connected: ${out.name}.` }),
        el("p", { text: "Go back to Live Sarthi: it fills its empty boxes now. Press Save there to keep them. The PC appears under Your PCs once the app has picked up the connection, in a few seconds." }));
      $("connect-code").value = "";
      await load();
      $("connect-card").hidden = false;
      // The app collects its token on its next poll (every 5 s): one more look, so the PC shows without a reload.
      setTimeout(() => load().then(() => { $("connect-card").hidden = false; }).catch(() => {}), 7000);
    }));
  });
});

// ------------------------------------------------------------------ profile

function renderProfileSummary() {
  const p = data.profile, out = $("profile-summary");
  if (unavailable("profile") || !p) return missing(out);
  const parts = [];
  if (p.cv) parts.push(`Resume${p.cv.file_name ? ` (${p.cv.file_name})` : ""}`);
  if (p.jds.length) parts.push(`${p.jds.length} job description${p.jds.length === 1 ? "" : "s"}`);
  if (p.examples) parts.push("your examples");
  if (p.gemini.saved) parts.push(`Gemini key ${p.gemini.hint}`);
  out.textContent = parts.length ? `Saved: ${parts.join(" · ")}.` : "Nothing saved yet.";
  geminiState(p.gemini);
}

function geminiState(g) {
  $("gemini-state").textContent = g.saved ? `A key ending ${g.hint.replace("…", "")} is saved.` : "No key saved.";
  $("gemini-remove").hidden = !g.saved;
}

$("profile-open").addEventListener("click", (e) => act(e.target, async () => {
  profile = await call("/account/profile");
  $("pf-name").value = profile.name || "";
  $("pf-language").value = profile.language || "";
  $("pf-role").value = profile.target_role || "";
  $("pf-level").value = profile.target_level || "";
  $("pf-cv").value = profile.cv ? profile.cv.text : "";
  $("pf-cv").dataset.file = profile.cv ? profile.cv.file_name || "" : "";
  $("pf-examples").value = profile.examples ? profile.examples.text : "";
  jds = (profile.jds || []).map((j) => ({ id: j.id, title: j.title, text: j.text }));
  paintJds();
  cvCount();
  $("profile-form").hidden = false;
  e.target.hidden = true;
}));

function cvCount() { $("pf-cv-count").textContent = `${$("pf-cv").value.length.toLocaleString("en-IN")} / 20,000 characters`; }
$("pf-cv").addEventListener("input", cvCount);

$("pf-cv-file").addEventListener("change", (e) => act(null, async () => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const { readDocFile } = await import("/prep/app/cv.js");
  const text = await readDocFile(file, "CV");
  if (!text) throw new Error("No text could be read from that file (a scanned PDF?). Paste the text instead.");
  $("pf-cv").value = text.slice(0, 20000);
  $("pf-cv").dataset.file = file.name;
  cvCount();
}));

function paintJds() {
  const box = $("pf-jds");
  box.replaceChildren();
  jds.forEach((j, i) => {
    const title = el("input", { type: "text", maxlength: "120", placeholder: "Title, e.g. Data Analyst at Acme" });
    title.value = j.title || "";
    title.addEventListener("input", () => { j.title = title.value; });
    const text = el("textarea", { rows: "5", maxlength: "20000", placeholder: "Paste the responsibilities and requirements" });
    text.value = j.text || "";
    text.addEventListener("input", () => { j.text = text.value; });
    box.append(el("div", { class: "jd" },
      el("div", { class: "input-row" }, title,
        el("button", { class: "text-button", type: "button", text: "Remove", onclick: () => { jds.splice(i, 1); paintJds(); } })),
      text));
  });
  $("pf-jd-add").hidden = jds.length >= 10;
}

$("pf-jd-add").addEventListener("click", () => { jds.push({ title: "", text: "" }); paintJds(); });

$("profile-form").addEventListener("submit", (e) => {
  e.preventDefault();
  act(e.submitter, async () => {
    const cvText = $("pf-cv").value.trim(), examples = $("pf-examples").value.trim();
    const p = { name: $("pf-name").value, language: $("pf-language").value, target_role: $("pf-role").value, target_level: $("pf-level").value,
      jds: jds.filter((j) => (j.text || "").trim()).map((j) => ({ ...(j.id ? { id: j.id } : {}), title: j.title || "", text: j.text })) };
    // Only what changed, so an unchanged resume keeps its date.
    if (cvText !== (profile.cv ? profile.cv.text : "")) p.cv = cvText ? { text: cvText, file_name: $("pf-cv").dataset.file || "" } : null;
    if (examples !== (profile.examples ? profile.examples.text : "")) p.examples = examples || null;
    profile = await call("/account/profile/save", { profile: p });
    jds = profile.jds.map((j) => ({ id: j.id, title: j.title, text: j.text }));
    paintJds();
    say("Profile saved. Your apps fill their empty boxes from it.");
    data.profile = { cv: profile.cv ? { file_name: profile.cv.file_name } : null, jds: profile.jds, examples: Boolean(profile.examples), gemini: profile.gemini };
    renderProfileSummary();
  });
});

$("gemini-form").addEventListener("submit", (e) => {
  e.preventDefault();
  act(e.submitter, async () => {
    const key = $("gemini-key").value.trim();
    if (!key) return;
    const out = await call("/account/profile/gemini", { key });
    $("gemini-key").value = "";
    geminiState(out.gemini);
    say("Gemini key saved, encrypted.");
    await load();
  });
});

$("gemini-remove").addEventListener("click", (e) => act(e.target, async () => {
  if (!confirm("Remove the saved Gemini key from My Sarthi? Your apps keep their own copy.")) return;
  const out = await call("/account/profile/gemini", { key: "" });
  geminiState(out.gemini);
  await load();
}));

$("profile-delete").addEventListener("click", (e) => act(e.target, async () => {
  if (!confirm("Delete your whole My Sarthi profile (resume, job descriptions, examples and Gemini key)? Your apps keep their own copies.")) return;
  await call("/account/profile/delete");
  $("profile-form").hidden = true;
  $("profile-open").hidden = false;
  await load();
  say("Your profile was deleted.");
}));

// ------------------------------------------------------------------ Prep, purchases, help, invite

function renderPrep() {
  const card = $("prep-card"), p = data.prep;
  if (unavailable("prep") || !p) return missing(card);
  const h = p.history;
  card.replaceChildren(...[
    el("p", { class: "state", text: p.pass.valid ? `Pass active until ${when(p.pass.expires_at)}` : p.pass.ended_at ? `Your pass ended on ${when(p.pass.ended_at)}` : "No Prep Sarthi pass yet." }),
    p.banked_days ? el("p", { class: "gift", text: `${p.banked_days} free days waiting. They start when you press Start in Prep Sarthi.` }) : null,
    el("p", { class: "fine", text: h.enabled ? `${h.saved} saved item${h.saved === 1 ? "" : "s"} in your account.` : "Saving interviews is off. Switch it on in Prep Sarthi to keep your reports." }),
    h.recent.length ? el("ul", { class: "list" }, h.recent.map((r) => el("li", {},
      el("b", { text: r.role || "Practice interview" }),
      el("span", { class: "meta", text: [day(r.at), r.score != null ? `${r.score}/10` : "", r.minutes != null ? `${r.minutes} min` : ""].filter(Boolean).join(" · ") })))) : null,
    el("a", { class: "btn primary", href: safe(p.app_url) || "/prep/app/", text: "Open Prep Sarthi" })].filter(Boolean));
}

function renderPurchases() {
  const list = $("purchase-list");
  if (unavailable("purchases")) return missing(list);
  list.replaceChildren();
  if (!data.purchases.length) list.append(el("li", { class: "empty", text: "Nothing bought with this Google account's email yet." }));
  for (const p of data.purchases) {
    const product = p.product === "prep" ? "Prep Sarthi" : "Live Sarthi";
    list.append(el("li", {},
      el("div", {}, el("b", { text: `${product}: ${p.label}` }),
        el("div", { class: "meta", text: [day(p.paid_at), p.amount ? `₹${p.amount}` : "", p.abroad ? "paid abroad" : "", p.order_id].filter(Boolean).join(" · ") }))));
  }
}

function renderTickets() {
  const list = $("tickets");
  if (unavailable("support")) return missing(list);
  list.replaceChildren();
  const tickets = (data.support || []).slice().sort((a, b) => Number(b.open) - Number(a.open));
  if (!tickets.length) list.append(el("li", { class: "empty", text: "No support conversations." }));
  for (const t of tickets) {
    list.append(el("li", {},
      el("div", {}, el("b", { text: `#${t.number} ${t.problem}` }),
        el("div", { class: "meta", text: `${t.replied ? "We replied" : t.open ? "Open" : "Closed"} · ${day(t.updated_at)}` })),
      safe(t.link) ? el("a", { class: "btn ghost", href: safe(t.link), text: "Open conversation" }) : null));
  }
}

function renderInvite() {
  const r = data.live.referral;
  $("invite").hidden = !r;
  $("menu").querySelector('a[data-pane="invite"]').hidden = !r;
  if (!r) return;
  $("invite-card").replaceChildren(
    el("p", { text: "When a friend buys a Live Sarthi pass with your code, you both get a free interview day." }),
    el("div", { class: "keyline" }, el("code", { text: r.code }), copyButton(String(r.link || ""), "Copy invite link")),
    el("p", { class: "fine", text: `Friends who bought with it: ${r.friends}.` }),
    ...(safe(r.page) ? [el("a", { href: safe(r.page), text: "Share it →" })] : []));
}

// ------------------------------------------------------------------ account

$("sign-out").addEventListener("click", () => {
  session.clear();
  try { window.google && window.google.accounts && window.google.accounts.id.disableAutoSelect(); } catch { /* not loaded */ }
  location.reload();
});

$("loading-retry").addEventListener("click", () => { load(); });

if (session.get()) load(); else showSignedOut();
