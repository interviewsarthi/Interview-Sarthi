/* Prep Sarthi: microphone in, interviewer voice out.
 *
 * One AudioContext at whatever rate the device runs (44.1k or 48k on most
 * phones). Two worklets do the resampling so we never ask the browser for a
 * fixed-rate context, which Firefox and some Android builds refuse when the
 * microphone's hardware rate differs:
 *
 *   capture  : mic float samples  ->  16 kHz Int16 PCM in ~100 ms chunks,
 *              plus the chunk's RMS (the engine's "is someone talking" floor)
 *   playback : 24 kHz Int16 PCM from Gemini  ->  device rate, queued, with a
 *              clear() for barge-in and playing/idle notices for the page
 *
 * Everything must be created inside a user gesture (Start button): iOS Safari
 * keeps an AudioContext suspended otherwise.
 *
 * The microphone can be swapped while everything runs (useMic), because the
 * most common failure on a real device is the browser picking a muted or
 * wrong input.
 */

import { isHandsFree, preferredMic, handsFreeOutputFor } from "./micpick.js";

const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;

const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${CAPTURE_RATE};
    this.rest = new Float32Array(0);
    this.out = new Int16Array(${CAPTURE_RATE / 10});   // 100 ms
    this.filled = 0;
    this.sq = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const merged = new Float32Array(this.rest.length + ch.length);
    merged.set(this.rest);
    merged.set(ch, this.rest.length);
    const outLen = Math.floor(merged.length / this.ratio);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * this.ratio);
      const end = Math.max(start + 1, Math.floor((i + 1) * this.ratio));
      let s = 0;
      for (let j = start; j < end; j++) s += merged[j];
      s /= (end - start);
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this.sq += s * s;
      this.out[this.filled++] = s * 32767;
      if (this.filled === this.out.length) {
        const pcm = this.out.slice(0);
        const rms = Math.sqrt(this.sq / this.filled);
        this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]);
        this.filled = 0;
        this.sq = 0;
      }
    }
    this.rest = merged.slice(Math.floor(outLen * this.ratio));
    return true;
  }
}
registerProcessor("sarthi-capture", CaptureProcessor);
`;

const PLAYBACK_WORKLET = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = ${PLAYBACK_RATE} / sampleRate;   // input samples per output sample
    this.queue = [];      // Int16Array chunks
    this.pos = 0;         // fractional read position inside queue[0]
    this.playing = false;
    this.played = 0;      // input samples consumed, for timing
    this.sq = 0;          // loudness of what is actually leaving the speaker,
    this.count = 0;       // reported ~20 times a second so the wheel can follow her voice
    this.port.onmessage = (e) => {
      if (e.data.clear) { this.queue = []; this.pos = 0; this.setPlaying(false); return; }
      if (e.data.pcm) this.queue.push(new Int16Array(e.data.pcm));
    };
  }
  setPlaying(v) {
    if (v === this.playing) return;
    this.playing = v;
    this.port.postMessage({ playing: v, played: this.played });
  }
  sample(chunk, i) {
    const a = chunk[i] || 0;
    const b = chunk[i + 1] !== undefined ? chunk[i + 1] : a;
    const f = this.pos - Math.floor(this.pos);
    return (a + (b - a) * f) / 32768;
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    for (let n = 0; n < out.length; n++) {
      if (!this.queue.length) { out[n] = 0; continue; }
      const chunk = this.queue[0];
      const i = Math.floor(this.pos);
      if (i >= chunk.length) {
        this.pos -= chunk.length;
        this.queue.shift();
        n--;
        continue;
      }
      this.setPlaying(true);
      out[n] = this.sample(chunk, i);
      this.sq += out[n] * out[n];
      this.pos += this.step;
      this.played += this.step;
    }
    this.count += out.length;
    if (this.count >= 2048) {
      this.port.postMessage({ level: Math.sqrt(this.sq / this.count) });
      this.sq = 0; this.count = 0;
    }
    if (!this.queue.length) this.setPlaying(false);
    return true;
  }
}
registerProcessor("sarthi-playback", PlaybackProcessor);
`;

function workletUrl(source) {
  return URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
}

