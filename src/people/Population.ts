// The people of Emberhold. Everyone who sleeps in the fort is a resident with a home, a
// trade (or a post) and a day that follows the clock. Only people near the player are
// simulated as walking agents; the rest are simply wherever their day says they are.
//
// Near agents are skinned people posed every frame; farther ones outdoors are drawn as
// cheap instanced figures. People open doors as they come and go, climb stairs, sit at
// tables, work at their trades, sleep at night, and turn to look at you.
import * as THREE from 'three/webgpu';
import type { Heightfield } from '../world/Heightfield';
import { type Building, type BuildingKind, localToWorld, worldToLocal } from '../world/Buildings';
import { planOf, type Spot, type Interiors } from '../world/Interiors';
import type { Doors } from '../world/Doors';
import { EMBERHOLD as E, fortShape } from '../world/Layout';
import { SOUTH, NORTH } from '../world/Emberhold';
import { NavGrid } from './NavGrid';
import { type Look, DYES, SKIN, HAIR, staticGeometry, bodyMaterial } from './Body';
import { type Mode, type PoseState } from './Pose';
import { type Characters, type Char, bakeFar } from './Characters';
import { mulberry32 } from '../world/Noise';
import { CAST, presentAt, type CastMember, type Where } from '../story/Cast';
import type { Beat } from '../story/Timeline';

export type RoleId =
  | 'smith' | 'apprentice' | 'baker' | 'chandler' | 'weaver' | 'cooper' | 'alewife' | 'potboy' | 'groom'
  | 'townsman' | 'townswoman' | 'child' | 'gateGuard' | 'doorGuard' | 'patrol' | 'servant' | 'cook' | 'clerk'
  | 'furnaceKeeper' | 'roadWatch' | 'swornElder' | 'nurse' | 'seller' | 'cast';

export const ROLE_LABEL: Record<RoleId, string> = {
  smith: 'Smith', apprentice: 'Smith\'s apprentice', baker: 'Baker', chandler: 'Chandler', weaver: 'Weaver', cooper: 'Cooper',
  alewife: 'Alewife', potboy: 'Potboy', groom: 'Groom', townsman: 'Townsman', townswoman: 'Townswoman', child: 'Child',
  gateGuard: 'Gate guard', doorGuard: 'Halvane guard', patrol: 'Watchman', servant: 'Servant', cook: 'Cook', clerk: 'Vhassarin clerk',
  furnaceKeeper: 'Ashmantle furnace-keeper', roadWatch: 'Marrowyn road-watch', swornElder: 'Elder', nurse: 'Nursery maid', seller: 'Market seller', cast: '',
};

/** An outdoor place someone stands, works or patrols. */
export interface Post { x: number; z: number; face: number; mode: Mode; task?: string; patrol?: [number, number][] }

export interface Resident {
  id: number;
  role: RoleId;
  label: string;
  household: string;
  look: Look;
  home: Building;
  work: Building | null;
  post: Post | null;
  shift: 0 | 1;          // guards: 0 = day, 1 = night
  seed: number;
  cast: CastMember | null;
  bedIdx: number;
  workIdx: number;
  agent: Agent | null;
  /** Talked to already today (for barks). */
  greeted?: number;
}

/** Where someone means to be right now, and doing what. */
interface Goal {
  key: string;
  b: Building | null;          // inside this building...
  spot: Spot | null;           // ...at this spot
  post: Post | null;           // or outdoors here
  mode: Mode;
  task?: string;
}

interface Leg { pts: [number, number, number][]; inside: Building | null; outdoor: boolean; door?: Building; doorAt?: number }

export interface Agent {
  r: Resident;
  x: number; y: number; z: number; yaw: number;
  goal: Goal;
  legs: Leg[];
  legI: number; ptI: number;
  inside: Building | null;
  mode: Mode; task?: string;
  speed: number; phase: number;
  waiting: boolean;            // for a path
  talkT: number;               // seconds left facing the player in conversation
  look: number;                // head turn smoothing
  /** The full character, when near. */
  char: Char | null;
  farSlot: number;             // index in the far instanced mesh, or -1
  pose: PoseState;
  stuckT: number;
  /** Start this far (0..1) along the next walk (set when met mid-errand). */
  skip?: number;
}

const WALK = 1.35;
const DOOR_OUT = 2.9;          // metres in front of a door where the street begins
const ACTIVE_R = 150;
const NEAR_R = 52;
const FAR_R = 300;

