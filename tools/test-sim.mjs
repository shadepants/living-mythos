// Sim tests (spec 3.2). Run: node --expose-gc tools/test-sim.mjs   (npm test)
import { createWorld } from '../src/sim/world.js';
import { GRID_N, GRID_W, GRID_H } from '../src/sim/grid.js';
import { hydroStep } from '../src/sim/hydro.js';
import { simStep } from '../src/sim/sim.js';
import { ecologyStep } from '../src/sim/ecology.js';
import { prewarm } from '../src/sim/prewarm.js';
import { Rng } from '../src/sim/rng.js';
import { sculptAt, rainAt, placeMonolith, monolithEffects, MAX_MONOLITHS } from '../src/sim/tools.js';
import { sampleGrid, visualHeight, raymarchHeightfield } from '../src/sim/sample.js';
import { nextEvent, EV_MONOLITH_PLACE, EV_MONOLITH_PULSE } from '../src/sim/events.js';

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

// 2b. erosion conserves rock + sediment (closed rim)
{
  const w = createWorld(6);
  Object.assign(w.params, { evap: 0, drainRim: false });
  steps(w, 300);
  const tot = () => { let s = 0; for (let i = 0; i < GRID_N; i++) s += w.elev[i] + w.sediment[i]; return s; };
  const t0 = tot();
  steps(w, 3000);
  const drift = Math.abs(tot() - t0) / t0;
  check('erosion conserves elevation + sediment < 0.05% over 3000 substeps', drift < 5e-4, `drift ${(drift * 100).toFixed(4)}%`);
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

// 5c. tools, events, raymarch
{
  const w = createWorld(31);
  const x0 = 0, z0 = 0;
  const before = sampleGrid(w.elev, x0, z0);
  sculptAt(w, x0, z0, 1.6, 0.5);
  const up = sampleGrid(w.elev, x0, z0) - before;
  check('sculpt: raise lifts the centre by ~amount', up > 0.45 && up < 0.52, `${up.toFixed(3)}`);
  const far = sampleGrid(w.elev, 4, 4) - sampleGrid(createWorld(31).elev, 4, 4);
  check('sculpt: gaussian falls off to zero outside the radius', Math.abs(far) < 1e-6);
  sculptAt(w, x0, z0, 1.6, -3);
  check('sculpt: carve clamps at the elevation floor', sampleGrid(w.elev, x0, z0) >= 0.0199);
  check('sculpt: freshly steepened ground gains frustration', (() => { sculptAt(w, 3, 3, 1.2, 1.5); let s = 0; for (let i = 0; i < GRID_N; i++) s += w.frustration[i]; return s > 0.05; })());

  const w2 = createWorld(32);
  const m0 = sum(w2.water);
  rainAt(w2, 0, 0, 1.5, 1.0);
  check('raincloud: injects water, moisture and fertility', sum(w2.water) > m0 + 0.02 && sum(w2.moisture) > 1);

  const w3 = createWorld(33);
  const cur = { i: w3.events.head };
  for (let k = 0; k < MAX_MONOLITHS; k++) { w3.stats.time = k + 1; placeMonolith(w3, -4 + k, 1); }
  w3.stats.time = 20;
  const slot = placeMonolith(w3, 0, 5);
  check('monolith: the 9th placement recycles the oldest slot', slot === 0 && w3.monoliths[0] === 0 && w3.monoliths[1] === 5, `slot ${slot}`);
  check('monolith: refuses placement off the island', placeMonolith(w3, 9.5, 0) === -1);
  let placed = 0, k;
  while ((k = nextEvent(w3.events, cur)) >= 0) if (w3.events.type[k] === EV_MONOLITH_PLACE) placed++;
  check('events: consumer sees every placement exactly once', placed === 9, `${placed}`);
  const w4 = createWorld(34);
  placeMonolith(w4, 0, 0);
  const cur4 = { i: w4.events.head };
  w4.params.ecoGrow = 1;
  for (let t = 0; t < 400; t++) { w4.stats.time += 0.1; monolithEffects(w4, 0.1); }
  const bc = sampleGrid(w4.culturalBias, 0, 0), bf = sampleGrid(w4.culturalBias, 7, 7);
  check('monolith: pulls nearby culture toward Mystical (+1), not far away', bc > 0.8 && Math.abs(bf) < 0.2, `centre ${bc.toFixed(2)}, far ${bf.toFixed(2)}`);
  let pulses = 0;
  while ((k = nextEvent(w4.events, cur4)) >= 0) if (w4.events.type[k] === EV_MONOLITH_PULSE) pulses++;
  check('monolith: emits periodic harmonic pulses', pulses >= 5, `${pulses}`);

  // raymarch vs a dense reference march (first surface hit; hills may legitimately occlude the aimed point)
  const wr = createWorld(35);
  const out = { x: 0, y: 0, z: 0 };
  let worst = 0, misses = 0, bad = 0, lip = 0, total = 0;
  const rr = new Rng(77);
  for (let n = 0; n < 300; n++) {
    const tx = rr.range(-7, 7), tz = rr.range(-7, 7);
    const ty = visualHeight(wr.elev, tx, tz);
    const ox = rr.range(-6, 6), oy = 15 + rr.range(0, 6), oz = 22 + rr.range(0, 6);
    let dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L;
    let rx = 0, rz = 0, found = false;
    for (let t = 0; t < 70; t += 0.005) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (Math.abs(x) <= 10 && Math.abs(z) <= 10 && y <= visualHeight(wr.elev, x, z)) { rx = x; rz = z; found = true; break; }
    }
    const hit = raymarchHeightfield(wr.elev, ox, oy, oz, dx, dy, dz, out);
    if (!found) { if (hit) bad++; continue; }
    if (!hit) { misses++; continue; }
    const e = Math.hypot(out.x - rx, out.z - rz);
    if (e > 0.3) lip++; else worst = Math.max(worst, e);
    total++;
  }
  // The only legitimate disagreements are rays grazing a cliff lip (a sliver thinner than the 32-step spacing).
  check('raymarch: >=97% of 300 rays agree with a dense reference within 0.3', bad === 0 && misses <= 3 && lip / total < 0.03, `misses ${misses}, spurious ${bad}, lip-grazing ${lip}/${total}, worst-ok ${worst.toFixed(3)}`);
  check('raymarch: a ray that points away misses', !raymarchHeightfield(wr.elev, 0, 10, 20, 0, 1, 0, out));
}

// 5d. long-run equilibrium: no runaway flooding or land growth
{
  const w = createWorld(1337);
  prewarm(w);
  const land = (a) => { let s = 0; for (let i = 0; i < GRID_N; i++) if (!w.mask[i]) s += a[i]; return s; };
  for (let i = 0; i < 24000; i++) simStep(w);
  const w1 = land(w.water), e1 = land(w.elev);
  for (let i = 0; i < 12000; i++) simStep(w);
  const w2 = land(w.water), e2 = land(w.elev);
  let wet = 0, cells = 0; for (let i = 0; i < GRID_N; i++) if (!w.mask[i]) { cells++; if (w.water[i] > 0.008) wet++; }
  check('long run: standing water reaches equilibrium (<15% change over the next 300 sim s)', Math.abs(w2 - w1) / w1 < 0.15, `${w1.toFixed(0)} -> ${w2.toFixed(0)}`);
  check('long run: land does not inflate (<2% change over 300 sim s)', Math.abs(e2 - e1) / e1 < 0.02, `${e1.toFixed(0)} -> ${e2.toFixed(0)}`);
  check('long run: island is not flooded (<35% of land wet)', wet / cells < 0.35, `${(wet / cells * 100).toFixed(1)}%`);
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
