/* Prep Sarthi: the Sarthi chariot wheel as the interviewer's presence.
 *
 * The same shape as the site logo (assets/mark.svg): rim, eight spokes, hub.
 *   speaking      the wheel turns, faster when her voice is louder, and coasts
 *                 to a stop when she finishes, like a real wheel
 *   listening     the wheel is still; an outer ring breathes with your mic
 *   thinking      a slow rock, a quarter-turn back and forth
 *   reconnecting  greyed out, with a slow steady turn
 *   idle          still
 */

const SVG = `
<svg class="wheel" viewBox="0 0 200 200" role="img" aria-label="Interviewer" data-state="idle">
  <circle class="ring" cx="100" cy="100" r="92" fill="none" stroke="#8FA6FF" stroke-width="2.5"/>
  <g class="spin">
    <circle cx="100" cy="100" r="74" fill="none" stroke="#FFFFFF" stroke-width="11"/>
    <g stroke="#FFFFFF" stroke-width="7" stroke-linecap="round">
      <path d="M100 37V163M37 100H163M55.5 55.5L144.5 144.5M55.5 144.5L144.5 55.5"/>
    </g>
    <circle cx="100" cy="100" r="19" fill="#FFFFFF"/>
    <circle cx="100" cy="100" r="7" fill="#245ADC"/>
  </g>
</svg>`;

export class Wheel {
  /** @param {HTMLElement} host  an element to draw into (its content is replaced) */
  constructor(host) {
    host.innerHTML = SVG;
    this.host = host;
    this.svg = host.querySelector("svg");
    this.spin = host.querySelector(".spin");
    this.ring = host.querySelector(".ring");
    this.state = "idle";
    this.level = 0;      // interviewer's voice, 0..1
    this.mic = 0;        // candidate's mic, 0..1
    this.angle = 0;      // degrees
    this.speed = 0;      // degrees per second, eased
    this._t = 0;
    this._raf = null;
    this._still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.svg.dataset.state = state;
    this._thinkStart = performance.now();
  }
  setLevel(x) { this.level = Math.max(0, Math.min(1, x)); }
  setMic(x) { this.mic = Math.max(0, Math.min(1, x)); }

  start() {
    if (this._raf) return;
    this._t = performance.now();
    const frame = (t) => {
      const dt = Math.min(0.05, (t - this._t) / 1000);
      this._t = t;
      this._step(dt, t);
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _step(dt, t) {
    let target = 0;
    if (this.state === "speaking") target = 70 + this.level * 300;   // ~0.2 to ~1 turn a second
    else if (this.state === "reconnecting") target = 40;
    // "Reduce motion" (common on Windows with animations off) slows the wheel
    // but never freezes it: the turning is how you know she is talking.
    if (this._still) target = Math.min(target, 140);
    // Spin up quickly, coast down slowly: a wheel has weight.
    const rate = target > this.speed ? 6 : 1.6;
    this.speed += (target - this.speed) * Math.min(1, rate * dt);
    if (Math.abs(this.speed) < 0.4 && target === 0) this.speed = 0;
    this.angle = (this.angle + this.speed * dt) % 360;

    let shown = this.angle;
    if (this.state === "thinking") {
      // rock a quarter-turn around wherever the wheel came to rest
      shown += Math.sin((t - this._thinkStart) / 520) * (this._still ? 9 : 22);
    }
    this.spin.style.transform = `rotate(${shown.toFixed(2)}deg)`;

    // While you speak the ring swells and brightens with your voice, so the
    // screen never looks frozen during an answer.
    const hearing = this.state === "listening";
    this._ringLevel = (this._ringLevel || 0) + ((hearing ? this.mic : 0) - (this._ringLevel || 0)) * Math.min(1, 14 * dt);
    const r = this._ringLevel;
    this.ring.style.transform = `scale(${(1 + r * 0.17).toFixed(3)})`;
    this.ring.style.strokeWidth = (3 + r * 12).toFixed(2);
    this.ring.style.stroke = r > 0.12 ? "#B4C3FF" : "#8FA6FF";

    const glow = this.state === "speaking" ? 0.45 + this.level * 0.5 : hearing ? 0.22 + r * 0.6 : 0.18;
    this.host.style.setProperty("--glow", glow.toFixed(2));
  }
}
