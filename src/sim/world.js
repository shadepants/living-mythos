import { TUNING } from './tuning.js';
import { generateIsland } from './island.js';
import { GRID_N } from './grid.js';
import { createEventRing } from './events.js';
import { Rng } from './rng.js';
import { createCiv } from './civ.js';


// All simulation state, allocated once (spec 3.1).
export function createWorld(seed) {
  const f = () => new Float32Array(GRID_N);
  const world = {
    seed: (seed === undefined ? TUNING.seedDefault : seed) | 0,
    elev: f(), water: f(),
    fluxL: f(), fluxR: f(), fluxT: f(), fluxB: f(),
    vx: f(), vz: f(), sediment: f(),
    moisture: f(), fertility: f(), compaction: f(), frustration: f(), culturalBias: f(),
    structureIdx: new Int32Array(GRID_N).fill(-1),
    mask: new Uint8Array(GRID_N),        // 0 land, 1 rim (drain)
    rimOut: f(),                         // water drained over the cliff by the last substep, per rim cell
    sedTmp: f(),                         // scratch for sediment advection
    ecoTmp: f(),                         // scratch for ecology diffusion
    biomass: f(),                        // standing vegetation 0..1 (grass -> crops -> forest), saved
    shade: new Float32Array(GRID_N).fill(1),   // sun shadow factor from the heightfield (runtime only)
    soil: f(),                           // fixed soil quality 0.55..1.45 (regenerated from the seed, not saved)
    ecoCount: 0,
    events: createEventRing(),
    monoliths: new Float32Array(8 * 4),   // x, z, placedAt, active
    monoPulse: new Float32Array(8),
    rng: new Rng(((seed === undefined ? TUNING.seedDefault : seed) ^ 0x5bd1e995) >>> 0),
    engCover: new Uint8Array(GRID_N),     // 0 none, 2 bridge, 3 steps, 4 paving
    civ: null,
    springs: new Int32Array(TUNING.springCount),
    rimCells: null,
    params: {
      dt: TUNING.dtSim, gravity: TUNING.gravity, fluxDamp: TUNING.fluxDamp,
      rain: TUNING.rain, evap: TUNING.evap, springRate: TUNING.springRate,
      rimDrainRate: TUNING.rimDrainRate, drainRim: true, erosion: true,
      kCap: TUNING.kCap, kErode: TUNING.kErode, kDeposit: TUNING.kDeposit,
      ecoGrow: 1.0, evapMul: 1.0,
    },
    stats: { rimDrained: 0, flux: 0, substeps: 0, time: 0, quarried: 0, timberLoads: 0, stoneLoads: 0 },
  };
  generateIsland(world);
  world.civ = createCiv();
  return world;
}
