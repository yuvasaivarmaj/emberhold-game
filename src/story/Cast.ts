// The named people of Emberhold, from the Story Bible, placed on the timeline: who is at
// Emberhold at each beat, where they live, where they spend their days, and how they look.
// Ilyan (the player) is not listed here.
import type { Beat } from './Timeline';
import { reached } from './Timeline';
import type { Look } from '../people/Body';
import { DYES } from '../people/Body';
import type { BuildingKind } from '../world/Buildings';

/** Where in Emberhold: a building (by kind, and household for the sworn halls) or an open place. */
export type Where =
  | { b: BuildingKind; household?: string; level?: 'top' | 'ground'; spot?: 'sit' | 'desk' | 'work' | 'hearth' | 'bed' | 'stand' | 'serve' | 'seat' }
  | { out: 'greatCourt' | 'trainingYard' | 'forgeCourt' | 'nurseryGarden' | 'southAvenue' | 'northAvenue' | 'innerGate'; task?: string };

export interface CastMember {
  id: string;
  name: string;
  /** One line on who they are, shown under the name when you talk to them. */
  who: string;
  household: string;
  home: Where;
  /** [fromHour, toHour, where] — the rest of the time they're at home (in bed at night). */
  day: [number, number, Where][];
  /** Present at Emberhold from this beat (born or arrived)... */
  from?: Beat;
  /** ...until this beat (dies or leaves for good). */
  until?: Beat;
  /** Away from Emberhold between these beats. */
  away?: [Beat, Beat][];
  look: Look;
}

const noble = (o: Partial<Look>): Look => ({
  garb: 'noble', height: 1.78, build: 1, skin: 0xd0a283, hair: 0x2a1d14, hairStyle: 'short', beard: false,
  cloth: DYES.black, cloth2: DYES.madder, legs: DYES.charcoal, boots: DYES.black, cloak: DYES.madder, apron: null, helmet: false, ...o,
});
const lady = (o: Partial<Look>): Look => noble({ garb: 'nobleGown', height: 1.66, hairStyle: 'long', cloak: null, cloth: DYES.madder, cloth2: DYES.black, ...o });
const sworn = (o: Partial<Look>): Look => ({
  garb: 'robe', height: 1.74, build: 1, skin: 0xc89a78, hair: 0x2a1d14, hairStyle: 'short', beard: false,
  cloth: DYES.navy, cloth2: DYES.linen, legs: DYES.charcoal, boots: DYES.darkLeather, cloak: null, apron: null, helmet: false, ...o,
});

