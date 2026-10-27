// On-screen guidance: an ink-and-parchment map drawn from the real world data (M), a
// minimap, places announced as you discover them, a "things to do" panel (bottom left)
// and a small message feed with hints (top right).
import type { Heightfield } from '../world/Heightfield';
import {
  WORLD_SIZE, WORLD_HALF, HF_N, MASK_RES, PLACES, EMBERHOLD, ROADS, RIVERS, smoothPath, fortShape,
} from '../world/Layout';

const MAP = 1024; // map canvas size (8 m per pixel)
const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private mapCanvas = document.createElement('canvas');
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private bigCtx: CanvasRenderingContext2D;
  private discovered = new Set<string>();
  private seenTips = new Set<string>();
  private msgs: HTMLElement;
  mapOpen = false;

  constructor(private hf: Heightfield) {
    this.mapCanvas.width = this.mapCanvas.height = MAP;
    this.drawMap();
    this.mini = $('minimap') as HTMLCanvasElement;
    this.miniCtx = this.mini.getContext('2d')!;
    const big = $('bigmap') as HTMLCanvasElement;
    this.bigCtx = big.getContext('2d')!;
    this.msgs = $('messages');
    try {
      const d = JSON.parse(localStorage.getItem('emberhold.discovered') ?? '[]');
      for (const n of d) this.discovered.add(n);
      const t = JSON.parse(localStorage.getItem('emberhold.tips') ?? '[]');
      for (const n of t) this.seenTips.add(n);
    } catch { /* private mode */ }
  }

  // ---------------------------------------------------------------- the map
  private drawMap() {
    const ctx = this.mapCanvas.getContext('2d')!;
    const img = ctx.createImageData(MAP, MAP);
    const hf = this.hf;
    const mask = hf.mask;
    const crops = (hf.cropTexture.image as any).data as Uint8Array;
    const step = (HF_N - 1) / MAP;
    const H = (px: number, pz: number) => hf.data[Math.min(HF_N - 1, Math.round(pz * step)) * HF_N + Math.min(HF_N - 1, Math.round(px * step))];
    const hash = (x: number, y: number) => {
      let h = (x * 374761393 + y * 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let y = 0; y < MAP; y++) {
      for (let x = 0; x < MAP; x++) {
        const h = H(x, y);
        const hx = H(Math.min(MAP - 1, x + 1), y) - H(Math.max(0, x - 1), y);
        const hz = H(x, Math.min(MAP - 1, y + 1)) - H(x, Math.max(0, y - 1));
        // Hillshade lit from the north-west, as old maps are.
        const shade = Math.max(0.55, Math.min(1.12, 1 + (-hx - hz) * 0.035));
        const mi = ((Math.floor((y / MAP) * MASK_RES)) * MASK_RES + Math.floor((x / MAP) * MASK_RES)) * 4;
        const road = mask[mi] / 255, settle = mask[mi + 1] / 255, forest = mask[mi + 2] / 255, water = mask[mi + 3];
        let r = 233, g = 222, b = 192; // parchment
        // Higher ground browns and greys.
        const hi = Math.min(1, Math.max(0, (h - 60) / 380));
        r -= hi * 40; g -= hi * 45; b -= hi * 40;
        if (h > 430) { r = 238; g = 236; b = 230; }
        if (crops[mi] > 128) { r = 220; g = 200; b = 140; }
        else if (crops[mi + 1] > 128) { r = 206; g = 202; b = 146; }
        else if (crops[mi + 2] > 128) { r = 186; g = 196; b = 168; }
        else if (crops[mi + 3] > 128) { r = 196; g = 168; b = 150; if ((x + y) % 4 === 0) { r -= 30; g -= 30; b -= 25; } }
        r *= shade; g *= shade; b *= shade;
        // Forests: stippled trees.
        if (forest > 0.25 && hash(x, y) < forest * 0.55) { r = 86; g = 100; b = 66; }
        else if (forest > 0.15) { r = r * 0.9; g = g * 0.94; b = b * 0.85; }
        // Contours every 25 m.
        const c0 = Math.floor(h / 25), c1 = Math.floor(H(Math.min(MAP - 1, x + 1), y) / 25), c2 = Math.floor(H(x, Math.min(MAP - 1, y + 1)) / 25);
        if (h > 2 && (c0 !== c1 || c0 !== c2)) { r *= 0.82; g *= 0.8; b *= 0.76; }
        if (water === 0) { r = 118; g = 150; b = 160; }
        else if (water < 3) { r = 70; g = 92; b = 100; }
        if (settle > 0.5) { r = r * 0.86; g = g * 0.84; b = b * 0.8; }
        if (road > 0.5) { r = 128; g = 88; b = 56; }
        const o = (y * MAP + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const P = (wx: number, wz: number) => [((wx + WORLD_HALF) / WORLD_SIZE) * MAP, ((wz + WORLD_HALF) / WORLD_SIZE) * MAP];
    // Emberhold's three walls in ink.
    ctx.strokeStyle = 'rgba(40,28,20,0.9)';
    for (const [rr, w] of [[EMBERHOLD.outerR + 3, 2.2], [EMBERHOLD.middleR + 4, 1.6], [EMBERHOLD.keepR + 3, 1.4]]) {
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2, R = rr * fortShape(a);
        const [px, pz] = P(EMBERHOLD.x + Math.cos(a) * R, EMBERHOLD.z + Math.sin(a) * R);
        if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
      }
      ctx.stroke();
    }
    // Rivers in a deeper ink line over the wash.
    ctx.strokeStyle = 'rgba(52,84,98,0.55)';
    for (const rv of RIVERS) {
      ctx.lineWidth = Math.max(1, rv.width / 12);
      ctx.beginPath();
      smoothPath(rv.pts, 40).forEach(([x, z], i) => { const [px, pz] = P(x, z); if (i) ctx.lineTo(px, pz); else ctx.moveTo(px, pz); });
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(96,60,34,0.8)';
    ctx.setLineDash([4, 2]);
    for (const rd of ROADS) {
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      smoothPath(rd.pts, 30).forEach(([x, z], i) => { const [px, pz] = P(x, z); if (i) ctx.lineTo(px, pz); else ctx.moveTo(px, pz); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Labels.
    ctx.textAlign = 'center';
    for (const pl of PLACES) {
      const [px, pz] = P(pl.x, pl.z);
      if (pl.label === 'big') { ctx.font = '600 22px Georgia, serif'; ctx.fillStyle = 'rgba(40,24,16,0.95)'; }
      else if (pl.label === 'water') { ctx.font = 'italic 15px Georgia, serif'; ctx.fillStyle = 'rgba(40,70,86,0.9)'; }
      else { ctx.font = 'italic 14px Georgia, serif'; ctx.fillStyle = 'rgba(56,40,28,0.85)'; }
      const yOff = pl.label === 'big' ? -((pl.r / WORLD_SIZE) * MAP) - 6 : 0;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(236,226,198,0.7)';
      ctx.strokeText(pl.name, px, pz + yOff);
      ctx.fillText(pl.name, px, pz + yOff);
    }
    // Compass rose and a border.
    ctx.strokeStyle = 'rgba(60,40,26,0.85)'; ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, MAP - 12, MAP - 12);
    ctx.font = '600 18px Georgia, serif'; ctx.fillStyle = 'rgba(60,40,26,0.9)';
    ctx.fillText('N', MAP - 48, 46);
    ctx.beginPath(); ctx.moveTo(MAP - 48, 52); ctx.lineTo(MAP - 54, 80); ctx.lineTo(MAP - 48, 74); ctx.lineTo(MAP - 42, 80); ctx.closePath(); ctx.fill();
    ctx.font = 'italic 13px Georgia, serif';
    ctx.fillText('The Verdance · one league = 4.8 km', MAP / 2, MAP - 18);
  }

  private toMap(x: number, z: number) { return [((x + WORLD_HALF) / WORLD_SIZE) * MAP, ((z + WORLD_HALF) / WORLD_SIZE) * MAP]; }

  // ---------------------------------------------------------------- per frame
  update(x: number, z: number, yaw: number, extras: { horses?: { x: number; z: number }[] } = {}) {
    // Minimap: the land around you, turning so that ahead is always up.
    const c = this.miniCtx, S = this.mini.width, R = S / 2;
    const [mx, mz] = this.toMap(x, z);
    const zoom = 2.4; // map pixels -> minimap pixels (about 600 m across)
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.clip();
    c.translate(R, R);
    c.rotate(yaw);
    c.scale(zoom, zoom);
    c.drawImage(this.mapCanvas, -mx, -mz);
    if (extras.horses) {
      c.fillStyle = 'rgba(70,40,20,0.9)';
      for (const h of extras.horses) {
        const [hx, hz] = this.toMap(h.x, h.z);
        if (Math.abs(hx - mx) < 70 && Math.abs(hz - mz) < 70) { c.beginPath(); c.arc(hx - mx, hz - mz, 1.3, 0, Math.PI * 2); c.fill(); }
      }
    }
    c.restore();
    // You: an arrow, pointing up.
    c.fillStyle = '#7a2414'; c.strokeStyle = '#f3e7cf'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(R, R - 9); c.lineTo(R - 6, R + 7); c.lineTo(R, R + 3); c.lineTo(R + 6, R + 7); c.closePath(); c.fill(); c.stroke();
    // North marker on the rim.
    const na = yaw - Math.PI / 2;
    c.fillStyle = '#3a2416'; c.font = '600 13px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', R + Math.cos(na) * (R - 12), R + Math.sin(na) * (R - 12));

    if (this.mapOpen) this.drawBig(x, z, yaw, extras);

    // Discovery.
    for (const pl of PLACES) {
      if (!pl.r || this.discovered.has(pl.name)) continue;
      if (Math.hypot(x - pl.x, z - pl.z) < pl.r) {
        this.discovered.add(pl.name);
        try { localStorage.setItem('emberhold.discovered', JSON.stringify([...this.discovered])); } catch { /* ignore */ }
        this.onDiscover?.(pl.name, pl.sub ?? '');
      }
    }
  }
  onDiscover: ((name: string, sub: string) => void) | null = null;

  private drawBig(x: number, z: number, yaw: number, extras: { horses?: { x: number; z: number }[] }) {
    const cv = this.bigCtx.canvas;
    const size = Math.min(innerWidth, innerHeight) * 0.9;
    if (cv.width !== Math.round(size)) { cv.width = cv.height = Math.round(size); }
    const c = this.bigCtx, k = cv.width / MAP;
    c.drawImage(this.mapCanvas, 0, 0, cv.width, cv.height);
    if (extras.horses) {
      c.fillStyle = 'rgba(70,40,20,0.8)';
      for (const h of extras.horses) { const [hx, hz] = this.toMap(h.x, h.z); c.beginPath(); c.arc(hx * k, hz * k, 2, 0, Math.PI * 2); c.fill(); }
    }
    const [mx, mz] = this.toMap(x, z);
    c.save();
    c.translate(mx * k, mz * k);
    c.rotate(-yaw);
    c.fillStyle = '#8a1e10'; c.strokeStyle = '#f3e7cf'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -12); c.lineTo(-8, 9); c.lineTo(0, 4); c.lineTo(8, 9); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  toggleMap(open = !this.mapOpen) {
    this.mapOpen = open;
    $('mapview').classList.toggle('open', open);
  }

  // ---------------------------------------------------------------- panels
  objectives(title: string, goal: string, actions: string[]) {
    const el = $('todo');
    const html = `<div class="todo-title">${title}</div><div class="todo-goal">${goal}</div>` +
      (actions.length ? `<ul>${actions.map((a) => `<li>${a}</li>`).join('')}</ul>` : '');
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }

  /** A short message in the feed at the top right. */
  message(html: string, ms = 9000) {
    const m = document.createElement('div');
    m.className = 'msg';
    m.innerHTML = html;
    this.msgs.prepend(m);
    requestAnimationFrame(() => m.classList.add('show'));
    setTimeout(() => { m.classList.remove('show'); setTimeout(() => m.remove(), 900); }, ms);
    while (this.msgs.children.length > 5) this.msgs.lastElementChild!.remove();
  }

  /** A hint shown once (remembered across sessions). */
  tip(id: string, html: string) {
    if (this.seenTips.has(id)) return;
    this.seenTips.add(id);
    try { localStorage.setItem('emberhold.tips', JSON.stringify([...this.seenTips])); } catch { /* ignore */ }
    this.message(`<span class="tip">Hint</span> ${html}`, 12000);
  }
}
