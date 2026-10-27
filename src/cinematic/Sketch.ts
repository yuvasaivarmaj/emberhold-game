// Ink-and-wash drawing for the opening film: paper, sketchy pen lines, hatching and
// watercolour washes, and the things the story needs drawn (towers, ships, people,
// fire-hounds, mountains, a world seen from the dark).
export type Pt = [number, number];

export const W = 1600, H = 900;

export const C = {
  ink: '#2a1c13', sepia: '#6a4a33', ember: '#d8642a', red: '#9e2f1c', gold: '#d6a443',
  night: '#141a2a', blue: '#3c587a', earth: '#4d7ea6', green: '#62743f', paper: '#e9dcc1', smoke: '#5b524a',
};

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let paperCache: HTMLCanvasElement | null = null;
/** Warm laid paper with fibres, specks, foxing and darkened edges. */
export function paper(): HTMLCanvasElement {
  if (paperCache) return paperCache;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const r = mulberry(7);
  c.fillStyle = C.paper; c.fillRect(0, 0, W, H);
  const img = c.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.9;
  }
  c.putImageData(img, 0, 0);
  // Fibres.
  c.strokeStyle = 'rgba(120,96,70,0.08)'; c.lineWidth = 0.7;
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y = r() * H, a = r() * Math.PI, l = 4 + r() * 16;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + r() * 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  // Foxing stains.
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = r() * H, rad = 10 + r() * 60;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(150,110,60,0.08)'); g.addColorStop(1, 'rgba(150,110,60,0)');
    c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, 'rgba(90,60,30,0)'); v.addColorStop(1, 'rgba(90,60,30,0.38)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
  paperCache = cv;
  return cv;
}

export class Ink {
  r: () => number;
  constructor(public c: CanvasRenderingContext2D, seed = 1) { this.r = mulberry(seed); }
  rnd(a = 0, b = 1) { return a + (b - a) * this.r(); }

