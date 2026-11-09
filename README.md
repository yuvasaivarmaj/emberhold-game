# The Blood of Emberhold

A first-person, open-world browser game based on *The Blood of Emberhold*, Part One: *What the Blood Remembers*.

The game opens with a narrated film of the night the Scorpion bled: Aethryn's fall, the crossing, and the ship that came down out of Scorpius. Then you are Ilyan Vhassarin, on the south road of the Verdance with Emberhold on its hill ahead. The region is 8 × 8 km and the fort itself is about a kilometre across. The main menu offers **Continue** (it remembers where you are in the story) and **New Game**.

## Play

- **Online:** once GitHub Pages is enabled (see below), the game is published at `https://yuvasaivarmaj.github.io/emberhold-game/`.
- **Locally:** `npm install`, then `npm run dev`, and open the address it prints.

Works best in a recent Chrome or Edge, which use WebGPU. Other browsers fall back to WebGL 2 automatically.

### Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Mouse | Look |
| Shift | Run (on horseback: canter, then gallop) |
| Space | Jump; at a ledge, climb it |
| C or Ctrl | Crouch (on horseback: keep to a walk) |
| E | Open or close a door, talk to someone, mount or dismount a horse |
| 1 – 4 | Choose what to say in a conversation (E or Space to go on, walk away to leave) |
| F | Break off a branch; hold to light it |
| C + F (hold) | Grind a lit torch into the earth |
| Q | Drop the branch |
| M | Map |
| Hold T | Let time pass quickly |
| F3 | Frame rate and position |
| Esc | Menu and settings |

## What's built so far

- **Opening film:** told in hand-drawn ink-and-wash panels, narrated and subtitled. It covers Aethryn and its fire-hounds, the smiths and their blood-bound ore, the Doom, the flight of the houses, the dark that took them, the one ship that fell out of Scorpius, the first forge, and the other ship that drifted in centuries late. Hold Space to skip.
- **The Verdance:** an 8 × 8 km baked map with the Silverrun, Quill Brook and Ember Brook, roads, humped stone bridges on arches and piers with cutwaters and parapets, farm parcels of wheat, barley and flax, vineyards, horse pastures, the charcoal woods, oak forest, a lake, high mountains to the north and west, and the outer watchstones on the south road.
- **Emberhold:** three ring walls of pale stone banded with dark fused brick, with towers and gatehouses. The great blackwood gates open on the lower yard, a town of smithies, stables, granary towers, barracks and houses. Above it are the middle courts with the halls of the sworn households and the rookery tower. On the summit stand the Hall of Cinders, the keep, the family and nursery wings, the forge hall with its smoking stack, and the vault stair. Windows light up after dark.
- **A living Emberhold:** every one of its 728 buildings is a hollow building with a real door you can open, and an interior furnished for what it is. Houses have hearths, tables, beds upstairs and stairs to reach them. Smithies have forges and anvils, and there are stables, bakeries, chandleries, weavers, cooperages, two alehouses and barracks. On the summit are kitchens, a bakehouse, stores, servants' halls, record houses and the forge hall. Interiors are built only as you come near. Doors lock at night, and the family's rooms, the keep and the vault stair stay shut to a Vhassarin apprentice.
- **The Hall of Cinders:** a long hall of pillars with the dais and high seat, two long tables, hearths in the side walls, the house's red between the pillars, and the great beam carved *The blood does not leave the blood*.
- **The people of Emberhold:** about 2,300 residents, each with a home and a bed, a trade or a post, and a day that follows the clock. Smiths hammer at the anvil, bakers knead, clerks write in the cipher room and sellers keep the market stalls on the gate avenues. Children play in the lanes, guards stand the gates in day and night shifts, watchmen walk the streets, and people run errands, go to the alehouse in the evening and sleep at night. They open doors, climb stairs, sit at tables and turn to look at you. Up close they are real people: textured human bodies with faces, hands and hair, dressed by trade and rank in tunics, hose and boots, gowns, aprons, cloaks, coats, coifs and caps, guards in the red tabard with helmets, and they walk, jog, sit, sleep and work with full-body animation. Farther off they become light baked figures in the same clothes. Walk up and press E to talk.
- **The named cast, on the story's timeline:** Lord Maelor, Lady Saelys, Lady Vaenora, Daevon, Vaelor, Corwyn Bramble, Ser Aelyx, Lady Naelith, Aurek, Lady Maerra, Ser Maeron, Lady Rhessa, Otherys and Talen Vhassarin, Ryndon Qelbar, Boryn Ashmantle and Malla. Each lives where the Story Bible puts them and keeps their own day. Who is at Emberhold follows the timeline in `src/story/Timeline.ts`: it is the time before the heir's birth, so the heir is not yet born and nobody knows what comes later.
- **Ilyan's ordinary day:** report to Talen in the cipher room, fetch the furnace tally from Boryn Ashmantle, take it to your father, catch your first look at the vault stair, and go home. The map and minimap point the way.
- **Streets and walls:** market stalls, wells, carts, barrels and hay, trade signs and Vaelaros banners. Braziers and torches are lit at dusk at the gates, the great doors and the summit court, and stone stairs lead up onto the outer wall walk.
- **Quillhaven:** the leaning square tower of House Quillayne with its three additions and two weak walls, the rookery larger than the chapel, the chapel's crooked bell, the market green with its stalls and well, the Green Perch (with its sign), the counting hall, the granary on staddle stones, the scribe-house, saddle-house and west store, the mill with its turning wheel on the Quill Brook, the north bridge and its bell, rooks wheeling over the old elms, and the old banyan with its hanging roots outside the village.
- **Horses:** procedural horses with jointed legs and real gaits (walk, trot, canter, gallop), grazing and wandering in the Maegyr horse fields east of Emberhold, tied by the stables and the Green Perch. Ilyan's own horse, Ashfoot, waits by the south road. Ride any saddled or unsaddled horse with **E**: W to trot, Shift to canter and then gallop, Ctrl to keep to a walk, S to rein in, A and D to turn. You see the neck and ears ahead and your hands on the reins, and you hear the hoofbeats change from grass to road.
- **Night sky:** 8,700 real stars from the Yale Bright Star Catalogue, turning with sidereal time, plus the Milky Way, a phased moon and Scorpius picked out.
- **Lighting:** cascaded sun and moon shadows, image-based light from the sky, bloom and filmic tone mapping.
- **Grass, trees, rocks and water:** GPU grass that follows the fields and crops, about a dozen tree species with three levels of detail, boulders, and refracting rivers.
- **You:** a first-person body at a person's eye height, with real jointed hands. The arms swing with each step, pump when you run, lift as you jump, hold the reins on horseback and swim a breaststroke. Walking and running have weight, the head bobs with each footfall, and footsteps sound different on grass, gravel, flagstones, rock, mud and water.
- **Climbing:** jump at a ledge up to about 2.4 m (low walls, rocks, parapets) to pull yourself up and over.
- **Torches:** snap a branch off a tree, strike your tinderbox to light it, and carry it through the dark, on horseback too. Put it out by plunging it into water or grinding it into the earth. It burns down in about a quarter of an hour.
- **Map and guidance:** an ink map of the Verdance drawn from the real terrain (M), a minimap that turns with you, places announced as you discover them, a things-to-do panel and a hint feed.
- **Saving:** autosaves every 20 seconds and when you pause.
- **Settings:** five quality presets, horizontal field of view, adaptive resolution, show hands, sensitivity, volume, time of day and day length.

