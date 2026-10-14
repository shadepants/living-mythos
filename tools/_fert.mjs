import { createWorld } from '../src/sim/world.js';
import { simStep } from '../src/sim/sim.js';
import { prewarm } from '../src/sim/prewarm.js';
import { seedCivilization } from '../src/sim/civ.js';
import { GRID_N } from '../src/sim/grid.js';
const w = createWorld(1337); prewarm(w); seedCivilization(w);
const hist = () => { const b = new Array(10).fill(0); let n = 0; for (let i = 0; i < GRID_N; i++) if (!w.mask[i]) { b[Math.min(9, Math.floor(w.fertility[i] * 10))]++; n++; } return b.map(v => (v / n * 100).toFixed(0).padStart(3)).join(' '); };
console.log('fert deciles 0..1 after prewarm:', hist());
for (let k = 0; k < 3; k++) { for (let i = 0; i < 40 * 30; i++) simStep(w); console.log(`+${(k + 1) * 30}s:`, hist()); }
