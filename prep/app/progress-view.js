/* Presentation only: numbers, persistence and AI remain in the progress modules. */
import { HISTORY_EVENTS, listSummaries, getItems, getPrefs, setEnabled, deleteItem, deleteAll, exportAll, importable, importLocal, statusOf, flushOutbox, pending } from './history.js';
import { buildProgress, REASONS, dayKey, inPeriod } from './progress.js';
import { monthReportText, analysisId } from './insights.js?v=20261012-models38';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const fmt = value => num(value) === null ? '—' : String(Math.round(value * 10) / 10);
const date = (value, full = false) => new Date(value).toLocaleDateString(undefined, {day:'numeric',month:'short', ...(full ? {year:'numeric'} : {})});
const delta = n => num(n) === null ? '—' : `${n > 0 ? '+' : ''}${fmt(n)}`;
const badge = (n, text) => `<span class="pg-badge ${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${delta(n)} ${esc(text)}</span>`;
const button = (action, text, attrs = '', cls = 'pill small ghost') => `<button type="button" class="${cls}" data-pg="${action}" ${attrs}>${text}</button>`;
const state = () => window.prepApp?.state() || {};
const checkLabel = { fixed:'Demonstrated in this attempt', improved:'Improved in this attempt', still_open:'Still needs practice', not_tested:'Not tested this time' };
const readinessLabel = {not_enough:'Building your baseline',not_yet:'Keep building the foundations',getting_there:'Getting there',ready:'Strong recent practice'};
let data = {items:[],periods:[],prefs:null}, selectedPeriod = '', selectedTrack = '', selectedDay = '', tab = 'overview';
let progress = null, request = 0, reportRecord = null, toastTimer, refreshTimer;
let activeDialogTrigger = null;

