/* Live Sarthi on the phone: the microphone, as 16 kHz PCM in 100 ms pieces. Starts inside a tap. */

const RATE = 16000;
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / ${RATE}; this.rest = new Float32Array(0); this.out = new Int16Array(${RATE / 10}); this.filled = 0; this.sq = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const merged = new Float32Array(this.rest.length + ch.length);
    merged.set(this.rest); merged.set(ch, this.rest.length);
    const outLen = Math.floor(merged.length / this.ratio);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * this.ratio), end = Math.max(start + 1, Math.floor((i + 1) * this.ratio));
      let s = 0; for (let j = start; j < end; j++) s += merged[j]; s /= (end - start);
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this.sq += s * s; this.out[this.filled++] = s * 32767;
      if (this.filled === this.out.length) {
        const pcm = this.out.slice(0); const rms = Math.sqrt(this.sq / this.filled);
        this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]); this.filled = 0; this.sq = 0;
      }
    }
    this.rest = merged.slice(Math.floor(outLen * this.ratio));
    return true;
  }
}
registerProcessor("live-phone-capture", Capture);`;

export class Mic {
  constructor({ cleanup = false } = {}) {
    this.cleanup = cleanup;
    this.ctx = null; this.stream = null; this.source = null; this.node = null;
    this.onChunk = null;         // (Int16Array, rms) => void
    this.onState = null;         // ("muted"|"live"|"ended") => void
    this.label = "";
  }

  get running() { return !!(this.ctx && this.stream && this.stream.getAudioTracks().some((t) => t.readyState === "live")); }

  async start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: "interactive" });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await this.ctx.audioWorklet.addModule(url);
      this.node = new AudioWorkletNode(this.ctx, "live-phone-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = (e) => { if (this.onChunk) this.onChunk(new Int16Array(e.data.pcm), e.data.rms); };
      const sink = this.ctx.createGain(); sink.gain.value = 0;
      this.node.connect(sink).connect(this.ctx.destination);
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    await this._open();
  }

  async _open() {
    const audio = { channelCount: 1, echoCancellation: this.cleanup, noiseSuppression: this.cleanup, autoGainControl: true };
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    if (this.source) { try { this.source.disconnect(); } catch (_) { /* gone */ } }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.node);
    const track = stream.getAudioTracks()[0];
    this.label = (track && track.label) || "";
    if (track) {
      track.onmute = () => this.onState && this.onState("muted");
      track.onunmute = () => this.onState && this.onState("live");
      track.onended = () => this.onState && this.onState("ended");
    }
  }

  async revive() {
    if (!this.ctx) return this.start();
    if (this.ctx.state !== "running") { try { await this.ctx.resume(); } catch (_) { /* needs a tap */ } }
    if (!this.running) await this._open();
    return this.running && this.ctx.state === "running";
  }

  async stop() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    if (this.ctx) { try { await this.ctx.close(); } catch (_) { /* closed */ } }
    this.ctx = null; this.stream = null; this.source = null; this.node = null;
  }
}
