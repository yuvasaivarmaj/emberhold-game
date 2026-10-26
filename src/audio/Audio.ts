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

  footstep(surface: Surface, intensity: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.2;
    let dur = 0.12, peak = 0.22 * intensity;
    if (surface === 'grass') { f.type = 'bandpass'; f.frequency.value = 2600 + Math.random() * 1500; f.Q.value = 0.7; dur = 0.16; peak *= 0.6; }
    else if (surface === 'rock') { f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 600; f.Q.value = 1.4; dur = 0.07; peak *= 0.9; }
    else if (surface === 'mud') { f.type = 'lowpass'; f.frequency.value = 700 + Math.random() * 300; dur = 0.15; peak *= 1.1; }
    else { f.type = 'lowpass'; f.frequency.value = 1300 + Math.random() * 600; dur = 0.32; peak *= 1.0; }
    const off = Math.random() * 1.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, off, dur + 0.05);
    // Low thump of the heel
    if (surface !== 'water') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(95 + Math.random() * 20, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.18 * intensity, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(og).connect(this.master);
      o.start(t); o.stop(t + 0.1);
    }
  }

  landed(impact: number, surface: Surface) {
    this.footstep(surface, Math.min(1.6, impact / 4));
    setTimeout(() => this.footstep(surface, Math.min(1.2, impact / 6)), 60);
  }
}
