// Sim tests (spec 3.2). Run: node --expose-gc tools/test-sim.mjs   (npm test)
import { createWorld } from '../src/sim/world.js';
import { GRID_N, GRID_W, GRID_H } from '../src/sim/grid.js';
import { hydroStep } from '../src/sim/hydro.js';
import { simStep } from '../src/sim/sim.js';
import { ecologyStep } from '../src/sim/ecology.js';
import { prewarm } from '../src/sim/prewarm.js';
import { Rng } from '../src/sim/rng.js';
import { computeShadeRows, stampObjectShadows } from '../src/sim/shade.js';
import { createParticles, stepParticles, breezeLanterns, PARTICLE_CAP, P_ROCK, P_LANTERN, P_RAIN, P_SPRAY, P_EMBER } from '../src/sim/particles.js';
import { emitEvent, EV_ROCKFALL, EV_DUST, EV_LANTERN } from '../src/sim/events.js';
import { seedCivilization, civStep, KIND_BRIDGE, KIND_DWELLING, KIND_MYTH, ROLE_MYSTIC, ST_BUILD, recordMyth, MYTH_FLOOD, MYTH_MAX } from '../src/sim/civ.js';
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

// 5e. civilization
{
  const mk = (seed) => { const w = createWorld(seed); prewarm(w); seedCivilization(w); return w; };
  const w = mk(1337);
  const c = w.civ;
  check('civ: founding dwellings and 120 villagers', c.dwellings >= 8 && c.nV === 120, `${c.dwellings} dwellings`);
  let inside = true, deep = 0;
  for (let v = 0; v < c.nV; v++) { if (Math.hypot(c.vX[v], c.vZ[v]) > 8.4) inside = false; if (w.water[Math.round((c.vZ[v] + 10) / 20 * 128 - 0.5) * 128 + Math.round((c.vX[v] + 10) / 20 * 128 - 0.5)] > 0.07) deep++; }
  check('civ: villagers start on dry land inside the island', inside && deep === 0, `deep ${deep}`);

  // determinism
  const a = mk(77), b = mk(77);
  for (let i = 0; i < 1500; i++) { simStep(a); simStep(b); }
  check('civ: deterministic from the same seed', bytesEqual(a.civ.vX, b.civ.vX) && bytesEqual(a.civ.vZ, b.civ.vZ) && a.civ.food === b.civ.food && a.civ.built === b.civ.built);

  // zero allocation with everyone walking
  const z = mk(5);
  for (let i = 0; i < 600; i++) simStep(z);
  global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1200; i++) simStep(z);
  global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  check('zero-GC: simStep with the full civilization does not grow the heap', grew < 256 * 1024, `${(grew / 1024).toFixed(1)} KB`);

  // villagers should actually move and keep to land
  let moved = 0, wild = 0;
  for (let v = 0; v < c.nV; v++) { const x0 = c.vX[v], z0 = c.vZ[v]; void x0; void z0; }
  const w2 = mk(1337); const sx = Float32Array.from(w2.civ.vX), sz = Float32Array.from(w2.civ.vZ);
  for (let i = 0; i < 2400; i++) simStep(w2);
  for (let v = 0; v < 120; v++) { if (Math.hypot(w2.civ.vX[v] - sx[v], w2.civ.vZ[v] - sz[v]) > 0.5) moved++; if (Math.hypot(w2.civ.vX[v], w2.civ.vZ[v]) > 8.9) wild++; }
  check('civ: most villagers go about their business (60 sim s)', moved > 70 && wild === 0, `${moved}/120 moved, ${wild} off-island`);

  // Mason dispatch: frustration on a river cell summons a Mason who builds a bridge
  const wb = mk(1337);
  let river = -1;
  for (let i = 0; i < GRID_N; i++) { const x = i % 128, zz = (i / 128) | 0; if (x > 20 && x < 108 && zz > 20 && zz < 108 && wb.water[i] > 0.04 && wb.mask[i] === 0 && Math.hypot(wb.vx[i], wb.vz[i]) > 0.3) { river = i; break; } }
  check('civ test setup: found a river cell', river >= 0);
  if (river >= 0) {
    wb.frustration[river] = 0.9;
    const tb0 = wb.stats.time;
    let tOrder = -1, tDone = -1;
    for (let i = 0; i < 20 * 40 && tDone < 0; i++) {
      wb.frustration[river] = Math.max(wb.frustration[river], 0.9 * (wb.civ.built === 0 ? 1 : 0));
      simStep(wb);
      if (tOrder < 0) for (let o = 0; o < 12; o++) if (wb.civ.oState[o] > 0) tOrder = wb.stats.time;
      if (wb.civ.bridges > 0 || wb.civ.built > 0) tDone = wb.stats.time;
    }
    check('civ: a Mason is dispatched soon after frustration appears (<15 s even when no one stands there)', tOrder >= 0 && tOrder - tb0 < 15, `order after ${(tOrder - tb0).toFixed(1)} sim s`);
    check('civ: the structure is built and covers the crossing', tDone >= 0 && wb.civ.built > 0, `built ${wb.civ.built}`);
    let cover = 0; for (let i = 0; i < GRID_N; i++) if (wb.engCover[i] !== 0) cover++;
    check('civ: completed structure marks cells as covered (cheaper to cross)', cover > 2, `${cover} cells`);
  }

  // localized traffic summons a Mason within ~10 s
  const wt = mk(1337);
  let rc = -1;
  for (let i = 0; i < GRID_N; i++) { const x = i % 128, zz = (i / 128) | 0; if (x > 25 && x < 100 && zz > 25 && zz < 100 && wt.water[i] > 0.035 && wt.water[i - 3] < 0.003 && wt.water[i + 3] < 0.02) { rc = i; break; } }
  if (rc < 0) { for (let i = 0; i < GRID_N; i++) { const x = i % 128, zz = (i / 128) | 0; if (x > 25 && x < 100 && zz > 25 && zz < 100 && wt.water[i] > 0.03 && wt.mask[i] === 0) { rc = i; break; } } }
  if (rc >= 0) {
    const cx = -10 + ((rc % 128) + 0.5) * 20 / 128, cz = -10 + (((rc / 128) | 0) + 0.5) * 20 / 128;
    const walkers = 14;
    for (let v = 0; v < walkers; v++) { wt.civ.vX[v] = cx - 0.5 + (v % 3) * 0.1; wt.civ.vZ[v] = cz + (v % 5) * 0.05; wt.civ.vRole[v] = 0; wt.civ.vTimer[v] = 1e9; wt.civ.vState[v] = 1; wt.civ.vTX[v] = cx + 0.5; wt.civ.vTZ[v] = cz; }
    const tt0 = wt.stats.time;
    let tFirst = -1;
    for (let i = 0; i < 40 * 40 && tFirst < 0; i++) {
      for (let v = 0; v < walkers; v++) { const dxx = wt.civ.vTX[v] - wt.civ.vX[v]; if (Math.abs(dxx) < 0.15) { wt.civ.vTX[v] = cx + (dxx > 0 ? -0.5 : 0.5); } wt.civ.vTimer[v] = 1e9; wt.civ.vState[v] = 1; }
      simStep(wt);
      for (let o = 0; o < 12; o++) if (wt.civ.oState[o] > 0 && tFirst < 0) tFirst = wt.stats.time;
    }
    check('civ: localized traffic dispatches a Mason within ~10 s', tFirst >= 0 && tFirst - tt0 < 10, `first order after ${(tFirst - tt0).toFixed(1)} sim s`);
  } else check('civ test setup: found a wading spot', false);

  // ruins and re-consecration
  const wr = mk(1337);
  const target = 0;
  for (let i = 0; i < GRID_N; i++) { const dx = (i % 128 + 0.5) / 128 * 20 - 10 - wr.civ.sX[target], dz = (((i / 128) | 0) + 0.5) / 128 * 20 - 10 - wr.civ.sZ[target]; if (dx * dx + dz * dz < 1.0) { wr.fertility[i] = 0; wr.moisture[i] = 0; } }
  wr.params.rain = 0; wr.params.springRate = 0;
  for (let v = 0; v < 120; v++) if (wr.civ.vRole[v] === ROLE_MYSTIC) wr.civ.vRole[v] = 0;   // mystics would re-consecrate it at once
  const tr0 = wr.stats.time;
  let ruinT = -1;
  for (let i = 0; i < 40 * 90 && ruinT < 0; i++) { for (let k = 0; k < 0; k++) void k; simStep(wr); if (wr.civ.sDecay[target] >= 0.99) ruinT = wr.stats.time; if (i % 4 === 0) { const sx0 = wr.civ.sX[target], sz0 = wr.civ.sZ[target]; for (let j = 0; j < GRID_N; j++) { const dx = (j % 128 + 0.5) / 128 * 20 - 10 - sx0, dz = (((j / 128) | 0) + 0.5) / 128 * 20 - 10 - sz0; if (dx * dx + dz * dz < 1.0) wr.fertility[j] = 0; } } }
  check('civ: a dwelling in barren ground decays into a ruin', ruinT >= 0, `ruin after ${(ruinT - tr0).toFixed(0)} sim s`);
  const before = wr.civ.revived;
  placeMonolith(wr, wr.civ.sX[target] + 0.8, wr.civ.sZ[target]);
  let minDecay = 1;
  for (let i = 0; i < 40 * 8; i++) { simStep(wr); minDecay = Math.min(minDecay, wr.civ.sDecay[target]); }
  check('civ: a monolith re-consecrates the ruin (decay reset, revival counted)', minDecay < 0.05 && wr.civ.revived > before, `lowest decay ${minDecay.toFixed(2)}, revivals ${wr.civ.revived - before}`);

  // mystics process to a monolith and release lanterns
  const wm = mk(1337);
  const cur = { i: wm.events.head };
  placeMonolith(wm, 1.0, 1.0);
  let near = 0, lanterns = 0;
  for (let i = 0; i < 40 * 40; i++) simStep(wm);
  for (let v = 0; v < 120; v++) if (wm.civ.vRole[v] === ROLE_MYSTIC && Math.hypot(wm.civ.vX[v] - 1, wm.civ.vZ[v] - 1) < 2.0) near++;
  let kk; while ((kk = nextEvent(wm.events, cur)) >= 0) if (wm.events.type[kk] === 6) lanterns++;
  check('civ: mystics gather at a monolith and launch sky-lanterns', near >= 6 && lanterns >= 2, `${near} mystics nearby, ${lanterns} lanterns`);
}

