import { TUNING } from './tuning.js';
import { GRID_W, GRID_H } from './grid.js';
import { sampleGrid, worldToGridX, worldToGridZ } from './sample.js';
import { emitEvent, EV_DISCOVERY } from './events.js';

// Phase 5b: know-how. Each camp holds an adoption value 0..1 for ten ideas; ideas are discovered where they are
// needed, take hold inside the camp, spread by contact, travel with splits and fade when unused
// (docs/SPEC-phase5-society.md section 4). Runs once per sim second from societyTick; zero allocation.

export const IDEA_FIRE = 0, IDEA_SHELTER = 1, IDEA_BASKETS = 2, IDEA_FARMING = 3, IDEA_WOOD = 4, IDEA_STONE = 5,
  IDEA_BRIDGES = 6, IDEA_PATHS = 7, IDEA_RITUAL = 8, IDEA_STORAGE = 9, N_IDEAS = 10;
export const IDEA_NAMES = ['Fire', 'Shelter', 'Baskets', 'Farming', 'Woodworking', 'Stonework', 'Bridges', 'Paths', 'Ritual', 'Storage'];
export const MYTH_DISCOVERY = 7;   // myth kind of a stone carved for a discovery (civ.js kinds are 1-6)

const KN_CAMPS = 8;   // = MAX_CAMPS in society.js (kept local: society imports this module)
const CH_IND = 0, CH_PAS = 1, CH_MYS = 2, CH_NONE = 3;
// prereq (-1 none) and the character that doubles the discovery chance (spec 4.1)
const PREREQ = [-1, IDEA_FIRE, -1, IDEA_BASKETS, IDEA_FIRE, IDEA_FIRE, IDEA_WOOD, IDEA_STONE, IDEA_FIRE, IDEA_BASKETS];
const FAVOUR = [CH_NONE, CH_NONE, CH_PAS, CH_PAS, CH_NONE, CH_IND, CH_IND, CH_IND, CH_MYS, CH_PAS];

const K = {
  known: 0.5, lost: 0.05,
  baseFire: 1 / 300, baseOther: 1 / 1200, popScale: 20, charMult: 2, monoMult: 2,
  startAdopt: 0.1, growth: 1 / 90, contactR: 1.5, spread: 0.004, splitKeep: 0.8,
  fadeAfter: 900, fadeRate: 1 / 1800,
  tripWindow: 600, tripsFull: 40, fertileSec: 600, fertileGround: 0.6, richWindow: 300, floodShelter: 300,
  envEvery: 10, shelterR: 2, woodR: 3, stoneR: 3, frustR: 4, ritualR: 4, forest: 0.65, trodden: 0.5,
};
export const KNOWHOW = Object.freeze(K);

let KH = null;   // civ.js helpers (recordMyth, slopeAtCell), bound at load to avoid an import cycle
export function bindKnowHelpers(h) { KH = h; }

export function createKnowhowArrays() {
  const n = KN_CAMPS * N_IDEAS;
  return {
    kAdopt: new Float32Array(n), kUsed: new Float32Array(n), kNeed: new Float32Array(n),
    kTrips: new Float32Array(KN_CAMPS), kFertSec: new Float32Array(KN_CAMPS), kRichSec: new Float32Array(KN_CAMPS),
    kFloodT: new Float32Array(KN_CAMPS).fill(-1e9),
    kFirst: new Uint8Array(N_IDEAS), discoveries: 0, firstDiscT: -1,
    kRngS: 0,   // state of know-how's own random stream (0 = not started); saved, so restores stay deterministic
  };
}

export function knows(civ, c, idea) { return c >= 0 && civ.kAdopt[c * N_IDEAS + idea] >= K.known; }
// 5c gating: the full town (society off) has every idea; a society camp needs to know it
export function campKnows(civ, c, idea) { return civ.societyOn === 0 || knows(civ, c, idea); }
export function anyKnows(civ, idea, maxCamps) {
  for (let c = 0; c < maxCamps; c++) if (civ.cActive[c] === 1 && civ.kAdopt[c * N_IDEAS + idea] >= K.known) return true;
  return false;
}

// the action an idea enables just happened in camp c: it stays fresh (spec 4.5)
export function useIdea(civ, c, idea, t) { if (c >= 0) civ.kUsed[c * N_IDEAS + idea] = t; }

// a forage visit landed (civ arrive): Baskets/Farming use, and the trip counter behind the Baskets need
export function noteForage(civ, c, t) {
  if (c < 0) return;
  civ.kTrips[c] += 1;
  useIdea(civ, c, IDEA_BASKETS, t); useIdea(civ, c, IDEA_FARMING, t);
}

// a flood reached one of camp c's homes: Shelter is needed for a while
export function noteFlood(civ, c, t) { if (c >= 0) civ.kFloodT[c] = t; }

