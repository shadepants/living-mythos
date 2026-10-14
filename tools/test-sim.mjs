// Sim tests (spec 3.2). Run: node --expose-gc tools/test-sim.mjs   (npm test)
import { createWorld } from '../src/sim/world.js';
import { GRID_N, GRID_W, GRID_H } from '../src/sim/grid.js';
import { hydroStep } from '../src/sim/hydro.js';
import { simStep } from '../src/sim/sim.js';
import { ecologyStep } from '../src/sim/ecology.js';
import { prewarm } from '../src/sim/prewarm.js';
import { Rng } from '../src/sim/rng.js';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}
const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const bytesEqual = (a, b) => Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
function steps(w, n) { for (let i = 0; i < n; i++) hydroStep(w); }
function allFinite(a) { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; }

// 1. determinism
{
  const a = createWorld(42), b = createWorld(42), c = createWorld(43);
  steps(a, 300); steps(b, 300); steps(c, 300);
  check('determinism: same seed is bit-identical', bytesEqual(a.elev, b.elev) && bytesEqual(a.water, b.water) && bytesEqual(a.sediment, b.sediment));
  check('determinism: different seed differs', !bytesEqual(a.elev, c.elev));
}

// 2. mass conservation (closed rim, no sources/sinks)
{
  const w = createWorld(5);
  Object.assign(w.params, { rain: 0, springRate: 0, evap: 0, drainRim: false });
  const rng = new Rng(9);
  for (let i = 0; i < GRID_N; i++) w.water[i] = rng.next() < 0.3 ? rng.range(0, 0.2) : 0;
  const m0 = sum(w.water);
  steps(w, 2000);
  const drift = Math.abs(sum(w.water) - m0) / m0;
  check('mass conservation < 0.1% over 2000 substeps', drift < 0.001, `drift ${(drift * 100).toFixed(4)}%`);
}

// 3. rim drain
{
  const w = createWorld(5);
  Object.assign(w.params, { rain: 0, springRate: 0, evap: 0 });
  const rng = new Rng(9);
  for (let i = 0; i < GRID_N; i++) w.water[i] = w.mask[i] ? 0 : rng.range(0, 0.1);
  let prev = sum(w.water), mono = true;
  const m0 = prev;
  for (let k = 0; k < 40; k++) {
    steps(w, 100);
    const t = sum(w.water);
    if (t > prev + 1e-3) mono = false;
    prev = t;
  }
  check('rim drain: total water non-increasing without sources', mono);
  check('rim drain: island loses most of its water', prev < 0.5 * m0, `${prev.toFixed(1)} of ${m0.toFixed(1)}`);
  check('rim drain: waterfall outflow was recorded', w.stats.rimDrained > 0.2 * m0, `drained ${w.stats.rimDrained.toFixed(1)}`);
}

// 4. stability with all sources and erosion on
{
  const w = createWorld(11);
  let bad = '';
  let minWater = 0;
  for (let k = 0; k < 200 && !bad; k++) {
    steps(w, 100);
    if (!allFinite(w.elev) || !allFinite(w.water) || !allFinite(w.sediment) || !allFinite(w.vx) || !allFinite(w.vz)) bad = 'non-finite at substep ' + w.stats.substeps;
    for (let i = 0; i < GRID_N; i++) { if (w.water[i] < minWater) minWater = w.water[i]; if (w.elev[i] > 6 || w.elev[i] < -3) bad = 'elev out of range at ' + i; }
  }
  check('stability: 20,000 substeps finite, bounded, water >= 0', !bad && minWater >= 0, bad || `min water ${minWater}`);
}

// 5. zero allocation in the step
{
  const w = createWorld(3);
  steps(w, 50);
  global.gc();
  const h0 = process.memoryUsage().heapUsed;
  steps(w, 1500);
  global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  check('zero-GC: heap does not grow over 1500 substeps', grew < 256 * 1024, `${(grew / 1024).toFixed(1)} KB`);
}