export class Population {
  readonly residents: Resident[] = [];
  readonly agents = new Map<number, Agent>();
  readonly group = new THREE.Group();
  readonly nav: NavGrid;
  private posts = new Map<string, Post>();
  private rand = mulberry32(5150);
  private pathQueue: Agent[] = [];
  private pathCache = new Map<string, [number, number][] | null>();
  private checkT = 0;
  private hourAcc = 0;
  private lastHour = -1;
  day = 0;
  beat: Beat = 'verdance';
  maxNear = 60;
  private far: { mesh: THREE.InstancedMesh; looks: Look[] }[] = [];
  private farCount: number[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private one = new THREE.Vector3(1, 1, 1);
  private v3 = new THREE.Vector3();
  /** Somebody passed through a door near the player (for the creak), handled by Doors. */

  constructor(private hf: Heightfield, readonly buildings: Building[], colliders: import('../world/Emberhold').Collider[],
    private interiors: Interiors, private doors: Doors, private well: { x: number; z: number },
    private stalls: { x: number; z: number; face: number }[] = [], private wells: { x: number; z: number }[] = [], private chars: Characters | null = null) {
    this.group.name = 'People';
    const t0 = performance.now();
    this.nav = new NavGrid(hf, colliders, buildings);
    const t1 = performance.now();
    this.makePosts();
    // Plan every interior now (cheap, and it keeps the planning out of play).
    for (const b of buildings) planOf(b);
    this.populate();
    this.makeFar();
    console.info(`[people] ${this.residents.length} residents; nav grid ${(t1 - t0).toFixed(0)} ms`);
  }

  // ---------------------------------------------------------------- places
  private at(a: number, r: number): [number, number] {
    const rr = r * fortShape(a);
    return [E.x + Math.cos(a) * rr, E.z + Math.sin(a) * rr];
  }

  private postAt(name: string, x: number, z: number, face: number, mode: Mode, task?: string) {
    const o = this.nav.nearestOpen(x, z, 8);
    if (!o) return;
    this.posts.set(name, { x: o[0], z: o[1], face, mode, task });
  }

  private makePosts() {
    // Gate guards: both sides of each gate passage, just inside.
    const gates: [string, number, number, number][] = [
      ['outerS', SOUTH, E.outerR + 3, 4.2], ['outerN', NORTH, E.outerR + 3, 4.2],
      ['midS', SOUTH, E.middleR + 4, 3.6], ['midN', NORTH, E.middleR + 4, 3.6], ['innerS', SOUTH, E.keepR + 3, 3.2],
    ];
    for (const [name, a, r, thick] of gates) {
      const [gx, gz] = this.at(a, r - thick / 2 - 4.5);
      const tx = -Math.sin(a), tz = Math.cos(a);
      const out = Math.atan2(Math.cos(a), Math.sin(a)); // facing out along the road
      for (const s of [-1, 1]) this.postAt(`${name}${s}`, gx + tx * s * 3.4, gz + tz * s * 3.4, out, 'guard');
    }
    // Door guards on the family and nursery wings, the Hall of Cinders and the forge hall.
    for (const b of this.buildings) {
      if (b.kind === 'familyWing' || b.kind === 'nurseryWing' || b.kind === 'hallOfCinders' || b.kind === 'forgeHall' || b.kind === 'keep') {
        for (const s of [-1, 1]) {
          const [x, z] = localToWorld(b, b.door.u + s * 1.6, b.d / 2 + 1.4);
          this.postAt(`door${b.id}${s}`, x, z, b.rot, 'guard');
        }
      }
    }
    // The summit's open places, for the family's walks and the training yard.
    const [wx, wz] = [this.well.x, this.well.z];
    this.postAt('greatCourt', wx + 6, wz + 4, 0, 'idle');
    const [ty, tz] = this.at(SOUTH - 0.45, 120);
    this.postAt('trainingYard', ty, tz, 0, 'work', 'drill');
    const forge = this.buildings.find((b) => b.kind === 'forgeHall');
    if (forge) { const [x, z] = localToWorld(forge, forge.door.u + 4, forge.d / 2 + 6); this.postAt('forgeCourt', x, z, forge.rot, 'idle'); }
    const nursery = this.buildings.find((b) => b.kind === 'nurseryWing');
    if (nursery) { const [x, z] = localToWorld(nursery, nursery.door.u - 5, nursery.d / 2 + 7); this.postAt('nurseryGarden', x, z, nursery.rot, 'idle'); }
    const [sx, sz] = this.at(SOUTH, 395); this.postAt('southAvenue', sx, sz, 0, 'idle');
    const [nx, nz] = this.at(NORTH, 400); this.postAt('northAvenue', nx, nz, 0, 'idle');
    const [ix, iz] = this.at(SOUTH, E.keepR - 6); this.postAt('innerGate', ix, iz, 0, 'idle');
    this.postAt('well', wx + 2.2, wz, -Math.PI / 2, 'idle');
  }

  /** A loose spot near a named place, so a crowd doesn't stand in one point. */
  private near(p: Post, seed: number, spread = 5): Post {
    const a = seed * 17.3, r = (seed * 7.1 % 1) * spread;
    const o = this.nav.nearestOpen(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 4) ?? [p.x, p.z];
    return { ...p, x: o[0], z: o[1], face: p.face + (seed - 0.5) * 1.2 };
  }

  // ---------------------------------------------------------------- residents
  private look(role: RoleId, household: string, rnd: () => number, female: boolean, child = false): Look {
    const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const plain = [DYES.linen, DYES.undyed, DYES.brown, DYES.russet, DYES.woad, DYES.green, DYES.ochre, DYES.grey, DYES.moss];
    const skin = pick(SKIN), hair = rnd() < 0.08 ? HAIR[6 + Math.floor(rnd() * 2)] : pick(HAIR.slice(0, 6));
    const L: Look = {
      garb: female ? 'dress' : 'tunic', height: child ? 1.05 + rnd() * 0.3 : female ? 1.56 + rnd() * 0.14 : 1.66 + rnd() * 0.18,
      build: 0.9 + rnd() * 0.25, skin, hair, hairStyle: female ? (rnd() < 0.55 ? 'coif' : rnd() < 0.5 ? 'tied' : 'long') : (rnd() < 0.85 ? 'short' : 'bald'),
      beard: !female && !child && rnd() < 0.45, cloth: pick(plain), cloth2: pick([DYES.linen, DYES.undyed, DYES.grey]),
      legs: pick([DYES.brown, DYES.grey, DYES.charcoal, DYES.undyed]), boots: pick([DYES.leather, DYES.darkLeather]),
      cloak: rnd() < 0.15 ? pick([DYES.brown, DYES.grey, DYES.moss]) : null, apron: null, helmet: false,
    };
    if (child) { L.build = 0.85; L.beard = false; if (L.hairStyle === 'bald' || L.hairStyle === 'coif') L.hairStyle = 'short'; }
    if (role === 'smith' || role === 'apprentice' || role === 'furnaceKeeper') { L.garb = 'smith'; L.apron = DYES.darkLeather; L.cloth = DYES.charcoal; L.hairStyle = female ? 'tied' : 'short'; }
    if (role === 'baker' || role === 'cook') { L.apron = DYES.linen; }
    if (role === 'alewife' || role === 'potboy' || role === 'servant' || role === 'nurse') { L.apron = rnd() < 0.7 ? DYES.linen : null; }
    if (role === 'servant' || role === 'cook') { L.cloth = rnd() < 0.5 ? DYES.madder : DYES.black; L.cloth2 = DYES.linen; }
    if (role === 'clerk') { L.garb = 'robe'; L.cloth = pick([DYES.navy, DYES.charcoal, DYES.black]); }
    if (role === 'gateGuard' || role === 'patrol' || role === 'doorGuard' || role === 'roadWatch') {
      L.garb = 'guard'; L.cloth = role === 'gateGuard' || role === 'patrol' ? DYES.madder : DYES.charcoal; L.helmet = true; L.cloak = rnd() < 0.5 ? DYES.black : null;
      L.hairStyle = 'short'; L.height = Math.max(L.height, 1.7);
    }
    if (household && household !== 'Vaelaros' && role !== 'servant' && (role === 'townsman' || role === 'townswoman' || role === 'swornElder')) {
      // The sworn families dress a little better than the yard.
      L.cloth = pick([DYES.navy, DYES.charcoal, DYES.madder, DYES.green, DYES.brown]);
      if (!female && rnd() < 0.4) L.cloak = pick([DYES.black, DYES.charcoal, DYES.navy]);
      if (female) L.garb = 'dress';
    }
    return L;
  }

  private add(role: RoleId, home: Building, work: Building | null, post: Post | null, household: string, female: boolean, child = false, shift: 0 | 1 = 0) {
    const rnd = mulberry32(777 + this.residents.length * 131);
    const r: Resident = {
      id: this.residents.length, role, label: ROLE_LABEL[role], household, look: this.look(role, household, rnd, female, child),
      home, work, post, shift, seed: rnd(), cast: null, bedIdx: 0, workIdx: 0, agent: null,
    };
    if (role === 'townsman' && female) r.label = ROLE_LABEL.townswoman;
    if (household && (role === 'townsman' || role === 'townswoman')) r.label = female ? `${household} woman` : `${household} man`;
    this.residents.push(r);
    return r;
  }

  private populate() {
    const R = this.rand;
    const B = this.buildings;
    const of = (k: BuildingKind) => B.filter((b) => b.kind === k);
    const homes = B.filter((b) => (b.kind === 'house' || b.kind === 'bakery' || b.kind === 'chandlery' || b.kind === 'weaver' || b.kind === 'cooper' || b.kind === 'inn'));
    const nearestHome = (b: Building, pool: Building[]) => {
      let best = pool[0], bd = Infinity;
      for (let i = 0; i < 8; i++) {
        const h = pool[Math.floor(R() * pool.length)];
        const d = Math.hypot(h.x - b.x, h.z - b.z);
        if (d < bd) { bd = d; best = h; }
      }
      return best;
    };
    const bedsLeft = new Map<number, number>(B.map((b) => [b.id, b.beds]));
    const takeBed = (b: Building) => { bedsLeft.set(b.id, (bedsLeft.get(b.id) ?? 0) - 1); };
    // Families in the lower yard: one or two adults, and children for the spare beds.
    for (const h of homes) {
      const beds = bedsLeft.get(h.id) ?? 2;
      const adults = beds >= 3 && R() < 0.8 ? 2 : 1;
      const fem0 = R() < 0.5;
      for (let a = 0; a < adults; a++) {
        const female = a === 0 ? fem0 : !fem0;
        const trade: RoleId = h.kind === 'bakery' && a === 0 ? 'baker' : h.kind === 'chandlery' && a === 0 ? 'chandler'
          : h.kind === 'weaver' ? 'weaver' : h.kind === 'cooper' && a === 0 ? 'cooper' : h.kind === 'inn' ? (a === 0 ? 'alewife' : 'potboy') : (female ? 'townswoman' : 'townsman');
        const work = trade === 'townsman' || trade === 'townswoman' ? null : h;
        this.add(trade, h, work, null, '', female);
        takeBed(h);
      }
      const kids = Math.min(2, Math.max(0, beds - adults - (R() < 0.5 ? 1 : 0)));
      for (let k = 0; k < kids; k++) { this.add('child', h, null, null, '', R() < 0.5, true); takeBed(h); }
    }
    // Trades staffed from the yard's townsfolk.
    const idle = () => this.residents.filter((r) => (r.role === 'townsman' || r.role === 'townswoman') && !r.work && r.home.ring === 'lower');
    const hire = (work: Building, role: RoleId, n: number) => {
      const pool = idle();
      for (let i = 0; i < n && pool.length; i++) {
        let best = 0, bd = Infinity;
        for (let k = 0; k < Math.min(40, pool.length); k++) {
          const j = Math.floor(R() * pool.length);
          const d = Math.hypot(pool[j].home.x - work.x, pool[j].home.z - work.z);
          if (d < bd) { bd = d; best = j; }
        }
        const r = pool.splice(best, 1)[0];
        const female = r.look.garb === 'dress';
        r.role = role; r.work = work; r.label = ROLE_LABEL[role];
        r.look = this.look(role, '', mulberry32(999 + r.id), female);
      }
    };
    for (const s of of('smithy')) { hire(s, 'smith', 1); hire(s, 'apprentice', 1); }
    for (const s of of('stable')) hire(s, 'groom', 2);
    for (const s of of('bakery')) hire(s, 'baker', 1);
    // Market sellers on the gate avenues.
    this.stalls.forEach((st) => {
      const pool = idle();
      if (!pool.length) return;
      let best = 0, bd = Infinity;
      for (let k = 0; k < Math.min(30, pool.length); k++) { const j = Math.floor(R() * pool.length); const d = Math.hypot(pool[j].home.x - st.x, pool[j].home.z - st.z); if (d < bd) { bd = d; best = j; } }
      const r = pool[best];
      r.role = 'seller'; r.label = ROLE_LABEL.seller;
      const o = this.nav.nearestOpen(st.x, st.z, 3) ?? [st.x, st.z];
      r.post = { x: o[0], z: o[1], face: st.face, mode: 'work', task: 'serve' };
    });
    // The garrison: the barracks by the south gate, two shifts on the gates and the walls.
    const barracks = of('barracks');
    const gatePosts = [...this.posts.entries()].filter(([k]) => /^(outer|mid)/.test(k)).map(([, p]) => p);
    let g = 0;
    for (const b of barracks) {
      for (let i = 0; i < 24; i++) {
        const shift = (i % 2) as 0 | 1;
        const post = i < gatePosts.length * 2 ? gatePosts[Math.floor(i / 2) % gatePosts.length] : null;
        const role: RoleId = post ? 'gateGuard' : 'patrol';
        this.add(role, b, null, post ?? this.patrolRoute(g++), '', false, false, shift);
        takeBed(b);
      }
    }
    // The sworn households in the middle courts.
    for (const h of of('swornHouse')) {
      const beds = bedsLeft.get(h.id) ?? 3;
      const adults = beds >= 3 ? 2 : 1;
      for (let a = 0; a < adults; a++) { this.add('townsman', h, null, null, h.household, a === 1 ? true : R() < 0.3); takeBed(h); }
      for (let k = 0; k < Math.min(2, beds - adults); k++) { this.add('child', h, null, null, h.household, R() < 0.5, true); takeBed(h); }
    }
    for (const h of of('swornHall')) if (h.household) for (let i = 0; i < 3; i++) { this.add(i === 0 ? 'swornElder' : 'servant', h, i === 0 ? null : h, null, h.household, R() < 0.5); takeBed(h); }
    // Each household's work, by what the Story Bible says they do.
    const sworn = (hh: string) => this.residents.filter((r) => r.household === hh && r.role === 'townsman' || r.household === hh && r.role === 'townswoman');
    const set = (r: Resident, role: RoleId, work: Building | null, post: Post | null = null) => {
      const female = r.look.garb === 'dress';
      r.role = role; r.work = work; r.post = post; r.label = ROLE_LABEL[role];
      r.look = this.look(role, r.household, mulberry32(1999 + r.id), female);
    };
    const records = of('records'), forgeHall = of('forgeHall')[0], vh = B.find((b) => b.kind === 'swornHall' && b.household === 'Vhassarin');
    sworn('Vhassarin').forEach((r, i) => { if (i % 3 !== 2) set(r, 'clerk', i % 2 ? (records[i % records.length] ?? vh!) : vh!); });
    sworn('Ashmantle').forEach((r, i) => { if (i % 3 !== 2) set(r, 'furnaceKeeper', forgeHall); });
    sworn('Qelbar').forEach((r, i) => { if (i % 3 !== 2) { const s = of('smithy'); set(r, 'smith', s[(i * 7) % s.length]); } });
    const outerPosts = [...this.posts.entries()].filter(([k]) => /^outer/.test(k)).map(([, p]) => p);
    sworn('Marrowyn').forEach((r, i) => {
      if (i % 3 === 2) return;
      if (i % 2) set(r, 'groom', of('stable')[i % of('stable').length]);
      else { set(r, 'roadWatch', null, outerPosts[i % outerPosts.length]); r.shift = (i % 4 === 0 ? 1 : 0); }
    });
    const doorPosts = [...this.posts.entries()].filter(([k]) => /^(door|innerS)/.test(k)).map(([, p]) => p);
    sworn('Halvane').forEach((r, i) => { if (i % 3 !== 2) { set(r, 'doorGuard', null, doorPosts[i % doorPosts.length]); r.shift = (i % 2) as 0 | 1; } });
    // Summit servants: kitchens, bakehouse, stores and the family's rooms.
    const servantHalls = of('servants');
    const summitWork = [...of('kitchen'), ...of('kitchen'), ...of('bakehouse'), ...of('store'), ...of('familyWing'), ...of('hallOfCinders')];
    let w = 0;
    for (const sh of servantHalls) for (let i = 0; i < Math.min(12, sh.beds); i++) {
      const work = summitWork[w++ % summitWork.length];
      const role: RoleId = work.kind === 'kitchen' || work.kind === 'bakehouse' ? 'cook' : 'servant';
      this.add(role, sh, work, null, 'Vaelaros', R() < 0.55);
      takeBed(sh);
    }
    const nursery = of('nurseryWing')[0];
    if (nursery) for (let i = 0; i < 2; i++) this.add('nurse', nursery, nursery, null, 'Vaelaros', true);
    // No more workers in a building than it has places to work; the rest keep house.
    const byWork = new Map<Building, Resident[]>();
    for (const r of this.residents) if (r.work && r.role !== 'servant' && r.role !== 'cook' && r.role !== 'nurse') {
      const l = byWork.get(r.work) ?? []; l.push(r); byWork.set(r.work, l);
    }
    for (const [b, list] of byWork) {
      const cap = Math.max(1, planOf(b).spots.filter((s) => s.kind === 'work' || s.kind === 'desk' || s.kind === 'serve').length);
      for (const r of list.slice(cap)) {
        const female = r.look.garb === 'dress';
        r.role = 'townsman'; r.work = null; r.label = r.household ? `${r.household} ${female ? 'woman' : 'man'}` : female ? ROLE_LABEL.townswoman : ROLE_LABEL.townsman;
        r.look = this.look('townsman', r.household, mulberry32(3001 + r.id), female);
      }
    }
    // The named people, where the story has them.
    this.castResidents();
    void nearestHome;
  }

  private castResidents() {
    for (const c of CAST) {
      const home = this.resolveBuilding(c.home);
      if (!home) continue;
      const r = this.add('cast', home, null, null, c.household, c.look.garb === 'dress' || c.look.garb === 'nobleGown');
      r.cast = c; r.look = c.look; r.label = c.name;
    }
  }

  /** Who is about at this point in the story (the named cast comes and goes with the timeline). */
  setBeat(beat: Beat) {
    this.beat = beat;
    for (const r of this.residents) if (r.cast && !presentAt(r.cast, beat) && r.agent) this.deactivate(r);
  }

  private resolveBuilding(w: Where): Building | null {
    if (!('b' in w)) return null;
    return this.buildings.find((b) => b.kind === w.b && (!w.household || b.household === w.household)) ?? null;
  }

  private patrolRoute(i: number): Post {
    // Watchmen walk a stretch of a ring street in the lower yard and back.
    const r = E.middleR + 46 + (i % 3) * 40;
    const a0 = (i * 0.83) % (Math.PI * 2);
    const pts: [number, number][] = [];
    for (let k = 0; k <= 4; k++) {
      const [x, z] = this.at(a0 + k * 0.09, r);
      const o = this.nav.nearestOpen(x, z, 10);
      if (o) pts.push(o);
    }
    const p0 = pts[0] ?? this.at(a0, r);
    return { x: p0[0], z: p0[1], face: 0, mode: 'walk', patrol: pts };
  }

  // ---------------------------------------------------------------- the day
  private hash(a: number, b: number, c: number) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Who is using which spot right now (so two people don't sit in one chair). */
  private taken = new Map<Spot, number>();
  private asking = -1;

  private spot(b: Building, kinds: Spot['kind'][], idx: number, level?: 'top' | 'ground'): Spot | null {
    const plan = planOf(b);
    let list = plan.spots.filter((s) => kinds.includes(s.kind));
    if (level === 'top') list = list.filter((s) => s.level === plan.levels.length - 1);
    if (level === 'ground') list = list.filter((s) => s.level === 0);
    if (!list.length) return null;
    for (let k = 0; k < list.length; k++) {
      const sp = list[(idx + k) % list.length];
      const who = this.taken.get(sp);
      if (who === undefined || who === this.asking) return sp;
    }
    return null;
  }

  private claimSpot(a: Agent, g: Goal) {
    if (a.goal.spot && this.taken.get(a.goal.spot) === a.r.id) this.taken.delete(a.goal.spot);
    if (g.spot) this.taken.set(g.spot, a.r.id);
  }

  private inGoal(b: Building, kinds: Spot['kind'][], idx: number, mode: Mode, key: string, task?: string, level?: 'top' | 'ground'): Goal {
    const plan = planOf(b);
    const s = this.spot(b, kinds, idx, level) ?? this.spot(b, ['sit', 'hearth', 'stand', 'work'], idx)
      ?? (plan.spots.length ? plan.spots[idx % plan.spots.length] : null);
    const m: Mode = s ? (s.kind === 'bed' ? 'sleep' : s.kind === 'sit' || s.kind === 'seat' ? 'sit' : s.kind === 'hearth' ? 'hearth' : s.kind === 'work' || s.kind === 'desk' || s.kind === 'serve' ? 'work' : mode) : mode;
    return { key, b, spot: s, post: null, mode: m, task: task ?? s?.task };
  }

  private outGoal(p: Post, key: string, mode?: Mode, task?: string): Goal {
    return { key, b: null, spot: null, post: p, mode: mode ?? p.mode, task: task ?? p.task };
  }

  /** Where this person's day has them at this hour. */
  goal(r: Resident, hour: number): Goal {
    this.asking = r.id;
    const h = hour, id = r.id;
    const bed = () => this.inGoal(r.home, ['bed'], id, 'sleep', `bed${r.home.id}`);
    const home = () => this.inGoal(r.home, h < 9 || h > 17 ? ['sit', 'hearth'] : ['hearth', 'sit'], id + Math.floor(h), 'sit', `home${r.home.id}`);
    // Named people follow the days the cast list gives them.
    if (r.cast) {
      if (h < 6.5 || h >= 22) return bed();
      for (const [a, b, w] of r.cast.day) {
        if (h >= a && h < b) {
          if ('out' in w) { const p = this.posts.get(w.out); if (p) return this.outGoal(this.near(p, r.seed, 6), `out-${w.out}`, w.task ? 'work' : 'idle', w.task); }
          else {
            const bd = this.resolveBuilding(w);
            if (bd) return this.inGoal(bd, w.spot ? [w.spot] : ['stand', 'sit', 'work', 'hearth'], id, 'idle', `in${bd.id}-${w.spot}`, undefined, w.level);
          }
        }
      }
      return home();
    }
    // Guards stand their shift; the rest of the time they sleep or sit in the barracks.
    if (r.role === 'gateGuard' || r.role === 'doorGuard' || r.role === 'roadWatch' || r.role === 'patrol') {
      const on = r.shift === 0 ? h >= 6 && h < 18 : h >= 18 || h < 6;
      if (on && r.post) return r.post.patrol ? this.outGoal(r.post, `patrol${r.id}`, 'walk') : this.outGoal(this.near(r.post, r.seed, 0.6), `post${r.id}`, 'guard');
      const off = r.shift === 0 ? h >= 21 || h < 5.5 : h >= 8 && h < 15;
      return off ? bed() : home();
    }
    if (h < 6 || h >= 22) return bed();
    if (r.role === 'seller' && r.post && h >= 7 && h < 17.5 && !(h >= 12 && h < 12.75)) return this.outGoal(r.post, `stall${r.id}`, 'work', 'serve');
    if (r.role === 'child') {
      if (((h >= 8 && h < 12) || (h >= 13.5 && h < 18.5)) && this.hash(id, this.day, Math.floor(h)) < 0.5) return this.playGoal(r, h);
      return h >= 21 ? bed() : home();
    }
    // An errand now and then in the working day.
    const slot = Math.floor(h);
    const p = r.work ? 0.12 : r.role === 'townsman' && r.look.garb !== 'dress' ? 0.65 : 0.35;
    if (h >= 7 && h < 20 && this.hash(id, this.day, slot) < p) {
      const m0 = this.hash(id, slot, 9) * 0.5;
      const frac = h - slot;
      const len = r.role === 'townsman' ? 0.45 : 0.35;
      if (frac >= m0 && frac < m0 + len) return this.errandGoal(r, slot);
    }
    const working = r.work && ((h >= 7 && h < 12) || (h >= 13 && h < 18) || (r.role === 'alewife' || r.role === 'potboy') && h >= 11 && h < 23);
    if (working) {
      const kinds: Spot['kind'][] = r.role === 'alewife' || r.role === 'potboy' ? ['serve', 'stand'] : r.role === 'clerk' ? ['desk'] : ['work', 'serve', 'hearth'];
      return this.inGoal(r.work!, kinds, r.id, 'work', `work${r.work!.id}`, undefined, r.role === 'clerk' && r.work!.kind === 'swornHall' ? 'top' : undefined);
    }
    // Evenings: some go to the alehouse.
    if (h >= 19 && h < 22 && r.home.ring === 'lower' && this.hash(id, this.day, 77) < 0.22) {
      const inn = this.nearestInn(r.home);
      if (inn) return this.inGoal(inn, ['sit'], id, 'sit', `inn${inn.id}`);
    }
    return home();
  }

  private innCache = new Map<number, Building | null>();
  private nearestInn(b: Building) {
    if (this.innCache.has(b.id)) return this.innCache.get(b.id)!;
    let best: Building | null = null, bd = Infinity;
    for (const x of this.buildings) if (x.kind === 'inn') { const d = Math.hypot(x.x - b.x, x.z - b.z); if (d < bd) { bd = d; best = x; } }
    this.innCache.set(b.id, best);
    return best;
  }

  private playGoal(r: Resident, h: number): Goal {
    // Children play in the street near home, moving every few minutes.
    const slot = Math.floor(h * 6);
    const a = this.hash(r.id, slot, 3) * Math.PI * 2, d = 3 + this.hash(r.id, slot, 4) * 10;
    const [dx, dz] = this.doorFront(r.home);
    const o = this.nav.nearestOpen(dx + Math.cos(a) * d, dz + Math.sin(a) * d, 5) ?? [dx, dz];
    return this.outGoal({ x: o[0], z: o[1], face: a, mode: 'idle' }, `play${r.id}-${slot}`, 'idle');
  }

  private errandGoal(r: Resident, slot: number): Goal {
    // To a shop, a store, the well, or a neighbour's door.
    const pick = this.hash(r.id, slot, 5);
    const ring = r.home.ring;
    if (pick < 0.2) {
      let p = this.posts.get(ring === 'lower' ? (this.hash(r.id, slot, 6) < 0.5 ? 'southAvenue' : 'northAvenue') : 'well');
      if (ring === 'lower' && this.wells.length && this.hash(r.id, slot, 12) < 0.5) {
        let best = this.wells[0], bd = Infinity;
        for (const w of this.wells) { const d = Math.hypot(w.x - r.home.x, w.z - r.home.z); if (d < bd) { bd = d; best = w; } }
        const o = this.nav.nearestOpen(best.x + 1.8, best.z, 4);
        if (o) p = { x: o[0], z: o[1], face: Math.atan2(best.x - o[0], best.z - o[1]), mode: 'idle' };
      }
      if (p) return this.outGoal(this.near(p, this.hash(r.id, slot, 7), 8), `errand${r.id}-${slot}`, 'idle');
    }
    const kinds: BuildingKind[] = ring === 'lower' ? ['bakery', 'chandlery', 'weaver', 'cooper', 'smithy', 'house', 'inn'] : ['swornHouse', 'store', 'kitchen', 'swornHall'];
    const pool = this.buildings.filter((b) => b.ring === ring && kinds.includes(b.kind) && Math.hypot(b.x - r.home.x, b.z - r.home.z) < 160 && b.access !== 'restricted');
    const b = pool[Math.floor(this.hash(r.id, slot, 8) * pool.length)];
    if (!b) return this.inGoal(r.home, ['sit'], r.id, 'sit', `home${r.home.id}`);
    return this.inGoal(b, ['stand', 'sit', 'hearth'], r.id + slot, 'idle', `visit${b.id}`);
  }

  // ---------------------------------------------------------------- geometry helpers
  doorFront(b: Building): [number, number] {
    const k = `df${b.id}`;
    const c = this.dfCache.get(k);
    if (c) return c;
    const [x, z] = localToWorld(b, b.door.u, b.d / 2 + DOOR_OUT);
    const o = this.nav.nearestOpen(x, z, 4) ?? [x, z];
    this.dfCache.set(k, o);
    return o;
  }
  private dfCache = new Map<string, [number, number]>();

  private groundY(x: number, z: number) { return this.hf.height(x, z); }

  /** World position of an interior spot. */
  private spotPos(b: Building, s: Spot): [number, number, number] {
    const [x, z] = localToWorld(b, s.u, s.v);
    const plan = planOf(b);
    const y = b.fy + 0.04 + plan.levels[s.level];
    return [x, s.kind === 'bed' ? s.y : y, z];
  }

  /** The way between a building's doorway and a spot inside it (via the stairs if need be). */
  private insideRoute(b: Building, s: Spot): [number, number, number][] {
    const plan = planOf(b);
    const pts: [number, number, number][] = [];
    const fy = b.fy + 0.04;
    const P = (u: number, v: number, y: number) => { const [x, z] = localToWorld(b, u, v); pts.push([x, y, z]); };
    P(b.door.u, b.d / 2 - b.wall - 0.9, fy);
    for (let lv = 0; lv < s.level; lv++) {
      const st = plan.stairs[lv];
      if (!st) break;
      const dir = Math.sign(st.u1 - st.u0) || 1;
      const y0 = fy + plan.levels[lv], y1 = fy + plan.levels[lv + 1];
      P(st.u0 - dir * 0.7, st.v + 1.0, y0);
      P(st.u0 - dir * 0.5, st.v, y0);
      P(st.u1 + dir * 0.5, st.v, y1);
      P(st.u1 + dir * 0.9, st.v + 1.0, y1);
    }
    const [x, y, z] = this.spotPos(b, s);
    pts.push([x, s.kind === 'bed' ? fy + plan.levels[s.level] : y, z]);
    return pts;
  }

  /** Where someone is when nobody's watching (for placing them as they come near). */
  private restPos(r: Resident, g: Goal): [number, number, number] {
    if (g.post) return [g.post.x, this.groundY(g.post.x, g.post.z), g.post.z];
    if (g.b && g.spot) return this.spotPos(g.b, g.spot);
    const [x, z] = this.doorFront(r.home);
    return [x, this.groundY(x, z), z];
  }

  // ---------------------------------------------------------------- agents
  private activate(r: Resident, hour: number) {
    const g = this.goal(r, hour);
    // If their day changed a few minutes ago, they're on the way: start them part-way along.
    const before = this.goal(r, hour - 0.12);
    const transit = before.key !== g.key && !g.post?.patrol && !before.post?.patrol;
    const from = transit ? before : g;
    const [x, y, z] = this.restPos(r, from);
    const a: Agent = {
      r, x, y, z, yaw: g.post ? g.post.face : g.b ? g.b.rot + (g.spot?.face ?? 0) : 0, goal: g, legs: [], legI: 0, ptI: 0,
      inside: g.b, mode: g.mode, task: g.task, speed: 0, phase: r.seed, waiting: false, talkT: 0, look: 0,
      char: null, farSlot: -1, stuckT: 0,
      pose: { mode: g.mode, phase: 0, speed: 0, lookYaw: 0, lookPitch: 0, t: 0, seed: r.seed, scale: r.look.height / 1.75, task: g.task },
    };
    if (g.post?.patrol) this.startPatrol(a, g.post.patrol, true);
    r.agent = a;
    this.agents.set(r.id, a);
    if (g.spot) this.taken.set(g.spot, r.id);
    if (transit) {
      a.goal = before; a.inside = before.b; a.mode = before.mode;
      a.skip = 0.15 + this.hash(r.id, this.day, 21) * 0.7;
      this.replan(a, g);
    }
  }

  /** Jump an agent part-way along its walk across the fort (for people met mid-errand). */
  private applySkip(a: Agent) {
    if (!a.skip) return;
    const li = a.legs.findIndex((l) => l.outdoor);
    const leg = a.legs[li];
    if (li < 0 || !leg.pts.length) { a.skip = 0; return; }
    const pts: [number, number][] = [[a.x, a.z], ...leg.pts.map((p) => [p[0], p[2]] as [number, number])];
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let want = total * a.skip;
    a.skip = 0;
    // Use the street in front of the door we came out of as the start.
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (want <= seg) {
        const t = seg > 0 ? want / seg : 0;
        a.x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
        a.z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
        a.y = this.groundY(a.x, a.z);
        a.legI = li; a.ptI = i - 1; a.inside = null;
        return;
      }
      want -= seg;
    }
  }

  private deactivate(r: Resident) {
    const a = r.agent;
    if (!a) return;
    if (a.goal.spot && this.taken.get(a.goal.spot) === r.id) this.taken.delete(a.goal.spot);
    this.dropMesh(a);
    r.agent = null;
    this.agents.delete(r.id);
  }

  private startPatrol(a: Agent, pts: [number, number][], randomStart: boolean) {
    const loop = [...pts, ...pts.slice(0, -1).reverse()];
    a.legs = [{ pts: loop.map(([x, z]) => [x, 0, z]), inside: null, outdoor: true }];
    a.legI = 0;
    a.ptI = randomStart ? Math.floor(this.hash(a.r.id, this.day, 11) * (loop.length - 1)) : 0;
    if (randomStart) { const p = loop[a.ptI]; a.x = p[0]; a.z = p[1]; a.y = this.groundY(p[0], p[1]); a.inside = null; }
    a.mode = 'walk';
  }

  /** Plan the way from where the agent is to its new goal. */
  private replan(a: Agent, g: Goal) {
    this.claimSpot(a, g);
    a.goal = g;
    a.legs = []; a.legI = 0; a.ptI = 0;
    const r = a.r;
    // Out of the building we're in (if any), to the street in front of its door.
    let sx = a.x, sz = a.z;
    if (a.inside) {
      const b = a.inside;
      if (g.b === b && g.spot) {
        // Moving within the same building.
        a.legs.push({ pts: [this.spotPos(b, g.spot)], inside: b, outdoor: false });
        a.waiting = false;
        return;
      }
      // Back the way an arrival would come: (down the stairs,) to the doorway, over the threshold.
      const [lu, lv] = worldToLocal(b, a.x, a.z);
      const here: Spot = { kind: 'stand', u: lu, v: lv, level: this.levelOf(a, b), y: a.y, face: 0 };
      const back = this.insideRoute(b, here).reverse().slice(1);
      const fy = b.fy + 0.04;
      const [tx, tz] = localToWorld(b, b.door.u, b.d / 2 + 0.2);
      const [dx, dz] = this.doorFront(b);
      a.legs.push({ pts: [...back, [tx, fy, tz], [dx, this.groundY(dx, dz), dz]], inside: b, outdoor: false, door: b, doorAt: 1 });
      sx = dx; sz = dz;
    }
    // Across the fort.
    let tx: number, tz: number;
    if (g.post) {
      if (g.post.patrol) { this.startPatrol(a, g.post.patrol, false); return; }
      tx = g.post.x; tz = g.post.z;
    } else if (g.b) { [tx, tz] = this.doorFront(g.b); }
    else return;
    const out: Leg = { pts: [], inside: null, outdoor: true };
    a.legs.push(out);
    const key = `${Math.round(sx)},${Math.round(sz)}>${Math.round(tx)},${Math.round(tz)}`;
    const cached = this.pathCache.get(key);
    if (cached !== undefined) { this.fillPath(out, cached, sx, sz, tx, tz); this.applySkip(a); }
    else { (out as any).want = [sx, sz, tx, tz, key]; a.waiting = true; this.pathQueue.push(a); }
    // In through the door to the spot.
    if (g.b && g.spot) {
      const b = g.b;
      const fy = b.fy + 0.04;
      const [ox, oz] = localToWorld(b, b.door.u, b.d / 2 + 0.2);
      a.legs.push({ pts: [[ox, fy, oz], ...this.insideRoute(b, g.spot)], inside: b, outdoor: false, door: b, doorAt: 0 });
    }
    void r;
  }

  private levelOf(a: Agent, b: Building) {
    const plan = planOf(b);
    const rel = a.y - (b.fy + 0.04);
    let lv = 0;
    for (let i = 0; i < plan.levels.length; i++) if (rel > plan.levels[i] - 0.5) lv = i;
    return lv;
  }

  private fillPath(leg: Leg, path: [number, number][] | null, sx: number, sz: number, tx: number, tz: number) {
    if (!path) {
      // No way found: go straight (rare; mostly short hops).
      leg.pts = [[tx, 0, tz]];
    } else leg.pts = path.map(([x, z]) => [x, 0, z]);
    void sx; void sz;
  }

  /** The search in progress (one at a time, a slice per frame). */
  private searching: { a: Agent; leg: Leg; key: string; sx: number; sz: number; tx: number; tz: number } | null = null;

  private processPaths(budgetMs: number) {
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (!this.searching) {
        const a = this.pathQueue.shift();
        if (!a) return;
        if (!a.r.agent) continue;
        const leg = a.legs.find((l) => (l as any).want);
        if (!leg) { a.waiting = false; continue; }
        const [sx, sz, tx, tz, key] = (leg as any).want;
        delete (leg as any).want;
        const cached = this.pathCache.get(key);
        if (cached !== undefined) { this.fillPath(leg, cached, sx, sz, tx, tz); a.waiting = false; this.applySkip(a); continue; }
        this.searching = { a, leg, key, sx, sz, tx, tz };
        if (!this.nav.begin(sx, sz, tx, tz)) { this.endSearch(this.nav.result); continue; }
      }
      const st = this.nav.step(2500);
      if (st === 'done') this.endSearch(this.nav.result);
      else if (st === 'fail') this.endSearch(null);
    }
  }

