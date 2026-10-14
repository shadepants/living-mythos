import { TUNING } from './tuning.js';
import { hydroStep } from './hydro.js';
import { ecologyStep } from './ecology.js';

// One fixed sim substep: hydrology every call, ecology every TUNING.ecoEvery calls.
export function simStep(world) {
  hydroStep(world);
  world.ecoCount++;
  if (world.ecoCount >= TUNING.ecoEvery) {
    world.ecoCount = 0;
    ecologyStep(world, world.params.dt * TUNING.ecoEvery);
  }
}