## Project layout

```
src/
  core/      Game loop, input, settings
  world/     Terrain, sky, grass, trees, rocks, water, world constants
  physics/   Rapier world and colliders
  people/    Townsfolk: bodies, animation, navigation, daily life
  story/     Timeline, named cast, dialogue, chapters, saving
  player/    First-person controller
  audio/     Procedural ambience and footsteps
  render/    Post-processing pipeline
  ui/        Menus, HUD, styles
```

Townsfolk models are built by `tools/people/build_people.py` (Python, numpy and Pillow): it reads the CC0 base bodies and animation library in `tools/people/base/`, fits the garments to each body (shells offset along the skin, skirts and gowns lathed around the legs, all skinned to the same skeleton), weaves cloth and leather textures, and writes `public/models/people/`. Run it again with `python3 tools/people/build_people.py` after changing it.

The map is baked by `tools/bake-world.ts` into `public/data/` (run automatically before `dev` and `build`, or by hand with `npm run bake`). The layout of rivers, roads and places is in `src/world/Layout.ts`; Emberhold is built in `src/world/Emberhold.ts`, with its building registry in `Buildings.ts`, doors in `Doors.ts`, interiors in `Interiors.ts` and street furniture in `Props.ts`. People live in `src/people/`. The story's timeline, cast and dialogue are in `src/story/`; the dialogue in `Dialogue.ts` is draft writing, meant to be edited.

## Deploying with GitHub Pages

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes the game.

## Credits

- [three.js](https://threejs.org) (MIT): rendering.
- [Rapier](https://rapier.rs) (Apache-2.0): physics.
- [ez-tree](https://github.com/dgreenheck/ez-tree) (MIT) by Daniel Greenheck: procedural tree geometry. Its bark textures are CC0, from Poly Haven and TextureCan.
- Hand models: the generic hands from [@webxr-input-profiles/assets](https://github.com/immersive-web/webxr-input-profiles) (MIT), posed in code.
- Townsfolk bodies: Kevin and Keisha, from the AI-made cast of the [Dramatis](https://github.com/tonioloewald/dramatis3d) character library by Tonio Loewald (CC0-1.0). The clothes are generated from them by `tools/people/build_people.py` (CC0-1.0).
- Townsfolk animation: the [Universal Animation Library](https://quaternius.com) by Quaternius (CC0-1.0).
- Star positions: the Yale Bright Star Catalogue (5th ed.), via the JSON conversion by Bretton Wade (MIT).

## Roadmap

1. **Foundation:** world, sky, lighting, movement, settings. *Done.*
2. **The Verdance and Emberhold:** the 8 km region, the fort and its rings, the opening film, saving. *Done; interiors to come.*
3. **Quillhaven and horses:** the village on the brown-green bend, the banyan, and riding. *Done.*
4. **Living world:** people with daily routines, conversations, interaction and objectives. *Emberhold done; Quillhaven to come.*
5. **Vertical slice:** Ilyan's first chapter, playable from start to finish.
6. **Expansion:** the later chapters and switching between characters.
