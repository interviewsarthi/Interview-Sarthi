/* Help and interview feedback screens. Persistence, polling and analytics belong to support.js. */
const $ = id => document.getElementById(id);
const support = () => window.prepApp?.support;
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
let trigger = null, problem = '', origin = '', reportId = null, emailEdited = false;
let localError = '', busy = false, shownTicket = null, messageKey = '';

const dialog = node('dialog', 'sh-dialog');
dialog.id = 'support-dialog';
dialog.setAttribute('aria-labelledby', 'sh-title');
// Only this fixed shell is HTML. Every message, problem label, error and link label uses textContent.
dialog.innerHTML = `
  <header class="sh-head">
    <div><span class="label">Prep Sarthi · Help</span><h2 id="sh-title">Report a problem</h2></div>
    <button type="button" class="sh-close" aria-label="Close Help">×</button>
  </header>
  <div class="sh-body">
    <p class="sh-intro" id="sh-intro">Tell us where you got stuck. Our assistant answers first; the Sarthi team can help if it stays unresolved.</p>
    <form id="sh-form">
      <fieldset class="sh-fieldset"><legend>What do you need help with?</legend><div class="sh-problems" id="sh-problems"></div></fieldset>
      <p class="sh-context" id="sh-context" hidden></p>
      <label class="f" for="sh-text">What happened?</label>
      <textarea id="sh-text" maxlength="2000" rows="4" placeholder="What were you trying to do, and what happened instead?"></textarea>
      <label class="f" for="sh-email">Email <span class="sh-optional">(optional)</span></label>
      <input id="sh-email" type="email" autocomplete="email" inputmode="email" maxlength="254" aria-describedby="sh-email-hint" placeholder="you@example.com">
      <p class="sh-caption" id="sh-email-hint">Get a reply by email too. You can always read it here in Help.</p>
      <label class="sh-transcript" id="sh-transcript-row" hidden><input id="sh-transcript" type="checkbox" checked><span>Include what was said in this interview<small>This helps us understand the problem. You can untick it.</small></span></label>
      <p class="sh-error" id="sh-form-error" role="alert" hidden></p>
      <button class="pill wide" id="sh-send" type="submit">Send problem</button>
    </form>
    <section id="sh-conversation" hidden aria-labelledby="sh-conversation-title">
      <div class="sh-ticket"><h3 id="sh-conversation-title" tabindex="-1">Your conversation</h3><span id="sh-ticket-number"></span></div>
      <div id="sh-messages" class="sh-messages" role="log" aria-label="Help conversation" aria-live="polite" aria-relevant="additions text"></div>
      <p class="sh-status" id="sh-status" role="status"></p>
      <div class="sh-actions" id="sh-resolution" hidden><button class="pill small" id="sh-solved" type="button">Solved</button><button class="pill small ghost" id="sh-not-solved" type="button">Still not working</button></div>
      <button class="pill small" id="sh-new" type="button" hidden>New problem</button>
      <form id="sh-reply-form">
        <label class="f" for="sh-reply">Write back</label>
        <textarea id="sh-reply" maxlength="2000" rows="3" placeholder="Add a detail or reply to the team."></textarea>
        <button class="pill small" id="sh-reply-send" type="submit">Send reply</button>
      </form>
      <p class="sh-error" id="sh-conversation-error" role="alert" hidden></p>
    </section>
  </div>
  <footer class="sh-footer">Your replies stay here. You can close Help and come back.</footer>`;
document.body.append(dialog);

function replyDot(unread = 0) {
  const button = $('open-help');
  if (!button) return;
  $('support-unread').hidden = !unread;
  button.setAttribute('aria-label', unread ? `Help, ${unread} unread ${unread === 1 ? 'reply' : 'replies'}` : 'Help');
}

