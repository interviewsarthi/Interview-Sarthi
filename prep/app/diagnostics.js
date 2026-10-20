import { cleanData, errorClass, NAMES } from './diagnostics-data.js';
export { errorClass } from './diagnostics-data.js';

const LOCAL = typeof location !== 'undefined' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const API = LOCAL ? 'https://interview-sarthi-license-test.interview-sarthi-license.workers.dev' : 'https://license.interviewsarthi.com';
const KEY = 'ps_diagnostic_outbox_v1', DAY = 86400000;
function browserStorage() { try { return globalThis.localStorage; } catch { return undefined; } }
export function createDiagnostics({ api = API, storage = browserStorage(), fetcher = (...a) => fetch(...a), now = Date.now, uuid = () => crypto.randomUUID(), schedule = setTimeout } = {}) {
  let attempts = [], current = null, pending = null, scheduled = false, retry = 1000;
  try { attempts = JSON.parse(storage?.getItem(KEY) || '[]').filter(a => a && now() - a.started < DAY && Array.isArray(a.events)).slice(-3); } catch { /* storage unavailable */ }
  const persist = () => { try { storage?.setItem(KEY, JSON.stringify(attempts.filter(a => a.events.length && now() - a.started < DAY))); } catch { /* memory still works */ } };
  const later = () => {
    if (scheduled || !attempts.some(a => a.events.length)) return;
    scheduled = true;
    const timer = schedule(() => { scheduled = false; void flush(); }, retry);
    timer?.unref?.();
  };
  function event(name, data = {}) {
    if (!current || !NAMES.has(name)) return;
    if (current.seq >= 950) return;
    if (current.seq === 949) { name = 'log_limit'; data = { count: 950 }; }
    current.events.push({ id: `c-${String(++current.seq).padStart(4, '0')}`, name, at: now(), elapsed_ms: Math.max(0, now() - current.started), data: cleanData(data) });
    // A sustained outage cannot fill localStorage. Preserve early failures and recent outcomes.
    if (current.events.length > 250) { current.events.splice(100, 1); current.dropped = (current.dropped || 0) + 1; }
    persist(); later();
  }
  function begin(metadata = {}) {
    current = { id: uuid(), token: uuid().replaceAll('-', '') + uuid().replaceAll('-', ''), started: now(), seq: 0, registered: false, metadata: cleanData(metadata), events: [] };
    attempts = [...attempts.filter(a => a.events.length && now() - a.started < DAY), current].slice(-3);
    event('attempt_start', metadata); void flush();
    return current.id;
  }
  const context = request_id => current ? { id: current.id, token: current.token, ...(request_id ? { request_id } : {}) } : undefined;
  async function send(path, body, keepalive) {
    const r = await fetcher(api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive, signal: AbortSignal.timeout(8000) });
    return r;
  }
  function flush({ keepalive = false } = {}) {
    if (pending) return pending;
    pending = (async () => {
      for (const a of [...attempts]) {
        if (now() - a.started >= DAY) { attempts = attempts.filter(x => x !== a); persist(); continue; }
        if (!a.events.length) continue;
        const auth = { id: a.id, token: a.token };
        if (!a.registered) {
          const r = await send('/mock/diagnostics/start', { ...auth, metadata: a.metadata }, keepalive);
          if (!r.ok) throw new Error('diagnostic registration unavailable');
          a.registered = true; persist();
        }
        // One batch per attempt per flush keeps page-exit traffic below the keepalive budget.
        if (a.dropped) {
          a.events.push({ id: `overflow-${++a.seq}`, name: 'log_limit', at: now(), elapsed_ms: Math.max(0, now() - a.started), data: { count: a.dropped } });
          a.dropped = 0;
        }
        const batch = a.events.slice(0, 40);
        const r = await send('/mock/diagnostics/events', { ...auth, events: batch }, keepalive);
        if (r.status === 403) { attempts = attempts.filter(x => x !== a); persist(); continue; }
        if (!r.ok) throw new Error('diagnostic upload unavailable');
        const sent = new Set(batch.map(e => e.id));
        a.events = a.events.filter(e => !sent.has(e.id)); persist();
        if (keepalive) break;
      }
      retry = 1000;
    })().catch(() => { retry = Math.min(retry * 2, 60000); }).finally(() => { pending = null; later(); });
    return pending;
  }
  persist(); later();
  return { begin, event, context, flush };
}
const recorder = createDiagnostics();
export const beginDiagnostics = recorder.begin;
export const diagnosticEvent = recorder.event;
export const diagnosticContext = recorder.context;
export const flushDiagnostics = recorder.flush;

// Never include request bodies, URLs, keys, exception messages or generated text in telemetry.
export async function measuredRequest(stage, model, run) {
  const started = performance.now(), request_id = crypto.randomUUID();
  diagnosticEvent('request_start', { stage, model, request_id });
  try {
    const response = await run(request_id);
    const data = { stage, model, request_id, status: response.status, duration_ms: Math.round(performance.now() - started) };
    if (response.ok) {
      try {
        const payload = await response.clone().json();
        const u = payload.usageMetadata || {};
        if (payload.served_by) data.served_by = payload.served_by;
        Object.assign(data, { input_tokens: u.promptTokenCount, output_tokens: u.candidatesTokenCount, total_tokens: u.totalTokenCount });
      } catch { /* response parsing remains the caller's responsibility */ }
    }
    diagnosticEvent('request_end', data);
    return response;
  } catch (e) {
    diagnosticEvent('request_error', { stage, model, request_id, duration_ms: Math.round(performance.now() - started), error: errorClass(e) });
    throw e;
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => diagnosticEvent('network_offline'));
  window.addEventListener('online', () => { diagnosticEvent('network_online'); void flushDiagnostics(); });
  window.addEventListener('pagehide', () => { diagnosticEvent('page_exit'); void flushDiagnostics({ keepalive: true }); });
}
