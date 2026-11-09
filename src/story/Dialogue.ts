// What people say. Named characters have short conversations written for the current
// point in the story (the 'verdance' beat: Ilyan's ordinary day, before the heir is born,
// before any royal letter, before Wingfall). Townsfolk say a line that fits their trade and
// the hour. Nothing here knows what happens later in Part One.
//
// This file is meant to be edited: the lines are drafts in each character's voice as the
// Story Bible describes them.
import type { Beat } from './Timeline';
import type { RoleId } from '../people/Population';

export interface Choice { label: string; next?: string; set?: string[] }
export interface Node { text: string; choices?: Choice[]; set?: string[] }
export type Talk = Record<string, Node>;

type Flags = Record<string, unknown>;
const has = (f: Flags, k: string) => !!f[k];

/** A conversation with a named character, for this beat and these story flags. */
export function castTalk(id: string, beat: Beat, f: Flags, hour: number): Talk {
  void beat;
  const late = hour >= 21 || hour < 6;
  switch (id) {
    case 'talen':
      if (!has(f, 'q.reported')) return {
        start: { text: 'There you are. The south road again? Your father counts the hours you\'re gone, and so do I.', choices: [
          { label: 'I was copying the marks on the watchstones.', next: 'stones' },
          { label: 'I\'m here now. What needs doing?', next: 'task' },
        ] },
        stones: { text: 'Copy them on your own time. The house has older marks than those, and none of them are yours to copy.', choices: [{ label: 'Yes, Talen.', next: 'task' }] },
        task: { text: 'The furnace tally. Boryn Ashmantle keeps it at the forge hall, on the north side of the summit. Bring it to your father, and don\'t let anyone read it on the way.', set: ['q.reported'], choices: [{ label: 'I\'ll fetch it.' }] },
      };
      if (!has(f, 'q.tally')) return { start: { text: 'The forge hall, Ilyan. North side of the summit. Boryn Ashmantle. Go.' } };
      if (!has(f, 'q.delivered')) return { start: { text: 'Don\'t show it to me. It goes to your father. Mornings he\'s at the record house on the summit; afternoons, up here with us.' } };
      return { start: { text: late ? 'Go to bed, Ilyan. The tolls will still be wrong in the morning.' : 'Tomorrow you start on the toll rolls. Every cart through the south gate this moon, and what it carried.' } };

    case 'boryn':
      if (has(f, 'q.reported') && !has(f, 'q.tally')) return {
        start: { text: 'Vhassarin. So Talen sends the boy for the tally now.', choices: [
          { label: 'He sends his apprentice.', next: 'give' },
          { label: 'Is it ready?', next: 'give' },
        ] },
        give: { text: 'Every bar that went into the fire today, and every bar that came out. The house counts what it spends. Straight to the Minister, and nobody else\'s hands.', set: ['q.tally'], choices: [{ label: 'Straight to him.' }] },
      };
      return { start: { text: 'Ashmantles keep the furnace keys. We kept them before your grandfather could hold a pen. Keep your hands back from the fire.' } };

    case 'otherys':
      if (has(f, 'q.tally') && !has(f, 'q.delivered')) return {
        start: { text: 'Let me see it.', choices: [{ label: 'Hand him the tally.', next: 'read' }] },
        read: { text: 'Two bars fewer than yesterday, and Boryn\'s hand on every line. Good. You didn\'t open it?', choices: [
          { label: 'No.', next: 'vault' },
          { label: 'I only looked at the seal.', next: 'seal' },
        ] },
        seal: { text: 'Then you know the seal. That\'s enough knowing for one day.', choices: [{ label: 'Yes, father.', next: 'vault' }] },
        vault: { text: 'Go back by the north court. You\'ll pass a low stone house by the forge hall: the vault stair. Look at its door, and remember it. Everything this house is, it keeps below. You\'re Vhassarin: you\'ll learn its numbers before you\'re thirty. You will never learn its door.', set: ['q.delivered'], choices: [{ label: 'I\'ll remember.' }] },
      };
      if (has(f, 'q.delivered') && !has(f, 'q.vault')) return { start: { text: 'The north court. The vault stair. Look, and come home.' } };
      return { start: { text: late ? 'Still up? Numbers keep. Go to sleep.' : 'Mind your numbers, Ilyan. A Vhassarin who loses count loses more than the count.' } };

    case 'maelor': return {
      start: { text: 'You\'re Otherys\'s boy. Ilyan.', choices: [
        { label: 'My lord.', next: 'a' },
        { label: 'My lord, is the lady\'s time near?', next: 'b' },
      ] },
      a: { text: 'Your father tells me you forget nothing. Good. Then you won\'t forget that everything you copy belongs to the house.' },
      b: { text: 'Near enough that half the summit asks me, and I answer them all the same way: when it comes, the house will know. Back to your desk.' },
    };
    case 'saelys': return { start: { text: 'Don\'t fuss, Vhassarin. Half the summit asks me how I\'m keeping. I\'m keeping.' } };
    case 'vaenora': return { start: { text: 'Otherys\'s boy. Stand up straight. The ministers of this house used to look like men who could carry a secret.' } };
    case 'daevon': return { start: { text: 'Want to hold a spear, ink-boy? No? Then stand back from the yard before someone mistakes you for a post.' } };
    case 'vaelor': return { start: { text: 'Mind the axe. It doesn\'t know you.' } };
    case 'aelyx': return { start: { text: 'Speak softly near the halls, Vhassarin. Some of us hear more than we\'d like.' } };
    case 'naelith': return { start: { text: 'This room has been arguing all morning. Record houses always do.' } };
    case 'aurek': return { start: { text: 'A Vhassarin with time to talk. Either the ledgers balance today, or someone\'s lying about them.' } };
    case 'maerra': return { start: { text: 'Everything you copy, you copy for the blood. Never forget whose house this is.' } };
    case 'maeron': return { start: { text: 'Careful what you carry across the courts, lad. Paper travels further than men do.' } };
    case 'rhessa': return {
      start: { text: 'Is it morning? I was sure the old lord was still at table.', choices: [{ label: 'Lady Rhessa?', next: 'b' }] },
      b: { text: 'No. No, Vaegor\'s dead, isn\'t he. Years. It\'s only that the rooms remember him louder than I do.' },
    };
    case 'corwyn': return {
      start: { text: 'Corwyn. Bramble, if you need the rest of it. You\'re the cipher boy.', choices: [{ label: 'Ilyan.', next: 'b' }] },
      b: { text: 'I know. You\'re always running between the halls with something under your arm. Watch the spears when you cut across the yard.' },
    };
    case 'ryndon': return { start: { text: 'Hm? Sorry. Didn\'t see you there. Have we met? People ask me that a lot.' } };
    case 'malla': return { start: { text: 'The nursery\'s ready, near enough. Linen, cradle, a fire that never goes out. Now we wait.' } };
  }
  return { start: { text: '...' } };
}

