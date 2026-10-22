// Phase 5a/5b acceptance tests: one family grows, splits into camps and can die out; camps discover ideas, pass them on
// and forget them (docs/SPEC-phase5-society.md 8). Slow (~25 min in PRoot; run it in tmux). Run: node --expose-gc tools/test-society.mjs
import { createWorld } from '../src/sim/world.js';
import { simStep } from '../src/sim/sim.js';
import { prewarm } from '../src/sim/prewarm.js';
import { seedCivilization, civStep, ROLE_MASON, ROLE_MYSTIC } from '../src/sim/civ.js';
import { killVillager, MAX_CAMPS } from '../src/sim/society.js';
import { N_IDEAS, IDEA_NAMES, IDEA_FARMING, IDEA_BRIDGES } from '../src/sim/knowhow.js';

let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };
const mk = (seed = 1337) => { const w = createWorld(seed); prewarm(w); seedCivilization(w); return w; };
const camps = (c) => { let n = 0; for (let k = 0; k < MAX_CAMPS; k++) n += c.cActive[k]; return n; };

// 1. fresh world
{
  const c = mk().civ;
  let orders = 0; for (let o = 0; o < c.oState.length; o++) if (c.oState[o] > 0) orders++;
  let special = 0; for (let v = 0; v < c.nV; v++) if (c.vAlive[v] && (c.vRole[v] === ROLE_MASON || c.vRole[v] === ROLE_MYSTIC)) special++;
  check('fresh: 5 people, 1 camp, 1 dwelling, no Mason orders or roles', c.nAlive === 5 && camps(c) === 1 && c.dwellings === 1 && orders === 0 && special === 0,
    `alive ${c.nAlive}, camps ${camps(c)}, dwellings ${c.dwellings}, orders ${orders}, special ${special}`);
}

// 2. determinism
{
  const a = mk(77), b = mk(77);
  for (let i = 0; i < 2000; i++) { simStep(a); simStep(b); }
  const eq = (x, y) => Buffer.compare(Buffer.from(x.buffer), Buffer.from(y.buffer)) === 0;
  check('determinism: same seed after 2,000 substeps', a.civ.nAlive === b.civ.nAlive && camps(a.civ) === camps(b.civ) && eq(a.civ.vX, b.civ.vX) && eq(a.civ.vZ, b.civ.vZ));
}

// 3-4. growth and stability on each seed
for (const seed of [1337, 7, 4242]) {
  const w = mk(seed), c = w.civ;
  let at3600 = -1, splits3600 = -1, range = true, homes = true, homesAt = -1;
  while (w.stats.time < 7200) {
    simStep(w);
    if (at3600 < 0 && w.stats.time >= 3600) { at3600 = c.nAlive; splits3600 = c.splits; }
    if ((c.nAlive < 1 && c.emptyT === 0) || c.nAlive > 120) range = false;
    for (let k = 0; k < MAX_CAMPS && homes; k++) {
      if (c.cActive[k] && c.cHomeSlot[k] >= 0 && c.cHomes[k] < Math.ceil(c.cPop[k] / 3) - 1) { homes = false; homesAt = w.stats.time; }
    }
  }
  check(`growth ${seed}: by 3,600 s at least 12 people and a split`, at3600 >= 12 && splits3600 >= 1, `${at3600} people, ${splits3600} splits`);
  check(`stability ${seed}: population stays in [1, 120] and settled camps keep their homes`, range && homes,
    `end ${c.nAlive} people in ${camps(c)} camps${homes ? '' : `, homes short at ${homesAt.toFixed(0)} s`}`);
}

// 5. starvation: no food and no foraging, one death per ~60 s until the camp is gone
{
  const w = mk(), c = w.civ;
  const deaths = [];
  let prev = c.nAlive;
  const t0 = w.stats.time;
  while (c.cActive[0] === 1 && w.stats.time - t0 < 600) {
    c.cFood[0] = 0; w.fertility.fill(0);
    for (let v = 0; v < c.nV; v++) c.vCargo[v] = 0;
    simStep(w);
    if (c.nAlive < prev) { deaths.push(w.stats.time - t0); prev = c.nAlive; }
  }
  const gaps = deaths.map((d, i) => d - (i ? deaths[i - 1] : 0));
  check('starvation: a starving camp loses one member per ~60 s, then goes inactive', c.cActive[0] === 0 && deaths.length === 5 && gaps.every(g => g > 55 && g < 66),
    `deaths at ${deaths.map(d => d.toFixed(0)).join(', ')} s, camp active ${c.cActive[0]}`);
}

// 6. floor rule
{
  const w = mk(), c = w.civ;
  for (let v = 0; v < c.nV; v++) killVillager(w, v);
  const t0 = w.stats.time;
  while (c.nAlive === 0 && w.stats.time - t0 < 90) simStep(w);
  const dt = w.stats.time - t0;
  check('floor: an empty island gets a wandering family of 4 within 60-62 s', c.nAlive === 4 && dt >= 60 && dt <= 62, `${c.nAlive} after ${dt.toFixed(1)} s`);
}

// 7. zero allocation in civStep with the society running
if (global.gc) {
  const w = mk(5), dt = w.params.dt;
  for (let i = 0; i < 1000; i++) simStep(w);
  global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 5000; i++) { w.stats.time += dt; civStep(w, dt); }
  global.gc();
  const grew = process.memoryUsage().heapUsed - h0;
  check('zero-GC: civStep with the society does not grow the heap over 5,000 substeps', grew < 256 * 1024, `${(grew / 1024).toFixed(1)} KB`);
} else check('zero-GC: run with --expose-gc', false);

