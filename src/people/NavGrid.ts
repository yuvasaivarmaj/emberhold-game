// Where people can walk in Emberhold: a 1 m grid over the fort marking buildings, walls,
// towers and steep scarps as blocked, with A* paths that are then pulled straight.
import { EMBERHOLD as E } from '../world/Layout';
import type { Heightfield } from '../world/Heightfield';
import type { Collider } from '../world/Emberhold';
import type { Building } from '../world/Buildings';

const N = 1040;                 // cells per side (1 m)
const OX = E.x - N / 2, OZ = E.z - N / 2;
const MAX_STEP = 0.55;          // biggest height change between neighbouring cells

export class NavGrid {
  /** 0 = open, 1 = blocked. */
  readonly blocked = new Uint8Array(N * N);
  readonly height = new Float32Array(N * N);
  private g = new Float32Array(N * N);
  private from = new Int32Array(N * N);
  private stamp = new Uint32Array(N * N);
  private closed = new Uint32Array(N * N);
  private gen = 1;
  private heap = new Int32Array(N * N);
  private heapF = new Float32Array(N * N);

  constructor(private hf: Heightfield, colliders: Collider[], buildings: Building[]) {
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const wx = OX + x + 0.5, wz = OZ + z + 0.5;
      this.height[z * N + x] = hf.height(wx, wz);
      if (Math.hypot(wx - E.x, wz - E.z) > E.outerR + 30) this.blocked[z * N + x] = 1;
    }
    // Everything that isn't part of a house: walls, towers, gatehouses, courtyard walls, granaries...
    const own = new Uint8Array(colliders.length);
    for (const b of buildings) if (b.colRange) for (let i = b.colRange[0]; i < b.colRange[1]; i++) own[i] = 1;
    colliders.forEach((c, i) => { if (!own[i]) this.rasterCollider(c); });
    // Houses as solid blocks (people go in and out by the door, not through the grid).
    for (const b of buildings) this.rasterRect(b.x, b.z, b.rot, b.W / 2 + 0.45, b.D / 2 + 0.45);
    // Steep ground: block cells whose neighbours differ by too much (terrace scarps, glacis).
    const h = this.height;
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
      const k = z * N + x;
      if (this.blocked[k]) continue;
      const h0 = h[k];
      if (Math.abs(h[k + 1] - h0) > MAX_STEP || Math.abs(h[k - 1] - h0) > MAX_STEP || Math.abs(h[k + N] - h0) > MAX_STEP || Math.abs(h[k - N] - h0) > MAX_STEP) this.blocked[k] = 2;
    }
  }

  private rasterCollider(c: Collider) {
    if (c.kind === 'box') {
      // Only things that stand in a person's way (not slabs underfoot or roofs overhead).
      const r = Math.hypot(c.hx, c.hz) + 0.5;
      const cs = Math.cos(c.rotY), sn = Math.sin(c.rotY);
      for (let x = Math.floor(c.x - r - OX); x <= c.x + r - OX; x++) for (let z = Math.floor(c.z - r - OZ); z <= c.z + r - OZ; z++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const dx = OX + x + 0.5 - c.x, dz = OZ + z + 0.5 - c.z;
        const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
        if (Math.abs(u) > c.hx + 0.4 || Math.abs(v) > c.hz + 0.4) continue;
        const gy = this.height[z * N + x];
        if (c.y - c.hy < gy + 1.7 && c.y + c.hy > gy + 0.4) this.blocked[z * N + x] = 1;
      }
    } else {
      for (let x = Math.floor(c.x - c.r - 1 - OX); x <= c.x + c.r + 1 - OX; x++) for (let z = Math.floor(c.z - c.r - 1 - OZ); z <= c.z + c.r + 1 - OZ; z++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        if (Math.hypot(OX + x + 0.5 - c.x, OZ + z + 0.5 - c.z) > c.r + 0.4) continue;
        const gy = this.height[z * N + x];
        if (c.y - c.hh < gy + 1.7 && c.y + c.hh > gy + 0.4) this.blocked[z * N + x] = 1;
      }
    }
  }

  private rasterRect(cx: number, cz: number, rot: number, hw: number, hd: number) {
    const r = Math.hypot(hw, hd) + 1;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (let x = Math.floor(cx - r - OX); x <= cx + r - OX; x++) for (let z = Math.floor(cz - r - OZ); z <= cz + r - OZ; z++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const dx = OX + x + 0.5 - cx, dz = OZ + z + 0.5 - cz;
      const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
      if (Math.abs(u) <= hw && Math.abs(v) <= hd) this.blocked[z * N + x] = 1;
    }
  }

  cell(x: number, z: number) {
    const cx = Math.floor(x - OX), cz = Math.floor(z - OZ);
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return -1;
    return cz * N + cx;
  }
  open(x: number, z: number) { const k = this.cell(x, z); return k >= 0 && !this.blocked[k]; }
  inside(x: number, z: number) { return this.cell(x, z) >= 0; }

  /** The nearest open cell to a point (spiralling out up to r cells). */
  nearestOpen(x: number, z: number, r = 6): [number, number] | null {
    const k0 = this.cell(x, z);
    if (k0 < 0) return null;
    if (!this.blocked[k0]) return [x, z];
    const cx = k0 % N, cz = Math.floor(k0 / N);
    let best: [number, number] | null = null, bd = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x1 = cx + dx, z1 = cz + dz;
      if (x1 < 0 || z1 < 0 || x1 >= N || z1 >= N || this.blocked[z1 * N + x1]) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = [OX + x1 + 0.5, OZ + z1 + 0.5]; }
    }
    return best;
  }

  /** Can you walk straight from a to b (every cell on the line open)? */
  clearLine(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.45);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const k = this.cell(ax + (bx - ax) * t, az + (bz - az) * t);
      if (k < 0 || this.blocked[k]) return false;
      // Also refuse lines that would drop down a scarp between samples.
      if (i > 1) {
        const k2 = this.cell(ax + (bx - ax) * (i - 1) / n, az + (bz - az) * (i - 1) / n);
        if (k2 >= 0 && Math.abs(this.height[k] - this.height[k2]) > MAX_STEP + 0.2) return false;
      }
    }
    return true;
  }

  /**
   * A* from a to b, run a slice at a time so a long search never stalls a frame.
   * begin() starts a search; step() expands up to `budget` cells and returns 'run' until
   * the search is finished ('done', with `result` set to the pulled-straight waypoints)
   * or gives up ('fail').
   */
  private srch: { s: number; t: number; tx: number; tz: number; bx: number; bz: number; gen: number; hn: number; expanded: number } | null = null;
  result: [number, number][] | null = null;

  begin(ax: number, az: number, bx: number, bz: number): boolean {
    this.result = null;
    const a0 = this.nearestOpen(ax, az), b0 = this.nearestOpen(bx, bz);
    if (!a0 || !b0) { this.srch = null; return false; }
    const s = this.cell(a0[0], a0[1]), t = this.cell(b0[0], b0[1]);
    if (s === t) { this.result = [[bx, bz]]; this.srch = null; return false; }
    const gen = ++this.gen;
    this.srch = { s, t, tx: t % N, tz: Math.floor(t / N), bx, bz, gen, hn: 0, expanded: 0 };
    this.g[s] = 0; this.stamp[s] = gen; this.from[s] = -1;
    this.push(s, this.hcost(s));
    return true;
  }

  private hcost(k: number) {
    const S = this.srch!;
    const dx = Math.abs(k % N - S.tx), dz = Math.abs(Math.floor(k / N) - S.tz);
    return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * 1.6;
  }
  private push(k: number, f: number) {
    const S = this.srch!;
    let i = S.hn++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.heapF[p] <= f) break; this.heap[i] = this.heap[p]; this.heapF[i] = this.heapF[p]; i = p; }
    this.heap[i] = k; this.heapF[i] = f;
  }
  private pop() {
    const S = this.srch!;
    const top = this.heap[0];
    const k = this.heap[--S.hn], f = this.heapF[S.hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= S.hn) break;
      if (c + 1 < S.hn && this.heapF[c + 1] < this.heapF[c]) c++;
      if (this.heapF[c] >= f) break;
      this.heap[i] = this.heap[c]; this.heapF[i] = this.heapF[c]; i = c;
    }
    this.heap[i] = k; this.heapF[i] = f;
    return top;
  }

  step(budget = 4000): 'run' | 'done' | 'fail' {
    const S = this.srch;
    if (!S) return this.result ? 'done' : 'fail';
    const dirs = [1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1];
    let n = 0;
    while (S.hn > 0 && n < budget) {
      const k = this.pop();
      if (this.closed[k] === S.gen) continue;
      this.closed[k] = S.gen;
      n++;
      if (k === S.t) { this.finish(); return 'done'; }
      if (++S.expanded > 90000) { this.srch = null; return 'fail'; }
      const kx = k % N;
      for (let di = 0; di < 8; di++) {
        const nk = k + dirs[di];
        const nx = nk % N;
        if (nk < 0 || nk >= N * N || Math.abs(nx - kx) > 1 || this.blocked[nk] || this.closed[nk] === S.gen) continue;
        if (Math.abs(this.height[nk] - this.height[k]) > MAX_STEP) continue;
        if (di >= 4 && (this.blocked[k + (nx - kx)] || this.blocked[k + (dirs[di] - (nx - kx))])) continue;
        const ng = this.g[k] + (di >= 4 ? Math.SQRT2 : 1);
        if (this.stamp[nk] === S.gen && ng >= this.g[nk]) continue;
        this.stamp[nk] = S.gen; this.g[nk] = ng; this.from[nk] = k;
        this.push(nk, ng + this.hcost(nk));
      }
    }
    if (S.hn === 0) { this.srch = null; return 'fail'; }
    return 'run';
  }

  private finish() {
    const S = this.srch!;
    const cells: [number, number][] = [];
    for (let k = S.t; k !== -1; k = this.from[k]) cells.push([OX + (k % N) + 0.5, OZ + Math.floor(k / N) + 0.5]);
    cells.reverse();
    const out: [number, number][] = [];
    let i = 0;
    while (i < cells.length - 1) {
      let j = i + 1;
      const lim = Math.min(cells.length - 1, i + 90);
      while (j + 1 <= lim && this.clearLine(cells[i][0], cells[i][1], cells[j + 1][0], cells[j + 1][1])) j++;
      out.push(cells[j]);
      i = j;
    }
    out[out.length - 1] = [S.bx, S.bz];
    this.result = out;
    this.srch = null;
  }

  /** A whole search at once (for tests and short hops). */
  path(ax: number, az: number, bx: number, bz: number): [number, number][] | null {
    if (!this.begin(ax, az, bx, bz)) return this.result;
    let st: 'run' | 'done' | 'fail' = 'run';
    while (st === 'run') st = this.step(100000);
    return st === 'done' ? this.result : null;
  }
}