/** A line from someone in the crowd. */
export function bark(role: RoleId, hour: number, n: number): string {
  if (hour >= 22 || hour < 5) {
    const night = ['It\'s late, Vhassarin. Go home.', 'Hm? Oh. Goodnight.', 'Shouldn\'t you be abed?'];
    if (role === 'gateGuard' || role === 'patrol' || role === 'doorGuard' || role === 'roadWatch') return pick(['Quiet night. Keep it that way.', 'Move along.', 'Lamps are lit. Off home with you.'], n);
    return pick(night, n);
  }
  const L: Partial<Record<RoleId, string[]>> = {
    smith: ['Mind the sparks.', 'Iron for the yard, steel for the summit. Always been that way.', 'The great stack\'s smoking heavy today. Something\'s being worked up there.', 'Hand me that— no. Never mind. Ink on your fingers.'],
    apprentice: ['Can\'t stop, the master\'s watching.', 'Three more hours on the bellows. My arms are dead.', 'Is it true the Vhassarin can read anything? Even the summit\'s marks?'],
    baker: ['First loaves went up the hill at dawn. The summit eats before the yard does.', 'Flour\'s dear this moon. Ask your lot, they count it.', 'Mind the oven door.'],
    chandler: ['Tallow for the yard, beeswax for the summit.', 'The lampwardens want more candles than ever this moon.'],
    weaver: ['Mind the threads.', 'Red for the Vaelaros, and red\'s the hardest dye to get right.'],
    cooper: ['A barrel\'s only as good as its hoops.', 'Half of these go to the granaries before harvest.'],
    alewife: ['Ale\'s a copper. Talk\'s free, but nobody here talks to a Vhassarin.', 'Sit if you\'re sitting.'],
    potboy: ['Coming through!', 'Mind your feet.'],
    groom: ['Marrowyn horses. Best in the Verdance, and they know it.', 'Mind his back legs.', 'He\'s been off his feed. Don\'t write that down.'],
    gateGuard: ['Keep to the road, Vhassarin.', 'Quiet on the south road today. Carts and dust.', 'Halvane have the inner doors. We have the gates. Everyone has their door.'],
    doorGuard: ['Not past here. Family only.', 'Halvane keep the inner doors. That\'s the oath.', 'Move along, Vhassarin.'],
    patrol: ['Evening.', 'Move along.', 'Mind the drain, it\'s been blocked since the rain.'],
    servant: ['Excuse me, the kitchens want this before the bell.', 'The lady\'s rooms want fresh linen twice a day now.', 'If you see Talen, tell him the stores are short again.'],
    cook: ['If you\'re hungry, the yard has bread. The summit\'s pots aren\'t for you.', 'Out of my way unless you\'re carrying onions.'],
    clerk: ['Ilyan. Talen\'s been asking where you were.', 'Six columns, and none of them agree.', 'Don\'t touch that pile. Those are the tolls.'],
    furnaceKeeper: ['The keys stay with us. Always have.', 'Stand back from the door. The heat comes through.'],
    roadWatch: ['Nothing on the south road but carts and dust.', 'Riders come in, we mark them. Riders go out, we mark them too.'],
    townsman: ['They say the lady\'s time is close.', 'Ashen Lords up there, and us down here. Suits me.', 'Seen the forge smoke at night? Like the hill\'s breathing.', 'The lampwarden lit the lamps late last night. Nobody said why.', 'Good day.'],
    townswoman: ['They say the lady\'s time is close.', 'The well queue was out to the lane this morning.', 'You\'re the Minister\'s boy. You\'ve his look.', 'Good day to you.'],
    child: ['Are you a Vhassarin? Can you read my name?', 'Race you to the well!', 'My da says the summit has a hole that goes down forever.'],
    swornElder: ['Mind your father, boy.', 'The halls were quieter when I was young. No, they weren\'t.'],
    nurse: ['Shh. The lady\'s resting.', 'Everything\'s ready but the child.'],
  };
  return pick(L[role] ?? ['Good day.'], n);
}
const pick = (a: string[], n: number) => a[Math.abs(Math.floor(n)) % a.length];