  private endSearch(p: [number, number][] | null) {
    const S = this.searching!;
    this.searching = null;
    if (this.pathCache.size > 800) this.pathCache.delete(this.pathCache.keys().next().value!);
    this.pathCache.set(S.key, p);
    if (!S.a.r.agent) return;
    this.fillPath(S.leg, p, S.sx, S.sz, S.tx, S.tz);
    S.a.waiting = false;
    this.applySkip(S.a);
  }

  // ---------------------------------------------------------------- update
  update(dt: number, hour: number, player: THREE.Vector3, camera: THREE.Camera, scene: THREE.Scene, time: number) {
    if (this.lastHour >= 0 && hour < this.lastHour - 12) this.day++;
    this.lastHour = hour;
    if (!this.group.parent) scene.add(this.group);
    // Who's near enough to matter, re-checked a few times a second.
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.25;
      let activated = 0;
      for (const r of this.residents) {
        if (r.cast && !presentAt(r.cast, this.beat)) continue;
        if (r.agent) {
          const a = r.agent;
          if (Math.hypot(a.x - player.x, a.z - player.z) > ACTIVE_R + 30) this.deactivate(r);
          continue;
        }
        // Inactive: where would they be?
        const hx = r.post ? r.post.x : r.home.x, hz = r.post ? r.post.z : r.home.z;
        if (Math.abs(hx - player.x) > ACTIVE_R + 200 || Math.abs(hz - player.z) > ACTIVE_R + 200) continue;
        if (activated >= 14) continue; // a few at a time, so arriving in town doesn't stall
        const g = this.goal(r, hour);
        const [x, , z] = this.restPos(r, g);
        if (Math.hypot(x - player.x, z - player.z) < ACTIVE_R) { this.activate(r, hour); activated++; }
      }
      // Has anyone's day moved on?
      for (const a of this.agents.values()) {
        if (a.talkT > 0) continue;
        const g = this.goal(a.r, hour);
        if (g.key !== a.goal.key || (g.b && a.goal.b && g.spot !== a.goal.spot && a.legs.length === 0)) this.replan(a, g);
      }
    }
    this.processPaths(2.5);
    // Move everyone.
    for (const a of this.agents.values()) this.step(a, dt, player, time);
    this.separate(dt, player);
    this.draw(camera, time);
  }

  private step(a: Agent, dt: number, player: THREE.Vector3, time: number) {
    a.pose.t = time;
    if (a.talkT > 0) {
      a.talkT -= dt;
      a.speed = 0;
      a.mode = 'talk';
      a.yaw = turnToward(a.yaw, Math.atan2(player.x - a.x, player.z - a.z), dt * 5);
      return;
    }
    if (a.waiting || a.legI >= a.legs.length) {
      a.speed = 0;
      if (a.legI >= a.legs.length) {
        // Arrived: settle into the place.
        const g = a.goal;
        a.mode = g.mode; a.task = g.task;
        if (g.b && g.spot) {
          const [x, y, z] = this.spotPos(g.b, g.spot);
          a.x += (x - a.x) * Math.min(1, dt * 4); a.z += (z - a.z) * Math.min(1, dt * 4); a.y = g.spot.kind === 'bed' ? y : y;
          a.yaw = turnToward(a.yaw, g.b.rot + g.spot.face, dt * 4);
          a.inside = g.b;
        } else if (g.post) {
          a.yaw = turnToward(a.yaw, g.post.face, dt * 3);
          a.y = this.groundY(a.x, a.z);
          a.inside = null;
        }
      } else a.mode = a.inside ? a.mode : 'idle';
      return;
    }
    const leg = a.legs[a.legI];
    if (!leg.pts.length) { a.legI++; a.ptI = 0; return; }
    const target = leg.pts[Math.min(a.ptI, leg.pts.length - 1)];
    const dx = target[0] - a.x, dz = target[2] - a.z;
    const d = Math.hypot(dx, dz);
    // Doors: open as we reach them.
    if (leg.door) {
      const door = this.doors.of(leg.door);
      if (door) {
        const dd = Math.hypot(leg.door.door.x - a.x, leg.door.door.z - a.z);
        if (dd < 2.2 && door.target < 1) this.doors.openDoor(door, 2.5);
        else if (dd < 2.2) door.hold = Math.max(door.hold, 1.5);
      }
    }
    const speed = a.r.role === 'child' && leg.outdoor && a.goal.key.startsWith('play') ? 2.4 : a.r.role === 'child' ? 1.5 : WALK * (0.9 + a.r.seed * 0.25);
    if (d < 0.25) {
      a.ptI++;
      if (a.ptI >= leg.pts.length) {
        a.legI++; a.ptI = 0;
        a.inside = a.legI < a.legs.length ? a.legs[a.legI].inside : a.goal.b;
        if (a.goal.post?.patrol && a.legI >= a.legs.length) this.startPatrol(a, a.goal.post.patrol, false);
      }
      return;
    }
    const stepLen = Math.min(d, speed * dt);
    a.x += (dx / d) * stepLen; a.z += (dz / d) * stepLen;
    a.yaw = turnToward(a.yaw, Math.atan2(dx, dz), dt * 6);
    if (leg.outdoor) a.y = this.groundY(a.x, a.z);
    else {
      // Indoors (and on the steps): heights between waypoints.
      const prev = a.ptI > 0 ? leg.pts[a.ptI - 1] : null;
      if (prev) {
        const seg = Math.hypot(target[0] - prev[0], target[2] - prev[2]) || 1;
        const t = 1 - Math.min(1, d / seg);
        a.y = prev[1] + (target[1] - prev[1]) * t;
      } else a.y += (target[1] - a.y) * Math.min(1, dt * 6);
    }
    a.inside = leg.inside && !leg.outdoor ? leg.inside : null;
    a.speed = speed;
    a.mode = 'walk';
    a.phase = (a.phase + (speed * dt) / (1.45 * (a.r.look.height / 1.75))) % 1;
  }

  /** Keep people from walking through each other or the player. */
  private separate(dt: number, player: THREE.Vector3) {
    const list = [...this.agents.values()].filter((a) => a.mode === 'walk' && !a.inside);
    for (const a of list) {
      const pd = Math.hypot(a.x - player.x, a.z - player.z);
      if (pd < 0.9 && pd > 0.01) {
        const push = (0.9 - pd) * dt * 3;
        a.x += ((a.x - player.x) / pd) * push; a.z += ((a.z - player.z) / pd) * push;
      }
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = a.x - b.x, dz = a.z - b.z;
      if (Math.abs(dx) > 0.8 || Math.abs(dz) > 0.8) continue;
      const d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 0.001) {
        const push = (0.7 - d) * 0.5 * dt * 4;
        a.x += (dx / d) * push; a.z += (dz / d) * push;
        b.x -= (dx / d) * push; b.z -= (dz / d) * push;
      }
    }
  }

  // ---------------------------------------------------------------- drawing
  private makeFar() {
    // A handful of stand-in figures for people far off (one draw each).
    const R = mulberry32(31);
    const variants: Look[] = [];
    const plain = [DYES.linen, DYES.brown, DYES.russet, DYES.woad, DYES.green, DYES.grey];
    for (let i = 0; i < 6; i++) variants.push(this.look('townsman', '', R, i % 2 === 1));
    variants.push(this.look('gateGuard', '', R, false));
    variants.push(this.look('child', '', R, false, true));
    variants.forEach((L, i) => { L.cloth = i < 6 ? plain[i] : L.cloth; });
    const farMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 });
    for (const L of variants) {
      const geo = this.chars?.ready ? bakeFar(this.chars, L, 0.3) : staticGeometry(L);
      const mesh = new THREE.InstancedMesh(geo, this.chars?.ready ? farMat : bodyMaterial(), 220);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
      this.group.add(mesh);
      this.far.push({ mesh, looks: [L] });
      this.farCount.push(0);
    }
  }

  private farVariant(L: Look) {
    if (L.height < 1.4) return 7;
    if (L.garb === 'guard') return 6;
    const female = L.garb === 'dress' || L.garb === 'nobleGown';
    const c = new THREE.Color(L.cloth);
    const bright = c.r + c.g + c.b;
    const k = bright > 1.6 ? 0 : c.r > c.b + 0.08 ? 1 : c.b > c.r ? 2 : 1;
    return Math.min(5, k * 2 + (female ? 1 : 0));
  }

  private dropMesh(a: Agent) {
    if (a.char) {
      this.chars?.release(a.char);
      a.char = null;
    }
  }

  private draw(camera: THREE.Camera, time: number) {
    const cam = camera.position;
    const visible: { a: Agent; d: number }[] = [];
    for (const a of this.agents.values()) {
      const shown = !a.inside || this.interiors.isLive(a.inside);
      const d = Math.hypot(a.x - cam.x, a.z - cam.z);
      if (!shown || d > FAR_R) { this.dropMesh(a); continue; }
      visible.push({ a, d });
    }
    visible.sort((p, q) => p.d - q.d);
    for (let i = 0; i < this.farCount.length; i++) this.farCount[i] = 0;
    let near = 0;
    for (const { a, d } of visible) {
      const close = d < NEAR_R && near < this.maxNear && !!this.chars?.ready;
      if (close) {
        near++;
        if (!a.char) {
          a.char = this.chars!.make(a.r.look, a.r.seed);
          if (a.r.look.garb === 'guard' || a.r.cast?.id === 'corwyn') a.char.outer.add(spear(a.r.look.height / 1.75));
          this.group.add(a.char.outer);
        }
        // Only the nearest few cast shadows.
        const shadow = near <= 6;
        if (shadow !== a.char.shadow) { a.char.shadow = shadow; a.char.model.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = shadow; }); }
        // Look at the player when they're close and in front.
        const toCam = Math.atan2(cam.x - a.x, cam.z - a.z);
        let rel = toCam - a.yaw;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        const want = d < 6 && Math.abs(rel) < 1.6 && a.mode !== 'sleep' ? rel : 0;
        a.look += (want - a.look) * 0.08;
        const ps = a.pose;
        ps.mode = a.mode; ps.task = a.task; ps.speed = a.speed; ps.phase = a.phase; ps.lookYaw = a.look;
        ps.lookPitch = d < 6 ? Math.atan2(cam.y - (a.y + 1.6 * ps.scale), Math.max(0.5, d)) * 0.6 : 0;
        ps.t = time;
        this.chars!.animate(a.char, ps, Math.min(0.1, Math.max(0, time - (a as any).lastT || 0.016)));
        (a as any).lastT = time;
        a.char.outer.position.set(a.x, a.y, a.z);
        a.char.outer.rotation.set(0, a.yaw, 0);
      } else {
        this.dropMesh(a);
        if (a.inside) continue; // indoors far away: not drawn
        const v = this.farVariant(a.r.look);
        const f = this.far[v];
        const i = this.farCount[v]++;
        if (i >= f.mesh.instanceMatrix.count) continue;
        const bob = a.mode === 'walk' ? Math.abs(Math.sin(a.phase * Math.PI * 2)) * 0.03 : 0;
        const s = a.r.look.height / f.looks[0].height;
        void s;
        this.q.setFromAxisAngle(this.up, a.yaw);
        this.m4.compose(this.v3.set(a.x, a.y + bob, a.z), this.q, this.one.set(s, s, s));
        f.mesh.setMatrixAt(i, this.m4);
      }
    }
    this.far.forEach((f, i) => { f.mesh.count = Math.min(this.farCount[i], f.mesh.instanceMatrix.count); f.mesh.instanceMatrix.needsUpdate = true; });
  }

  // ---------------------------------------------------------------- the player
  /** The person the player is looking at, close enough to talk to. */
  inReach(eye: THREE.Vector3, look: THREE.Vector3): Agent | null {
    let best: Agent | null = null, bs = -Infinity;
    for (const a of this.agents.values()) {
      if (!a.char) continue;
      const dx = a.x - eye.x, dz = a.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.8 || Math.abs(a.y + 1.2 - eye.y) > 1.6) continue;
      const f = (dx * look.x + dz * look.z) / Math.max(0.2, d);
      if (f < 0.75) continue;
      const s = f * 2 - d;
      if (s > bs) { bs = s; best = a; }
    }
    return best;
  }

  /** Hold someone in conversation for a while (they stop and face you). */
  hold(a: Agent, seconds: number) { a.talkT = Math.max(a.talkT, seconds); }
  release(a: Agent) { a.talkT = 0; }

  /** Where a named person is now (walking, or wherever their day has them). */
  whereIs(id: string, hour: number): [number, number] | null {
    const r = this.residents.find((x) => x.cast?.id === id);
    if (!r || (r.cast && !presentAt(r.cast, this.beat))) return null;
    if (r.agent) return [r.agent.x, r.agent.z];
    const g = this.goal(r, hour);
    if (g.b) return this.doorFront(g.b);
    const [x, , z] = this.restPos(r, g);
    return [x, z];
  }

  get activeCount() { return this.agents.size; }
  get drawnNear() { let n = 0; for (const a of this.agents.values()) if (a.char) n++; return n; }
}

let spearGeo: THREE.BufferGeometry | null = null;
const spearMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a3524, roughness: 0.7 });
/** A spear held upright at the right side. */
function spear(s: number) {
  if (!spearGeo) {
    const shaft = new THREE.CylinderGeometry(0.018, 0.022, 2.3, 6); shaft.translate(0, 1.15, 0);
    const tip = new THREE.ConeGeometry(0.035, 0.24, 6); tip.translate(0, 2.42, 0);
    spearGeo = new THREE.BufferGeometry();
    const g = [shaft.toNonIndexed(), tip.toNonIndexed()];
    const pos = new Float32Array(g[0].attributes.position.array.length + g[1].attributes.position.array.length);
    pos.set(g[0].attributes.position.array as Float32Array, 0); pos.set(g[1].attributes.position.array as Float32Array, g[0].attributes.position.array.length);
    spearGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    spearGeo.computeVertexNormals();
  }
  const m = new THREE.Mesh(spearGeo, spearMat);
  m.position.set(-0.27 * s, 0, 0.2 * s);
  m.castShadow = true;
  return m;
}

function turnToward(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}