// a new camp n split from camp c: the family carries the ideas, slightly diluted (spec 3.7 step 5)
export function splitCarry(civ, c, n, t) {
  for (let k = 0; k < N_IDEAS; k++) {
    const a = civ.kAdopt[c * N_IDEAS + k] * K.splitKeep;
    civ.kAdopt[n * N_IDEAS + k] = a < K.lost ? 0 : a;
    civ.kUsed[n * N_IDEAS + k] = civ.kUsed[c * N_IDEAS + k];   // carried, not used: the parent's clocks come along
    civ.kNeed[n * N_IDEAS + k] = civ.kNeed[c * N_IDEAS + k];
  }
  civ.kTrips[n] = 0; civ.kFertSec[n] = 0; civ.kRichSec[n] = 0; civ.kFloodT[n] = -1e9;
}

// a camp slot was (re)opened with no history (the founding family, wanderers)
export function clearCamp(civ, c) {
  for (let k = 0; k < N_IDEAS; k++) { civ.kAdopt[c * N_IDEAS + k] = 0; civ.kUsed[c * N_IDEAS + k] = 0; civ.kNeed[c * N_IDEAS + k] = 0; }
  civ.kTrips[c] = 0; civ.kFertSec[c] = 0; civ.kRichSec[c] = 0; civ.kFloodT[c] = -1e9;
}

function campChar(world, c) {
  const b = sampleGrid(world.culturalBias, world.civ.cX[c], world.civ.cZ[c]);
  return b < -0.33 ? CH_IND : b > 0.33 ? CH_MYS : CH_PAS;
}

