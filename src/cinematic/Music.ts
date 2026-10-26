// A synthesised score for the prologue: slow minor chords on warm pads, a sub-bass,
// a shimmer of high strings, and the impact of the fall. Placeholder until real music.

function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// D minor progression: Dm, Bb, F, C, Gm, Bb, A
const CHORDS: number[][] = [
  [50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64],
  [43, 55, 58, 62], [46, 53, 58, 65], [45, 52, 57, 61],
];

export class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private verb: ConvolverNode;
  private timers: number[] = [];
  private voices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private playing = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0;
    this.verb = ctx.createConvolver();
    this.verb.buffer = impulse(ctx, 5, 2.2);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    const dry = ctx.createGain(); dry.gain.value = 0.6;
    this.out.connect(dry).connect(destination);
    this.out.connect(this.verb).connect(wet).connect(destination);
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(0.5, t + 6);
    let i = 0;
    const next = () => {
      if (!this.playing) return;
      this.chord(CHORDS[i % CHORDS.length], 9.5);
      i++;
      this.timers.push(window.setTimeout(next, 8000));
    };
    next();
  }

  private chord(notes: number[], dur: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 2.5);
    gain.gain.setValueAtTime(0.09, t + dur - 3);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1300, t + dur * 0.6);
    gain.connect(lp).connect(this.out);
    const osc: OscillatorNode[] = [];
    for (const n of notes) {
      for (const det of [-7, 0, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        o.connect(gain);
        o.start(t); o.stop(t + dur + 0.1);
        osc.push(o);
      }
    }
    // Sub bass on the root.
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = NOTE(notes[0] - 12);
    const sg = ctx.createGain(); sg.gain.value = 0.0;
    sg.gain.linearRampToValueAtTime(0.16, t + 3); sg.gain.setValueAtTime(0.16, t + dur - 3); sg.gain.linearRampToValueAtTime(0, t + dur);
    sub.connect(sg).connect(this.out); sub.start(t); sub.stop(t + dur + 0.1);
    // High shimmer on the fifth.
    const hi = ctx.createOscillator(); hi.type = 'triangle'; hi.frequency.value = NOTE(notes[2] + 12);
    const hg = ctx.createGain(); hg.gain.value = 0;
    hg.gain.linearRampToValueAtTime(0.018, t + 4); hg.gain.linearRampToValueAtTime(0, t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = 4;
    vib.connect(vg).connect(hi.frequency); vib.start(t); vib.stop(t + dur);
    hi.connect(hg).connect(this.out); hi.start(t); hi.stop(t + dur + 0.1);
    this.voices.push({ osc, gain });
  }

  /** The fall: a rising roar while it crosses the sky, then the impact. */
  roar(seconds: number) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * (seconds + 1));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.03 * (Math.random() * 2 - 1)) / 1.03; d[i] = last * 6; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(2200, t + seconds);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.7, t + seconds);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds + 0.6);
    src.connect(lp).connect(g).connect(this.out);
    src.start(t);
  }

  impact() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // Deep boom
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(22, t + 3.5);
    const og = ctx.createGain(); og.gain.setValueAtTime(1.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
    o.connect(og).connect(this.out); o.start(t); o.stop(t + 4.6);
    // Blast noise
    const len = Math.floor(ctx.sampleRate * 6);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.05 * (Math.random() * 2 - 1)) / 1.05; d[i] = last * 8 * Math.pow(1 - i / len, 2.5); }
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(150, t + 5);
    const g = ctx.createGain(); g.gain.value = 0.9;
    src.connect(lp).connect(g).connect(this.out); src.start(t);
  }

  fadeOut(seconds: number) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + seconds);
    window.setTimeout(() => this.stop(), seconds * 1000 + 100);
  }

  stop() {
    this.playing = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    for (const v of this.voices) { try { v.gain.disconnect(); } catch { /* ignore */ } }
    this.voices = [];
  }
}