export const CAST: CastMember[] = [
  // ---------------------------------------------------------------- House Vaelaros
  {
    id: 'maelor', name: 'Lord Maelor Vaelaros', who: 'Lord of Emberhold', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[8, 12, { b: 'hallOfCinders', spot: 'seat' }], [13, 16, { b: 'forgeHall' }], [16, 18, { out: 'greatCourt' }]],
    away: [['ch3', 'ch7']], until: 'ch22',
    look: noble({ height: 1.86, build: 1.08, beard: true, hair: 0x16110e }),
  },
  {
    id: 'saelys', name: 'Lady Saelys', who: 'Lady of Emberhold, Maelor\'s wife', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[10, 11, { b: 'nurseryWing' }], [15, 16, { out: 'nurseryGarden' }]],
    look: lady({ hair: 0x3f2b1c, build: 1.08 }),
  },
  {
    id: 'vaenora', name: 'Lady Vaenora Vaelaros', who: 'Maelor\'s great-aunt, eldest of the blood', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[9, 11, { out: 'greatCourt' }], [14, 15, { b: 'hallOfCinders', spot: 'sit' }]],
    look: lady({ height: 1.58, build: 0.9, hair: 0xb8b4ac, hairStyle: 'coif', cloth: DYES.black, cloth2: DYES.grey, skin: 0xc89a78 }),
  },
  {
    id: 'daevon', name: 'Daevon Vaelaros', who: 'Maelor\'s younger brother', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[8, 12, { out: 'trainingYard', task: 'spar' }], [13, 17, { b: 'forgeHall' }], [17, 19, { out: 'trainingYard', task: 'spar' }]],
    look: noble({ height: 1.82, beard: false, hair: 0x2a1d14, cloak: null, cloth: DYES.charcoal }),
  },
  {
    id: 'vaelor', name: 'Vaelor Vaelaros', who: 'Maelor\'s cousin, a heavy-set axeman', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[8, 12, { out: 'trainingYard', task: 'spar' }], [13, 17, { out: 'trainingYard', task: 'spar' }]],
    away: [['ch3', 'ch7']],
    look: noble({ height: 1.8, build: 1.22, beard: true, cloak: null, cloth: DYES.brown }),
  },
  {
    id: 'aelyx', name: 'Ser Aelyx Vaelaros', who: 'A knight of the blood, Goat-gifted', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[8, 11, { out: 'trainingYard', task: 'spar' }], [14, 17, { out: 'greatCourt' }]],
    until: 'ch3',
    look: noble({ height: 1.8, hair: 0x5a3a22 }),
  },
  {
    id: 'naelith', name: 'Lady Naelith Vaelaros', who: 'Goat-gifted; they say she listens to rooms', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[9, 12, { b: 'records', spot: 'desk' }], [15, 17, { out: 'greatCourt' }]],
    until: 'ch3',
    look: lady({ height: 1.7, hair: 0x16110e, hairStyle: 'tied', cloth: DYES.charcoal, cloth2: DYES.madder }),
  },
  {
    id: 'aurek', name: 'Aurek Vaelaros', who: 'A kinsman of the blood, sharp-tongued', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[10, 13, { out: 'greatCourt' }], [15, 18, { b: 'hallOfCinders', spot: 'sit' }]],
    until: 'ch3',
    look: noble({ height: 1.76, hair: 0x3f2b1c, cloth: DYES.charcoal, cloak: DYES.black }),
  },
  {
    id: 'maerra', name: 'Lady Maerra Vaelaros', who: 'Sister of Maelor\'s late father', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[9, 12, { b: 'hallOfCinders', spot: 'sit' }], [14, 16, { out: 'greatCourt' }]],
    look: lady({ height: 1.64, hair: 0x8a8680, hairStyle: 'tied', cloth: DYES.madder, cloth2: DYES.black }),
  },
  {
    id: 'maeron', name: 'Ser Maeron Vaelaros', who: 'Maelor\'s cousin, a careful man', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[9, 12, { b: 'records', spot: 'desk' }], [14, 17, { out: 'greatCourt' }]],
    look: noble({ height: 1.76, beard: true, hair: 0x3f2b1c, cloak: DYES.charcoal }),
  },
  {
    id: 'rhessa', name: 'Lady Rhessa Vaelaros', who: 'A Goat-gifted elder of the blood', household: 'Vaelaros',
    home: { b: 'familyWing' },
    day: [[6, 7, { out: 'greatCourt' }], [11, 13, { out: 'greatCourt' }], [16, 17, { b: 'records', spot: 'desk' }]],
    look: lady({ height: 1.6, build: 0.88, hair: 0xb8b4ac, hairStyle: 'long', cloth: DYES.grey, cloth2: DYES.black }),
  },
  {
    id: 'corwyn', name: 'Corwyn Bramble', who: 'A spearman of seventeen', household: 'Ashmantle',
    home: { b: 'swornHall', household: 'Ashmantle' },
    day: [[7, 12, { out: 'trainingYard', task: 'drill' }], [13, 18, { out: 'trainingYard', task: 'drill' }]],
    away: [['ch3', 'ch7']],
    look: { garb: 'tunic', height: 1.8, build: 1.02, skin: 0xc89a78, hair: 0x2a1d14, hairStyle: 'short', beard: false,
      cloth: DYES.charcoal, cloth2: DYES.brown, legs: DYES.brown, boots: DYES.darkLeather, cloak: null, apron: null, helmet: false },
  },
  // ---------------------------------------------------------------- The sworn households
  {
    id: 'otherys', name: 'Lord Minister Otherys Vhassarin', who: 'Keeper of the secret records. Your father.', household: 'Vhassarin',
    home: { b: 'swornHall', household: 'Vhassarin' },
    day: [[8, 12, { b: 'records', spot: 'desk' }], [13, 18, { b: 'swornHall', household: 'Vhassarin', level: 'top', spot: 'desk' }]],
    look: sworn({ height: 1.72, hair: 0x8a8680, beard: true, patch: true } as Partial<Look>),
  },
  {
    id: 'talen', name: 'Talen Vhassarin', who: 'Steward and cipher keeper', household: 'Vhassarin',
    home: { b: 'swornHall', household: 'Vhassarin' },
    day: [[7, 12, { b: 'swornHall', household: 'Vhassarin', level: 'top', spot: 'desk' }], [13, 18, { b: 'swornHall', household: 'Vhassarin', level: 'top', spot: 'desk' }]],
    look: sworn({ height: 1.7, hair: 0x3f2b1c, cloth: DYES.charcoal }),
  },
  {
    id: 'ryndon', name: 'Ryndon Qelbar', who: 'A Qelbar man you never quite remember meeting', household: 'Qelbar',
    home: { b: 'swornHall', household: 'Qelbar' },
    day: [[8, 12, { out: 'southAvenue' }], [13, 17, { out: 'northAvenue' }], [19, 22, { b: 'inn', spot: 'sit' }]],
    until: 'ch10',
    look: { garb: 'tunic', height: 1.74, build: 0.98, skin: 0xc89a78, hair: 0x3f2b1c, hairStyle: 'short', beard: false,
      cloth: DYES.brown, cloth2: DYES.undyed, legs: DYES.grey, boots: DYES.leather, cloak: DYES.brown, apron: null, helmet: false },
  },
  {
    id: 'boryn', name: 'Boryn Ashmantle', who: 'Elder of the Ashmantles, keepers of the furnace keys', household: 'Ashmantle',
    home: { b: 'swornHall', household: 'Ashmantle' },
    day: [[6, 12, { b: 'forgeHall', spot: 'work' }], [13, 18, { b: 'forgeHall', spot: 'work' }]],
    look: { garb: 'smith', height: 1.76, build: 1.18, skin: 0xb98463, hair: 0x8a8680, hairStyle: 'short', beard: true,
      cloth: DYES.charcoal, cloth2: DYES.brown, legs: DYES.charcoal, boots: DYES.black, cloak: null, apron: DYES.darkLeather, helmet: false },
  },
  {
    id: 'malla', name: 'Malla', who: 'A nursery servant', household: 'Vaelaros',
    home: { b: 'nurseryWing' },
    day: [[6, 21, { b: 'nurseryWing', spot: 'work' }]],
    look: { garb: 'dress', height: 1.6, build: 1.0, skin: 0xd0a283, hair: 0x5a3a22, hairStyle: 'coif', beard: false,
      cloth: DYES.undyed, cloth2: DYES.linen, legs: DYES.brown, boots: DYES.leather, cloak: null, apron: DYES.linen, helmet: false },
  },
];

/** Is this person at Emberhold at this point in the story? */
export function presentAt(c: CastMember, now: Beat) {
  if (c.from && !reached(now, c.from)) return false;
  if (c.until && reached(now, c.until)) return false;
  for (const [a, b] of c.away ?? []) if (reached(now, a) && !reached(now, b)) return false;
  return true;
}

/**
 * Not walking about, but part of the story at this beat (shown to the player through what
 * people say): the dead of the house and the unborn heir.
 */
export const OFFSTAGE = {
  vaegor: 'Lord Vaegor, Maelor\'s father, is dead. He had Orryn Ashmantle burned.',
  orryn: 'Orryn Ashmantle, captain of the furnace guard, was burned on Lord Vaegor\'s order.',
  aeryon: 'The heir is not yet born.',
};