// 5b. ecology
{
  const w = createWorld(21);
  // a wet patch, a dry patch, and a compacted wet patch
  const idxWet = 64 * 128 + 50, idxDry = 64 * 128 + 80, idxPath = 64 * 128 + 65;
  const patch = (c, fn) => { for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) fn(c + dz * 128 + dx); };
  for (const c of [idxWet, idxDry, idxPath]) patch(c, (i) => { w.mask[i] = 0; w.fertility[i] = 0.5; w.moisture[i] = 0; w.water[i] = 0; w.elev[i] = 0.5; });
  w.culturalBias[idxWet] = 1;
  w.params.rain = 0; w.params.ecoGrow = 1;
  const hold = () => { patch(idxWet, (i) => { w.water[i] = 0.08; }); patch(idxPath, (i) => { w.water[i] = 0.08; w.compaction[i] = 0.9; }); };
  for (let k = 0; k < 600; k++) { hold(); ecologyStep(w, 0.1); }
  check('ecology: wet soil gains moisture and fertility', w.moisture[idxWet] > 0.6 && w.fertility[idxWet] > 0.8, `m ${w.moisture[idxWet].toFixed(2)} f ${w.fertility[idxWet].toFixed(2)}`);
  check('ecology: dry soil loses fertility', w.fertility[idxDry] < 0.2, `f ${w.fertility[idxDry].toFixed(2)}`);
  check('ecology: compaction suppresses fertility even when wet', w.fertility[idxPath] < w.fertility[idxWet] - 0.3, `path ${w.fertility[idxPath].toFixed(2)} vs ${w.fertility[idxWet].toFixed(2)}`);
  check('ecology: cultural bias diffuses to neighbours', w.culturalBias[idxWet + 1] > 0.05 || w.culturalBias[idxWet - 1] > 0.05, `${w.culturalBias[idxWet + 1].toFixed(3)}`);
  let ok = true;
  for (let i = 0; i < GRID_N; i++) { if (!(w.fertility[i] >= 0 && w.fertility[i] <= 1 && w.moisture[i] >= 0 && w.moisture[i] <= 1 && w.compaction[i] >= 0 && Math.abs(w.culturalBias[i]) <= 1)) { ok = false; break; } }
  check('ecology: all channels stay in range', ok);
  const w2 = createWorld(22);
  steps(w2, 50); global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < 800; k++) simStep(w2);
  global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  check('zero-GC: simStep (hydro+ecology) does not grow the heap', grew < 256 * 1024, `${(grew / 1024).toFixed(1)} KB`);
}

// 6. prewarm produces a believable island
{
  const w = createWorld(1337);
  const t0 = performance.now();
  prewarm(w);
  const ms = performance.now() - t0;
  let land = 0, wet = 0, emax = -9, relief0;
  const fresh = createWorld(1337);
  let carved = 0, built = 0;
  for (let i = 0; i < GRID_N; i++) {
    if (w.mask[i]) continue;
    land++;
    if (w.water[i] > 0.008) wet++;
    if (w.elev[i] > emax) emax = w.elev[i];
    const d = w.elev[i] - fresh.elev[i];
    if (d < -0.005) carved++; else if (d > 0.005) built++;
  }
  const wetFrac = wet / land;
  console.log(`      prewarm ${ms.toFixed(0)} ms; wet ${(wetFrac * 100).toFixed(1)}% of land; carved ${carved} cells, deposited ${built} cells; rim drained ${w.stats.rimDrained.toFixed(1)}`);
  check('prewarm: rivers exist (1-25% of land wet)', wetFrac > 0.01 && wetFrac < 0.25, `${(wetFrac * 100).toFixed(1)}%`);
  check('prewarm: erosion visibly carved terrain', carved > 150, `${carved} cells`);
  check('prewarm: water reaches the rim (waterfalls)', w.stats.rimDrained > 1, `${w.stats.rimDrained.toFixed(1)}`);
  check('prewarm: under 3 s on this device', ms < 3000, `${ms.toFixed(0)} ms`);
  let lush = 0, scrub = 0;
  for (let i = 0; i < GRID_N; i++) if (!w.mask[i]) { if (w.fertility[i] > 0.7) lush++; else if (w.fertility[i] < 0.3) scrub++; }
  console.log(`      fertility after prewarm: lush ${(lush / land * 100).toFixed(1)}%, scrub ${(scrub / land * 100).toFixed(1)}%`);
  check('prewarm: both lush valleys and dry scrub exist', lush / land > 0.03 && scrub / land > 0.03, `lush ${(lush / land * 100).toFixed(1)}% scrub ${(scrub / land * 100).toFixed(1)}%`);

  if (process.argv.includes('--map')) {
    const ramp = ' .:-=+*#%@';
    let out = '';
    for (let z = 0; z < GRID_H; z += 3) {
      for (let x = 0; x < GRID_W; x += 2) {
        const i = z * GRID_W + x;
        out += w.water[i] > 0.008 ? '~' : ramp[Math.max(0, Math.min(9, Math.floor((w.elev[i] + 0.2) / 1.4 * 9)))];
      }
      out += '\n';
    }
    console.log(out);
  }
}

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall sim tests passed');