function nearMonolith(world, x, z, r) {
  const m = world.monoliths;
  for (let k = 0; k < 8; k++) {
    if (m[k * 4 + 3] === 0) continue;
    const dx = m[k * 4] - x, dz = m[k * 4 + 1] - z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

// area signals around camp c, refreshed every envEvery s (staggered per camp): they change over minutes
function refreshEnv(world, c) {
  const civ = world.civ, i0 = c * N_IDEAS;
  const gx = Math.round(worldToGridX(civ.cX[c])), gz = Math.round(worldToGridZ(civ.cZ[c]));
  const cell = 20 / GRID_W, rc = Math.ceil(K.frustR / cell);
  let mN = 0, mS = 0, wN = 0, wS = 0, sN = 0, sS = 0, bN = 0, bS = 0, pN = 0, pS = 0;
  for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
    const x = gx + dx, z = gz + dz;
    if (x < 0 || z < 0 || x >= GRID_W || z >= GRID_H) continue;
    const i = z * GRID_W + x;
    if (world.mask[i] === 1) continue;
    const d = Math.sqrt(dx * dx + dz * dz) * cell;
    if (d > K.frustR) continue;
    const steep = KH.slopeAtCell(world.elev, i) > TUNING.steepSlope;
    if (d <= K.shelterR) { mN++; mS += world.moisture[i]; }
    if (d <= K.woodR) { wN++; if (world.biomass[i] > K.forest) wS++; }
    if (d <= K.stoneR) { sN++; if (steep) sS++; }
    if (world.water[i] > 0.004) { bN++; bS += world.frustration[i]; }
    else if (steep || world.compaction[i] > K.trodden) { pN++; pS += world.frustration[i]; }
  }
  civ.kNeed[i0 + IDEA_SHELTER] = mN ? mS / mN : 0;
  civ.kNeed[i0 + IDEA_WOOD] = wN ? wS / wN : 0;
  civ.kNeed[i0 + IDEA_STONE] = sN ? sS / sN : 0;
  civ.kNeed[i0 + IDEA_BRIDGES] = bN ? bS / bN : 0;
  civ.kNeed[i0 + IDEA_PATHS] = pN ? pS / pN : 0;
  let sacred = nearMonolith(world, civ.cX[c], civ.cZ[c], K.ritualR);
  for (let k = 0; k < civ.nM && !sacred; k++) {
    const dx = civ.mX[k] - civ.cX[c], dz = civ.mZ[k] - civ.cZ[c];
    if (civ.mStruct[k] >= 0 && dx * dx + dz * dz < K.ritualR * K.ritualR) sacred = true;
  }
  civ.kNeed[i0 + IDEA_RITUAL] = 0.3 + (sacred ? 0.7 : 0);
}

// stateless 0..1 draw per (seed, second, camp, idea): discovery rolls leave world.rng's sequence alone,
// so adding know-how does not reshuffle the rest of the sim
function roll(seed, t, c, k) {
  let h = Math.imul(seed ^ 0x27d4eb2d, 0x9e3779b1) ^ Math.imul(Math.floor(t) + 1, 0x85ebca6b) ^ Math.imul(c * 16 + k + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function discover(world, c, idea) {
  const civ = world.civ, t = world.stats.time;
  civ.kAdopt[c * N_IDEAS + idea] = K.startAdopt; civ.kUsed[c * N_IDEAS + idea] = t;
  civ.discoveries++;
  if (civ.firstDiscT < 0) civ.firstDiscT = t;
  emitEvent(world.events, EV_DISCOVERY, civ.cX[c], civ.cZ[c], c * N_IDEAS + idea);
  const first = civ.kFirst[idea] === 0;
  civ.kFirst[idea] = 1;
  if (first || nearMonolith(world, civ.cX[c], civ.cZ[c], TUNING.monolithRadius)) {
    // the stone's placement and motif draw from know-how's own stream, so world.rng's sequence is untouched
    const main = world.rng.s;
    world.rng.s = civ.kRngS !== 0 ? civ.kRngS : ((world.seed ^ 0x51ed270b) >>> 0) || 1;
    KH.recordMyth(world, MYTH_DISCOVERY, civ.cX[c], civ.cZ[c]);
    civ.kRngS = world.rng.s; world.rng.s = main;
  }
}

// once per sim second, after society's recount (cPop current)
export function knowhowTick(world, maxCamps, capOf) {
  const civ = world.civ, t = world.stats.time;
  const tripDecay = 1 - 1 / K.tripWindow, fertDecay = 1 - 1 / K.fertileSec, richDecay = 1 - 1 / K.richWindow;
  // per-second signals from what villagers are doing
  for (let c = 0; c < maxCamps; c++) { civ.kTrips[c] *= tripDecay; civ.kFertSec[c] *= fertDecay; civ.kRichSec[c] *= richDecay; }
  for (let v = 0; v < civ.nV; v++) {
    if (civ.vAlive[v] === 0) continue;
    const a = civ.vCamp[v];
    if (a < 0) continue;
    if (civ.vState[v] === 2 /* ST_FORAGE */ && sampleGrid(world.fertility, civ.vX[v], civ.vZ[v]) > K.fertileGround) civ.kFertSec[a] += 1;
    // contact: a villager near another camp's centre passes on what its own camp knows (spec 4.4)
    for (let b = 0; b < maxCamps; b++) {
      if (b === a || civ.cActive[b] === 0) continue;
      const dx = civ.vX[v] - civ.cX[b], dz = civ.vZ[v] - civ.cZ[b];
      if (dx * dx + dz * dz > K.contactR * K.contactR) continue;
      for (let k = 0; k < N_IDEAS; k++) {
        const ia = a * N_IDEAS + k, ib = b * N_IDEAS + k;
        const d = civ.kAdopt[ia] - civ.kAdopt[ib];
        if (d <= 0) continue;
        if (civ.kAdopt[ib] < K.lost) civ.kUsed[ib] = t;   // newly heard of: fresh, not stale
        civ.kAdopt[ib] = Math.min(1, civ.kAdopt[ib] + K.spread * d);
      }
    }
  }
  for (let c = 0; c < maxCamps; c++) {
    if (civ.cActive[c] === 0 || civ.cHomeSlot[c] < 0) continue;   // settling parties discover nothing until they arrive
    const i0 = c * N_IDEAS, pop = civ.cPop[c];
    if (civ.cFood[c] > capOf(civ, c) * 10) { civ.kRichSec[c] += 1; useIdea(civ, c, IDEA_STORAGE, t); }
    if ((Math.floor(t) + c) % K.envEvery === 0) refreshEnv(world, c);
    civ.kNeed[i0 + IDEA_FIRE] = 1;
    if (t - civ.kFloodT[c] < K.floodShelter) civ.kNeed[i0 + IDEA_SHELTER] = 1;
    civ.kNeed[i0 + IDEA_BASKETS] = Math.min(1, civ.kTrips[c] / K.tripsFull);
    civ.kNeed[i0 + IDEA_FARMING] = Math.min(1, civ.kFertSec[c] / K.fertileSec);
    civ.kNeed[i0 + IDEA_STORAGE] = Math.min(1, civ.kRichSec[c] / K.richWindow);
    const ch = campChar(world, c);
    const mono = nearMonolith(world, civ.cX[c], civ.cZ[c], TUNING.monolithRadius) ? K.monoMult : 1;
    for (let k = 0; k < N_IDEAS; k++) {
      const i = i0 + k;
      let a = civ.kAdopt[i];
      if (a < K.lost) {
        // discovery (spec 4.2): needs its prereq known; one draw per eligible idea per second
        if (PREREQ[k] >= 0 && civ.kAdopt[i0 + PREREQ[k]] < K.known) continue;
        const p = (k === IDEA_FIRE ? K.baseFire : K.baseOther) * Math.min(1, civ.kNeed[i]) * (1 + pop / K.popScale)
          * (FAVOUR[k] === ch ? K.charMult : 1) * mono;
        if (roll(world.seed, t, c, k) < p) discover(world, c, k);
        continue;
      }
      // in use: takes hold (logistic); unused for fadeAfter: stops growing and fades until lost (spec 4.3, 4.5)
      if (t - civ.kUsed[i] < K.fadeAfter) a += K.growth * a * (1 - a);
      else a -= K.fadeRate;
      civ.kAdopt[i] = a < K.lost ? 0 : a > 1 ? 1 : a;
    }
  }
}