  /** A pen line: a few slightly different passes, wobbling like a hand. */
  line(pts: Pt[], w = 2, color: string = C.ink, alpha = 0.85, jit = 1.2, passes = 2) {
    const c = this.c;
    c.save();
    c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let p = 0; p < passes; p++) {
      c.globalAlpha = alpha * (p === 0 ? 1 : 0.45);
      c.lineWidth = w * (p === 0 ? 1 : 0.6);
      c.beginPath();
      pts.forEach(([x, y], i) => {
        const jx = (this.r() - 0.5) * jit, jy = (this.r() - 0.5) * jit;
        if (i === 0) c.moveTo(x + jx, y + jy); else c.lineTo(x + jx, y + jy);
      });
      c.stroke();
    }
    c.restore();
  }

  /** A closed shape, filled and/or outlined. */
  shape(pts: Pt[], fill?: string, stroke: string | null = C.ink, w = 2, fillAlpha = 1) {
    const c = this.c;
    if (fill) {
      c.save(); c.globalAlpha = fillAlpha; c.fillStyle = fill;
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
      c.restore();
    }
    if (stroke) this.line([...pts, pts[0]], w, stroke);
  }

  /** Parallel strokes clipped to a shape: the shading of an engraving. */
  hatch(pts: Pt[], angle = 0.8, gap = 6, w = 1, alpha = 0.5, color: string = C.ink) {
    const c = this.c;
    c.save();
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.clip();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 4;
    const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
    c.strokeStyle = color; c.lineWidth = w; c.globalAlpha = alpha; c.lineCap = 'round';
    for (let s = -R; s < R; s += gap * (0.8 + this.r() * 0.4)) {
      const ox = cx + nx * s, oy = cy + ny * s;
      c.beginPath();
      c.moveTo(ox - dx * R + (this.r() - 0.5) * 2, oy - dy * R);
      c.lineTo(ox + dx * R, oy + dy * R + (this.r() - 0.5) * 2);
      c.stroke();
    }
    c.restore();
  }

  /** A watercolour wash: soft, uneven blooms of pigment. */
  wash(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 0.35, blooms = 7, mode: GlobalCompositeOperation = 'multiply') {
    const c = this.c;
    c.save();
    c.globalCompositeOperation = mode;
    for (let i = 0; i < blooms; i++) {
      const x = cx + (this.r() - 0.5) * rx * 0.8, y = cy + (this.r() - 0.5) * ry * 0.8;
      const rad = Math.max(rx, ry) * (0.35 + this.r() * 0.5);
      const g = c.createRadialGradient(x, y, rad * 0.1, x, y, rad);
      g.addColorStop(0, hexA(color, alpha * 0.7));
      g.addColorStop(0.75, hexA(color, alpha * 0.45));
      g.addColorStop(1, hexA(color, 0));
      c.fillStyle = g;
      c.save(); c.translate(x, y); c.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); c.translate(-x, -y);
      c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    c.restore();
  }

  /** A flat wash over the whole sheet (for night skies and fire). */
  fill(color: string, alpha: number, mode: GlobalCompositeOperation = 'multiply') {
    const c = this.c;
    c.save(); c.globalCompositeOperation = mode; c.globalAlpha = alpha; c.fillStyle = color; c.fillRect(0, 0, W, H); c.restore();
  }

  gradient(stops: [number, string][], y0 = 0, y1 = H, mode: GlobalCompositeOperation = 'multiply', alpha = 1) {
    const c = this.c;
    const g = c.createLinearGradient(0, y0, 0, y1);
    for (const [o, col] of stops) g.addColorStop(o, col);
    c.save(); c.globalCompositeOperation = mode; c.globalAlpha = alpha; c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
  }

  stars(n: number, y1 = H, bright = 1) {
    const c = this.c;
    c.save();
    for (let i = 0; i < n; i++) {
      const x = this.r() * W, y = this.r() * y1, s = this.r() ** 3 * 2.2 + 0.4;
      c.globalAlpha = (0.35 + this.r() * 0.65) * bright;
      c.fillStyle = this.r() < 0.1 ? '#f3d9b0' : '#efe8da';
      c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** A ridge line from left to right with noise, filled down to the bottom. */
  ridge(y: number, amp: number, freq: number, fill: string, stroke: string | null = C.ink, seedOff = 0, jag = 0.5): Pt[] {
    const pts: Pt[] = [];
    for (let x = -20; x <= W + 20; x += 12) {
      const n = Math.sin(x * freq + seedOff) * 0.6 + Math.sin(x * freq * 2.3 + seedOff * 1.7) * 0.3 + Math.sin(x * freq * 5.1 + seedOff * 3.1) * 0.15 * jag;
      pts.push([x, y - Math.abs(n) * amp - n * amp * 0.3]);
    }
    const poly: Pt[] = [...pts, [W + 20, H + 20], [-20, H + 20]];
    this.shape(poly, fill, null);
    if (stroke) this.line(pts, 1.8, stroke, 0.8);
    return pts;
  }

  /** A person in a cloak, seen at a distance: head, shoulders, a falling cloak. */
  figure(x: number, y: number, h: number, color: string = C.ink, sway = 0, facing = 1) {
    const c = this.c;
    const hw = h * 0.16;
    c.save();
    c.fillStyle = color;
    c.beginPath();
    c.arc(x + sway * 0.2, y - h * 0.9, h * 0.075, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(x - hw * 0.55 + sway * 0.1, y - h * 0.8);
    c.quadraticCurveTo(x - hw * 1.1, y - h * 0.45, x - hw * 1.25 + sway, y);
    c.lineTo(x + hw * 1.15 + sway * 1.2 * facing, y);
    c.quadraticCurveTo(x + hw * 1.05, y - h * 0.45, x + hw * 0.55 + sway * 0.1, y - h * 0.8);
    c.closePath();
    c.fill();
    c.restore();
  }

  /** A tall Aethryn tower: tapering shaft, galleries, a spire, lit windows. */
  tower(x: number, base: number, w: number, h: number, lit = 0.6, color: string = C.ink) {
    const top = base - h;
    const shaft: Pt[] = [[x - w / 2, base], [x - w * 0.36, top + h * 0.12], [x + w * 0.36, top + h * 0.12], [x + w / 2, base]];
    this.shape(shaft, '#3a2a20', color, 1.4, 0.85);
    this.hatch(shaft, 1.35, 4, 0.8, 0.35);
    // Galleries.
    for (let k = 1; k < 4; k++) {
      const yy = base - h * (k * 0.22);
      const ww = w * (0.55 - k * 0.04);
      this.line([[x - ww * 0.75, yy], [x + ww * 0.75, yy]], 1.6, color);
    }
    // Spire.
    this.shape([[x - w * 0.36, top + h * 0.12], [x, top - h * 0.12], [x + w * 0.36, top + h * 0.12]], '#2a1c13', color, 1.4);
    // Windows.
    const c = this.c;
    c.save();
    for (let k = 0; k < Math.floor(h / 28); k++) {
      if (this.r() > lit) continue;
      c.fillStyle = this.r() < 0.5 ? '#f2b860' : '#e98a3c';
      c.globalAlpha = 0.85;
      c.fillRect(x - 2 + (this.r() - 0.5) * w * 0.3, base - 20 - k * 26, 3, 6);
    }
    c.restore();
  }

  /** A ship of Aethryn: a long pointed hull with ribs, fins and a drive at the stern. */
  ship(x: number, y: number, len: number, angle: number, glow = 1, broken = 0) {
    const c = this.c;
    c.save();
    c.translate(x, y); c.rotate(angle);
    const L = len, Hh = len * 0.13;
    const hull: Pt[] = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; hull.push([-L / 2 + t * L, -Hh * Math.sin(Math.PI * Math.pow(t, 0.7)) * (t > 0.92 ? 0.6 : 1)]); }
    for (let i = 16; i >= 0; i--) { const t = i / 16; hull.push([-L / 2 + t * L, Hh * 0.8 * Math.sin(Math.PI * Math.pow(t, 0.7))]); }
    this.shape(hull, '#33261d', C.ink, Math.max(1, len / 120));
    this.hatch(hull, 0.2, Math.max(3, len / 40), 0.8, 0.35);
    for (let k = 1; k < 5; k++) { const xx = -L / 2 + L * k * 0.18; this.line([[xx, -Hh * 0.9], [xx, Hh * 0.7]], Math.max(0.8, len / 200), C.ink, 0.7); }
    // Fins at the stern.
    this.shape([[-L * 0.38, -Hh * 0.6], [-L * 0.52, -Hh * 1.7], [-L * 0.46, -Hh * 0.4]], '#2a1c13', C.ink, 1);
    this.shape([[-L * 0.38, Hh * 0.5], [-L * 0.52, Hh * 1.5], [-L * 0.46, Hh * 0.3]], '#2a1c13', C.ink, 1);
    if (broken > 0) {
      // A crack through the hull.
      this.line([[L * 0.05, -Hh], [L * 0.1, -Hh * 0.2], [L * 0.02, Hh * 0.3], [L * 0.08, Hh * 0.8]], Math.max(1, len / 100), '#d8642a', 0.9 * broken);
    }
    if (glow > 0) {
      const g = c.createRadialGradient(-L / 2, 0, 0, -L / 2, 0, len * 0.35);
      g.addColorStop(0, `rgba(255,190,120,${0.9 * glow})`); g.addColorStop(0.3, `rgba(230,110,40,${0.5 * glow})`); g.addColorStop(1, 'rgba(230,110,40,0)');
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = g; c.beginPath(); c.arc(-L / 2, 0, len * 0.35, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /**
   * A fire-hound of Aethryn: lean, low and lizard-like, kept like a dog. `wings` (0..1)
   * grows the membranes it would gain on the new world; `size` scales it.
   */
  beast(x: number, y: number, s: number, facing = 1, wings = 0, color: string = C.ink) {
    const c = this.c;
    c.save();
    c.translate(x, y); c.scale(s * facing, s);
    c.fillStyle = color; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
    if (wings > 0) {
      // Bat-like wings: an arm to the wrist, long finger bones, and a membrane scalloped
      // between them, opening up and back from the shoulders.
      for (const side of [0.82, 1]) {
        c.save();
        c.globalAlpha = side === 1 ? 0.95 : 0.55;
        const sh: Pt = [-2, -32];
        const wrist: Pt = [-30 * wings * side, -32 - 70 * wings * side];
        const tips: Pt[] = [
          [-150 * wings * side, -150 * wings * side],
          [-175 * wings * side, -80 * wings * side],
          [-150 * wings * side, -20 * wings * side],
          [-95 * wings * side, 6],
        ];
        c.beginPath();
        c.moveTo(sh[0], sh[1]);
        c.lineTo(wrist[0], wrist[1]);
        c.lineTo(tips[0][0], tips[0][1]);
        let prev = tips[0];
        for (let k = 1; k < tips.length; k++) {
          const t2 = tips[k];
          const mx = (prev[0] + t2[0]) / 2 - (wrist[0] - (prev[0] + t2[0]) / 2) * -0.25;
          const my = (prev[1] + t2[1]) / 2 - (wrist[1] - (prev[1] + t2[1]) / 2) * -0.25;
          c.quadraticCurveTo(mx, my, t2[0], t2[1]);
          prev = t2;
        }
        c.quadraticCurveTo(-55 * wings, -12, -30, -22);
        c.closePath();
        c.fill();
        // Finger bones.
        c.strokeStyle = color; c.lineWidth = 3 / Math.max(1, s * 0.5);
        for (const tp of tips) { c.beginPath(); c.moveTo(wrist[0], wrist[1]); c.lineTo(tp[0], tp[1]); c.stroke(); }
        c.restore();
      }
    }
    // Body.
    c.beginPath(); c.ellipse(0, -22, 34, 13, -0.05, 0, Math.PI * 2); c.fill();
    // Neck and head.
    c.beginPath();
    c.moveTo(26, -30); c.quadraticCurveTo(42, -50, 52, -56); c.lineTo(58, -50); c.quadraticCurveTo(46, -38, 32, -20); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(50, -60); c.lineTo(78, -54); c.lineTo(74, -48); c.lineTo(52, -46); c.closePath(); c.fill(); // snout
    c.beginPath(); c.moveTo(52, -60); c.lineTo(46, -72); c.lineTo(56, -60); c.fill(); // horn
    c.beginPath(); c.moveTo(48, -56); c.lineTo(38, -64); c.lineTo(46, -52); c.fill(); // frill
    // Legs.
    c.lineWidth = 6;
    for (const [lx, d] of [[-22, 1], [-14, -1], [18, 1], [26, -1]] as [number, number][]) {
      c.beginPath(); c.moveTo(lx, -16); c.lineTo(lx + d * 6, -6); c.lineTo(lx + d * 2, 4); c.stroke();
    }
    // Tail.
    c.lineWidth = 7;
    c.beginPath(); c.moveTo(-32, -22); c.quadraticCurveTo(-62, -14, -78, -32); c.stroke();
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(-78, -32); c.quadraticCurveTo(-88, -40, -84, -48); c.stroke();
    // Spines along the back.
    for (let k = 0; k < 6; k++) { const xx = -24 + k * 9; c.beginPath(); c.moveTo(xx - 3, -33); c.lineTo(xx, -41); c.lineTo(xx + 3, -33); c.fill(); }
    c.restore();
  }

  /** Flame from a point in a direction; t animates the flicker. */
  flame(x: number, y: number, len: number, angle: number, t: number, alpha = 1) {
    const c = this.c;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const k = i / 14;
      const a = angle + Math.sin(t * 9 + i * 1.7) * 0.12 * k;
      const px = x + Math.cos(a) * len * k, py = y + Math.sin(a) * len * k - k * k * len * 0.15;
      const rad = 4 + k * len * 0.22 + Math.sin(t * 13 + i) * 2;
      const g = c.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(255,${Math.round(220 - k * 120)},${Math.round(150 - k * 120)},${0.55 * alpha * (1 - k * 0.6)})`);
      g.addColorStop(1, 'rgba(220,80,20,0)');
      c.fillStyle = g; c.beginPath(); c.arc(px, py, rad, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** Embers or sparks drifting up through the picture. */
  embers(t: number, n: number, x0: number, x1: number, y0: number, y1: number, speed = 60, color = '255,170,90') {
    const c = this.c;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const r1 = frac(Math.sin(i * 12.9898) * 43758.5453), r2 = frac(Math.sin(i * 78.233) * 12345.678);
      const life = (y1 - y0) / speed;
      const age = frac(t / life + r2);
      const x = x0 + r1 * (x1 - x0) + Math.sin(t * 1.3 + i) * 12;
      const y = y1 - age * (y1 - y0);
      c.globalAlpha = Math.sin(age * Math.PI) * 0.9;
      c.fillStyle = `rgb(${color})`;
      c.beginPath(); c.arc(x, y, 1.2 + r2 * 1.8, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** Billowing smoke column, animated. */
  smoke(x: number, y: number, h: number, t: number, color = '60,52,46', alpha = 0.35, drift = 40) {
    const c = this.c;
    c.save();
    for (let i = 0; i < 18; i++) {
      const k = frac(i / 18 + t * 0.04);
      const px = x + Math.sin(i * 2.1 + t * 0.4) * 10 + k * k * drift;
      const py = y - k * h;
      const rad = 10 + k * h * 0.22;
      const g = c.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(${color},${alpha * (1 - k)})`); g.addColorStop(1, `rgba(${color},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(px, py, rad, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}

export const frac = (x: number) => x - Math.floor(x);

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
