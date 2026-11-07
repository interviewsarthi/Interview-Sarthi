/* Prep Sarthi inside the Interview Sarthi Windows app: the first-start demo (Live Sarthi 1.0.46, owner 7 Nov 2026).
 *
 * The app opens /prep/app/?from=interview-sarthi-app&mode=demo in its own built-in browser, next to the Live Sarthi
 * panel, and puts what the person gave in setup into the page before it loads (window.__sarthiApp: their own Gemini
 * key, CV text, name, language). The interviewer then:
 *   1. explains, in short simple sentences, who it is and how Live Sarthi works, and how to check yourself that the
 *      Live Sarthi window is invisible in a screen share (said once, in one line, never how it works);
 *   2. asks "Are you ready to start the interview?" and waits ("wait" -> it waits; a minute of silence -> asks once
 *      more; a Start button on the page does the same as saying yes);
 *   3. interviews like a real interviewer, with follow-ups;
 *   4. near the end says what to do in a real interview, and closes. No report, no score.
 *
 * The key stays in this page's memory only: never written to this browser's storage, never sent anywhere but Google.
 * The page tells the app what happened by console lines "SARTHI_APP {json}" (the app reads the page's console).
 */

export const APP_FROM = "interview-sarthi-app";
export const APP_MINUTES = 7;
export const READY_REASK_MS = 60_000;     // quiet this long after the brief: ask once more if they are ready
export const START_BUTTON_MS = 180_000;   // the page's Start button goes after this (the interview is under way)

/** What the app put into the page, or null when this is not the app's demo (any normal visit). */
export function appDemo(win = globalThis, search = (globalThis.location && location.search) || "") {
  const q = new URLSearchParams(search);
  if (q.get("from") !== APP_FROM || q.get("mode") !== "demo") return null;
  const given = win && win.__sarthiApp;
  if (!given || typeof given !== "object" || !String(given.key || "").trim()) return null;
  const minutes = Number(given.minutes) > 0 ? Math.min(15, Number(given.minutes)) : APP_MINUTES;
  return {
    key: String(given.key).trim(),
    cv: String(given.cv || "").slice(0, 60_000),
    name: String(given.name || "").trim().slice(0, 80),
    language: ["English", "Hinglish", "Hindi"].includes(given.language) ? given.language : "English",
    voice: String(given.voice || "Kore"),
    minutes,
  };
}

/** Tell the app something: one console line it watches for. */
export function tellApp(event, data = {}, log = console.log, win = globalThis) {
  const line = JSON.stringify({ event, ...data });
  // Inside Microsoft Edge WebView2 (the Windows app's Prep window, 1.0.46): its own message channel to the app.
  try { if (win && win.chrome && win.chrome.webview && win.chrome.webview.postMessage) win.chrome.webview.postMessage(line); }
  catch (_) { /* not WebView2 */ }
  try { log("SARTHI_APP " + line); } catch (_) { /* console gone */ }
}

const firstName = (name) => (String(name || "").trim().split(/\s+/)[0] || "");

/** The brief, in English; the interviewer says it in the selected language. Owner's wording, 7 Nov 2026. */
export function briefLines(name) {
  const first = firstName(name);
  return [
    `Hello${first ? " " + first : ""}. I am your practice interviewer.`,
    "I am here to show you how Live Sarthi works. Then we will start the interview.",
    "Live Sarthi listens to my questions.",
    "When I ask a question, an answer appears in the Live Sarthi window on the right side of your screen.",
    "Read that answer out loud, in your own words, like you are answering me.",
    "The Live Sarthi window is invisible when you share your screen in your meeting app, like Zoom, Teams or Google Meet. Your interviewer will not see it.",
    "You can check it yourself after this interview: start a call in your meeting app from this computer to your other device, share your full screen, and you will see that the Live Sarthi window is not visible on your other device.",
    "Are you ready to start the interview?",
  ];
}

export const END_LINE = "That is the end of our practice. In your real interview, just open Live Sarthi and press Start Live, then join your interview.";

/** How the brief and the end line are said: as written in English, else translated (owner's MCQ, 7 Nov 2026: the
 * demo follows the app's language setting, same content). The 7 Nov Hinglish test read the English lines out word for
 * word and then stayed in English for the whole interview. */
function sayIn(language) {
  const l = String(language || "English").trim();
  if (/^english$/i.test(l)) return "say these sentences in this order, in short simple sentences";
  return `say these sentences in this order in ${l}: translate each one naturally into simple everyday ${l}, the way ` +
    `people really speak it; keep only the names Live Sarthi, Zoom, Teams and Google Meet as they are. The whole call ` +
    `stays in ${l}`;
}

/** Added to the interviewer's instructions for this demo only. */
export function appDemoInstructions(name, language = "English") {
  const english = /^english$/i.test(String(language || "English").trim());
  return `

THIS CALL IS A LIVE SARTHI DEMO (follow this; it overrides the turn-length rule only for the brief)
The candidate has just installed Live Sarthi, an app that shows suggested answers in a window on their screen during
an interview. This short practice interview shows them how it works. Live Sarthi is listening to your voice.
1. OPENING BRIEF. Your very first turn is this brief: ${sayIn(language)}, with nothing added (no "this is only a
   practice", no "nothing here is real", no "many people ask", no "the steps are on screen", never how the invisible
   window works):
${briefLines(name).map((l) => "   - " + l).join("\n")}
   Then stop and wait for their reply.
2. READY? (Every line quoted here is said${english ? "" : ` in ${language}`}.) If they say yes, start, ready, okay, haan,
   or similar: say "Okay. Let's start the interview." and ask your
   first question (a brief self-introduction). If they say wait or not yet: say "Sure, take your time. Say start when
   you are ready." and wait; do not start until they say so. If they ask about the brief, answer in one or two simple
   sentences, then ask again if they are ready.
3. THE INTERVIEW. From then on, interview them like a real interviewer: one question at a time, real follow-ups on
   what they say. Never mention Live Sarthi, the window or this brief again until the end. Never give a report or a
   score.
4. THE END. When the app says the time is nearly over, finish acknowledging the current answer, then say${english ? "" : ` in ${language}`}
   the END LINE: "${END_LINE}" Thank them in one sentence and stop.
`;
}

/** The stage notes this demo replaces (live.js merges them over interviewer.js NOTES). */
export const APP_DEMO_NOTES = {
  opening: "(The candidate has just joined the call. Give the OPENING BRIEF now, exactly as instructed, then ask if they are ready to start the interview, and wait.)",
  wrapUp: "(Note to interviewer: the time is nearly over. Finish acknowledging the current answer, then say the END LINE from your instructions, in the call's language. Thank them and close.)",
  clockClose: () => "(App clock: under a minute remains. Finish acknowledging the current answer, then say the END LINE from your instructions, in the call's language. Thank them in one sentence and close. Never mention this note.)",
};
export const START_NOTE = "(The candidate pressed the Start the interview button: they are ready. Say \"Okay. Let's start the interview.\" and ask your first question.)";
export const REASK_NOTE = "(The candidate has said nothing for a minute. Ask once, kindly and briefly, if they are ready to start the interview, then wait.)";
