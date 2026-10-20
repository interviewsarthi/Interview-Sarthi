// Strip data before browser persistence or upload. The server has its own allowlist;
// buy is retained locally but needs server support before it appears in uploaded timelines.
// Operational timelines only: never store prompts, transcripts, audio, credentials or raw errors.
export const RETENTION_DAYS = 30;
const ID = /^[a-f0-9-]{36}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const DAY = 86400000;
export const NAMES = new Set(('attempt_start page_exit network_offline network_online mic mic_error mic_switched mic_track_muted mic_back mic_check_help mic_check_ok mic_check_skipped mic_silent_in_call mic_stats preparation_start preparation_ready preparation_failed preparation_cancelled demo_requested demo_granted demo_refused call_start connection_attempt connected connection_failed reconnect retry_scheduled socket_closed socket_error connect_error send_error stall_detected audio_dropped go_away first_audio model_audio_start interrupted turn_complete turn_settled turn_complete_late text_sent session_usage_totals clock_note close_nudge interview_end report_start report_ready report_failed no_answers request_start request_end request_error model_fallback key_fallback backup_start backup_end token_start token_end demo_result relay_start relay_end log_limit').split(' '));
const REASONS = new Set(('audio_backpressure setup_timeout reply_timeout scheduled_refresh connection_deadline send_error quota permission network timeout invalid_response http_error unknown user buy time failed used day_full network_limit busy full unavailable cancelled quiet silent no-audio ok skipped help online offline demo livetest trial pass none redrill resume_rejected model_unavailable unstable exhausted').split(' '));
const NUMBERS = new Set(('status code duration_ms delay_ms attempt session elapsed planned seconds minutes deviceRate maxRms quietMax chunks voicedChunks silentFor quiet_s input_tokens output_tokens total_tokens key_slot count').split(' '));
const BOOLS = new Set(['wasConnected', 'muted', 'deaf', 'demo', 'resumed', 'handsFree', 'micPreferred']);
// Where the interviewer's voice is routed while a Bluetooth Hands-Free microphone is open (audio.js).
const SINKS = new Set(['default', 'handsfree', 'communications', 'unsupported']);
export function errorClass(value) {
  const s = String(value?.message || value || '');
  if (/quota|resource.?exhausted|rate.?limit|429/i.test(s)) return 'quota';
  if (/timeout|timed? ?out|abort|too slow|504/i.test(s)) return 'timeout';
  if (/permission|notallowed|denied|unauth|invalid.?key|403|401/i.test(s)) return 'permission';
  if (/fetch|network|unreachable|socket|502/i.test(s)) return 'network';
  if (/json|parse|malformed/i.test(s)) return 'invalid_response';
  return 'unknown';
}
export function cleanData(data = {}) {
  const out = {};
  for (const [k, v] of Object.entries(data && typeof data === 'object' ? data : {})) {
    if (NUMBERS.has(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(-1, Math.min(v, 1e9));
    else if (BOOLS.has(k) && typeof v === 'boolean') out[k] = v;
    else if (['reason', 'error', 'verdict', 'kind'].includes(k) && REASONS.has(v)) out[k] = v;
    else if (['model', 'served_by'].includes(k) && /^(gemini-[a-z0-9.-]{1,65}|openai\/gpt-oss-120b|groq|backup)$/.test(v)) out[k] = v;
    else if (k === 'demo_id' && /^[a-f0-9]{24}$/.test(v)) out[k] = v;
    else if (k === 'request_id' && ID.test(v)) out[k] = v;
    else if (k === 'stage' && ['mic', 'demo', 'livetest', 'plan', 'live', 'report', 'redrill'].includes(v)) out[k] = v;
    else if (k === 'device' && ['mobile', 'desktop', 'unknown'].includes(v)) out[k] = v;
    else if (k === 'sink' && SINKS.has(v)) out[k] = v;
    else if (k === 'release' && /^\d{8}-[a-z0-9-]{1,30}$/.test(v)) out[k] = v;
  }
  return out;
}