function toast(text) {
  $('pg-toast').textContent = text; $('pg-toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('pg-toast').hidden = true; }, 7000);
}
function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showDialog(title, html) {
  activeDialogTrigger = document.activeElement;
  $('pg-dialog').innerHTML = `${button('close','×','aria-label="Close dialog"','pg-close')}<span class="label">Your account</span><h2 id="pg-dialog-title">${esc(title)}</h2>${html}<p id="pg-dialog-error" role="alert" class="pg-caption"></p>`;
  $('pg-dialog').showModal();
}
$('pg-dialog').addEventListener('close', () => activeDialogTrigger?.isConnected && activeDialogTrigger.focus());
function currentPeriod() { return data.periods.find(p => p.start === selectedPeriod) || data.periods.find(p => p.current) || [...data.periods].sort((a,b) => b.start.localeCompare(a.start))[0] || null; }
function periodItems() { const p = currentPeriod(); return data.items.filter(i => i.kind !== 'analysis' && inPeriod(i, p)); }
function analyses() {
  const p = currentPeriod();
  return data.items.filter(i => i.kind === 'analysis' && (!p || i.id === analysisId(p,'latest') || i.id === analysisId(p,'period') || i.id.startsWith(analysisId(p,'week',''))));
}
function latestAnalysis() { return analyses().find(a => a.scope === 'latest') || analyses().find(a => a.scope === 'period'); }

async function refresh() {
  const n = ++request;
  if (!state().signedIn) { data = {items:[],periods:[],prefs:null}; render(); return; }
  const result = await listSummaries();
  if (n !== request || !state().signedIn) return;
  data = result;
  if (!data.periods.some(p => p.start === selectedPeriod)) selectedPeriod = currentPeriod()?.start || '';
  render();
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if ($('s-progress').classList.contains('on')) refresh().catch(e => toast(e.message)); }, 200);
}
async function openProgress() {
  if (!window.prepApp) { toast('The app is still loading. Please try again in a moment.'); return; }
  window.prepApp.navigate('s-progress');
  $('s-progress').innerHTML = '<div class="pg-empty" role="status"><h1 id="pg-title">Your progress</h1><p>Opening your saved interviews…</p></div>';
  await refresh();
  $('pg-title')?.focus({preventScroll:true});
}
function preview() {
  return `<div class="pg-preview"><span class="label">Included with your 30-day pass</span><h2>A little practice.<br>A clearer picture.</h2><p>See how your answers develop, revisit every saved interview, and know what to work on next. Account saving is your choice.</p><div class="pg-preview-steps"><span>01 / Practise</span><span>02 / Find your focus</span><span>03 / See your progress</span></div><div class="pg-toolbar">${button('passes', state().signedIn ? 'View passes →' : 'Sign in / view passes →','','pill small')}${button('practice','Back to practice')}</div><p class="pg-caption">Your real progress appears after you practise. No sample scores are mixed into your history.</p></div>`;
}
function render() {
  const s = state(), host = $('s-progress');
  if (!s.signedIn) {
    host.innerHTML = `<header class="pg-head"><div><span class="pg-eyebrow">Your preparation, over time</span><h1 id="pg-title" tabindex="-1">My <em>progress.</em></h1><p>Sign in to see the interviews saved to your account.</p></div></header>${preview()}`; return;
  }
  const period = currentPeriod();
  const raw = buildProgress(data.items, {period});
  // Start with a single role/level so unlike interviews are not joined into one trend.
  if (!raw.tracks.some(t => t.key === selectedTrack)) selectedTrack = raw.tracks[0]?.key || 'all';
  progress = buildProgress(data.items, {period, track:selectedTrack});
  const p = progress, enabled = !!data.prefs?.enabled;
  const expired = !!p.period?.ended || !s.pass;
  host.innerHTML = `<header class="pg-head"><div><span class="pg-eyebrow"><i class="pg-dot" aria-hidden="true"></i>Your preparation, over time</span><h1 id="pg-title" tabindex="-1">Small steps. <em>Real progress.</em></h1><p>${expired ? 'Your saved interviews are here whenever you want to look back.' : 'See what is getting stronger. Give the next interview a purpose.'}</p></div><div class="pg-toolbar">${button('settings','Manage history')}${button(expired?'passes':'practice',expired?'Continue practising →':'New interview →','','pill small')}</div></header>
  <div class="pg-subnav"><nav class="pg-tabs" aria-label="Progress views">${['overview','history','reviews'].map(t => `<button class="pg-tab" data-pg="tab" data-tab="${t}" aria-current="${tab === t ? 'page':'false'}">${{overview:'Overview',history:'Interviews',reviews:'Reviews'}[t]}</button>`).join('')}</nav><div class="pg-period">${data.periods.length > 1 ? `<label for="pg-period">Pass period</label><select id="pg-period">${[...data.periods].sort((a,b)=>b.start.localeCompare(a.start)).map(x => `<option value="${esc(x.start)}" ${x.start===period?.start?'selected':''}>${date(x.start)} – ${date(x.end,true)}</option>`).join('')}</select>` : period ? `${date(period.start)} – ${date(period.end,true)} · ${p.period.ended?'Completed':`${p.period.days_left} days left`}` : 'Your practice history'}</div></div>
  ${data.source === 'cache' ? `<div class="pg-note" role="status">You’re viewing a cached copy. Recent interviews may be missing.${button('refresh','Try again','','pg-link')}</div>` : ''}
  ${!enabled ? `<div class="pg-note">${s.pass ? 'Keep your next interview in your account to build a history across devices.' : 'Saved interviews remain readable for 12 months, even after your pass ends.'} ${button('settings',s.pass?'Choose what gets saved':'History settings','','pg-link')}</div>` : ''}
  ${pending().length ? `<div class="pg-note" role="status">${pending().length} item(s) waiting to save.${button('retry','Retry saving','','pg-link')}</div>`:''}
  ${data.more ? '<div class="pg-note">Showing the most recent available items. Export your history to include older records; totals here cover the loaded items.</div>':''}
  <div id="pg-panel">${tab === 'overview' ? overview(p) : tab === 'history' ? historyView() : reviewsView()}</div>`;
}
function chart(points, max = 100) {
  const pts = points.filter(p => num(p.score) !== null);
  if (!pts.length) return '';
  const first = Date.parse(pts[0].at), last = Date.parse(pts.at(-1).at);
  const x = p => 36 + (last===first ? .5 : (Date.parse(p.at)-first)/(last-first))*524;
  const y = p => 168 - Math.max(0,Math.min(max,p.score))/max*144;
  let segments = [], segment = [];
  for (const p of points) {
    if (num(p.score) !== null && p.comparable !== false) segment.push(`${x(p)},${y(p)}`);
    else { if(segment.length>1) segments.push(segment.join(' ')); segment=[]; }
  }
  if(segment.length>1) segments.push(segment.join(' '));
  return `<svg class="pg-chart" viewBox="0 0 580 196" role="img" aria-label="Practice scores over time. Each point opens its interview.">${[0,50,100].map(n=>`<line class="grid" x1="36" x2="560" y1="${168-n/100*144}" y2="${168-n/100*144}"/><text x="0" y="${172-n/100*144}">${n}</text>`).join('')}${segments.map(s=>`<polyline class="line" points="${s}"/>`).join('')}${pts.map(p=>`<a href="#saved-interview" data-pg="interview" data-id="${esc(p.id)}" aria-label="${esc(date(p.at))}: ${fmt(p.score)} out of 100${p.comparable===false?'. '+esc(REASONS[p.reason]||'Excluded from trend'):''}"><circle class="${p.comparable===false?'excluded':''}" cx="${x(p)}" cy="${y(p)}" r="4"><title>${esc(date(p.at))} · ${fmt(p.score)}${p.comparable===false?' · '+esc(REASONS[p.reason]):''}</title></circle></a>`).join('')}</svg><div class="pg-chart-caption"><span>${date(pts[0].at)}</span><span>${date(pts.at(-1).at)}</span></div>`;
}
function spark(points, field='score') {
  const vs = points.map(p=>num(p[field])).filter(v=>v!==null);
  if(vs.length<2) return '';
  const lo=Math.min(...vs)-.5, hi=Math.max(...vs)+.5;
  return `<svg class="pg-spark" viewBox="0 0 90 26" aria-hidden="true"><polyline points="${vs.map((v,i)=>`${2+i/(vs.length-1)*86},${23-(v-lo)/(hi-lo)*20}`).join(' ')}"/></svg>`;
}
function overview(p) {
  const f=p.focus.current;
  return `<div class="pg-stats">${[[p.totals.interviews,'Interviews completed'],[p.totals.practice_days,'Days you practised'],[p.totals.minutes,'Minutes of practice'],[p.totals.streak,'Day streak']].map(([n,t])=>`<div class="pg-stat"><b>${fmt(n)}</b><span>${t}</span></div>`).join('')}</div>
  <div class="pg-grid"><div class="pg-stack"><section class="pg-card"><div class="pg-section-title"><div><span class="label">The bigger picture</span><h2>Your practice score</h2></div>${p.tracks.length>1?`<label class="pg-filter">Role &amp; level<select id="pg-track" aria-label="Role and level">${p.tracks.map(t=>`<option value="${esc(t.key)}" ${t.key===selectedTrack?'selected':''}>${esc(t.role||'General practice')} · ${esc(t.level||'General')}</option>`).join('')}</select></label>`:''}</div>
  <div class="pg-score-head"><div class="pg-score-number">${fmt(p.score.latest)} <small>/ 100 · latest</small></div>${p.score.enough?badge(p.score.change_since_first,'since your first'):''}</div>
  ${p.score.enough?chart(p.score.points):`<div class="pg-empty"><p>${esc(p.score.message)}</p>${button('practice','Start an interview →','','pill small ghost')}</div>`}
  <div class="pg-chart-stats"><span>First <b>${fmt(p.score.first)}</b></span><span>Best <b>${fmt(p.score.best)}</b></span><span>Average <b>${fmt(p.score.average)}</b></span></div>
  <p class="pg-caption">Scores reflect the areas tested. Question difficulty and assessment coverage can still vary within a role.</p>
  ${p.warnings.map(w=>`<p class="pg-caption">${esc(w.text)}</p>`).join('')}
  ${p.score.points.some(x=>!x.comparable)?`<details class="pg-caption"><summary>Interviews excluded from the trend</summary>${p.score.points.filter(x=>!x.comparable).map(x=>`<p>${date(x.at)} · ${esc(REASONS[x.reason]||'Not comparable')}</p>`).join('')}</details>`:''}</section>
  <section class="pg-card"><span class="label">A closer look</span><h2>Skills taking shape</h2><p class="pg-caption">Recent scores out of 10, for the selected role. Untested skills stay unscored.</p><div class="pg-skills">${p.groups.map(g=>`<div class="pg-skill"><div class="pg-skill-head"><strong>${esc(g.label)}</strong><span>${g.n?`${fmt(g.recent)} <small>/ 10</small>`:'<small>Not tested</small>'}</span></div><div class="pg-meter"><i style="width:${Math.max(0,Math.min(100,(g.recent||0)*10))}%"></i></div><div class="pg-caption"><span>${!g.n?'A future practice opportunity':g.n===1?'One assessment · building a baseline':`${delta(g.change)} trend · ${g.n} interviews`}</span>${spark(g.points)}</div></div>`).join('')}</div>${p.coverage.planned_not_scored.length?'<p class="pg-caption">Some planned skills have no scored evidence yet. They need another opportunity to be assessed.</p>':''}</section></div>
  <aside class="pg-stack"><section class="pg-card pg-focus"><span class="label">One thing for next time</span><h2>${esc(f?.issue||'Give yourself a starting point.')}</h2><p>${esc(f?.drill||'Your first interview helps identify one useful habit to work on. Each new attempt is a chance to practise it.')}</p>${button('practice','Put it into practice →','','pill small')}${f?`<p>${button('interview','See the answer behind this focus',`data-id="${esc(f.from_id)}"`,'pg-link')}</p>`:''}${p.focus.checks.length?`<p>${esc(checkLabel[p.focus.checks.at(-1).status]||'Latest focus check')}: ${esc(p.focus.checks.at(-1).note)}</p>`:''}</section>
  <section class="pg-card"><span class="label">Showing up adds up</span><h2>Your practice days</h2>${calendarView(p)}<p class="pg-caption"><i class="pg-dot" aria-hidden="true"></i> Practised · Select a day to see its interviews.</p></section>
  <section class="pg-card"><span class="label">Practice readiness</span><h2>${esc(readinessLabel[p.readiness.level])}</h2><ul class="pg-reasons">${p.readiness.reasons.map(r=>`<li>${esc(r.text)}</li>`).join('')}</ul><p class="pg-caption">Based on mock interview evidence, not a prediction of a hiring decision.</p></section></aside></div>
  <section class="pg-card" style="margin-top:20px"><span class="label">How you sounded · estimates</span><h2>Make room for your best answers</h2><p class="pg-caption">Timing and filler counts are approximate. Guide ranges are context-dependent, not a measure of ability.</p><div class="pg-delivery">${p.delivery.map(d=>`<div><h3>${esc(d.label)}</h3><b>${d.id==='talk_share'&&d.latest!==null?Math.round(d.latest*100)+'%':fmt(d.latest)}</b><span class="pg-caption">${d.id==='talk_share'?'of the conversation':esc(d.unit)}</span>${spark(d.points,'value')}<p class="pg-caption">${d.latest===null?'Not measured yet':d.latest_in_target?'Within the usual range':'Outside the usual range'}<br>${guide(d)}</p></div>`).join('')}</div></section>
  <section class="pg-card" style="margin-top:20px">${historyView(3)}</section>`;
}
function guide(d) {
  const f=n=>d.id==='talk_share'?Math.round(n*100)+'%':fmt(n);
  return `Guide: ${d.target.min!==undefined&&d.target.max!==undefined?`${f(d.target.min)}–${f(d.target.max)}`:d.target.max!==undefined?`up to ${f(d.target.max)}`:`${f(d.target.min)} or more`}`;
}
function calendarView(p) {
  const start=p.calendar[0]?.date;
  const pad=start?new Date(start+'T12:00:00').getDay():0;
  return `<div class="pg-calendar">${['S','M','T','W','T','F','S'].map(d=>`<span class="pg-weekday" aria-hidden="true">${d}</span>`).join('')}${'<span></span>'.repeat(pad)}${p.calendar.map(d=>`<button class="pg-day ${d.interviews.length?'practised':''}" data-pg="day" data-day="${d.date}" aria-pressed="${selectedDay===d.date}" aria-label="${esc(date(d.date+'T12:00:00',true))}: ${d.interviews.length} interviews, ${d.minutes} minutes" ${d.future?'disabled':''}>${Number(d.date.slice(-2))}</button>`).join('')}</div>`;
}
function canOpen(i) {
  if (!i.local_only) return true;
  return importable().some(r=>r.id===i.id);
}
function historyView(limit) {
  const list=periodItems().filter(i=>!selectedDay||dayKey(i.at)===selectedDay);
  const shown=limit?list.slice(0,limit):list;
  return `<div class="pg-section-title"><div><span class="label">Your practice notebook</span><h2>${selectedDay?date(selectedDay+'T12:00:00',true):limit?'Recent interviews':'Saved interviews'}</h2></div>${limit?button('tab','View all →','data-tab="history"','pg-link'):button('export','Export history','','pill small ghost')}${selectedDay?button('clear-day','Show all days','','pg-link'):''}</div>${shown.length?shown.map(i=>`<article class="pg-history-row"><div class="pg-history-score">${fmt(i.kind==='redrill'?i.score_after:i.score)}</div><div><h3>${esc(i.kind==='redrill'?i.question:i.role||'Mock interview')}</h3><p>${esc(date(i.at,true))} · ${i.kind==='redrill'?'Question retake · score / 10':`${fmt(i.minutes)} min · score / 100 · ${esc(i.level||i.language||'Practice')}`}${i.demo?' · Demo':''} · ${i.local_only?'This browser only':'Saved to account'}</p>${!canOpen(i)?'<p>Only the score remains; the full report was not saved.</p>':''}</div><div class="pg-history-actions">${button(i.kind==='redrill'?'comparison':'interview','Open',`data-id="${esc(i.id)}" ${!canOpen(i)?'disabled':''}`,'pg-link')}${button('delete','Delete',`data-id="${esc(i.id)}" aria-label="Delete interview from ${esc(date(i.at))}"`,'pg-link')}</div></article>`).join(''):`<div class="pg-empty"><h2>${selectedDay?'A quiet day.':'Your story starts here.'}</h2><p>${selectedDay?'No interviews on this day. Every new practice is another opportunity.':'Finish an interview and choose account saving to keep the full report here.'}</p>${button('practice','Start an interview →','','pill small')}</div>`}`;
}
function evidenceLink(e, label) { return button('evidence',esc(label||`Read answer ${e.turn}`),`data-id="${esc(e.interview_id)}" data-turn="${Number(e.turn)||0}"`,'pg-link'); }
function analysisView(a) {
  if(!a.enough) return `<p class="pg-caption">${esc(a.message||'More practice is needed to identify reliable patterns.')}</p>`;
  return `<p>${esc(a.summary)}</p>${(a.patterns||[]).map(p=>`<article class="pg-review"><span class="pg-badge">${esc(({recurring_weakness:'Keep practising',improved:'Making progress',inconsistent:'Build consistency',strength:'A strength to keep'})[p.type]||'Practice insight')} · ${esc(p.group_label)}</span><h3>${esc(p.title)}</h3><p>${esc(p.detail)}</p><div class="pg-evidence">${(p.evidence||[]).map(e=>evidenceLink(e,`${date(data.items.find(i=>i.id===e.interview_id)?.at||a.at)} · answer ${e.turn}`)).join('')}</div>${p.drill?`<p class="pg-caption"><strong>Try next:</strong> ${esc(p.drill)}</p>`:''}</article>`).join('')}${a.strong_answers?.length?`<div class="pg-review"><h3>Answers worth revisiting</h3>${a.strong_answers.map(e=>`<p>${esc(e.why)} ${evidenceLink(e)}</p>`).join('')}</div>`:''}${a.next_priorities?.length?`<div class="pg-review"><h3>Your next priorities</h3><ol class="pg-reasons">${a.next_priorities.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>${button('practice','Practise again →','','pill small')}</div>`:''}`;
}
function reviewsView() {
  const latest=latestAnalysis(), reviews=analyses().filter(a=>a.scope!=='latest');
  const s=state();
  return `<section class="pg-card"><div class="pg-section-title"><div><span class="label">Across your interviews</span><h2>What your practice is telling you</h2></div>${button('analyse','Refresh analysis',`${!s.pass||!s.hasKey||!data.prefs?.enabled?'disabled':''}`)}</div><p class="pg-caption">Each finding links to your own answers. Reviews update as you practise; refreshing uses your connected Gemini key.</p>${!s.hasKey?'<p class="pg-caption">Connect your Gemini key through interview setup to generate new reviews on this device.</p>':''}${latest?analysisView(latest):`<div class="pg-empty"><h2>Patterns take a little practice.</h2><p>${data.prefs?.enabled?'After you save at least two interviews, your analysis can connect what is improving and what needs attention.':'Enable account saving, then practise to build your first review.'}</p>${button('settings','Manage saving')}</div>`}</section><section class="pg-card" style="margin-top:20px"><div class="pg-section-title"><h2>Weekly &amp; monthly reviews</h2>${button('month-export','Download month report',`${!progress?.totals.interviews?'disabled':''}`)}</div>${reviews.length?reviews.map(a=>`<details class="pg-review"><summary>${a.scope==='period'?'Month in review':`Week ${Number(a.week)||''} review`} · ${date(a.at)}</summary>${analysisView(a)}</details>`).join(''):'<p class="pg-caption">Weekly reviews appear after a week of practice. Your month review becomes available near the end of your pass.</p>'}</section>`;
}

async function settings() {
  const prefs=await getPrefs();
  if(!state().signedIn) { await window.prepApp.openPasses(); return; }
  if(!prefs) { toast('Could not load your history setting. Please try again.'); return; }
  data.prefs=prefs;
  showDialog('Your interviews, your choice.', `<div class="pg-consent"><p>When account saving is on, we keep your reports, interview transcripts, delivery numbers, progress analyses, re-answers, and the short CV or job-description quotes cited in your report.</p><p>We never keep your CV or job-description documents, or your voice. Saved items are kept for <strong>12 months</strong>, remain readable after your pass ends, and can be deleted at any time.</p><p>Progress analyses use your saved interviews with Google’s Gemini on your own key. <a href="/privacy.html" target="_blank" rel="noopener">Read the privacy policy</a>.</p><label class="pg-switch" for="pg-saving"><span><strong>Save interviews to my account</strong><br><span class="pg-caption">Turning this off stops new saves; it does not delete history.</span></span><input class="pg-toggle" type="checkbox" role="switch" id="pg-saving" ${prefs.enabled?'checked':''} ${!prefs.enabled&&!state().pass?'disabled':''}></label>${!state().pass?'<p class="pg-caption">An active pass is needed to turn on new account saves.</p>':''}
  ${importable().length?`<div class="pg-note"><strong>One report is still in this browser.</strong><p>Import its full report and transcript into this account? Older score-only records cannot be restored.</p>${button('import','Import this report',`${!prefs.enabled||!state().pass?'disabled':''}`)}</div>`:''}<div class="pg-toolbar">${button('export','Export history')}${button('delete-all','Delete all history','','pg-link')}${button('close','Done','','pill small')}</div></div>`);
}
function saveText(id, localOnly=false) {
  if (data.items.some(i => i.id === id && !i.local_only)) localOnly=false;
  const s=statusOf(id), label={saving:'Saving to your account…',saved:'Saved to your account',retry:'Save pending · retry available',off:'Account saving is off',signed_out:'Sign in to save to your account',no_pass:'Not saved · an active pass is needed',failed:'Could not save this report'};
  return `<span role="status">${esc(s?label[s.state]:localOnly?'This browser only':'Saved to your account')}${s?.message?` · ${esc(s.message)}`:''}</span>${['retry','signed_out'].includes(s?.state)?` ${button(s.state==='signed_out'?'passes':'retry',s.state==='signed_out'?'Sign in':'Retry','','pg-link')}`:''}${s?.state==='failed'?'<span> · Download the report to keep a copy.</span>':''}`;
}
function decorateReport(record, locked=false) {
  reportRecord=record;
  $('pg-report-tools')?.remove();
  const host=document.createElement('div'); host.id='pg-report-tools'; host.className='pg pg-report-tools';
  $('report').after(host);
  if(locked) { host.innerHTML=preview(); return; }
  // The score's change since last time and the next focus are in the dashboard itself (report-view.js, 1 Oct 2026).
  host.innerHTML=`<div class="pg-toolbar"><span id="pg-save-state" class="pg-caption">${saveText(record.id,!record.saved_at)}</span>${button('open','My progress →','','pg-link')}${button('settings','Saving settings','','pg-link')}</div>
    <details class="pg-card pg-transcript" id="pg-report-transcript"><summary>Read the interview transcript · ${(record.transcript||[]).length} turns</summary>${record.transcript_trimmed?'<p class="pg-caption">This long transcript was shortened for storage. Some cited answers may no longer be available.</p>':''}${(record.transcript||[]).map((t,i)=>`<div class="pg-turn" id="pg-turn-${i+1}" tabindex="-1"><small>${t.who==='candidate'?'You':'Interviewer'} · ${i+1}</small>${esc(t.text)}</div>`).join('')}</details>`;
  // Buttons live next to the actual questions, not an unrelated list of titles. Only question cards carry
  // data-qi: the assessment rows above them share the .q class, so counting .q would shift every index.
  $('report').querySelectorAll('.q[data-qi]').forEach(q=>{
    const i=Number(q.dataset.qi);
    q.insertAdjacentHTML('beforeend',`<div class="pg-toolbar" style="margin-top:16px">${button('redrill','Answer this again · 3 min',`data-id="${esc(record.id)}" data-question="${i}" ${!state().pass?'disabled':''}`)}</div>`);
  });
}
async function openEvidence(id, turn) {
  await window.prepApp.openInterview(id);
  const el=$(`pg-turn-${turn}`);
  if(!el) { toast('That answer is no longer available in the saved transcript.'); return; }
  $('pg-report-transcript').open=true;
  el.scrollIntoView({block:'center',behavior:'instant'}); el.focus({preventScroll:true});
}
function comparison(item) {
  const s=item.summary, b=item.body;
  if(!b?.source?.before||!b.after) throw new Error('The saved answer comparison is not available.');
  window.prepApp.navigate('s-comparison');
  $('s-comparison').innerHTML=`<header class="pg-head"><div><span class="pg-eyebrow">One question. Another opportunity.</span><h1 tabindex="-1" id="pg-compare-title">Look how your <em>answer changed.</em></h1><p>${esc(s.question)}</p></div>${button('open','← My progress')}</header><div class="pg-note" id="pg-redrill-status">${saveText(item.id,!item.saved_at)}</div><div class="pg-compare"><section class="pg-card"><span class="label">Your earlier answer</span><h2>${fmt(s.score_before)} <small>/ 10</small></h2><p class="pg-answer">${esc(b.source.before.text||b.source.before.gist||'Original wording not available.')}</p>${!b.source.before.text?'<p class="pg-caption">Report summary; the original wording was not saved.</p>':''}</section><section class="pg-card pg-after"><span class="label">Your new answer</span><h2>${fmt(s.score_after)} <small>/ 10</small></h2><p class="pg-answer">${esc(b.after.text)}</p></section></div><section class="pg-card"><h2>${esc(s.verdict)}</h2><p class="pg-caption">The earlier score is unchanged. This retake is shown separately from full interview trends.</p><div class="pg-compare"><div><h3>What improved</h3><ul class="pg-reasons">${(s.improved||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li>No clear improvement identified yet.</li>'}</ul></div><div><h3>Keep working on</h3><ul class="pg-reasons">${(s.still_missing||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li>No additional gaps identified in this attempt.</li>'}</ul></div></div>${b.source.before.better?`<details><summary>AI-written example from your earlier report</summary><p class="pg-answer">${esc(b.source.before.better)}</p><p class="pg-caption">This is a suggested answer, not something you said.</p></details>`:''}<div class="pg-toolbar" style="margin-top:24px">${button('redrill','Try this question again',`data-id="${esc(s.interview_id)}" data-question="${Number(s.question_index)||0}" ${!state().pass?'disabled':''}`,'pill small')}${button('interview','Open original interview',`data-id="${esc(s.interview_id)}"`)}</div></section>`;
  $('pg-compare-title').focus({preventScroll:true});
}

document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-pg]'); if(!el||el.disabled) return;
  event.preventDefault(); const action=el.dataset.pg, id=el.dataset.id;
  el.disabled=true;
  try {
    switch(action) {
      case 'open': await openProgress(); break;
      case 'practice': window.prepApp.navigate('s-cv'); break;
      case 'passes': await window.prepApp.openPasses(); break;
      case 'refresh': await refresh(); break;
      case 'tab': tab=el.dataset.tab; selectedDay=''; render(); $('s-progress').querySelector(`[data-tab="${tab}"]`)?.focus(); break;
      case 'day': selectedDay=el.dataset.day; tab='history'; render(); $('pg-title')?.focus({preventScroll:true}); break;
      case 'clear-day': selectedDay=''; render(); break;
      case 'settings': await settings(); break;
      case 'close': $('pg-dialog').close(); break;
      case 'retry': await flushOutbox(); toast(pending().length?'Some items are still waiting. Please check your connection and sign-in.':'Saved items are up to date.'); scheduleRefresh(); break;
      case 'interview': await window.prepApp.openInterview(id); break;
      case 'evidence': await openEvidence(id,Number(el.dataset.turn)); break;
      case 'redrill': await window.prepApp.startRedrill(id,Number(el.dataset.question)); break;
      case 'comparison': { const [item]=await getItems([id]); if(!item) throw new Error('This answer comparison could not be loaded.'); comparison(item); break; }
      case 'analyse': {
        const result=await window.prepApp.refreshAnalyses({force:true});
        toast(result.length?'Your analysis is up to date.':'No new analysis was saved. Check that saving is on, your pass is active, and there are saved interviews.'); await refresh(); break;
      }
      case 'month-export': {
        const a=analyses().find(a=>a.scope==='period')||latestAnalysis();
        download('prep-sarthi-month-review.txt',monthReportText(buildProgress(data.items,{period:currentPeriod()}),a,{name:state().name})); break;
      }
      case 'export': showDialog('Keep a copy.',`<p>Export your saved reports, transcripts, analyses and available browser history.</p><div class="pg-toolbar">${button('export-text','Readable text')}${button('export-json','Complete data (JSON)','','pill small')}</div>`); break;
      case 'export-text': case 'export-json': {
        const out=await exportAll(); download(action==='export-json'?'prep-sarthi-history.json':'prep-sarthi-history.txt',action==='export-json'?JSON.stringify(out.json,null,2):out.text,action==='export-json'?'application/json':'text/plain'); toast('Your export is ready.'); break;
      }
      case 'import': {
        const results=await importLocal(); toast(results.every(r=>r.state==='saved')?'The report is saved to your account.':'The report could not be saved yet. Check its saving status before leaving.'); $('pg-dialog').close(); await refresh(); break;
      }
      case 'delete': case 'delete-all': showDialog(action==='delete-all'?'Delete all history?':'Delete this interview?',`<p>${action==='delete-all'?'Your saved interviews, analyses, re-answers and browser copies will be removed. Your saving preference will stay the same.':'This removes the saved item and its browser copy. Related analysis may need to be rebuilt.'} This cannot be undone.</p><div class="pg-toolbar">${button('close','Keep history')}${button(action==='delete-all'?'confirm-delete-all':'confirm-delete','Delete permanently',`data-id="${esc(id||'')}"`,'pill small danger')}</div>`); break;
      case 'confirm-delete': case 'confirm-delete-all': {
        if(action==='confirm-delete-all') await deleteAll(); else await deleteItem(id);
        $('pg-dialog').close();
        if(action==='confirm-delete-all'||reportRecord?.id===id) { reportRecord=null; $('pg-report-tools')?.remove(); $('report').innerHTML=''; window.__lastReport=null; }
        if(action==='confirm-delete-all') { $('s-comparison').innerHTML=''; window.__lastRedrill=null; }
        toast('History deleted.'); await refresh(); break;
      }
    }
  } catch(e) { if($('pg-dialog').open) $('pg-dialog-error').textContent=e.message; else toast(e.message||'Something went wrong. Please try again.'); }
  finally { if(el.isConnected) el.disabled=false; }
});
document.addEventListener('change',async event=>{
  const el=event.target;
  if(el.id==='pg-period') { selectedPeriod=el.value; selectedTrack=''; selectedDay=''; render(); }
  if(el.id==='pg-track') { selectedTrack=el.value; render(); $('pg-track')?.focus(); }
  if(el.id==='pg-saving') {
    const on=el.checked; el.disabled=true;
    try {
      data.prefs=await setEnabled(on);
      const imp=$('pg-dialog').querySelector('[data-pg="import"]'); if(imp) imp.disabled=!on||!state().pass;
      toast(on?'Future interviews will be saved to your account.':'Account saving is off. Your existing history is kept.'); scheduleRefresh();
    } catch(e) { el.checked=!on; $('pg-dialog-error').textContent=e.message; }
    finally { el.disabled=!data.prefs?.enabled&&!state().pass; }
  }
});
window.addEventListener('prep:screen',e=>{
  document.body.classList.toggle('progress-open',['s-progress','s-comparison'].includes(e.detail.id));
  if(e.detail.id==='s-live'||e.detail.id==='s-cv') { $('pg-report-tools')?.remove(); reportRecord=null; }
});
window.addEventListener('prep:account',()=>{
  request++; data={items:[],periods:[],prefs:null}; selectedPeriod=''; selectedTrack=''; selectedDay='';
  if($('pg-dialog').open) $('pg-dialog').close();
  if($('s-progress').classList.contains('on')) refresh().catch(e=>toast(e.message));
});
window.addEventListener('prep:report-rendered',e=>decorateReport(e.detail.record,e.detail.locked));
window.addEventListener('prep:redrill',e=>{ comparison(e.detail.item); e.preventDefault(); });
HISTORY_EVENTS.addEventListener('changed',scheduleRefresh);
HISTORY_EVENTS.addEventListener('analysis',scheduleRefresh);
HISTORY_EVENTS.addEventListener('status',e=>{
  if(reportRecord?.id===e.detail.id&&$('pg-save-state')) $('pg-save-state').innerHTML=saveText(e.detail.id,true);
  if(window.__lastRedrill?.id===e.detail.id&&$('pg-redrill-status')) $('pg-redrill-status').innerHTML=saveText(e.detail.id,true);
});
window.addEventListener('prep:ready',()=>{
  if(location.hash==='#progress') openProgress().catch(e=>toast(e.message));
});