function choices(problems) {
  const host = $('sh-problems');
  if (host.children.length) return;
  for (const p of problems || []) {
    const b = node('button', 'sh-problem', p.label);
    b.type = 'button'; b.dataset.problem = p.code; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { problem = p.code; localError = ''; render(support().state()); });
    host.append(b);
  }
}

function renderMessages(messages) {
  const key = JSON.stringify(messages);
  if (key === messageKey) return;
  messageKey = key;
  const host = $('sh-messages');
  const nearBottom = dialog.scrollHeight - dialog.scrollTop - dialog.clientHeight < 160;
  // Keep existing message nodes so polling does not re-announce the entire log.
  const old = new Map([...host.children].map(el => [el.dataset.seq, el]));
  const keep = new Set();
  for (const m of messages) {
    const seq = String(m.seq); keep.add(seq);
    if (old.has(seq)) continue;
    const item = node('article', `sh-message sh-message-${['user', 'bot', 'owner', 'system'].includes(m.from) ? m.from : 'user'}`);
    item.dataset.seq = seq;
    item.append(node('span', 'sh-sender', ({ user: 'You', bot: 'Sarthi assistant', owner: 'Sarthi team', system: 'Update' })[m.from] || 'You'));
    item.append(node('p', 'sh-message-text', m.text || ''));
    if (m.from === 'bot' && Array.isArray(m.links)) {
      const links = node('div', 'sh-links');
      for (const link of m.links) {
        let url;
        try { url = new URL(link.url); } catch { continue; }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
        const a = node('a', '', link.label || url.hostname);
        a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a);
      }
      if (links.children.length) item.append(links);
    }
    host.append(item);
  }
  for (const [seq, el] of old) if (!keep.has(seq)) el.remove();
  if (nearBottom && dialog.open) $('sh-status').scrollIntoView({ block: 'nearest' });
}

function render(s) {
  if (!s) return;
  replyDot(s.unread);
  choices(s.problems);
  const hasTicket = !!s.ticket, blocked = s.sending || busy;
  $('sh-form').hidden = hasTicket;
  $('sh-conversation').hidden = !hasTicket;
  $('sh-intro').hidden = hasTicket;
  $('sh-title').textContent = hasTicket ? 'Here to help' : 'Report a problem';
  if (!emailEdited) $('sh-email').value = s.email || '';
  $('sh-transcript-row').hidden = !s.hasTranscript;
  const rated = problem === 'prep_rated_no' || problem === 'prep_rated_partly';
  $('sh-context').hidden = !reportId;
  $('sh-context').textContent = rated ? `Linked to the interview you rated ${problem === 'prep_rated_no' ? 'Not useful' : 'Partly useful'}.` : 'Linked to this interview report.';
  for (const b of $('sh-problems').children) {
    b.setAttribute('aria-pressed', String(b.dataset.problem === (rated ? 'prep_report' : problem)));
    b.disabled = blocked;
  }
  for (const id of ['sh-text', 'sh-email', 'sh-transcript', 'sh-send']) $(id).disabled = blocked;
  $('sh-send').textContent = s.sending ? 'Sending…' : 'Send problem';
  const error = localError || s.error || '';
  for (const [id, show] of [['sh-form-error', !hasTicket], ['sh-conversation-error', hasTicket]]) {
    $(id).textContent = error; $(id).hidden = !error || !show;
  }
  if (!hasTicket) { shownTicket = null; messageKey = ''; $('sh-messages').replaceChildren(); return; }
  $('sh-ticket-number').textContent = `#${s.ticket.number}`;
  renderMessages(s.messages || []);
  const status = s.ticket.status, closed = ['closed', 'solved'].includes(status);
  $('sh-status').textContent = ({
    new: 'Writing an answer…', bot_answered: 'Did this fix the problem?',
    waiting_you: s.expected_reply || 'The Sarthi team will reply here.',
    you_replied: 'Your reply has been sent. We’ll reply here.',
    solved: 'Marked as solved. Glad we could help.', closed: 'This conversation is closed.',
  })[status] || 'Your conversation is saved here.';
  $('sh-resolution').hidden = status !== 'bot_answered';
  $('sh-new').hidden = !closed;
  $('sh-reply-form').hidden = closed;
  for (const id of ['sh-solved', 'sh-not-solved', 'sh-new', 'sh-reply', 'sh-reply-send']) $(id).disabled = blocked;
  $('sh-reply-send').disabled = blocked || !$('sh-reply').value.trim();
  $('sh-reply-send').textContent = busy ? 'Sending…' : 'Send reply';
  if (shownTicket !== s.ticket.id) {
    shownTicket = s.ticket.id;
    if (dialog.open) $('sh-conversation-title').focus({ preventScroll: true });
  }
}

