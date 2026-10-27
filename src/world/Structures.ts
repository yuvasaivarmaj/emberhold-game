// Works of the land outside the walls: stone bridges where the roads cross the rivers,
// and the ancient watchstones along the south road.
import * as THREE from 'three/webgpu';
import { Builder, type Bucket, type Collider } from './Emberhold';
import { Heightfield } from './Heightfield';
import { ROADS, WATCHSTONES, smoothPath, distToPath } from './Layout';
import { mulberry32 } from './Noise';

export class Structures {
  readonly group: THREE.Group;
  readonly colliders: Collider[];

  constructor(hf: Heightfield, materials: Record<Bucket, THREE.Material>) {
    const b = new Builder();
    const rand = mulberry32(77);
    for (const br of (hf.meta.bridges ?? []) as { x: number; z: number; dirX: number; dirZ: number; deck: number; length: number; road: string }[]) {
      const road = ROADS.find((r) => r.name === br.road);
      const width = (road?.width ?? 5) + 1.6;
      const len = br.length + 14;
      const rot = -Math.atan2(br.dirZ, br.dirX);
      const top = br.deck + 0.08;
      // Deck and parapets.
      b.box('stone', len, 1.4, width, br.x, top - 1.4, br.z, rot);
      const nx = -br.dirZ, nz = br.dirX;
      for (const s of [-1, 1]) {
        const px = br.x + nx * s * (width / 2 - 0.25), pz = br.z + nz * s * (width / 2 - 0.25);
        b.box('stone', len, 1.05, 0.5, px, top, pz, rot);
        b.box('stone', len + 0.2, 0.15, 0.62, px, top + 1.05, pz, rot, false);
      }
      // Arched spans on piers, the piers footed in the riverbed.
      const spans = Math.max(2, Math.round(len / 14));
      const L = len / spans;
      for (let i = 0; i < spans; i++) {
        const t = -len / 2 + (i + 0.5) * L;
        const x = br.x + br.dirX * t, z = br.z + br.dirZ * t;
        let ground = Infinity;
        for (let k = -2; k <= 2; k++) ground = Math.min(ground, hf.height(x + br.dirX * k * L * 0.25, z + br.dirZ * k * L * 0.25));
        const H = Math.max(3, top - (ground - 4));
        const a = L / 2 - 1.2;
        const bb = Math.max(1.2, Math.min(a, H - 2.6));
        const spring = H - 1.4 - bb;
        const shape = new THREE.Shape();
        shape.moveTo(-L / 2, -H); shape.lineTo(L / 2, -H); shape.lineTo(L / 2, 0); shape.lineTo(-L / 2, 0); shape.closePath();
        const hole = new THREE.Path();
        hole.moveTo(-a, -H);
        hole.lineTo(a, -H);
        hole.lineTo(a, -H + spring);
        hole.absellipse(0, -H + spring, a, bb, 0, Math.PI, false, 0);
        hole.lineTo(-a, -H);
        shape.holes.push(hole);
        const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 14 });
        g.translate(0, 0, -width / 2);
        g.rotateY(rot);
        g.translate(x, top - 1.4, z);
        b.add('stone', g);
        // Cutwater at each pier in the stream.
        if (i > 0) {
          const px = br.x + br.dirX * (t - L / 2), pz = br.z + br.dirZ * (t - L / 2);
          b.cyl('stone', 1.25, top - 1.4 - 3 - (ground - 4), px, ground - 4, pz, 8, false);
        }
      }
    }
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
}
