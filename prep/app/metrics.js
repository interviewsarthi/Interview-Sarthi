/* Prep Sarthi: delivery numbers from the transcript timing and the mic.
 *
 * Gemini's transcripts carry no word timestamps, so these come from when the
 * pieces arrived and from the microphone's own energy log. Good enough for
 * "you took 4 seconds before every technical question", not lab grade.
 */

// "toh", "wo" and "haan" were in this list until 29 Sep 2026, but in Hindi they are ordinary words (then, that,
// yes), so every Hinglish answer counted as full of fillers. Version 2 of the numbers leaves them out.
const FILLERS = /\b(um+|uh+|erm|hmm+|like|basically|actually|literally|you know|i mean|sort of|kind of|matlab|yaani|acha)\b/gi;
export const METRICS_VERSION = 2;

/**
 * @param {Array} turns   transcript utterances {who, text, start, end, interrupted} (seconds)
 * @param {Array} voice   [[t, voiced:boolean], ...] from the mic, in the same clock
 */
export function computeMetrics(turns, voice) {
  const answers = [];
  let prevInterviewerEnd = null;
  for (const u of turns) {
    if (u.who === "interviewer") { prevInterviewerEnd = u.end; continue; }
    const words = u.text.split(/\s+/).filter(Boolean).length;
    const firstVoice = firstVoicedAfter(voice, prevInterviewerEnd);
    const delay = prevInterviewerEnd !== null && firstVoice !== null ? Math.max(0, firstVoice - prevInterviewerEnd) : null;
    const duration = Math.max(0.5, u.end - (firstVoice ?? u.start));
    const fillers = (u.text.match(FILLERS) || []).length;
    answers.push({
      text: u.text, words, seconds: round(duration), wpm: Math.round(words / (duration / 60)),
      responseDelay: delay === null ? null : round(delay), fillers,
      longestPause: round(longestGap(voice, firstVoice ?? u.start, u.end)),
    });
    prevInterviewerEnd = null;
  }
  const withDelay = answers.filter((a) => a.responseDelay !== null);
  const talk = (who) => turns.filter((u) => u.who === who).reduce((s, u) => s + Math.max(0, u.end - u.start), 0);
  const totalWords = answers.reduce((s, a) => s + a.words, 0);
  const totalSeconds = answers.reduce((s, a) => s + a.seconds, 0);
  return {
    v: METRICS_VERSION,
    answers,
    avgResponseDelay: withDelay.length ? round(withDelay.reduce((s, a) => s + a.responseDelay, 0) / withDelay.length) : null,
    avgWpm: totalSeconds ? Math.round(totalWords / (totalSeconds / 60)) : null,
    fillersTotal: answers.reduce((s, a) => s + a.fillers, 0),
    fillersPerMinute: totalSeconds ? round(answers.reduce((s, a) => s + a.fillers, 0) / (totalSeconds / 60)) : 0,
    longestPause: round(Math.max(0, ...answers.map((a) => a.longestPause))),
    candidateTalkSeconds: Math.round(talk("candidate")),
    interviewerTalkSeconds: Math.round(talk("interviewer")),
    interruptions: turns.filter((u) => u.who === "interviewer" && u.interrupted).length,
    answerCount: answers.length,
  };
}

function firstVoicedAfter(voice, t) {
  if (t === null || t === undefined) return null;
  for (const [at, voiced] of voice) if (voiced && at >= t) return at;
  return null;
}

function longestGap(voice, from, to) {
  let last = from, worst = 0;
  for (const [at, voiced] of voice) {
    if (at < from) continue;
    if (at > to) break;
    if (voiced) { worst = Math.max(worst, at - last); last = at; }
  }
  return worst;
}

function round(x) { return Math.round(x * 10) / 10; }

/* Plain-language lines for the report prompt and the page. */
export function describeMetrics(m) {
  const lines = [];
  if (m.avgResponseDelay !== null) lines.push(`Average pause before answering: ${m.avgResponseDelay}s`);
  if (m.avgWpm) lines.push(`Speaking pace: about ${m.avgWpm} words per minute`);
  lines.push(`Filler words: ${m.fillersTotal} (${m.fillersPerMinute} per minute)`);
  if (m.longestPause >= 2) lines.push(`Longest silence inside an answer: ${m.longestPause}s`);
  lines.push(`Talk time: candidate ${m.candidateTalkSeconds}s, interviewer ${m.interviewerTalkSeconds}s`);
  if (m.interruptions) lines.push(`Times the candidate cut the interviewer off: ${m.interruptions}`);
  return lines;
}