/** Ilyan's opening day: what to do next, and where. */
export interface Objective { title: string; text: string; target: string | null; done?: boolean }
export function objective(f: Flags, inEmberhold: boolean): Objective {
  const title = 'An ordinary day';
  if (!has(f, 'q.reported')) return { title, text: inEmberhold
    ? 'Report to Talen in the cipher room, upstairs in the Vhassarin hall (the hall with the rookery tower, in the middle courts).'
    : 'Go home to Emberhold, across the river, and report to Talen in the cipher room of the Vhassarin hall.', target: 'talen' };
  if (!has(f, 'q.tally')) return { title, text: 'Fetch the day\'s furnace tally from Boryn Ashmantle at the forge hall, on the north side of the summit.', target: 'boryn' };
  if (!has(f, 'q.delivered')) return { title, text: 'Take the tally to your father, Lord Minister Otherys. Mornings he works at the record house on the summit; afternoons in the cipher room.', target: 'otherys' };
  if (!has(f, 'q.vault')) return { title, text: 'Go back by the north court and look at the vault stair, as your father told you.', target: 'vault' };
  if (!has(f, 'q.home')) return { title, text: 'Go home to the Vhassarin hall. The day is done.', target: 'home' };
  return { title, text: 'Ilyan\'s first day is done. The story continues with the heir\'s birth, which isn\'t in the game yet. Emberhold is yours to wander.', target: null, done: true };
}
