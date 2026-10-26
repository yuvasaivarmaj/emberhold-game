# The Blood of Emberhold

A first-person, open-world browser game based on *The Blood of Emberhold*, Part One: *What the Blood Remembers*.

This repository holds **Phase 1: the foundation**. It's a playable stretch of the Verdance, the green river country where Emberhold will stand. You can walk, run, swim and watch the day turn to night. Story, characters and Emberhold itself come in the next phases.

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

## What's in Phase 1

- **World:** a 2 × 2 km region with rolling meadows, a winding river (the Silverrun) and a ring of mountains. A levelled hill to the north-east is the future site of Emberhold.
- **Sky:** a physically based sky with moving clouds, a full day and night cycle, a moon and stars, and atmospheric haze.
- **Lighting:** sun and moon shadows (cascaded), image-based light taken from the sky, bloom, and filmic tone mapping.
- **Grass:** hundreds of thousands of individual blades generated on the GPU, swaying in travelling gusts of wind.
- **Trees:** about a dozen species (oak, ash, aspen, pine, bushes) with wind. They use three levels of detail, down to baked billboards for far forests.
- **Rocks and water:** procedural boulders and river stones with moss, and a river that refracts its bed, darkens with depth and flows.
- **Movement:** a first-person controller with a physics capsule (Rapier). It handles slopes, steps, wading and swimming, plus head bob, landing dip and a field-of-view kick when sprinting.
- **Sound:** wind, the river, birdsong by day, insects at night, and footsteps that change with the surface. All of it is synthesised, so there are no audio files yet.
- **Settings:** four quality presets (Low, Medium, High, Ultra), field of view, mouse sensitivity, volume, time of day and day length.

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

Key constants such as the world size, river path, spawn point and Emberhold site are in `src/world/WorldConfig.ts`.

## Deploying with GitHub Pages

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes the game.

## Credits

- [three.js](https://threejs.org) (MIT): rendering.
- [Rapier](https://rapier.rs) (Apache-2.0): physics.
- [ez-tree](https://github.com/dgreenheck/ez-tree) (MIT) by Daniel Greenheck: procedural tree geometry. Its bark textures are CC0, from Poly Haven and TextureCan.

## Roadmap

1. **Foundation** (this phase): world, sky, lighting, movement, settings.
2. **Emberhold:** the castle and its rings, the Hall of Cinders, the vault stair and the First Forge.
3. **Living world:** people with daily routines, conversations, interaction, objectives, saving.
4. **Vertical slice:** Ilyan's first chapter, playable from start to finish.
5. **Expansion:** Wingfall, the Judgment of Lamps, Rookrest, Seraphel, and switching between characters.
6. **Polish:** cutscenes, voice, music and performance.
