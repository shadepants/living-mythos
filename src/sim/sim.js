import { TUNING } from './tuning.js';
import { hydroStep } from './hydro.js';
import { ecologyStep } from './ecology.js';
import { monolithEffects } from './tools.js';
import { civStep } from './civ.js';

// One fixed sim substep: hydrology every call, ecology every TUNING.ecoEvery calls.
export function simStep(world) {
  hydroStep(world);
  world.stats.time += world.params.dt;
  civStep(world, world.params.dt);
  world.ecoCount++;
  if (world.ecoCount >= TUNING.ecoEvery) {
    world.ecoCount = 0;
    const edt = world.params.dt * TUNING.ecoEvery;
    ecologyStep(world, edt);
    monolithEffects(world, edt);
  }
}
