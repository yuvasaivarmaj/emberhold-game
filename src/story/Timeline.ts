// Part One's timeline as the game knows it: the order of the story's beats, from the
// Story Bible (chapter by chapter). Everything that depends on "when" in the story (who is
// alive, who is at Emberhold, which doors are open) asks this file, so the world never runs
// ahead of the story.

export type Beat =
  | 'prologue'      // the opening film: Aethryn, the crossing, the ship out of Scorpius
  | 'verdance'      // Ilyan's opening: daily life at Emberhold, before the heir is born
  | 'heirBorn'      // Aeryon's double-gifted birth under a red moon
  | 'ch1'           // The Secret in the Forge: Maelor visits the sealed First Forge
  | 'ch2'           // The Six-Moon Ledger: Quillhaven's coded warning; the royal letter
  | 'ch3'           // The Courtesy That Cut: Maelor at Wingfall
  | 'ch5'           // The Seven at Dawn: the Judgment of Lamps
  | 'ch7'           // Ashes Returned to Emberhold: homecoming and funeral
  | 'ch10'          // The House Counts Its Blood: fourteen rooks sent, and Ryndon in secret
  | 'ch20'          // The Blood Under the Tree: Ryndon killed at the banyan
  | 'ch22'          // The First Mistake: Maelor killed at Emberhold
  | 'ch24';         // The Crown Behind the Gate: Daevon crowned keeper

export const BEATS: Beat[] = ['prologue', 'verdance', 'heirBorn', 'ch1', 'ch2', 'ch3', 'ch5', 'ch7', 'ch10', 'ch20', 'ch22', 'ch24'];

export const beatIndex = (b: Beat) => BEATS.indexOf(b);

/** Is `now` at or after `b`? */
export const reached = (now: Beat, b: Beat) => beatIndex(now) >= beatIndex(b);

/** The beat the game's current chapter sits at. */
export function beatForChapter(chapter: string): Beat {
  if (chapter === 'prologue') return 'prologue';
  return (BEATS as string[]).includes(chapter) ? chapter as Beat : 'verdance';
}
