# Space Fodder

A top-down squad shooter in the spirit of the classic 1993 genre-definer *Cannon Fodder*: you lead a line of armoured drop troopers across alien worlds and try to bring as many of them home as you can. The enemies are an insectoid alien swarm. Everything in the game (art, sound, music, names, missions) is original and generated in code. No assets from any existing game or film are used.

Retro rules, modern rendering: pseudo-3D cliffs with cast shadows, dynamic lighting on night missions, bioluminescent flora, persistent blood, scorch marks and footprints, particle explosions, weather, and a dropship that flies the squad in and out.

## Play

No build step. Open `index.html` in a browser, or serve the folder:

```sh
npx serve .
```

Progress is saved in your browser's localStorage.

## Controls

| Input | Action |
| --- | --- |
| Left click / hold | Move the squad. Troopers follow the leader in a line. |
| Right click / hold, or `F` | Every trooper fires at the cursor. |
| `Space`, `E`, middle click, or both buttons | Leader throws a grenade or fires a rocket at the cursor. |
| `1` / `2`, `Q` or `Tab` | Choose grenades or rockets. |
| `Esc` / `P` | Pause. `M` mutes. |
| Ctrl + click | Fire, for one-button trackpads. |
| Touch | Tap to move. Fire and Bomb auto-aim at the nearest threat. |

## The campaign

Twelve missions across five worlds: a dust world, a bioluminescent jungle, a frozen moon, volcanic badlands and the alien hive world. Objectives mix wiping out hostiles, destroying hive nests (explosives only), escorting colonists to an extraction beacon, and a final boss.

- Every trooper has a name and a rank. Survivors are promoted after a win and get tougher, faster and more accurate.
- The dead go on the Wall of the Fallen and are replaced from a reserve of 60 recruits. When the reserve and the barracks are empty, the campaign is lost.
- Explosions hurt your own troopers. Troopers cannot fire while wading. Acid burns and lava blocks the way. Fuel canisters explode when shot.

### Aliens

- **Skitter**: small, fast, attacks in packs with a zig-zag charge.
- **Spitter**: keeps its distance and lobs acid that splashes.
- **Brute**: armoured, slow, charges. Rockets and grenades work best.
- **Hive nest**: keeps hatching aliens while troopers are nearby. Rifles bounce off.
- **Brood mother**: the final boss.

## Code layout

| File | Purpose |
| --- | --- |
| `js/util.js` | Math, seeded RNG, value noise, colour helpers, names and ranks |
| `js/input.js` | Mouse, keyboard and touch input |
| `js/audio.js` | Synthesised sound effects and a small music sequencer (Web Audio) |
| `js/terrain.js` | Biomes, procedural map generation, A* pathfinding, flow fields, terrain rendering |
| `js/sprites.js` | Vector drawing for troopers, aliens, nests, props and the dropship |
| `js/fx.js` | Particles and permanent decals |
| `js/entities.js` | Trooper, alien, nest and colonist classes and alien AI |
| `js/world.js` | A mission in progress: squad movement, weapons, objectives, rendering and lighting |
| `js/missions.js` | Campaign data |
| `js/game.js` | Screens, HUD, camera, persistence and the main loop |

Plain browser JavaScript with classic `<script>` tags, so it also runs from `file://`.
