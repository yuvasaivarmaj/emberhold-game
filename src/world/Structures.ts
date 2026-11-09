// Works of the land outside the walls: stone bridges where the roads cross the rivers,
// and the ancient watchstones along the south road.
import * as THREE from 'three/webgpu';
import { Builder, type Bucket, type Collider } from './Emberhold';
import { Heightfield } from './Heightfield';
import { ROADS, WATCHSTONES, smoothPath, distToPath } from './Layout';
import { mulberry32 } from './Noise';

interface BridgeMeta { x: number; z: number; dirX: number; dirZ: number; deck: number; length: number; road: string; deckA?: number; deckB?: number; hump?: number }

export class Structures {
  readonly group: THREE.Group;
  readonly colliders: Collider[];

  constructor(hf: Heightfield, materials: Record<Bucket, THREE.Material>) {
    const b = new Builder();
    const rand = mulberry32(77);
    for (const br of (hf.meta.bridges ?? []) as BridgeMeta[]) this.bridge(b, hf, br);
    // The outer watchstones: tall grey stones beside the road, older than the house.
    const south = smoothPath(ROADS[0].pts, 4);
    for (const [wx, wz] of WATCHSTONES) {
      // Step off the road to its east verge.
      let x = wx, z = wz;
      for (let k = 0; k < 20 && distToPath(x, z, south) < 6.5; k++) x += 0.6;
      const y = hf.height(x, z) - 0.6;
      const g = new THREE.CylinderGeometry(0.45, 0.75, 4.6, 5, 4);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const py = pos.getY(i);
        pos.setX(i, pos.getX(i) * (1 + (rand() - 0.5) * 0.12));
        pos.setZ(i, pos.getZ(i) * 0.7 * (1 + (rand() - 0.5) * 0.12));
        if (py > 2.2) pos.setY(i, py - Math.abs(pos.getX(i)) * 0.4);
      }
      g.computeVertexNormals();
      g.rotateZ((rand() - 0.5) * 0.08);
      g.rotateY(rand() * Math.PI);
      g.translate(x, y + 2.3, z);
      b.add('monolith', g);
      b.colliders.push({ kind: 'cyl', x, y: y + 2.3, z, r: 0.6, hh: 2.3 });
      // A ring of small stones at its foot.
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + rand();
        const s = new THREE.DodecahedronGeometry(0.25 + rand() * 0.2, 0);
        s.translate(x + Math.cos(a) * 1.4, hf.height(x + Math.cos(a) * 1.4, z + Math.sin(a) * 1.4) + 0.05, z + Math.sin(a) * 1.4);
        b.add('monolith', s);
      }
    }
    this.group = b.merge(materials);
    this.group.name = 'Structures';
    this.colliders = b.colliders;
  }

  /**
   * A stone road bridge: a humped deck on segmental arches, the arch rings in darker
   * voussoirs, piers with cutwaters up and down stream, parapets that follow the hump with a
   * coping and end posts, and wing walls splaying back into each bank.
   */
  private bridge(b: Builder, hf: Heightfield, br: BridgeMeta) {
    const road = ROADS.find((r) => r.name === br.road);
    const width = (road?.width ?? 5) + 1.8;
    const L = br.length + 4;
    const hA = br.deckA ?? br.deck, hB = br.deckB ?? br.deck, hump = br.hump ?? 0;
    // Deck height along the bridge, u from -L/2 (the A end) to +L/2.
    const deckAt = (u: number) => {
      const t = Math.min(1, Math.max(0, (u + L / 2) / L));
      return hA + (hB - hA) * t + hump * Math.sin(Math.PI * t) + 0.08;
    };
    const rot = -Math.atan2(br.dirZ, br.dirX);
    const P = (u: number, v: number): [number, number] => [br.x + br.dirX * u - br.dirZ * v, br.z + br.dirZ * u + br.dirX * v];
    let bed = Infinity;
    for (let u = -L / 2; u <= L / 2; u += 2) bed = Math.min(bed, hf.height(...P(u, 0)));
    const foot = bed - 3;
    // Spans: about 13 m each, piers 2.6 m thick.
    const spans = Math.max(2, Math.round(L / 13));
    const pier = 2.6;
    const SEG = 48;
    // Side elevation as one outline: along the bottom from end to end, rising into each arch
    // between the piers, then back along the deck line on top.
    const outline: THREE.Vector2[] = [new THREE.Vector2(-L / 2, foot)];
    const rings: THREE.Shape[] = [];
    for (let i = 0; i < spans; i++) {
      const u0 = -L / 2 + (L * i) / spans + (i === 0 ? 3.2 : pier / 2), u1 = -L / 2 + (L * (i + 1)) / spans - (i === spans - 1 ? 3.2 : pier / 2);
      const a = (u1 - u0) / 2, c = (u0 + u1) / 2;
      const crown = Math.min(deckAt(u0), deckAt(u1), deckAt(c)) - 1.15;
      const rise = Math.min(a * 0.75, Math.max(1.6, crown - (bed - 0.5)));
      const spring = crown - rise;
      // A segmental arch: part of a circle through both springings and the crown.
      const R = (a * a + rise * rise) / (2 * rise), cy = crown - R, half = Math.asin(Math.min(1, a / R));
      outline.push(new THREE.Vector2(u0, foot), new THREE.Vector2(u0, spring));
      const inner: THREE.Vector2[] = [], outer: THREE.Vector2[] = [];
      for (let k = 0; k <= 20; k++) {
        const ang = -half + (2 * half * k) / 20;
        inner.push(new THREE.Vector2(c + Math.sin(ang) * R, cy + Math.cos(ang) * R));
        outer.push(new THREE.Vector2(c + Math.sin(ang) * (R + 0.55), cy + Math.cos(ang) * (R + 0.55)));
      }
      outline.push(...inner);
      outline.push(new THREE.Vector2(u1, spring), new THREE.Vector2(u1, foot));
      // The voussoir ring: a band 0.55 m deep round the arch, standing a little proud.
      const ring = new THREE.Shape();
      ring.setFromPoints([...outer, ...inner.slice().reverse()]);
      rings.push(ring);
      // Cutwaters on the piers between spans, both faces.
      if (i > 0) {
        const pu = -L / 2 + (L * i) / spans;
        for (const side of [-1, 1]) {
          const cw = new THREE.Shape([new THREE.Vector2(-pier / 2, 0), new THREE.Vector2(pier / 2, 0), new THREE.Vector2(0, 1.9)]);
          const g = new THREE.ExtrudeGeometry(cw, { depth: spring - foot + 0.4, bevelEnabled: false });
          g.rotateX(-Math.PI / 2);
          if (side < 0) g.rotateY(Math.PI);
          g.translate(0, foot, side * width / 2);
          this.place(b, g, br, pu, rot);
          const capg = new THREE.ConeGeometry(1.4, 1.2, 3);
          capg.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
          capg.translate(0, spring + 0.9, side * (width / 2 + 0.55));
          this.place(b, capg, br, pu, rot);
        }
      }
    }
    outline.push(new THREE.Vector2(L / 2, foot));
    for (let i = SEG; i >= 0; i--) { const u = -L / 2 + (L * i) / SEG; outline.push(new THREE.Vector2(u, deckAt(u) - 0.02)); }
    const shape = new THREE.Shape(outline);
    const body = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
    body.translate(0, 0, -width / 2);
    this.place(b, body, br, 0, rot);
    for (const ring of rings) {
      for (const side of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(ring, { depth: 0.12, bevelEnabled: false });
        g.translate(0, 0, side > 0 ? width / 2 - 0.02 : -width / 2 - 0.1);
        this.place(b, g, br, 0, rot, 'monolith');
      }
    }
    // Parapets following the deck, with a coping, and end posts.
    for (const side of [-1, 1]) {
      const par = new THREE.Shape();
      par.moveTo(-L / 2, deckAt(-L / 2) - 0.3);
      for (let i = 0; i <= SEG; i++) { const u = -L / 2 + (L * i) / SEG; par.lineTo(u, deckAt(u) + 0.95); }
      for (let i = SEG; i >= 0; i--) { const u = -L / 2 + (L * i) / SEG; par.lineTo(u, deckAt(u) - 0.3); }
      const pg = new THREE.ExtrudeGeometry(par, { depth: 0.45, bevelEnabled: false });
      pg.translate(0, 0, side > 0 ? width / 2 - 0.45 : -width / 2);
      this.place(b, pg, br, 0, rot);
      const cop = new THREE.Shape();
      cop.moveTo(-L / 2, deckAt(-L / 2) + 0.95);
      for (let i = 0; i <= SEG; i++) { const u = -L / 2 + (L * i) / SEG; cop.lineTo(u, deckAt(u) + 1.1); }
      for (let i = SEG; i >= 0; i--) { const u = -L / 2 + (L * i) / SEG; cop.lineTo(u, deckAt(u) + 0.95); }
      const cg = new THREE.ExtrudeGeometry(cop, { depth: 0.6, bevelEnabled: false });
      cg.translate(0, 0, side > 0 ? width / 2 - 0.52 : -width / 2 - 0.08);
      this.place(b, cg, br, 0, rot, 'monolith');
      for (const e of [-1, 1]) {
        const u = e * (L / 2 - 0.35);
        const [px, pz] = P(u, side * (width / 2 - 0.22));
        const y = deckAt(u) - 0.3;
        b.box('stone', 0.75, 1.75, 0.75, px, y, pz, rot, false);
        b.box('monolith', 0.9, 0.18, 0.9, px, y + 1.75, pz, rot, false);
        b.pyramid('monolith', 0.8, 0.35, px, y + 1.93, pz, rot);
        // Wing walls splaying back into the bank.
        const [wx, wz] = P(e * (L / 2 + 2.2), side * (width / 2 + 1.2));
        const wy = hf.height(wx, wz);
        b.box('stone', 4.6, Math.max(1.2, deckAt(u) - wy + 0.9), 0.6, wx, wy - 0.8, wz, rot + e * side * 0.55);
      }
    }
    // Walking surface and parapet colliders, segment by segment along the hump.
    const segs = Math.max(6, Math.round(L / 4));
    const yaw = Math.atan2(br.dirX, br.dirZ);
    for (let i = 0; i < segs; i++) {
      const u0 = -L / 2 + (L * i) / segs, u1 = -L / 2 + (L * (i + 1)) / segs, um = (u0 + u1) / 2;
      const y0 = deckAt(u0), y1 = deckAt(u1);
      const pitch = Math.atan2(y1 - y0, u1 - u0);
      const len = Math.hypot(u1 - u0, y1 - y0) + 0.05;
      const [cx, cz] = P(um, 0);
      b.colliders.push({ kind: 'box', x: cx, y: (y0 + y1) / 2 - 0.25, z: cz, hx: width / 2, hy: 0.25, hz: len / 2, rotY: yaw, rotX: -pitch });
      for (const side of [-1, 1]) {
        const [qx, qz] = P(um, side * (width / 2 - 0.22));
        b.colliders.push({ kind: 'box', x: qx, y: (y0 + y1) / 2 + 0.5, z: qz, hx: 0.22, hy: 0.6, hz: len / 2, rotY: yaw, rotX: -pitch });
      }
    }
    // The piers stand in the stream.
    // Each pier stops well under its own stretch of deck (the deck falls toward the low bank).
    for (let i = 1; i < spans; i++) {
      const pu = -L / 2 + (L * i) / spans;
      const [px, pz] = P(pu, 0);
      const top = Math.min(deckAt(pu - pier / 2), deckAt(pu + pier / 2)) - 1.4;
      if (top <= foot + 0.5) continue;
      b.colliders.push({ kind: 'box', x: px, y: (foot + top) / 2, z: pz, hx: width / 2 + 1, hy: (top - foot) / 2, hz: pier / 2, rotY: yaw });
    }
  }

  /** Put a shape built in the bridge's side-elevation frame (x along, y up, z across) into the world. */
  private place(b: Builder, g: THREE.BufferGeometry, br: BridgeMeta, u: number, rot: number, bucket: Bucket = 'stone') {
    g.translate(u, 0, 0);
    g.rotateY(rot);
    g.translate(br.x, 0, br.z);
    b.add(bucket, g);
  }
}
