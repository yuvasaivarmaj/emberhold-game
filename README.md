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
| Shift | Run |
| Space | Jump |
| C or Ctrl | Crouch |
| Hold T | Let time pass quickly |
| F3 | Frame rate and position |
| Esc | Menu and settings |

## What's built so far

- **Opening film:** a narrated, subtitled cinematic (Aethryn, the departure, the crossing, the fall out of Scorpius, the wreck at dawn). Hold Space to skip.
- **The Verdance:** an 8 × 8 km baked map with the Silverrun, Quill Brook and Ember Brook, roads, stone bridges, farm parcels of wheat, barley and flax, vineyards, horse pastures, the charcoal woods, oak forest, a lake, high mountains to the north and west, and the outer watchstones on the south road.
- **Emberhold:** three ring walls of pale stone banded with dark fused brick, with towers and gatehouses. The great blackwood gates open on the lower yard, a town of smithies, stables, granary towers, barracks and houses. Above it are the middle courts with the halls of the sworn households and the rookery tower. On the summit stand the Hall of Cinders, the keep, the family and nursery wings, the forge hall with its smoking stack, and the vault stair. Windows light up after dark.
- **Night sky:** 8,700 real stars from the Yale Bright Star Catalogue, turning with sidereal time, plus the Milky Way, a phased moon and Scorpius picked out.
- **Lighting:** cascaded sun and moon shadows, image-based light from the sky, bloom and filmic tone mapping.
- **Grass, trees, rocks and water:** GPU grass that follows the fields and crops, about a dozen tree species with three levels of detail, boulders, and refracting rivers.
- **You:** a first-person body at a person's eye height, with visible hands and arms that sway, swing and react to running, swimming and turning.
- **Saving:** autosaves every 20 seconds and when you pause.
- **Settings:** five quality presets, horizontal field of view, adaptive resolution, show hands, sensitivity, volume, time of day and day length.

## Project layout

```
src/
  core/      Game loop, input, settings
  world/     Terrain, sky, grass, trees, rocks, water, world constants
  physics/   Rapier world and colliders
  player/    First-person controller
  audio/     Procedural ambience and footsteps
  render/    Post-processing pipeline
  ui/        Menus, HUD, styles
```

The map is baked by `tools/bake-world.ts` into `public/data/` (run automatically before `dev` and `build`, or by hand with `npm run bake`). The layout of rivers, roads and places is in `src/world/Layout.ts`; Emberhold is built in `src/world/Emberhold.ts`.

## Deploying with GitHub Pages

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes the game.

## Credits

- [three.js](https://threejs.org) (MIT): rendering.
- [Rapier](https://rapier.rs) (Apache-2.0): physics.
- [ez-tree](https://github.com/dgreenheck/ez-tree) (MIT) by Daniel Greenheck: procedural tree geometry. Its bark textures are CC0, from Poly Haven and TextureCan.
- Star positions: the Yale Bright Star Catalogue (5th ed.), via the JSON conversion by Bretton Wade (MIT).

## Roadmap

1. **Foundation:** world, sky, lighting, movement, settings. *Done.*
2. **The Verdance and Emberhold:** the 8 km region, the fort and its rings, the opening film, saving. *Done; interiors to come.*
3. **Quillhaven and horses:** the village on the brown-green bend, the banyan, and riding.
4. **Living world:** people with daily routines, conversations, interaction and objectives.
5. **Vertical slice:** Ilyan's first chapter, playable from start to finish.
6. **Expansion:** the later chapters and switching between characters.