export class AudioIO {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.capture = null;
    this.playback = null;
    this.onChunk = null;       // (Int16Array pcm16k, rms) => void
    this.onPlaying = null;     // (bool) => void
    this.onLevel = null;       // (rms 0..1 of the interviewer's voice right now) => void
    this.onMicMuted = null;    // (bool) => void   the browser reports the track as muted
    this.speaking = false;
    this.micLabel = "";
    this.micId = "";
    this._muted = false;
    this.handsFree = false;     // the open microphone is a Bluetooth Hands-Free endpoint (micpick.js)
    this.sink = "default";      // where the interviewer plays: default, handsfree, communications, unsupported
    this.micPreferred = false;  // start() swapped a Hands-Free default for a real microphone
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 0; }

  /* Microphones the browser knows about. Labels only appear after the user has
   * granted the mic once, so call this after start(). */
  static async listMics() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    } catch (_) { return []; }
  }

  /* Call from a click/tap handler. Asks for the mic and wires both worklets. */
  async start(deviceId) {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    if (this.ctx.state !== "running") await this.ctx.resume();
    await this.ctx.audioWorklet.addModule(workletUrl(CAPTURE_WORKLET));
    await this.ctx.audioWorklet.addModule(workletUrl(PLAYBACK_WORKLET));

    this.capture = new AudioWorkletNode(this.ctx, "sarthi-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.capture.port.onmessage = (e) => {
      if (this._muted || !this.onChunk) return;
      this.onChunk(new Int16Array(e.data.pcm), e.data.rms);
    };
    // A worklet only runs while it reaches the destination; a silent gain keeps
    // the mic out of the speakers.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.capture.connect(sink).connect(this.ctx.destination);

    this.playback = new AudioWorkletNode(this.ctx, "sarthi-playback", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.playback.port.onmessage = (e) => {
      if (typeof e.data.playing === "boolean") {
        this.speaking = e.data.playing;
        if (this.onPlaying) this.onPlaying(e.data.playing);
      }
      if (typeof e.data.level === "number" && this.onLevel) this.onLevel(e.data.level);
    };
    this.playback.connect(this.ctx.destination);

    await this.useMic(deviceId);
    // Left to choose and handed a Bluetooth Hands-Free microphone: take another
    // one, so the earbuds stay in stereo (micpick.js). useMic stops the Hands-Free
    // track and Windows returns the headset to stereo on its own.
    if (!deviceId && this.handsFree) this.micPreferred = await this._preferOtherMic();
  }

  async _preferOtherMic() {
    let mics = [];
    try { mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"); } catch (_) { return false; }
    const other = preferredMic(mics, this.micLabel);
    if (!other) return false;
    try { await this.useMic(other.deviceId); return true; } catch (_) { return false; }
  }

  /* Where the interviewer's voice goes. With a Hands-Free microphone open, Windows
   * mutes the headset's Stereo device, which is the browser's default output, so
   * the voice is sent to the headset's Hands-Free output instead (phone quality,
   * but heard). Chrome, Edge and Brave can do this; Firefox and Safari cannot, and
   * the page then says so and offers the laptop microphone. */
  async _routeOutput() {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.setSinkId !== "function") { this.sink = this.handsFree ? "unsupported" : "default"; return; }
    if (!this.handsFree) {
      if (this.sink !== "default") { try { await ctx.setSinkId(""); } catch (_) { /* already default */ } }
      this.sink = "default";
      return;
    }
    let outputs = [];
    try { outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput"); } catch (_) { /* no list: try the communications device */ }
    const twin = handsFreeOutputFor(this.micLabel, outputs);
    for (const [id, name] of [[twin && twin.deviceId, "handsfree"], ["communications", "communications"]]) {
      if (!id) continue;
      try { await ctx.setSinkId(id); this.sink = name; return; } catch (_) { /* next */ }
    }
    this.sink = "unsupported";
  }

  /* Open a microphone (the default one when no id is given) and feed it to the
   * capture worklet. Safe to call again mid-call to switch microphones: the
   * new one is opened first, so a refusal leaves the old one running. */
  async useMic(deviceId) {
    const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    if (this.source) { try { this.source.disconnect(); } catch (_) { /* already gone */ } }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.capture);
    const track = stream.getAudioTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    this.micLabel = (track && track.label) || "";
    this.micId = settings.deviceId || deviceId || "";
    this.handsFree = isHandsFree(this.micLabel);
    if (track) {
      track.onmute = () => this.onMicMuted && this.onMicMuted(true);
      track.onunmute = () => this.onMicMuted && this.onMicMuted(false);
      if (track.muted && this.onMicMuted) this.onMicMuted(true);
    }
    await this._routeOutput();
    return { label: this.micLabel, id: this.micId, settings, handsFree: this.handsFree, sink: this.sink };
  }

  /* Gemini's audio parts are 24 kHz Int16 PCM. */
  play(pcm16) {
    if (!this.playback) return;
    const copy = pcm16.slice(0);
    this.playback.port.postMessage({ pcm: copy.buffer }, [copy.buffer]);
  }

  /* Barge-in: the interviewer was interrupted; stop mid-sentence. */
  clear() {
    if (this.playback) this.playback.port.postMessage({ clear: true });
  }

  /* Half-duplex gate for devices whose echo cancellation is weak. */
  set muted(v) { this._muted = !!v; }
  get muted() { return this._muted; }

  async stop() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    if (this.ctx) { try { await this.ctx.close(); } catch (_) { /* already closed */ } }
    this.ctx = null; this.stream = null; this.source = null; this.capture = null; this.playback = null;
    this.speaking = false;
  }
}

export { CAPTURE_RATE, PLAYBACK_RATE };
