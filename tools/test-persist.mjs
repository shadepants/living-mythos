// Save/restore round trip, corruption handling and size (run: node tools/test-persist.mjs).
import { createWorld } from '../src/sim/world.js';
import { simStep } from '../src/sim/sim.js';
import { prewarm } from '../src/sim/prewarm.js';
import { seedCivilization } from '../src/sim/civ.js';
import { placeMonolith } from '../src/sim/tools.js';
import { serializeWorld, restoreWorld, saveToStorage, loadFromStorage, SAVE_KEY } from '../src/sim/persist.js';

let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };
const same = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

const mk = () => { const w = createWorld(1337); prewarm(w); seedCivilization(w); return w; };
const a = mk();
placeMonolith(a, 2, 1);
for (let i = 0; i < 1500; i++) simStep(a);
a.civ.kAdopt[2] = 0.7; a.civ.kUsed[2] = 31.5; a.civ.kFirst[2] = 1; a.civ.discoveries = 1;   // non-zero know-how to round-trip
const text = serializeWorld(a, { atmo: 0.5 });
check('save: payload is a JSON string under 1.6 MB', typeof text === 'string' && text.length < 1.6e6, `${(text.length / 1024).toFixed(0)} KB`);

const b = createWorld(1337);                 // fresh world, same seed, nothing prewarmed
const r = restoreWorld(b, text);
check('restore: a valid save is accepted and returns the extra state', r.ok && r.extra && r.extra.atmo === 0.5);
check('restore: terrain, soil and culture arrays match exactly', same(a.elev, b.elev) && same(a.fertility, b.fertility) && same(a.culturalBias, b.culturalBias) && same(a.compaction, b.compaction) && same(a.engCover, b.engCover));
check('restore: villagers, structures, myths and monoliths match', same(a.civ.vX, b.civ.vX) && same(a.civ.sX, b.civ.sX) && same(a.civ.sKind, b.civ.sKind) && same(a.monoliths, b.monoliths) && a.civ.nS === b.civ.nS && a.civ.nM === b.civ.nM && a.stats.time === b.stats.time);
check('restore: society state (camps, ages, households) matches', ['vAlive', 'vAge', 'vLife', 'vCamp', 'sCamp', 'cActive', 'cPop', 'cHomes', 'cFood', 'cX', 'cZ'].every(k => same(a.civ[k], b.civ[k])) && a.civ.nAlive === b.civ.nAlive && a.civ.societyOn === b.civ.societyOn && a.civ.gates === b.civ.gates && a.civ.splits === b.civ.splits, `alive ${a.civ.nAlive} vs ${b.civ.nAlive}`);
check('restore: know-how (adoption, idea clocks, need signals) matches', ['kAdopt', 'kUsed', 'kNeed', 'kTrips', 'kFertSec', 'kRichSec', 'kFloodT', 'kFirst'].every(k => same(a.civ[k], b.civ[k])) && a.civ.discoveries === b.civ.discoveries && a.civ.firstDiscT === b.civ.firstDiscT && a.civ.kRngS === b.civ.kRngS, `discoveries ${a.civ.discoveries} vs ${b.civ.discoveries}`);
check('restore: runtime-only state is reset sanely (orders cleared, builders free)', b.civ.oState.every(v => v === 0) && b.civ.vJob.every(v => v === -1) && b.civ.vState.every(v => v === 0));
for (let i = 0; i < 400; i++) simStep(b);
let fin = true; for (let i = 0; i < b.elev.length; i++) if (!Number.isFinite(b.elev[i]) || !Number.isFinite(b.water[i])) fin = false;
check('restore: the restored world keeps simulating without blowing up', fin);

// corruption / mismatch must leave a fresh world untouched
const fresh = createWorld(1337);
const before = Float32Array.from(fresh.elev);
check('corrupt: garbage JSON is rejected', restoreWorld(fresh, '{not json').ok === false);
check('corrupt: truncated array data is rejected', restoreWorld(fresh, text.replace(/"elev":"[^"]{40}/, '"elev":"AAAA')).ok === false);
check('corrupt: wrong version is rejected', restoreWorld(fresh, text.replace('"v":3', '"v":99')).ok === false);
{ // saves from before Phase 5 (v1, v2) are not converted: the caller starts a fresh primitive island
  for (const v of [1, 2]) {
    const old = JSON.parse(text); old.v = v;
    const r0 = restoreWorld(fresh, JSON.stringify(old));
    check(`old: a v${v} save is declined with reason 'old'`, r0.ok === false && r0.reason === 'old');
  }
  const wRT = createWorld(1337);   // b has been simulated since its restore, so round-trip into a fresh world
  check('restore: biomass round-trips in a current save', restoreWorld(wRT, text).ok && same(wRT.biomass, a.biomass));
  const bad = JSON.parse(text); const arr = new Float32Array(a.biomass); arr[100] = 5;
  bad.w.biomass = Buffer.from(arr.buffer).toString('base64');
  check('corrupt: out-of-range biomass is rejected', restoreWorld(createWorld(1337), JSON.stringify(bad)).ok === false);
}
{ // 5d home stages: round-trip, and a 5c save (no sStage/cUpgT) restores with homes at their camp's stage
  const src = JSON.parse(text);
  const st = new Uint8Array(a.civ.sStage); st[a.civ.cHomeSlot[0]] = 1;
  src.c.sStage = Buffer.from(st.buffer).toString('base64');
  const w1 = createWorld(1337);
  check('5d restore: home stages round-trip', restoreWorld(w1, JSON.stringify(src)).ok && w1.civ.sStage[a.civ.cHomeSlot[0]] === 1 && same(w1.civ.cUpgT, a.civ.cUpgT));
  const old = JSON.parse(text); delete old.c.sStage; delete old.c.cUpgT;
  const kS = new Float32Array(a.civ.kAdopt); kS[0 * 10 + 1] = 0.9;   // camp 0 knows Shelter
  old.c.kAdopt = Buffer.from(kS.buffer).toString('base64');
  const w2 = createWorld(1337);
  const r2 = restoreWorld(w2, JSON.stringify(old));
  let ok = r2.ok;
  for (let s = 0; s < w2.civ.nS; s++) if (w2.civ.sKind[s] === 0 && w2.civ.sCamp[s] === 0 && w2.civ.sStage[s] !== 1) ok = false;
  check('5d restore: a 5c save (no stages) loads; camp 0 homes take its stage (Shelter -> wattle hut)', ok);
  const bad = JSON.parse(text); const b8 = new Uint8Array(a.civ.sStage.length).fill(7);
  bad.c.sStage = Buffer.from(b8.buffer).toString('base64');
  check('corrupt: an out-of-range home stage is rejected', restoreWorld(createWorld(1337), JSON.stringify(bad)).ok === false);
}
check('corrupt: a save from another seed is rejected', restoreWorld(createWorld(5), text).ok === false);
const poisoned = JSON.parse(text); const e = new Float32Array(128 * 128).fill(99); poisoned.w.elev = Buffer.from(e.buffer).toString('base64');
check('corrupt: out-of-range elevations are rejected', restoreWorld(fresh, JSON.stringify(poisoned)).ok === false);
check('corrupt: a rejected restore leaves the world untouched', same(fresh.elev, before));

