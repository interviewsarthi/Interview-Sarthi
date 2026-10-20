/* Bluetooth headsets, Prep side (8 Oct 2026).
 *
 * Windows shows a Bluetooth headset as two devices: "Headphones (X Stereo)",
 * the music profile without a microphone, and "Headset (X Hands-Free AG Audio)",
 * the call profile with the microphone. The moment a page opens the Hands-Free
 * microphone, Windows switches the headset to call mode and mutes the Stereo
 * device, so a page that keeps playing to the default output goes silent. That
 * is what the owner heard on 6 Oct 2026 with JBL earbuds: the mic switched to
 * the Hands-Free entry at 105 s and the interviewer was never heard again.
 *
 * Two answers, both pure functions so they are tested without a browser:
 * prefer another microphone when the default one is Hands-Free (the earbuds
 * then stay in stereo), and, when the Hands-Free microphone is the one in use
 * anyway, play through the same headset's Hands-Free output, where Windows
 * plays calls. Chrome on Windows prefixes its two virtual entries with
 * "Default - " and "Communications - ".
 */

const HANDS_FREE = /hands-free/i;
const PREFIX = /^(Default|Communications) - /i;
const VIRTUAL = new Set(["default", "communications"]);

export function isHandsFree(label) {
  return HANDS_FREE.test(String(label || "").replace(PREFIX, ""));
}

/* "Headset (boAt Rockerz 510 Hands-Free AG Audio)" -> "boat rockerz 510": the
 * headset's own name, shared by its Stereo and Hands-Free entries. */
export function headsetName(label) {
  return String(label || "").replace(PREFIX, "").replace(/^[^(]*\(|\)$/g, "")
    .replace(/\s*Hands-Free.*$|\s*Stereo$/i, "").trim().toLowerCase();
}

/* The microphone to use when the page is left to choose: null to keep the one
 * already open, else a device to switch to because the open one is a Bluetooth
 * Hands-Free endpoint and a real microphone exists. `mics` are {deviceId, label}
 * entries of kind audioinput, as enumerateDevices gives them once the
 * microphone has been granted; `currentLabel` is the open track's label. */
export function preferredMic(mics, currentLabel = "") {
  const list = (mics || []).filter((m) => m && typeof m.deviceId === "string");
  const current = currentLabel || (list.find((m) => m.deviceId === "default") || list[0] || {}).label;
  if (!isHandsFree(current)) return null;
  return list.find((m) => !VIRTUAL.has(m.deviceId) && m.label && !isHandsFree(m.label)) || null;
}

/* The output to play through while a Hands-Free microphone is open: the same
 * headset's Hands-Free entry (Windows plays calls there), else null. Prefers
 * the plain entry over Chrome's prefixed virtual ones. */
export function handsFreeOutputFor(micLabel, outputs) {
  if (!isHandsFree(micLabel)) return null;
  const name = headsetName(micLabel);
  const same = (outputs || []).filter((o) => o && HANDS_FREE.test(o.label || "") && headsetName(o.label) === name);
  return same.find((o) => !PREFIX.test(o.label)) || same[0] || null;
}
