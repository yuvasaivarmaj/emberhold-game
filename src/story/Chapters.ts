// The story's chapters as the game knows them. Playable content is added chapter by chapter.

export interface Chapter {
  id: string;
  part: string;
  title: string;
  character: string;
  place: string;
  objective: string;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'prologue',
    part: 'Prologue',
    title: 'The Night the Scorpion Bled',
    character: '',
    place: 'Aethryn, and the Verdance',
    objective: '',
  },
  {
    id: 'verdance',
    part: 'Part One · What the Blood Remembers',
    title: 'The Verdance',
    character: 'Ilyan Vhassarin',
    place: 'South bank of the Silverrun',
    objective: 'Explore the Verdance. Emberhold stands on the hill across the river.',
  },
];

export const chapterById = (id: string) => CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[1];
