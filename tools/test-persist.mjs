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
const text = serializeWorld(a, { atmo: 0.5 });
check('save: payload is a JSON string under 1.6 MB', typeof text === 'string' && text.length < 1.6e6, `${(text.length / 1024).toFixed(0)} KB`);

const b = createWorld(1337);                 // fresh world, same seed, nothing prewarmed
const r = restoreWorld(b, text);
check('restore: a valid save is accepted and returns the extra state', r.ok && r.extra && r.extra.atmo === 0.5);
check('restore: terrain, soil and culture arrays match exactly', same(a.elev, b.elev) && same(a.fertility, b.fertility) && same(a.culturalBias, b.culturalBias) && same(a.compaction, b.compaction) && same(a.engCover, b.engCover));
check('restore: villagers, structures, myths and monoliths match', same(a.civ.vX, b.civ.vX) && same(a.civ.sX, b.civ.sX) && same(a.civ.sKind, b.civ.sKind) && same(a.monoliths, b.monoliths) && a.civ.nS === b.civ.nS && a.civ.nM === b.civ.nM && a.stats.time === b.stats.time);
check('restore: runtime-only state is reset sanely (orders cleared, builders free)', b.civ.oState.every(v => v === 0) && b.civ.vJob.every(v => v === -1) && b.civ.vState.every(v => v === 0));
for (let i = 0; i < 400; i++) simStep(b);
let fin = true; for (let i = 0; i < b.elev.length; i++) if (!Number.isFinite(b.elev[i]) || !Number.isFinite(b.water[i])) fin = false;
check('restore: the restored world keeps simulating without blowing up', fin);

// corruption / mismatch must leave a fresh world untouched
const fresh = createWorld(1337);
const before = Float32Array.from(fresh.elev);
check('corrupt: garbage JSON is rejected', restoreWorld(fresh, '{not json').ok === false);
check('corrupt: truncated array data is rejected', restoreWorld(fresh, text.replace(/"elev":"[^"]{40}/, '"elev":"AAAA')).ok === false);
check('corrupt: wrong version is rejected', restoreWorld(fresh, text.replace('"v":1', '"v":99')).ok === false);
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

if (failed) { console.error(`${failed} persistence test(s) failed`); process.exit(1); }
console.log('persistence tests passed');