// storage wrapper
const store = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, v); } };
check('storage: save then load round-trips', saveToStorage(store, a, { atmo: 1 }) && store.m.has(SAVE_KEY) && loadFromStorage(store, createWorld(1337)).ok);
check('storage: an empty store is a clean miss', loadFromStorage({ getItem: () => null }, createWorld(1337)).ok === false);
check('storage: quota errors are swallowed', saveToStorage({ setItem() { throw new Error('QuotaExceededError'); } }, a) === false);
check('storage: a throwing getItem is a clean miss', loadFromStorage({ getItem() { throw new Error('denied'); } }, createWorld(1337)).ok === false);

// bounds: one bad value used to load and then hang the page or poison the world (audit F1)
{
  const bad = (mut) => { const d = JSON.parse(text); mut(d); return restoreWorld(createWorld(1337), JSON.stringify(d)).ok; };
  const setF = (d, k, i, val, Ctor = Float32Array) => { const arr = new Ctor(Buffer.from(d.c[k], 'base64').buffer.slice(0)); arr[i] = val; d.c[k] = Buffer.from(arr.buffer).toString('base64'); };
  const setW = (d, k, i, val) => { const arr = new Float32Array(Buffer.from(d.w[k], 'base64').buffer.slice(0)); arr[i] = val; d.w[k] = Buffer.from(arr.buffer).toString('base64'); };
  check('restore rejects: a huge villager heading (used to hang the first step)', bad(d => setF(d, 'vHeading', 0, 1e30)) === false);
  check('restore rejects: one NaN in water (used to spread island-wide)', bad(d => setW(d, 'water', 500, NaN)) === false);
  check('restore rejects: NaN villager position', bad(d => setF(d, 'vX', 3, NaN)) === false);
  check('restore rejects: structure count above capacity', bad(d => { d.n.nS = 5e6; }) === false);
  check('restore rejects: out-of-range home and camp indices', bad(d => setF(d, 'vHome', 0, 99999, Int32Array)) === false && bad(d => setF(d, 'vCamp', 0, 77, Int32Array)) === false);
  check('restore rejects: a bad random state', bad(d => { d.rng = -5; }) === false);
  check('restore: an older save without a random state still loads', bad(d => { delete d.rng; }) === true);
}
{ // a huge heading in a live world no longer hangs the step (the wrap was a while loop)
  const w = mk(); for (let i = 0; i < 200; i++) simStep(w);
  let v = 0; while (!w.civ.vAlive[v]) v++;
  w.civ.vHeading[v] = 1e30; w.civ.vVX[v] = 0.3; w.civ.vVZ[v] = 0.1;
  const t0 = Date.now(); for (let i = 0; i < 40; i++) simStep(w);
  check('step: a huge heading no longer hangs the step and snaps back to the walking direction', Date.now() - t0 < 20000 && Math.abs(w.civ.vHeading[v]) < 10, `heading ${w.civ.vHeading[v]}`);
}
{ // restores are deterministic: the random state is saved and villager timers no longer use Math.random (audit F7)
  const run = () => { const w = createWorld(1337); restoreWorld(w, text); for (let i = 0; i < 600; i++) simStep(w); return w; };
  const p = run(), q = run();
  const cont = createWorld(1337); restoreWorld(cont, text);
  check('restore: two restores of one save run identically', same(p.civ.vX, q.civ.vX) && same(p.water, q.water) && p.civ.nAlive === q.civ.nAlive && p.rng.s === q.rng.s);
  check('restore: the random state continues from the save', cont.rng.s === a.rng.s, `${cont.rng.s} vs ${a.rng.s}`);
}

if (failed) { console.error(`${failed} persistence test(s) failed`); process.exit(1); }
console.log('persistence tests passed');
