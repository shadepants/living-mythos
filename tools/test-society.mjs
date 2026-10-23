// Phase 5a-5d acceptance tests: one family grows, splits into camps and can die out; camps discover ideas, pass them on
// and forget them; what a camp can do depends on what it knows (docs/SPEC-phase5-society.md 8). Slow (~30 min in
// PRoot; run it in tmux). Run: node --expose-gc tools/test-society.mjs
import { createWorld } from '../src/sim/world.js';
import { simStep } from '../src/sim/sim.js';
import { prewarm } from '../src/sim/prewarm.js';
import { seedCivilization, civStep, ROLE_MASON, ROLE_MYSTIC, ROLE_FORAGER, KIND_STEPS } from '../src/sim/civ.js';
import { placeMonolith } from '../src/sim/tools.js';
import { killVillager, MAX_CAMPS, campCap, householdOf, campStage, SOCIETY, addHome } from '../src/sim/society.js';
import {
  N_IDEAS, IDEA_NAMES, IDEA_FARMING, IDEA_BRIDGES, IDEA_PATHS, IDEA_RITUAL, IDEA_SHELTER, IDEA_STORAGE, IDEA_WOOD, IDEA_STONE, knows,
} from '../src/sim/knowhow.js';
import { GRID_W } from '../src/sim/grid.js';
import { TUNING } from '../src/sim/tuning.js';

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
  // a camp may fall short for a while: cHomes is recounted at 1 Hz (two homes ruined in one tick), and a home lost
  // to land drying out needs a new site, which a camp on poor ground can take ~30 s to find (seed 1337 after the
  // 2026-10-23 audit fixes: 33 s). Only a shortfall lasting 60 s or more counts (Jordan, 2026-10-23)
  const shortSince = new Float64Array(MAX_CAMPS).fill(-1);
  while (w.stats.time < 7200) {
    simStep(w);
    if (at3600 < 0 && w.stats.time >= 3600) { at3600 = c.nAlive; splits3600 = c.splits; }
    if ((c.nAlive < 1 && c.emptyT === 0) || c.nAlive > 120) range = false;
    for (let k = 0; k < MAX_CAMPS && homes; k++) {
      const short = c.cActive[k] && c.cHomeSlot[k] >= 0 && c.cHomes[k] < Math.ceil(c.cPop[k] / householdOf(c, k)) - 1;
      if (!short) { shortSince[k] = -1; continue; }
      if (shortSince[k] < 0) shortSince[k] = w.stats.time;
      else if (w.stats.time - shortSince[k] >= 60) { homes = false; homesAt = shortSince[k]; }
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

// 5b-3: an idea nobody uses (Bridges, with no frustration to open a bridge work) takes hold for 900 s, then fades
{
  const w = mk(), c = w.civ;
  for (let i = 0; i < 600; i++) simStep(w);
  const t0 = w.stats.time;
  for (let b = 0; b < MAX_CAMPS; b++) if (c.cActive[b]) { c.kAdopt[b * N_IDEAS + IDEA_BRIDGES] = 0.6; c.kUsed[b * N_IDEAS + IDEA_BRIDGES] = t0; }
  let peak = 0, at900 = -1;
  while (w.stats.time - t0 < 1300) {
    w.frustration.fill(0);   // since 5c Bridges opens bridge works (a use); with no frustration none can open
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

// 5c-a: unlocks follow the camp's know-how (forced adoption on a fresh world)
{
  const w = mk(), c = w.civ;
  const set = (idea, a) => { c.kAdopt[idea] = a; c.kUsed[idea] = w.stats.time; };
  const cap0 = campCap(c, 0), hh0 = householdOf(c, 0);
  set(IDEA_FARMING, 0.9); const capF = campCap(c, 0);
  set(IDEA_STORAGE, 0.9); const capFS = campCap(c, 0);
  set(IDEA_SHELTER, 0.9); const hh1 = householdOf(c, 0);
  check('5c capacity and households: 12 -> 18 (Farming) -> 22 (+Storage); 3 -> 4 per home with Shelter',
    cap0 === 12 && capF === 18 && capFS === 22 && hh0 === 3 && hh1 === 4, `cap ${cap0}/${capF}/${capFS}, household ${hh0}/${hh1}`);
}
// 5c-b: spoilage without Storage
{
  const drop = (store) => {
    const w = mk(), c = w.civ;
    for (let i = 0; i < 300; i++) simStep(w);
    c.kAdopt[IDEA_STORAGE] = store ? 0.95 : 0; c.kUsed[IDEA_STORAGE] = w.stats.time;
    c.cFood[0] = 2000; c.cBirthT[0] = w.stats.time + 1e6;   // no births or homes muddying the food count
    const f0 = c.cFood[0], t0 = w.stats.time;
    while (w.stats.time - t0 < 60) { simStep(w); c.cBirthT[0] = w.stats.time; }
    return f0 - c.cFood[0];
  };
  const without = drop(false), withS = drop(true);
  check('5c spoilage: above campCap x 10 food spoils without Storage, not with it', without > withS + 100,
    `60 s loss ${without.toFixed(0)} without vs ${withS.toFixed(0)} with Storage`);
}
// 5c-c: Mason works open only near a camp that knows Paths/Bridges, and only its people build them
{
  const run = (paths) => {
    const w = mk(), c = w.civ;
    for (let i = 0; i < 200; i++) simStep(w);
    const cx = c.cX[0] + 1.5, cz = c.cZ[0];
    const t0 = w.stats.time;
    let opened = -1, mason = true;
    while (w.stats.time - t0 < 240) {
      if (paths) { c.kAdopt[IDEA_PATHS] = 0.9; c.kUsed[IDEA_PATHS] = w.stats.time; }
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {   // a trodden, frustrating patch beside the camp
        const i = (Math.floor((cz + 10) / 20 * GRID_W) + dz) * GRID_W + Math.floor((cx + 10) / 20 * GRID_W) + dx;
        if (w.mask[i] === 0) { w.frustration[i] = 3; w.compaction[i] = 0.8; }
      }
      simStep(w);
      for (let o = 0; o < c.oState.length; o++) if (c.oState[o] > 0 && opened < 0) opened = o;
      for (let v = 0; v < c.nV; v++) if (c.vAlive[v] && c.vJob[v] >= 0 && c.vCamp[v] !== c.oCamp[c.vJob[v]]) mason = false;
    }
    return { opened, camp: opened >= 0 ? c.oCamp[opened] : -2, mason, gates: c.gates };
  };
  const no = run(false), yes = run(true);
  check('5c works: a frustrating patch opens no Mason work while no camp knows Paths', no.opened < 0, `opened ${no.opened}, gates ${no.gates}`);
  check('5c works: once the camp knows Paths the patch opens a work owned by that camp, built by its own people',
    yes.opened >= 0 && yes.camp === 0 && yes.mason, `order ${yes.opened}, camp ${yes.camp}, masons own-camp ${yes.mason}`);
}
// 5d-a: homes by stage. A camp's stage follows Shelter / Woodworking / Stonework; new homes are built at it; older
// standing homes are rebuilt to it one per camp per 60 s (forced adoption on a camp that has grown a few homes)
{
  const w = mk(1337), c = w.civ;
  while (w.stats.time < 1500) simStep(w);
  let cp = 0; for (let k = 0; k < MAX_CAMPS; k++) if (c.cActive[k] && c.cHomes[k] > c.cHomes[cp]) cp = k;
  const homes = () => { const o = []; for (let s = 0; s < c.nS; s++) if (c.sKind[s] === 0 && c.sCamp[s] === cp && c.sDecay[s] < 0.9) o.push(s); return o; };
  for (const i of [IDEA_SHELTER, IDEA_WOOD, IDEA_STONE]) c.kAdopt[cp * N_IDEAS + i] = 0;   // back to hide shelters
  for (let s = 0; s < c.nS; s++) if (c.sKind[s] === 0 && c.sCamp[s] === cp) c.sStage[s] = 0;
  const st0 = campStage(c, cp), h0 = homes();
  const learn = (idea) => { c.kAdopt[cp * N_IDEAS + idea] = 0.9; c.kUsed[cp * N_IDEAS + idea] = w.stats.time; };
  learn(IDEA_SHELTER); learn(IDEA_WOOD);
  const st1 = campStage(c, cp);
  const ups = []; const prev = new Uint8Array(c.sStage);
  const t0 = w.stats.time;
  while (w.stats.time - t0 < 60 * (h0.length + 3)) {
    simStep(w);
    c.kUsed[cp * N_IDEAS + IDEA_SHELTER] = c.kUsed[cp * N_IDEAS + IDEA_WOOD] = w.stats.time;
    c.kAdopt[cp * N_IDEAS + IDEA_STONE] = 0;   // no Stonework discovery mid-test
    for (let s = 0; s < c.nS; s++) {
      if (c.sKind[s] === 0 && c.sCamp[s] === cp && h0.includes(s) && c.sStage[s] > prev[s]) ups.push(w.stats.time);
      prev[s] = c.sStage[s];
    }
  }
  let gapOk = true; for (let i = 1; i < ups.length; i++) if (ups[i] - ups[i - 1] < SOCIETY.upgradeGap - 1.01) gapOk = false;
  const hs = homes(); let stale = 0, newAt = 0, newN = 0;
  for (const s of hs) { if (c.sStage[s] < 2 && c.sBuild[s] >= 1) stale++; if (!h0.includes(s)) { newN++; if (c.sStage[s] === 2) newAt++; } }
  check('5d stage: camp stage follows Shelter/Woodworking (0 -> 2)', st0 === 0 && st1 === 2, `before ${st0}, after ${st1}`);
  check('5d upgrade: older homes rebuilt to the camp stage, at most one per 60 s', ups.length >= Math.min(h0.length, 2) && gapOk && stale === 0,
    `${h0.length} older homes, ${ups.length} upgrades, gaps ok ${gapOk}, still below stage ${stale}`);
  check('5d new homes: built at the camp stage', newAt === newN, `${newAt} of ${newN} new homes at stage 2`);
  learn(IDEA_STONE);
  check('5d stage: Stonework makes stone houses (stage 3)', campStage(c, cp) === 3);
}
// audit fixes and Jordan's 2026-10-23 decisions (spec v1.5)
const biggest = (c) => { let cp = 0; for (let k = 0; k < MAX_CAMPS; k++) if (c.cActive[k] && c.cPop[k] > c.cPop[cp]) cp = k; return cp; };
const adultOf = (c, cp, skip = -1) => { for (let v = 0; v < c.nV; v++) if (v !== skip && c.vAlive[v] && c.vCamp[v] === cp && c.vAge[v] >= SOCIETY.adultAge) return v; return -1; };
{ // F2: a Mason lost mid-build reopens the half-built work, and another finishes it
  const w = mk(1337), c = w.civ;
  while (w.stats.time < 1500) simStep(w);
  const cp = biggest(c), v = adultOf(c, cp);
  for (let o = 0; o < c.oState.length; o++) c.oState[o] = 0;
  const s = c.nS++; c.sKind[s] = KIND_STEPS; c.sActive[s] = 1; c.sX[s] = c.vX[v]; c.sZ[s] = c.vZ[v]; c.sBuild[s] = 0.5; c.sDirX[s] = 0; c.sDirZ[s] = 1; c.sLen[s] = 0.5;
  c.vRole[v] = ROLE_MASON; c.masons++;
  c.oState[0] = 3; c.oKind[0] = KIND_STEPS; c.oCamp[0] = cp; c.oWorker[0] = v; c.oStruct[0] = s; c.oProg[0] = 0.5; c.vJob[v] = 0;
  c.oX[0] = c.vX[v]; c.oZ[0] = c.vZ[v]; c.oDirX[0] = 0; c.oDirZ[0] = 1; c.oLen[0] = 0.5;
  const built0 = c.built;
  killVillager(w, v); simStep(w);
  const reopened = c.oState[0] >= 1 && c.oStruct[0] === s && c.sBuild[s] >= 0.5;
  const t0 = w.stats.time; while (w.stats.time - t0 < 300 && c.built === built0) simStep(w);
  check('F2: a Mason lost mid-build reopens the half-built work and another Mason finishes it', reopened && c.built > built0 && c.sBuild[s] === 1,
    `reopened ${reopened}, finished after ${(w.stats.time - t0).toFixed(0)} s, sBuild ${c.sBuild[s].toFixed(2)}`);
}
{ // F3 + F4: an abandoned camp's homes belong to no camp, and one next to a monolith is not revived forever
  const w = mk(1337), c = w.civ;
  while (w.stats.time < 1500) simStep(w);
  const cp = biggest(c), h = c.cHomeSlot[cp];
  const mine = []; for (let s = 0; s < c.nS; s++) if (c.sKind[s] === 0 && c.sCamp[s] === cp) mine.push(s);
  placeMonolith(w, c.sX[h] + 1.0, c.sZ[h]);
  for (let v = 0; v < c.nV; v++) if (c.vAlive[v] && c.vCamp[v] === cp) killVillager(w, v);
  const t0 = w.stats.time; while (w.stats.time - t0 < 2) simStep(w);
  check('F4: an abandoned camp\'s homes belong to no camp', mine.length > 0 && mine.every(s => c.sCamp[s] !== cp), `${mine.length} homes, camp ${cp}`);
  let maxD = 0, rev0 = c.revived;
  while (w.stats.time - t0 < 600 && maxD < 1) { simStep(w); maxD = Math.max(maxD, c.sDecay[h]); }
  check('F3: an abandoned home next to a monolith is sometimes revived but finally ruins (its slot frees)', maxD >= 1,
    `decay reached ${maxD.toFixed(2)} after ${(w.stats.time - t0).toFixed(0)} s, ${c.revived - rev0} revivals`);
}
{ // home cap: past dwellingCap only a camp with fewer than 2 homes may build new; others reuse a full ruin or wait
  const w = mk(1337), c = w.civ;
  for (let s = 0; s < c.nS; s++) c.sDecay[s] = 0;
  c.dwellings = TUNING.dwellingCap; c.cHomes[0] = 1;
  const nS0 = c.nS, a = addHome(w, 0, c.cX[0] + 0.5, c.cZ[0], 1);
  c.cHomes[0] = SOCIETY.smallCampHomes;
  const b = addHome(w, 0, c.cX[0] - 0.5, c.cZ[0], 1);
  c.sDecay[a] = 1; c.sCamp[a] = -1;   // a full ruin of no camp: reused even past the cap
  const r = addHome(w, 0, c.cX[0], c.cZ[0] + 0.5, 1);
  check('cap: a camp under 2 homes builds past the cap; a bigger one cannot, but reuses a full ruin', a >= nS0 && b === -1 && r === a,
    `small camp got ${a}, big camp got ${b}, ruin reused ${r === a}`);
}
{ // roles: a Mason with no work left in their camp goes back to foraging; a Mystic stays one when the camp is small
  const w = mk(1337), c = w.civ;
  while (w.stats.time < 1500) simStep(w);
  const cp = biggest(c), m = adultOf(c, cp), y = adultOf(c, cp, m);
  for (let o = 0; o < c.oState.length; o++) c.oState[o] = 0;
  c.vRole[m] = ROLE_MASON; c.masons++; c.vJob[m] = -1;
  const masons0 = c.masons;
  c.kAdopt[cp * N_IDEAS + IDEA_RITUAL] = 0.9; c.vRole[y] = ROLE_MYSTIC; c.cMyst[cp]++;
  const small = Math.floor(c.cPop[cp] * SOCIETY.mysticShare) < c.cMyst[cp];
  const t0 = w.stats.time; let mystAll = true;
  while (w.stats.time - t0 < 30) { simStep(w); c.kUsed[cp * N_IDEAS + IDEA_RITUAL] = w.stats.time; c.kAdopt[cp * N_IDEAS + IDEA_RITUAL] = 0.9; if (c.vAlive[y] && c.vRole[y] !== ROLE_MYSTIC) mystAll = false; }
  check('roles: a Mason whose camp has no work goes back to foraging', c.vRole[m] === ROLE_FORAGER && c.masons < masons0, `role ${c.vRole[m]}, masons ${masons0} -> ${c.masons}`);
  check('roles: a Mystic stays one for life in a camp too small for the 10% share', mystAll && (small || c.cPop[cp] < 20), `camp of ${c.cPop[cp]}, over share at start ${small}`);
  c.kAdopt[cp * N_IDEAS + IDEA_RITUAL] = 0;
  const t1 = w.stats.time; while (w.stats.time - t1 < 10) { simStep(w); c.kAdopt[cp * N_IDEAS + IDEA_RITUAL] = 0; }
  check('roles: a Mystic whose camp forgets Ritual stops being one', !c.vAlive[y] || c.vRole[y] !== ROLE_MYSTIC);
}
// 5d-2: the field mask (crop rows) is set only around healthy homes of camps that know Farming
{
  const w = mk(1337), c = w.civ;
  while (w.stats.time < 1500) simStep(w);
  let cp = 0; for (let k = 0; k < MAX_CAMPS; k++) if (c.cActive[k] && c.cHomes[k] > c.cHomes[cp]) cp = k;
  const setFarm = () => {
    for (let k = 0; k < MAX_CAMPS; k++) c.kAdopt[k * N_IDEAS + IDEA_FARMING] = k === cp ? 0.9 : 0;
    c.kUsed[cp * N_IDEAS + IDEA_FARMING] = w.stats.time;
  };
  setFarm(); const t0 = w.stats.time;
  while (w.stats.time - t0 < 3) { simStep(w); setFarm(); }
  const R = TUNING.homeClearRadius + 20 / GRID_W, fd = w.field;
  let set = 0, stray = 0, otherHomes = 0, nearOther = 0;
  for (let i = 0; i < fd.length; i++) {
    if (fd[i] <= 0) continue;
    set++;
    const x = (i % GRID_W + 0.5) / GRID_W * 20 - 10, z = ((i / GRID_W | 0) + 0.5) / GRID_W * 20 - 10;
    let ok = false;
    for (let s = 0; s < c.nS && !ok; s++) {
      if (c.sKind[s] !== 0 || c.sDecay[s] > 0.4 || c.sCamp[s] !== cp) continue;
      if (Math.hypot(c.sX[s] - x, c.sZ[s] - z) <= R) ok = true;
    }
    if (!ok) stray++;
  }
  for (let s = 0; s < c.nS; s++) {   // a home of a non-Farming camp far from any farming home must have no field
    if (c.sKind[s] !== 0 || c.sDecay[s] > 0.4 || c.sCamp[s] === cp) continue;
    let far = true;
    for (let t = 0; t < c.nS; t++) if (c.sKind[t] === 0 && c.sDecay[t] <= 0.4 && c.sCamp[t] === cp && Math.hypot(c.sX[t] - c.sX[s], c.sZ[t] - c.sZ[s]) < 2 * R) far = false;
    if (!far) continue;
    otherHomes++;
    const gx = Math.round((c.sX[s] + 10) / 20 * GRID_W - 0.5), gz = Math.round((c.sZ[s] + 10) / 20 * GRID_W - 0.5);
    if (fd[gz * GRID_W + gx] > 0) nearOther++;
  }
  check('5d-2 field mask: set only around healthy homes of Farming camps', set > 0 && stray === 0 && nearOther === 0,
    `${set} cells set, ${stray} away from Farming homes, ${nearOther} of ${otherHomes} other camps' homes farmed`);
}

// 5c-1 and long-run checks: no Mason work before Bridges or Paths is known somewhere; every work opens for a camp that
// knows its idea; Masons work for their own camp; Mystics only in Ritual camps, at most a tenth of the camp
let worksAll = 0;
for (const seed of [1337, 4242, 7]) {
  const w = mk(seed), c = w.civ;
  const wasOpen = new Uint8Array(c.oState.length), prevMyst = new Int32Array(MAX_CAMPS);
  let early = 0, badOpen = 0, opens = 0, foreign = 0, mystBad = 0, samples = 0, sec = 0, firstWork = -1, maxMyst = 0;
  while (w.stats.time < 4500) {
    simStep(w);
    for (let o = 0; o < c.oState.length; o++) {
      const open = c.oState[o] > 0;
      if (open && !wasOpen[o]) {
        opens++; if (firstWork < 0) firstWork = w.stats.time;
        const idea = c.oKind[o] === 2 /* KIND_BRIDGE */ ? IDEA_BRIDGES : IDEA_PATHS;
        if (c.oCamp[o] < 0 || !knows(c, c.oCamp[o], idea)) badOpen++;
        let any = false; for (let k = 0; k < MAX_CAMPS; k++) if (c.cActive[k] && (knows(c, k, IDEA_BRIDGES) || knows(c, k, IDEA_PATHS))) any = true;
        if (!any) early++;
      }
      wasOpen[o] = open ? 1 : 0;
    }
    if (w.stats.time < sec) continue;
    sec = Math.floor(w.stats.time) + 1; samples++;
    for (let v = 0; v < c.nV; v++) if (c.vAlive[v] && c.vJob[v] >= 0 && c.vCamp[v] !== c.oCamp[c.vJob[v]]) foreign++;
    // Mystics are for life (2026-10-23): a camp that shrinks keeps them, so the 10% share limits new appointments
    const myst = new Int32Array(MAX_CAMPS);
    for (let v = 0; v < c.nV; v++) if (c.vAlive[v] && c.vRole[v] === ROLE_MYSTIC && c.vCamp[v] >= 0) myst[c.vCamp[v]]++;
    let bad = false;
    for (let k = 0; k < MAX_CAMPS; k++) {
      maxMyst = Math.max(maxMyst, myst[k]);
      if (myst[k] > 0 && !knows(c, k, IDEA_RITUAL)) bad = true;
      if (myst[k] > prevMyst[k] && myst[k] > Math.max(prevMyst[k], Math.floor(c.cPop[k] * 0.1))) bad = true;   // appointed past the share
      prevMyst[k] = myst[k];
    }
    if (bad) mystBad++;
  }
  worksAll += opens;
  const byStage = [0, 0, 0, 0]; let over = 0;
  for (let s = 0; s < c.nS; s++) if (c.sKind[s] === 0 && c.sDecay[s] < 0.9) { byStage[c.sStage[s]]++; if (c.sCamp[s] >= 0 && c.sStage[s] > 3) over++; }
  check(`5d homes ${seed}: every standing home has a stage 0-3`, over === 0, `homes by stage ${byStage.join('/')} at 4,500 s`);
  check(`5c gating ${seed}: no Mason work before Bridges/Paths is known; each work opens for a camp that knows its idea`,
    early === 0 && badOpen === 0, `${opens} works, first at ${firstWork.toFixed(0)} s, early ${early}, wrong camp ${badOpen}`);
  check(`5c roles ${seed}: Masons build their own camp's works; Mystics only in Ritual camps, none appointed past 10% (>= 98% of seconds)`,
    foreign === 0 && mystBad <= samples * 0.02, `foreign-camp Mason seconds ${foreign}, Mystic over-limit ${mystBad} of ${samples} s, most in a camp ${maxMyst}`);
}

check('5c gating: Mason works do appear once the ideas are known (all seeds together)', worksAll > 0, `${worksAll} works`);

if (failed) { console.error(`${failed} society test(s) failed`); process.exit(1); }
console.log('society tests passed');