// 5e1. monoliths appear in the structure pool
{
  const w = createWorld(1337); prewarm(w); seedCivilization(w);
  const n0 = w.civ.nS;
  placeMonolith(w, 2, 2);
  for (let i = 0; i < 60; i++) civStep(w, 0.05);
  const s = w.civ.monoStruct[0];
  check('monolith: placing one adds an obelisk to the structure pool that rises fully', s >= 0 && w.civ.sKind[s] === 1 && w.civ.nS >= n0 + 1 && w.civ.sBuild[s] === 1, `struct ${s}`);
  for (let k = 0; k < 9; k++) { w.stats.time += 1; placeMonolith(w, -5 + k, -3); }
  for (let i = 0; i < 60; i++) civStep(w, 0.05);
  let obelisks = 0; for (let i = 0; i < w.civ.nS; i++) if (w.civ.sKind[i] === 1) obelisks++;
  check('monolith: recycling reuses structures (never more than 8 obelisks)', obelisks === 8, `${obelisks}`);
}

// 5e2. myths
{
  const mk = (seed) => { const w = createWorld(seed); prewarm(w); seedCivilization(w); return w; };
  const w = mk(1337);
  check('myths: none exist at boot', w.civ.nM === 0);
  // first bridge writes a myth and a standing stone
  let river = -1;
  for (let i = 0; i < GRID_N; i++) { const x = i % 128, zz = (i / 128) | 0; if (x > 20 && x < 108 && zz > 20 && zz < 108 && w.water[i] > 0.04 && w.mask[i] === 0 && Math.hypot(w.vx[i], w.vz[i]) > 0.3) { river = i; break; } }
  const mcur = { i: w.events.head };
  const hasBridgeMyth = () => { for (let k = 0; k < w.civ.nM; k++) if (w.civ.mKind[k] === 1) return k; return -1; };
  for (let i = 0; i < 40 * 40 && hasBridgeMyth() < 0; i++) { w.frustration[river] = Math.max(w.frustration[river], w.civ.bridges === 0 ? 0.9 : 0); simStep(w); }
  const bm = hasBridgeMyth();
  check('myths: the first bridge becomes a myth with a carved stone', bm >= 0 && w.civ.sKind[w.civ.mStruct[bm]] === KIND_MYTH, `nM ${w.civ.nM}, bridges ${w.civ.bridges}`);
  let mythEv = 0, kq; while ((kq = nextEvent(w.events, mcur)) >= 0) if (w.events.type[kq] === 9) mythEv++;
  check('myths: a myth event is emitted for audio and visuals', mythEv >= 1, `${mythEv}`);
  check('myths: every myth carries a 4-note motif in the scale', (() => { for (let j = 0; j < w.civ.nM * 4; j++) if (w.civ.mMotif[j] > 6) return false; return true; })());
  // many myths recycle the oldest stone
  const nsBefore = w.civ.nS;
  for (let k = 0; k < MYTH_MAX + 4; k++) { w.stats.time += 1; recordMyth(w, MYTH_FLOOD, -3 + (k % 5), 2 + (k % 3)); }
  check('myths: capped at 12, oldest recycled without growing the structure pool unboundedly', w.civ.nM === MYTH_MAX && w.civ.nS - nsBefore <= MYTH_MAX, `nM ${w.civ.nM}, +${w.civ.nS - nsBefore} structures`);
  // anniversary: villagers gather and pause at the stone
  const wa = mk(1337);
  wa.civ.mythFlags = 63;                               // suppress the first-time myths so only ours exists
  recordMyth(wa, 2, 0.5, 0.5);
  const sx = wa.civ.mX[0], sz = wa.civ.mZ[0];
  for (let v = 0; v < 120; v++) { wa.civ.vX[v] = sx + ((v * 7) % 13 - 6) * 0.25; wa.civ.vZ[v] = sz + ((v * 5) % 11 - 5) * 0.25; }
  let maxNear = 0;
  for (let i = 0; i < 40 * 135; i++) {
    simStep(wa);
    if (wa.stats.time - wa.civ.mT0[0] > 121 && i % 20 === 0) { let n = 0; for (let v = 0; v < 120; v++) if (Math.hypot(wa.civ.vX[v] - sx, wa.civ.vZ[v] - sz) < 1.0) n++; maxNear = Math.max(maxNear, n); }
  }
  check('myths: villagers gather at the stone on the anniversary', maxNear >= 6, `${maxNear} villagers within 1.0`);
}

