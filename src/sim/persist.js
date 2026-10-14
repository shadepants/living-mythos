import { GRID_N } from './grid.js';

// Save / restore of the living world (spec 1.6). Typed arrays travel as base64; everything else as small JSON.
export const SAVE_KEY = 'mythos.save.v1';
const SAVE_VERSION = 1;

const WORLD_F32 = ['elev', 'water', 'sediment', 'moisture', 'fertility', 'compaction', 'frustration', 'culturalBias', 'monoliths', 'monoPulse'];
const WORLD_U8 = ['engCover'];
const CIV_F32 = ['vX', 'vZ', 'vVX', 'vVZ', 'vTX', 'vTZ', 'vCargo', 'vEnergy', 'vPhase', 'vTimer', 'vHeading',
  'sX', 'sZ', 'sRot', 'sBias', 'sBuild', 'sDecay', 'sLum', 'sDirX', 'sDirZ', 'sLen', 'mX', 'mZ', 'mT0', 'mSeed', 'monoX', 'monoZ'];
const CIV_U8 = ['vRole', 'vState', 'sKind', 'sActive', 'mKind', 'mMotif'];
const CIV_I32 = ['vHome', 'vAux', 'mStruct', 'mAnniv', 'monoStruct'];
const CIV_NUM = ['nS', 'dwellings', 'nM', 'food', 'masons', 'built', 'bridges', 'revived', 'mythFlags', 'mythClock'];

function toB64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(str, Ctor, expectLen) {
  const bin = atob(str);
  if (bin.length !== expectLen * Ctor.BYTES_PER_ELEMENT) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Ctor(bytes.buffer);
}

export function serializeWorld(world, extra) {
  const civ = world.civ;
  const out = { v: SAVE_VERSION, seed: world.seed, time: world.stats.time, extra: extra || null, w: {}, c: {}, n: {} };
  for (const k of WORLD_F32) out.w[k] = toB64(world[k]);
  for (const k of WORLD_U8) out.w[k] = toB64(world[k]);
  for (const k of CIV_F32) out.c[k] = toB64(civ[k]);
  for (const k of CIV_U8) out.c[k] = toB64(civ[k]);
  for (const k of CIV_I32) out.c[k] = toB64(civ[k]);
  for (const k of CIV_NUM) out.n[k] = civ[k];
  return JSON.stringify(out);
}

// Returns {ok, extra}. The world is only modified when the whole payload validates.
export function restoreWorld(world, text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false }; }
  if (!data || data.v !== SAVE_VERSION || data.seed !== world.seed || !data.w || !data.c || !data.n) return { ok: false };
  const civ = world.civ;
  const staged = [];
  try {
    for (const k of WORLD_F32) { const a = fromB64(data.w[k], Float32Array, world[k].length); if (!a) return { ok: false }; staged.push([world[k], a]); }
    for (const k of WORLD_U8) { const a = fromB64(data.w[k], Uint8Array, world[k].length); if (!a) return { ok: false }; staged.push([world[k], a]); }
    for (const k of CIV_F32) { const a = fromB64(data.c[k], Float32Array, civ[k].length); if (!a) return { ok: false }; staged.push([civ[k], a]); }
    for (const k of CIV_U8) { const a = fromB64(data.c[k], Uint8Array, civ[k].length); if (!a) return { ok: false }; staged.push([civ[k], a]); }
    for (const k of CIV_I32) { const a = fromB64(data.c[k], Int32Array, civ[k].length); if (!a) return { ok: false }; staged.push([civ[k], a]); }
    for (const k of CIV_NUM) if (typeof data.n[k] !== 'number' || !Number.isFinite(data.n[k])) return { ok: false };
  } catch (e) { return { ok: false }; }
  // sanity: elevations and fertility must be finite and in range before we trust the data
  for (const [target, src] of staged) {
    if (target === world.elev) { for (let i = 0; i < GRID_N; i++) if (!Number.isFinite(src[i]) || src[i] > 10 || src[i] < -10) return { ok: false }; }
    if (target === world.fertility) { for (let i = 0; i < GRID_N; i++) if (!(src[i] >= 0 && src[i] <= 1.0001)) return { ok: false }; }
  }
  for (const [target, src] of staged) target.set(src);
  for (const k of CIV_NUM) civ[k] = data.n[k];
  world.stats.time = data.time || 0;
  // runtime-only state that is not saved: orders restart, builders go home, unfinished works are considered done
  civ.oState.fill(0); civ.oWorker.fill(-1); civ.oStruct.fill(-1); civ.vJob.fill(-1);
  for (let v = 0; v < civ.nV; v++) { civ.vState[v] = 0; civ.vTimer[v] = Math.random() * 1.5; civ.vVX[v] = 0; civ.vVZ[v] = 0; }
  for (let s = 0; s < civ.nS; s++) if (civ.sKind[s] >= 2 && civ.sKind[s] <= 4 && civ.sBuild[s] < 1) civ.sBuild[s] = 1;
  world.vx.fill(0); world.vz.fill(0);
  world.fluxL.fill(0); world.fluxR.fill(0); world.fluxT.fill(0); world.fluxB.fill(0);
  civ.eventCursor.i = world.events.head;
  return { ok: true, extra: data.extra };
}

export function saveToStorage(storage, world, extra) {
  try { storage.setItem(SAVE_KEY, serializeWorld(world, extra)); return true; } catch (e) { return false; }
}
export function loadFromStorage(storage, world) {
  let text = null;
  try { text = storage.getItem(SAVE_KEY); } catch (e) { return { ok: false }; }
  if (!text) return { ok: false };
  return restoreWorld(world, text);
}
