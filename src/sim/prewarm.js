import { TUNING } from './tuning.js';
import { simStep } from './sim.js';

// Boot pre-warm: runs synchronous ticks so basins, rivers and rim falls exist on frame 1 (spec 3.4).
export function prewarm(world, ticks, substepsPerTick) {
  const t = ticks === undefined ? TUNING.prewarmTicks : ticks;
  const s = substepsPerTick === undefined ? TUNING.prewarmSubsteps : substepsPerTick;
  for (let i = 0; i < t; i++) for (let k = 0; k < s; k++) simStep(world);
}