function openPanel(detail = {}) {
  const api = support();
  if (!api) return;
  if (detail.problem || detail.reportId) {
    problem = detail.problem || problem;
    origin = detail.from || 'panel';
    reportId = detail.reportId || null;
  } else if (!problem) {
    origin = detail.from || 'topbar'; reportId = null;
  }
  localError = '';
  render(api.state());
  if (!dialog.open) {
    trigger = document.activeElement;
    document.documentElement.classList.add('support-open');
    dialog.showModal();
    api.watch(true);
    render(api.state());
    (api.state().ticket ? $('sh-conversation-title') : $('sh-title')).focus({ preventScroll: true });
  }
}
$('sh-title').tabIndex = -1;
dialog.querySelector('.sh-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const items = [...dialog.querySelectorAll('button, input, textarea, select, a[href], [tabindex]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
  const first = items[0], last = items.at(-1), active = document.activeElement;
  if (!items.includes(active) || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault(); (event.shiftKey ? last : first)?.focus();
  }
});
dialog.addEventListener('close', () => {
  document.documentElement.classList.remove('support-open');
  support()?.watch(false);
  if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus({ preventScroll: true });
  else $('open-help').focus({ preventScroll: true });
});
$('open-help').addEventListener('click', () => support()?.open({ from: 'topbar' }));
$('sh-email').addEventListener('input', () => { emailEdited = true; });
$('sh-reply').addEventListener('input', () => { $('sh-reply-send').disabled = busy || !$('sh-reply').value.trim(); });
$('sh-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!support() || busy || support().state().sending) return;
  if (!problem) {
    localError = 'Choose what you need help with above.';
    render(support().state()); $('sh-problems').firstElementChild?.focus(); return;
  }
  localError = '';
  await support().send({ problem, text: $('sh-text').value, email: $('sh-email').value,
    includeTranscript: $('sh-transcript').checked, from: origin, reportId });
});

async function conversationAction(action) {
  if (!support() || busy) return;
  busy = true; localError = ''; render(support().state());
  try {
    const result = await action();
    if (result?.ok && action === sendReply) $('sh-reply').value = '';
  } finally { busy = false; render(support().state()); }
}
const sendReply = () => support().write($('sh-reply').value);
$('sh-reply-form').addEventListener('submit', event => { event.preventDefault(); if ($('sh-reply').value.trim()) void conversationAction(sendReply); });
$('sh-solved').addEventListener('click', () => void conversationAction(() => support().solved()));
$('sh-not-solved').addEventListener('click', () => void conversationAction(() => support().notSolved()));
$('sh-new').addEventListener('click', () => {
  problem = ''; origin = 'new_problem'; reportId = null; localError = '';
  $('sh-form').reset(); $('sh-reply').value = ''; emailEdited = false;
  support().newProblem(); render(support().state()); $('sh-title').focus();
});
window.addEventListener('prep:support-open', event => openPanel(event.detail));
window.addEventListener('prep:support', event => render(event.detail));
window.addEventListener('prep:support-reply', event => replyDot(event.detail?.unread));
window.addEventListener('prep:ready', () => render(support()?.state()));
if (support()) render(support().state());