// 5f. particles
{
  const w = createWorld(1337); prewarm(w); seedCivilization(w);
  const p = createParticles(); p.cursor.i = w.events.head;
  const countType = (t) => { let n = 0; for (let i = 0; i < PARTICLE_CAP; i++) if (p.alive[i] && p.type[i] === t) n++; return n; };
  emitEvent(w.events, EV_ROCKFALL, 0, 0, 1);
  emitEvent(w.events, EV_DUST, 1, 1, 1);
  emitEvent(w.events, EV_LANTERN, -1, 1, 1);
  stepParticles(p, w, 0.016, 0, 0, 0.3, false, 0, 0, 0, 0, 0);
  check('particles: events spawn rockfall, dust and a sky-lantern', countType(P_ROCK) >= 3 && countType(P_EMBER) >= 3 && countType(P_LANTERN) >= 1, `rock ${countType(P_ROCK)} dust/ember ${countType(P_EMBER)} lantern ${countType(P_LANTERN)}`);
  // lanterns rise, rocks fall and come to rest on the ground
  const li = (() => { for (let i = 0; i < PARTICLE_CAP; i++) if (p.alive[i] && p.type[i] === P_LANTERN) return i; return -1; })();
  const ly0 = p.y[li];
  for (let t = 0; t < 120; t++) stepParticles(p, w, 0.016, t * 0.016, 0, 0.3, false, 0, 0, 0, 0, 0);
  check('particles: sky-lanterns drift upward', p.y[li] > ly0 + 0.4, `${ly0.toFixed(2)} -> ${p.y[li].toFixed(2)}`);
  let underground = 0;
  for (let i = 0; i < PARTICLE_CAP; i++) if (p.alive[i] && p.type[i] === P_ROCK && p.y[i] < -1) underground++;
  check('particles: rockfall debris does not fall through the island', underground === 0);
  // monsoon rain respects its budget and lands
  for (let t = 0; t < 400; t++) stepParticles(p, w, 0.016, t * 0.016, 1, 1.4, false, 0, 0, 0, 0, 0);
  const rain = countType(P_RAIN);
  check('particles: monsoon rain fills but does not exceed its budget', rain > 80 && rain <= p.rainSlots, `${rain} streaks`);
  // total never exceeds the pool and sim stays finite
  let ok = true; for (let i = 0; i < PARTICLE_CAP; i++) if (p.alive[i] && !(Number.isFinite(p.x[i]) && Number.isFinite(p.y[i]) && Number.isFinite(p.z[i]))) ok = false;
  check('particles: all alive particles stay finite', ok);
  // breeze accelerates lanterns
  emitEvent(w.events, EV_LANTERN, 0, 0, 1);
  stepParticles(p, w, 0.016, 0, 0, 0.3, false, 0, 0, 0, 0, 0);
  const lj = (() => { for (let i = PARTICLE_CAP - 1; i >= 0; i--) if (p.alive[i] && p.type[i] === P_LANTERN) return i; return -1; })();
  const bx0 = p.x[lj];
  for (let t = 0; t < 60; t++) breezeLanterns(p, bx0 - 0.5, p.z[lj], 2, 1, 0.016);
  check('particles: the breeze pushes nearby sky-lanterns', Math.abs(p.x[lj] - bx0) > 0.3, `${(p.x[lj] - bx0).toFixed(2)}`);
  // zero-GC
  global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let t = 0; t < 1500; t++) stepParticles(p, w, 0.016, t * 0.016, 0.6, 0.8, false, 0, 0, 0, 0, 0);
  global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  check('zero-GC: stepParticles does not grow the heap', grew < 256 * 1024, `${(grew / 1024).toFixed(1)} KB`);
  void P_SPRAY;
}

