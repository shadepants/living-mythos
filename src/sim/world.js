import { TUNING } from './tuning.js';
import { generateIsland } from './island.js';
import { GRID_N } from './grid.js';


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
    springs: new Int32Array(TUNING.springCount),
    rimCells: null,
    params: {
      dt: TUNING.dtSim, gravity: TUNING.gravity, fluxDamp: TUNING.fluxDamp,
      rain: TUNING.rain, evap: TUNING.evap, springRate: TUNING.springRate,
      rimDrainRate: TUNING.rimDrainRate, drainRim: true, erosion: true,
      kCap: TUNING.kCap, kErode: TUNING.kErode, kDeposit: TUNING.kDeposit,
    },
    stats: { rimDrained: 0, flux: 0, substeps: 0 },
  };
  generateIsland(world);
  return world;
}
