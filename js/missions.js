'use strict';
// The campaign: twelve drops across five worlds.

const CAMPAIGN = [
  {
    name: 'First Drop', world: 'Kessik IV', biome: 'dust', size: [60, 46], squad: 4,
    grenades: 3, rockets: 0, objectives: ['killAll'],
    aliens: { skitter: 12 }, nests: 0, crates: { grenades: 1 }, barrels: 2,
    brief: 'Scout drones spotted skitters swarming the dunes near the old survey camp. Clear them out and get a feel for your rifle.',
  },
  {
    name: 'Hatchery Row', vehicles: { crawler: 1 }, world: 'Kessik IV', biome: 'dust', size: [64, 50], squad: 4,
    grenades: 6, rockets: 0, objectives: ['nests'],
    aliens: { skitter: 10 }, nests: 3, nest: { types: ['skitter'], rate: 5.5, max: 4 }, crates: { grenades: 2, medkit: 1 }, barrels: 3,
    brief: 'The swarm is breeding in the canyon. Rifles will not crack a nest. Get close and put a grenade into each one. There is a Crawler buggy parked near the drop zone: click it to climb in.',
  },
  {
    name: 'Dead Air', vehicles: { crawler: 1 }, world: 'Kessik IV', biome: 'dust', size: [66, 52], squad: 5, ambient: [150, 110, 110],
    grenades: 4, rockets: 2, objectives: ['rescue', 'extract'], colonists: 3,
    aliens: { skitter: 14, spitter: 4 }, nests: 1, nest: { types: ['skitter'], rate: 6, max: 4 }, crates: { rockets: 1, medkit: 1 }, barrels: 3,
    brief: 'A mining crew stopped answering at dusk. Find the survivors, keep them alive, and walk them to the extraction beacon. Watch for spitters.',
  },
  {
    name: 'Glowroot', vehicles: { skimmer: 1 }, world: 'Veyra Prime', biome: 'jungle', size: [66, 52], squad: 5,
    grenades: 5, rockets: 2, objectives: ['killAll'],
    aliens: { skitter: 18, spitter: 6 }, nests: 2, nest: { types: ['skitter', 'spitter'], rate: 5.5, max: 4 }, crates: { grenades: 1, medkit: 1 }, barrels: 3,
    brief: 'Veyra\'s canopy hides everything. Sweep the valley, burn out the nests, and leave nothing crawling.',
  },
  {
    name: 'Canopy Burn', vehicles: { tank: 1 }, world: 'Veyra Prime', biome: 'jungle', size: [70, 54], squad: 5, ambient: [60, 84, 100],
    grenades: 6, rockets: 4, objectives: ['nests'],
    aliens: { skitter: 16, spitter: 6, brute: 1 }, nests: 4, nest: { types: ['skitter', 'spitter'], rate: 5, max: 5 }, crates: { rockets: 1, grenades: 1, medkit: 1 }, barrels: 4,
    brief: 'Night drop. Four nests, and something big is guarding them. Rockets punch through plate armour. The Warden tank only seats three, so split the squad (mark names, press X).',
  },
  {
    name: 'Pilgrim Station', vehicles: { crawler: 1, skimmer: 1 }, world: 'Veyra Prime', biome: 'jungle', size: [72, 56], squad: 6,
    grenades: 5, rockets: 3, objectives: ['rescue', 'extract'], colonists: 4,
    aliens: { skitter: 20, spitter: 8, brute: 2 }, nests: 2, nest: { types: ['skitter'], rate: 5, max: 5 }, crates: { grenades: 1, rockets: 1, medkit: 2 }, barrels: 4,
    brief: 'Pilgrim Station is overrun. Four colonists are holed up in the ruins. Bring them home.',
  },
  {
    name: 'Silent Shelf', vehicles: { skimmer: 2 }, world: 'Ossur', biome: 'ice', size: [72, 56], squad: 6,
    grenades: 6, rockets: 3, objectives: ['killAll'],
    aliens: { skitter: 22, spitter: 8, brute: 3 }, nests: 2, nest: { types: ['skitter', 'spitter'], rate: 5, max: 5 }, crates: { grenades: 1, rockets: 1, medkit: 1 }, barrels: 4,
    brief: 'The ice shelf on Ossur has gone quiet. Too quiet. Sweep it clean.',
  },
  {
    name: 'Whiteout', vehicles: { tank: 1, skimmer: 1 }, world: 'Ossur', biome: 'ice', size: [74, 58], squad: 6, ambient: [80, 96, 140],
    grenades: 6, rockets: 4, objectives: ['rescue', 'nests', 'extract'], colonists: 4,
    aliens: { skitter: 20, spitter: 8, brute: 2 }, nests: 3, nest: { types: ['skitter', 'spitter'], rate: 5, max: 5 }, crates: { grenades: 2, rockets: 1, medkit: 2 }, barrels: 5,
    brief: 'Polar night and a blizzard. A research team is trapped between three nests. Destroy the nests and get the team out.',
  },
  {
    name: 'Cinder Gate', vehicles: { skimmer: 2, tank: 1 }, world: 'Maw of Tehl', biome: 'volcanic', size: [74, 58], squad: 7,
    grenades: 8, rockets: 4, objectives: ['nests'],
    aliens: { skitter: 24, spitter: 10, brute: 3 }, nests: 5, nest: { types: ['skitter', 'spitter', 'skitter'], rate: 4.5, max: 5 }, crates: { grenades: 2, rockets: 1, medkit: 2 }, barrels: 5,
    brief: 'The swarm has dug in along the lava fields. Five nests. Mind the lava, it does not forgive.',
  },
  {
    name: 'Ashfall', vehicles: { tank: 2 }, world: 'Maw of Tehl', biome: 'volcanic', size: [76, 60], squad: 7,
    grenades: 7, rockets: 5, objectives: ['killAll'],
    aliens: { skitter: 28, spitter: 12, brute: 5 }, nests: 3, nest: { types: ['skitter', 'spitter', 'brute'], rate: 5, max: 4 }, crates: { grenades: 2, rockets: 2, medkit: 2 }, barrels: 6,
    brief: 'Everything on this ridge dies today. Heavy resistance expected.',
  },
  {
    name: 'The Undercroft', vehicles: { crawler: 1, skimmer: 1 }, world: 'Vess', biome: 'hive', size: [76, 60], squad: 8,
    grenades: 8, rockets: 5, objectives: ['nests', 'rescue', 'extract'], colonists: 3,
    aliens: { skitter: 28, spitter: 12, brute: 4 }, nests: 6, nest: { types: ['skitter', 'spitter'], rate: 4.5, max: 5 }, crates: { grenades: 2, rockets: 2, medkit: 2 }, barrels: 5,
    brief: 'We are on their home world now. Captured colonists were seen near the outer nests. The acid pools will eat through armour.',
  },
  {
    name: 'Brood Mother', vehicles: { tank: 2, crawler: 1 }, world: 'Vess', biome: 'hive', size: [78, 62], squad: 8,
    grenades: 10, rockets: 8, objectives: ['boss', 'nests'],
    aliens: { skitter: 26, spitter: 12, brute: 5 }, nests: 4, nest: { types: ['skitter', 'spitter', 'brute'], rate: 5, max: 4 }, boss: true, crates: { grenades: 2, rockets: 3, medkit: 3 }, barrels: 6,
    brief: 'The brood mother is at the heart of the hive. Kill her, burn the last nests, and this war is over.',
  },
];
CAMPAIGN.forEach((m, i) => { m.index = i; m.seed = 1009 * (i + 3) + 17; m.terrain = m.terrain || {}; });

const DEMO_MISSION = {
  name: 'Demo', world: '', biome: 'dust', size: [56, 40], objectives: [], seed: 4242, terrain: {},
  aliens: { skitter: 16, spitter: 3, brute: 1 }, nests: 2, crates: {}, barrels: 3, vehicles: { crawler: 1, tank: 1 },
};
