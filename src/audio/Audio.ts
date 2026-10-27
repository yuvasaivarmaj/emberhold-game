// Procedural ambience and footsteps with the Web Audio API. Everything is synthesised,
// so there are no sound files yet; recorded audio can replace these later.
import type { Surface } from '../player/Player';

function noiseBuffer(ctx: AudioContext, seconds: number, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  return buf;
}

export class GameAudio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private amb!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private riverGain!: GainNode;
  private nightGain!: GainNode;
  private white!: AudioBuffer;
  private birdTimer = 2;
  private volume = 0.8;
  private t = 0;

  start(volume: number) {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.volume = volume;
    this.master = ctx.createGain();
    this.master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.amb = ctx.createGain();
    this.amb.connect(this.master);

    this.white = noiseBuffer(ctx, 2, 'white');
    const pink = noiseBuffer(ctx, 6, 'pink');
    const brown = noiseBuffer(ctx, 6, 'brown');

    // Wind through grass and trees
    const wind = ctx.createBufferSource();
    wind.buffer = pink; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 420; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    wind.start();

    // River
    const river = ctx.createBufferSource();
    river.buffer = brown; river.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 900;
    const rf2 = ctx.createBiquadFilter(); rf2.type = 'peaking'; rf2.frequency.value = 2400; rf2.gain.value = 6; rf2.Q.value = 0.8;
    this.riverGain = ctx.createGain(); this.riverGain.gain.value = 0;
    const riverHiss = ctx.createBufferSource(); riverHiss.buffer = pink; riverHiss.loop = true; riverHiss.playbackRate.value = 0.9;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1800; hf.Q.value = 0.5;
    const hg = ctx.createGain(); hg.gain.value = 0.35;
    river.connect(rf).connect(rf2).connect(this.riverGain);
    riverHiss.connect(hf).connect(hg).connect(this.riverGain);
    this.riverGain.connect(this.amb);
    river.start(); riverHiss.start();

    // Night insects: amplitude-modulated high tones
    this.nightGain = ctx.createGain(); this.nightGain.gain.value = 0;
    this.nightGain.connect(this.amb);
    for (const [freq, rate, pan] of [[4300, 22, -0.6], [4700, 27, 0.5], [3900, 18, 0.1]] as const) {
      const osc = ctx.createOscillator(); osc.frequency.value = freq;
      const am = ctx.createGain(); am.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = rate; lfo.type = 'square';
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
      const slow = ctx.createOscillator(); slow.frequency.value = 0.35 + Math.random() * 0.3;
      const slowGain = ctx.createGain(); slowGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(am.gain);
      slow.connect(slowGain).connect(am.gain);
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      const g = ctx.createGain(); g.gain.value = 0.012;
      osc.connect(am).connect(g).connect(p).connect(this.nightGain);
      osc.start(); lfo.start(); slow.start();
    }
  }

  /** Fade the world's ambience (wind, river, birds, insects) in or out. */
  setAmbience(level: number, seconds = 1) {
    if (!this.ctx) return;
    this.amb.gain.setTargetAtTime(level, this.ctx.currentTime, Math.max(0.01, seconds / 3));
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  /** Called every frame with the environment around the player. */
  update(dt: number, env: { day: number; riverDist: number; altitude: number; wind: number; treesNear: number }) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.t += dt;
    const now = ctx.currentTime;
    const gust = 0.55 + 0.45 * Math.sin(this.t * 0.23) * Math.sin(this.t * 0.071 + 1.3);
    const windLevel = (0.05 + 0.06 * gust) * env.wind * (1 + Math.max(0, env.altitude - 40) / 80);
    this.windGain.gain.setTargetAtTime(windLevel, now, 0.5);
    this.windFilter.frequency.setTargetAtTime(300 + gust * 380, now, 0.6);
    const river = 0.5 / (1 + Math.pow(Math.max(0, env.riverDist - 8) / 18, 1.6));
    this.riverGain.gain.setTargetAtTime(river * 0.55, now, 0.3);
    this.nightGain.gain.setTargetAtTime((1 - env.day) * 0.9, now, 1.0);

    // Birdsong in daylight, more of it near trees.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.2 + Math.random() * 5 / (0.4 + env.treesNear);
      if (env.day > 0.4 && Math.random() < 0.85) this.bird(Math.random() * 2 - 1, (0.25 + env.treesNear * 0.6) * env.day);
    }
  }

  private bird(pan: number, level: number) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.02;
    const species = Math.floor(Math.random() * 3);
    const notes = species === 0 ? 3 + Math.floor(Math.random() * 4) : species === 1 ? 2 : 6 + Math.floor(Math.random() * 6);
    const p = ctx.createStereoPanner(); p.pan.value = pan * 0.85;
    const g = ctx.createGain(); g.gain.value = level * 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000 - Math.random() * 2500;
    g.connect(lp).connect(p).connect(this.amb);
    let t = t0;
    const base = 2200 + Math.random() * 2400;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const e = ctx.createGain(); e.gain.value = 0;
      const dur = species === 2 ? 0.045 + Math.random() * 0.03 : 0.08 + Math.random() * 0.12;
      const f0 = base * (0.85 + Math.random() * 0.4);
      const f1 = species === 1 ? f0 * 0.62 : f0 * (0.8 + Math.random() * 0.6);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(1, t + dur * 0.2);
      e.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(e).connect(g);
      o.start(t); o.stop(t + dur + 0.02);
      t += dur + (species === 2 ? 0.02 : 0.05 + Math.random() * 0.12);
    }
  }

  private stepSide = 1;

  /**
   * One footstep: the heel strikes, the weight rolls through, the toe pushes off. Each
   * surface has its own texture built from short grains of filtered noise, and every
   * step varies a little in timing, pitch and weight.
   */
  footstep(surface: Surface, intensity: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + Math.random() * 0.008;
    this.stepSide = -this.stepSide;
    const pan = ctx.createStereoPanner(); pan.pan.value = this.stepSide * 0.12;
    const out = ctx.createGain(); out.gain.value = Math.min(1.3, intensity) * (0.85 + Math.random() * 0.3);
    out.connect(pan).connect(this.master);
    const run = intensity > 0.9;
    const roll = run ? 0.045 : 0.085 + Math.random() * 0.02; // heel to toe
    const grain = (at: number, dur: number, type: BiquadFilterType, f: number, q: number, peak: number, attack = 0.002) => {
      const src = ctx.createBufferSource(); src.buffer = this.white;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
      src.connect(fl).connect(g).connect(out);
      src.start(at, Math.random() * 1.6, dur + 0.05);
    };
    const thud = (at: number, f0: number, peak: number, dur = 0.09) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0 * (0.9 + Math.random() * 0.2), at);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.45, at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, at);
      g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
      o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.02);
    };
    switch (surface) {
      case 'grass': {
        // Blades brushing and pressing: a soft thud under a spray of dry rustles.
        thud(t, 80, 0.16);
        grain(t, 0.12, 'lowpass', 500, 0.7, 0.08);
        const n = run ? 10 : 7;
        for (let i = 0; i < n; i++) grain(t + Math.random() * (roll + 0.1), 0.03 + Math.random() * 0.06, 'bandpass', 2500 + Math.random() * 4000, 1.2, 0.035 + Math.random() * 0.05);
        break;
      }
      case 'gravel': {
        // Packed road and gravel: a crunch of many tiny stones under the heel, then the toe.
        thud(t, 90, 0.18);
        for (const [at, n] of [[t, run ? 16 : 12], [t + roll, run ? 10 : 7]] as [number, number][]) {
          for (let i = 0; i < n; i++) grain(at + Math.random() * 0.07, 0.012 + Math.random() * 0.02, 'bandpass', 1400 + Math.random() * 3600, 2.2, 0.05 + Math.random() * 0.09, 0.001);
        }
        break;
      }
      case 'stone': {
        // Leather boots on flagstones: a hard heel click, a lighter toe click, a short ring.
        grain(t, 0.035, 'bandpass', 2100 + Math.random() * 500, 3, 0.32, 0.0008);
        grain(t, 0.06, 'bandpass', 700, 2, 0.12, 0.001);
        thud(t, 110, 0.12, 0.05);
        grain(t + roll, 0.025, 'bandpass', 2800 + Math.random() * 600, 3, 0.16, 0.0008);
        grain(t + 0.01, 0.14, 'bandpass', 1300, 9, 0.025, 0.002); // the courtyard answers faintly
        break;
      }
      case 'wood': {
        // Planks: a hollow knock and a creak.
        thud(t, 170, 0.26, 0.12);
        grain(t, 0.1, 'bandpass', 320, 7, 0.2, 0.001);
        grain(t + roll, 0.08, 'bandpass', 420, 6, 0.1, 0.001);
        if (Math.random() < 0.25) grain(t + 0.05, 0.18, 'bandpass', 900 + Math.random() * 300, 18, 0.05, 0.02);
        break;
      }
      case 'mud': {
        // Wet earth: a heavy squelch and the suck of the boot lifting out.
        thud(t, 70, 0.2, 0.12);
        grain(t, 0.16, 'lowpass', 650, 1, 0.22, 0.01);
        const src = ctx.createBufferSource(); src.buffer = this.white;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
        bp.frequency.setValueAtTime(700, t + roll + 0.05); bp.frequency.exponentialRampToValueAtTime(240, t + roll + 0.2);
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t + roll + 0.05); g.gain.linearRampToValueAtTime(0.12, t + roll + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + roll + 0.24);
        src.connect(bp).connect(g).connect(out); src.start(t + roll + 0.05, Math.random(), 0.25);
        break;
      }
      case 'water': {
        // Wading: the foot breaks the surface, water slaps and runs off.
        grain(t, 0.32, 'bandpass', 900 + Math.random() * 500, 0.8, 0.22, 0.015);
        grain(t, 0.12, 'lowpass', 400, 0.7, 0.18, 0.005);
        for (let i = 0; i < 6; i++) grain(t + 0.05 + Math.random() * 0.3, 0.03 + Math.random() * 0.04, 'bandpass', 1500 + Math.random() * 2500, 4, 0.03 + Math.random() * 0.04, 0.003);
        break;
      }
      default: { // bare rock
        grain(t, 0.05, 'bandpass', 1600 + Math.random() * 500, 1.6, 0.22, 0.001);
        thud(t, 100, 0.16, 0.07);
        for (let i = 0; i < 4; i++) grain(t + Math.random() * 0.08, 0.015, 'bandpass', 2500 + Math.random() * 2500, 2, 0.04, 0.001);
        grain(t + roll, 0.03, 'bandpass', 2000, 1.6, 0.1, 0.001);
      }
    }
  }

  /** A hoofbeat: a heavy thud and, on stone or packed road, a sharp clop. */
  hoof(surface: Surface, intensity: number, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || intensity < 0.01) return;
    const t = ctx.currentTime + Math.random() * 0.01;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70 + Math.random() * 15, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.32 * intensity, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    const pn = ctx.createStereoPanner(); pn.pan.value = pan;
    o.connect(og).connect(pn).connect(this.master);
    o.start(t); o.stop(t + 0.16);
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const hard = surface === 'rock';
    f.type = 'bandpass';
    f.frequency.value = hard ? 1100 + Math.random() * 400 : surface === 'water' ? 900 : 380 + Math.random() * 120;
    f.Q.value = hard ? 2.5 : 0.8;
    const dur = hard ? 0.06 : surface === 'water' ? 0.25 : 0.11;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((hard ? 0.5 : 0.22) * intensity, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(pn);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.004) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  /** A branch snapping: a dry crack, splintering, and a dull thump of wood. */
  crack() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.05, 'highpass', 2500, 0.7, 0.55, 0.001);
    for (let i = 0; i < 6; i++) this.noiseBurst(t + 0.02 + i * (0.012 + Math.random() * 0.02), 0.03, 'bandpass', 1800 + Math.random() * 2500, 2, 0.25 * Math.random() + 0.08, 0.001);
    this.noiseBurst(t, 0.12, 'lowpass', 300, 0.7, 0.3);
  }

  /** Steel on flint: a click and a little shower of sparks. */
  strike() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 0.03, 'bandpass', 5200, 3, 0.35, 0.001);
    for (let i = 0; i < 4; i++) this.noiseBurst(t + 0.02 + Math.random() * 0.08, 0.02, 'highpass', 6000, 1, 0.08, 0.001);
  }

  /** The flame taking: a soft whoomph. */
  ignite() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    this.noiseBurst(ctx.currentTime, 0.7, 'lowpass', 600, 0.5, 0.35, 0.12);
  }

  /** A burning brand pushed into water or earth. */
  hiss(water: boolean) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (water) this.noiseBurst(t, 1.1, 'highpass', 3500, 0.6, 0.4, 0.02);
    else { this.noiseBurst(t, 0.5, 'lowpass', 900, 0.7, 0.35, 0.03); this.noiseBurst(t + 0.1, 0.6, 'highpass', 2500, 0.5, 0.12, 0.05); }
  }

  /** Continuous crackle of a torch in the hand (0 = none). */
  setFire(level: number) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    if (!this.fireGain) {
      if (level <= 0) return;
      const src = ctx.createBufferSource();
      src.buffer = this.white; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
      this.fireGain = ctx.createGain(); this.fireGain.gain.value = 0;
      src.connect(f).connect(this.fireGain).connect(this.master);
      src.start();
    }
    this.fireGain.gain.setTargetAtTime(level * 0.06, ctx.currentTime, 0.3);
    if (level > 0.05 && Math.random() < 0.08 * level) this.noiseBurst(ctx.currentTime, 0.015 + Math.random() * 0.02, 'bandpass', 1500 + Math.random() * 3000, 1.5, 0.05 + Math.random() * 0.12 * level, 0.001);
  }
  private fireGain: GainNode | null = null;

  landed(impact: number, surface: Surface) {
    this.footstep(surface, Math.min(1.6, impact / 4));
    setTimeout(() => this.footstep(surface, Math.min(1.2, impact / 6)), 60);
  }
}