// app.js updates the payment notice with textContent. Preserve its static, keyboard-accessible hook.
const paymentNote = $('report-payment-note');
const paymentHook = paymentNote?.querySelector('[data-support]');
if (paymentNote && paymentHook) new MutationObserver(() => {
  if (!paymentNote.contains(paymentHook)) paymentNote.append(' ', paymentHook);
}).observe(paymentNote, { childList: true });

function decorateRating(record) {
  $('prep-rating')?.remove();
  if (!record?.report || !record.id || !support()) return;
  const section = node('section', 'sh-rating'); section.id = 'prep-rating';
  section.setAttribute('aria-labelledby', 'sh-rating-title');
  const heading = node('h2', '', 'Was this interview useful?'); heading.id = 'sh-rating-title';
  const caption = node('p', 'sh-caption', 'Your feedback helps us make the next one better.');
  const options = node('div', 'sh-rating-options'); options.setAttribute('role', 'group'); options.setAttribute('aria-labelledby', heading.id);
  const form = node('form', 'sh-rating-more');
  const label = node('label', 'f', 'Anything to add? (optional)'); label.htmlFor = 'sh-rating-words';
  const words = node('textarea'); words.id = 'sh-rating-words'; words.maxLength = 1000; words.rows = 2;
  words.placeholder = 'What helped, or what could be better?';
  const send = node('button', 'pill small', 'Send feedback'); send.type = 'submit';
  const tell = node('button', 'linkink sh-rating-help', 'Tell us what went wrong'); tell.type = 'button';
  const status = node('p', 'sh-rating-status'); status.setAttribute('role', 'status');
  section.append(heading, caption, options, status, form);
  form.append(label, words, node('div', 'sh-rating-actions'));
  form.lastChild.append(send, tell);
  $('report').append(section);
  const earlier = support().ratingFor(record.id);
  let rating = earlier?.rating || '', pending = false;
  words.value = earlier?.words || '';
  function update() {
    form.hidden = !rating;
    tell.hidden = !['partly', 'no'].includes(rating);
    for (const b of options.children) { b.setAttribute('aria-pressed', String(b.dataset.rating === rating)); b.disabled = pending; }
    send.disabled = pending || !words.value.trim(); words.disabled = pending;
    send.textContent = pending ? 'Sending…' : 'Send feedback';
  }
  async function save(withWords) {
    if (pending) return;
    pending = true; update(); status.textContent = 'Saving your feedback…';
    const result = await support().rate(rating, { reportId: record.id, ...(withWords ? { words: words.value.trim() } : {}) });
    pending = false;
    if (!section.isConnected) return;
    status.textContent = result?.ok ? (withWords ? 'Thanks. Your feedback has been sent.' : 'Thanks for letting us know. Add a detail below if you like.')
      : 'Saved in this browser. Could not send it yet. Check your connection and try again.';
    status.classList.toggle('sh-error', !result?.ok); update();
  }
  for (const [value, text] of [['yes', 'Yes'], ['partly', 'Partly'], ['no', 'Not useful']]) {
    const b = node('button', 'sh-rating-option', text); b.type = 'button'; b.dataset.rating = value;
    b.addEventListener('click', () => { rating = value; void save(false); }); options.append(b);
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (words.value.trim()) void save(true); });
  words.addEventListener('input', update);
  tell.addEventListener('click', () => support().open({ problem: rating === 'no' ? 'prep_rated_no' : 'prep_rated_partly', reportId: record.id, from: 'rating' }));
  if (earlier) status.textContent = 'Your earlier feedback is shown below. You can update it.';
  update();
}
window.addEventListener('prep:report-rendered', event => decorateRating(event.detail?.record));
window.addEventListener('prep:ready', () => { if (window.__lastReport?.report) decorateRating(window.__lastReport); });
window.addEventListener('prep:screen', event => { if (['s-live', 's-cv'].includes(event.detail?.id)) $('prep-rating')?.remove(); });