// 5b-1, 5b-2, 5b-4 (Pastoral half): discovery timing and spread by contact on the five 5b seeds
const SEEDS5B = [1337, 7, 4242, 99, 2026];
const farmT = { pas: [], ind: [] };
{
  const firsts = [];
  let spread = null;   // {idea, from, to, dist, delay}
  for (const seed of SEEDS5B) {
    const w = mk(seed), c = w.civ;
    const knownT = new Float64Array(N_IDEAS).fill(-1), kX = new Float64Array(N_IDEAS), kZ = new Float64Array(N_IDEAS), kCamp = new Int32Array(N_IDEAS);
    const lowSince = new Float64Array(MAX_CAMPS * N_IDEAS).fill(-1);   // when this camp was last seen without the idea
    let farm = -1, sec = 0;
    while (w.stats.time < 3600 && !(spread && farm >= 0 && c.firstDiscT >= 0)) {
      simStep(w);
      if (w.stats.time < sec) continue;
      sec = Math.floor(w.stats.time) + 1;
      if (farm < 0 && c.kFirst[IDEA_FARMING]) farm = w.stats.time;
      for (let b = 0; b < MAX_CAMPS; b++) {
        if (!c.cActive[b] || c.cHomeSlot[b] < 0) continue;
        for (let k = 0; k < N_IDEAS; k++) {
          const a = c.kAdopt[b * N_IDEAS + k];
          if (a < 0.1) { lowSince[b * N_IDEAS + k] = w.stats.time; continue; }
          if (a < 0.5) continue;
          if (knownT[k] < 0) { knownT[k] = w.stats.time; kX[k] = c.cX[b]; kZ[k] = c.cZ[b]; kCamp[k] = b; continue; }
          const d = Math.hypot(c.cX[b] - kX[k], c.cZ[b] - kZ[k]);
          if (!spread && b !== kCamp[k] && d >= 4 && lowSince[b * N_IDEAS + k] > knownT[k]) {
            spread = { seed, idea: IDEA_NAMES[k], from: kCamp[k], to: b, dist: d, delay: w.stats.time - knownT[k] };
          }
        }
      }
    }
    firsts.push(c.firstDiscT);
    farmT.pas.push(farm < 0 ? 1e9 : farm);
  }
  const mean = firsts.reduce((s, x) => s + x, 0) / firsts.length;
  check('5b first discovery: <= 600 s on every seed, mean <= 450', firsts.every(t => t >= 0 && t <= 600) && mean <= 450,
    `${firsts.map(t => t.toFixed(0)).join(', ')} s, mean ${mean.toFixed(0)}`);
  check('5b spread: an idea known in one camp later takes hold (>= 0.5) in a camp >= 4 units away that lacked it', !!spread && spread.delay > 30,
    spread ? `seed ${spread.seed}: ${spread.idea} camp ${spread.from} -> ${spread.to} (${spread.dist.toFixed(1)} units) after ${spread.delay.toFixed(0)} s` : 'never');
}

// 5b-3: an idea nobody uses (Bridges: no Mason work exists before 5c) takes hold for 900 s, then fades
{
  const w = mk(), c = w.civ;
  for (let i = 0; i < 600; i++) simStep(w);
  const t0 = w.stats.time;
  for (let b = 0; b < MAX_CAMPS; b++) if (c.cActive[b]) { c.kAdopt[b * N_IDEAS + IDEA_BRIDGES] = 0.6; c.kUsed[b * N_IDEAS + IDEA_BRIDGES] = t0; }
  let peak = 0, at900 = -1;
  while (w.stats.time - t0 < 1300) {
    simStep(w);
    const a = c.kAdopt[IDEA_BRIDGES];
    if (w.stats.time - t0 < 905) peak = Math.max(peak, a);
    if (at900 < 0 && w.stats.time - t0 >= 905) at900 = a;
  }
  const end = c.kAdopt[IDEA_BRIDGES];
  check('5b fading: an unused idea grows for 900 s, then declines', peak > 0.8 && at900 > end + 0.1 && end > 0.05,
    `peak ${peak.toFixed(2)}, at 905 s ${at900.toFixed(2)}, at 1,300 s ${end.toFixed(2)}`);
}

// 5b-4: character. Unpainted islands are Pastoral (bias ~0); the same seeds painted Industrious (bias -0.6 everywhere,
// held each second against the bias decay) should find Farming later on most seeds.
for (const seed of SEEDS5B) {
  const w = mk(seed), c = w.civ;
  let farm = -1, sec = 0;
  const paint = () => { for (let i = 0; i < w.culturalBias.length; i++) if (!w.mask[i]) w.culturalBias[i] = -0.6; };
  paint();
  while (w.stats.time < 2400 && farm < 0) {
    simStep(w);
    if (w.stats.time >= sec) { sec = Math.floor(w.stats.time) + 1; paint(); }
    if (c.kFirst[IDEA_FARMING]) farm = w.stats.time;
  }
  farmT.ind.push(farm < 0 ? 1e9 : farm);
}
{
  const fmt = (t) => t > 1e8 ? 'none' : t.toFixed(0);
  const wins = farmT.pas.filter((t, i) => t < farmT.ind[i]).length;
  check('5b character: Farming comes earlier in Pastoral camps than Industrious ones on most seeds', wins >= 3,
    `Pastoral ${farmT.pas.map(fmt).join('/')} vs Industrious ${farmT.ind.map(fmt).join('/')} s (${wins} of 5)`);
}

if (failed) { console.error(`${failed} society test(s) failed`); process.exit(1); }
console.log('society tests passed');