// 5g. heightfield sun shadows
{
  const w = createWorld(9);
  w.elev.fill(0.3); for (let i = 0; i < GRID_N; i++) if (w.mask[i]) w.elev[i] = -0.6;
  // a tall hill at the centre
  for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) { const d = Math.hypot(x - 64, z - 64); if (d < 8) w.elev[z * 128 + x] = 0.3 + (8 - d) * 0.25; }
  const cell = (wx, wz) => Math.round((wz + 10) / 20 * 128 - 0.5) * 128 + Math.round((wx + 10) / 20 * 128 - 0.5);
  computeShadeRows(w, -0.8, 0.35, 0, 0, 128);              // sun low in the -x direction
  const east = w.shade[cell(1.5, 0)], west = w.shade[cell(-1.5, 0)], far = w.shade[cell(4, 4)];
  check('shade: ground on the far side of a hill is shadowed', east < 0.2, `east ${east.toFixed(2)}`);
  check('shade: ground on the sunny side and far from the hill is lit', west > 0.95 && far > 0.95, `west ${west.toFixed(2)} far ${far.toFixed(2)}`);
  computeShadeRows(w, 0, 1, 0, 0, 128);                    // sun straight overhead
  let minS = 1; for (let i = 0; i < GRID_N; i++) if (w.shade[i] < minS) minS = w.shade[i];
  check('shade: nothing is shadowed with the sun overhead', minS > 0.99, `min ${minS.toFixed(2)}`);
  const t0 = performance.now(); computeShadeRows(w, -0.8, 0.35, 0.3, 0, 128); const ms = performance.now() - t0;
  check('shade: a full sweep is cheap enough to amortise (<60 ms)', ms < 60, `${ms.toFixed(1)} ms`);
  let ok = true; for (let i = 0; i < GRID_N; i++) if (!(w.shade[i] >= 0 && w.shade[i] <= 1)) ok = false;
  check('shade: values stay in [0,1]', ok);
  // a building shades the ground on the side away from the sun, not the sunny side
  const wb = createWorld(10); prewarm(wb); seedCivilization(wb);
  const sx = wb.civ.sX[0], sz = wb.civ.sZ[0];
  wb.elev.fill(0.3); for (let i = 0; i < GRID_N; i++) if (wb.mask[i]) wb.elev[i] = -0.6;
  const sun = { x: -0.8, y: 0.4, z: 0 };                        // sun toward -x, low
  computeShadeRows(wb, sun.x, sun.y, sun.z, 0, 128); stampObjectShadows(wb, sun.x, sun.y, sun.z, 0, 128);
  const cellW = (x, z) => Math.round((z + 10) / 20 * 128 - 0.5) * 128 + Math.round((x + 10) / 20 * 128 - 0.5);
  const away = wb.shade[cellW(sx + 0.35, sz)], toward = wb.shade[cellW(sx - 0.6, sz)];
  check('shade: a dwelling casts a soft shadow away from the sun only', away < 0.6 && toward > 0.95, `away ${away.toFixed(2)} sunny side ${toward.toFixed(2)}`);
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
