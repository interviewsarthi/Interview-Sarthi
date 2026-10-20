/* Prep Sarthi: is the microphone really delivering a voice?
 *
 * A muted laptop key, a headset that switched modes, or a virtual audio device
 * chosen as the default all look the same to a web page: the mic opens fine and
 * delivers silence. The interview must not start (and must not spend free
 * minutes) until real sound arrives.
 *
 * VoiceGate is fed the RMS of each ~100 ms microphone chunk. It passes once
 * enough chunks inside a short window are clearly louder than the room.
 */

export const MIC_VOICE_RMS = 0.012;     // clearly a voice, not hiss (the engine's floor is 0.005)
export const MIC_DEAD_RMS = 0.0005;     // a muted or dead input sits below this

export class VoiceGate {
  constructor({ need = 3, windowSeconds = 1.5, threshold = MIC_VOICE_RMS } = {}) {
    this.need = need;
    this.windowSeconds = windowSeconds;
    this.threshold = threshold;
    this.hits = [];
    this.chunks = 0;
    this.maxRms = 0;
    this.passed = false;
  }

  /** @returns {boolean} true the first time the voice is confirmed */
  feed(rms, t) {
    this.chunks++;
    if (rms > this.maxRms) this.maxRms = rms;
    if (this.passed) return false;
    if (rms >= this.threshold) this.hits.push(t);
    while (this.hits.length && t - this.hits[0] > this.windowSeconds) this.hits.shift();
    if (this.hits.length >= this.need) { this.passed = true; return true; }
    return false;
  }

  /* Why it has not passed, for the help text. */
  get verdict() {
    if (this.passed) return "ok";
    if (this.chunks === 0) return "no-audio";          // the worklet is not delivering at all
    if (this.maxRms < MIC_DEAD_RMS) return "silent";   // muted, or the wrong input
    return "quiet";                                    // something arrives, but too faint to be a voice
  }
}

export const MIC_HELP = {
  "no-audio": "Your browser opened the microphone but no sound is arriving at all.",
  "silent": "Your microphone is sending pure silence. It is probably muted, or the browser picked the wrong one.",
  "quiet": "I can hear something, but it is too faint to be your voice.",
};
