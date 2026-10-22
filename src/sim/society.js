import { TUNING } from './tuning.js';
import { GRID_W, GRID_H } from './grid.js';
import { sampleGrid, worldToGridX, worldToGridZ } from './sample.js';

// Phase 5a: the island starts with one family that grows, splits into camps and can die out locally
// (docs/SPEC-phase5-society.md section 3). Runs once per sim second from civ's secondTick; zero allocation.

export const MAX_CAMPS = 8;
export const ST_SETTLE = 13;            // walking to found (or join) a camp that has no home yet
export const GATE_MASON = 1, GATE_RITUAL = 2, GATE_FARM = 4, GATE_ALL = 7;

const S = {
  startPeople: 5, startAdults: 2, wanderers: 4,
  campFood0: 60, eatRate: 0.06, adultAge: 300,
  birthFood: 100, birthReserve: 5, birthGap: 45,
  lifeBase: 2400, lifeSpread: 1200, starveAfter: 60,
  householdSize: 3, homeFood: 120, campCapBase: 12,
  splitGap: 120, splitMin: 3.0, splitMax: 6.0, campSpacing: 2.5,
  emptyWait: 60, settleGiveUp: 150,
};
export const SOCIETY = Object.freeze(S);

export function createSocietyArrays(nV, nS) {
  const f = (n) => new Float32Array(n), i32 = (n) => new Int32Array(n).fill(-1);
  return {
    vAlive: new Uint8Array(nV), vAge: f(nV), vLife: f(nV), vCamp: i32(nV),
    sCamp: i32(nS),
    cActive: new Uint8Array(MAX_CAMPS), cX: f(MAX_CAMPS), cZ: f(MAX_CAMPS), cFood: f(MAX_CAMPS),
    cBirthT: f(MAX_CAMPS), cSplitT: f(MAX_CAMPS), cStarveT: f(MAX_CAMPS), cFounded: f(MAX_CAMPS),
    cPop: new Int32Array(MAX_CAMPS), cHomes: new Int32Array(MAX_CAMPS), cHomeSlot: i32(MAX_CAMPS),
    nAlive: 0, emptyT: 0, societyOn: 0, gates: 0, splits: 0,
    hCount: new Int32Array(nS), cOldest: i32(MAX_CAMPS),   // runtime scratch (recomputed every tick)
  };
}

function cellOf(x, z) {
  let gx = Math.round(worldToGridX(x)), gz = Math.round(worldToGridZ(z));
  if (gx < 0) gx = 0; else if (gx > GRID_W - 1) gx = GRID_W - 1;
  if (gz < 0) gz = 0; else if (gz > GRID_H - 1) gz = GRID_H - 1;
  return gz * GRID_W + gx;
}

// helpers injected by civ.js (avoids a circular import of its internals)
let H = null;
export function bindCivHelpers(h) { H = h; }

function freeSlot(civ) {
  for (let v = 0; v < civ.nV; v++) if (civ.vAlive[v] === 0) return v;
  return -1;
}

export function spawnVillager(world, camp, x, z, age) {
  const civ = world.civ, rng = world.rng;
  const v = freeSlot(civ);
  if (v < 0) return -1;
  civ.vAlive[v] = 1; civ.nAlive++;
  civ.vAge[v] = age; civ.vLife[v] = S.lifeBase + rng.next() * S.lifeSpread;
  civ.vCamp[v] = camp; civ.vHome[v] = camp >= 0 ? civ.cHomeSlot[camp] : -1;
  civ.vRole[v] = 0; civ.vState[v] = 0; civ.vJob[v] = -1; civ.vAux[v] = -1; civ.vSupply[v] = -1;
  civ.vCargo[v] = 0; civ.vCargoKind[v] = 0;
  civ.vX[v] = x; civ.vZ[v] = z; civ.vTX[v] = x; civ.vTZ[v] = z; civ.vVX[v] = 0; civ.vVZ[v] = 0;
  civ.vEnergy[v] = 0.6 + rng.next() * 0.4;
  civ.vTimer[v] = rng.next() * 1.5;
  civ.vPhase[v] = rng.next() * 6.283;
  civ.vHeading[v] = rng.next() * 6.283;
  return v;
}

export function killVillager(world, v) {
  const civ = world.civ;
  if (civ.vAlive[v] === 0) return;
  H.releaseVillager(world, v);
  civ.vAlive[v] = 0; civ.nAlive--;
  civ.vCamp[v] = -1; civ.vHome[v] = -1; civ.vState[v] = 0; civ.vCargo[v] = 0;
  civ.vVX[v] = 0; civ.vVZ[v] = 0;
}

function newCamp(world, x, z, food) {
  const civ = world.civ;
  let c = -1;
  for (let k = 0; k < MAX_CAMPS; k++) if (civ.cActive[k] === 0) { c = k; break; }
  if (c < 0) return -1;
  civ.cActive[c] = 1; civ.cX[c] = x; civ.cZ[c] = z; civ.cFood[c] = food;
  civ.cBirthT[c] = 0; civ.cSplitT[c] = 0; civ.cStarveT[c] = 0; civ.cFounded[c] = world.stats.time;
  civ.cPop[c] = 0; civ.cHomes[c] = 0; civ.cHomeSlot[c] = -1;
  return c;
}

// place a dwelling for camp c (reusing a fully ruined slot of an abandoned camp once the cap is reached)
function addHome(world, c, x, z, build) {
  const civ = world.civ;
  let s = -1;
  if (civ.dwellings >= TUNING.dwellingCap) {
    for (let k = 0; k < civ.nS; k++) {
      if (civ.sKind[k] !== 0 || civ.sDecay[k] < 1) continue;
      const oc = civ.sCamp[k];
      if (oc >= 0 && civ.cActive[oc] === 1 && oc !== c) continue;
      s = k; break;
    }
    if (s < 0) return -1;
    civ.sX[s] = x; civ.sZ[s] = z; civ.sDecay[s] = 0; civ.sLum[s] = 0; civ.sEpoch++;
  } else {
    s = H.addDwelling(world, x, z);
    if (s < 0) return -1;
  }
  civ.sBuild[s] = build; civ.sRot[s] = world.rng.next() * 6.283;
  civ.sBias[s] = sampleGrid(world.culturalBias, x, z);
  civ.sCamp[s] = c;
  if (civ.cHomeSlot[c] < 0) civ.cHomeSlot[c] = s;
  return s;
}

// best of n samples by fertility in a ring around (x, z), dry, buildable and away from other camps
const site = new Float32Array(2);
function findSite(world, x, z, rMin, rMax, n) {
  const civ = world.civ, rng = world.rng;
  let best = -1;
  for (let k = 0; k < n; k++) {
    const a = rng.next() * 6.283, r = rMin + rng.next() * (rMax - rMin);
    const sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
    if (!H.siteOk(world, sx, sz, 1.3 * 1.3, 0.5)) continue;
    let near = false;
    for (let c = 0; c < MAX_CAMPS; c++) {
      if (civ.cActive[c] === 0) continue;
      const dx = civ.cX[c] - sx, dz = civ.cZ[c] - sz;
      if (dx * dx + dz * dz < S.campSpacing * S.campSpacing) { near = true; break; }
    }
    if (near) continue;
    const f = world.fertility[cellOf(sx, sz)];
    if (f > best) { best = f; site[0] = sx; site[1] = sz; }
  }
  return best;
}

// Primitive start (spec 3.2): one family of five around a hide shelter on good ground near the centre.
export function seedFamily(world) {
  const civ = world.civ, rng = world.rng;
  civ.societyOn = 1; civ.gates = 0;
  let fx = 0, fz = 0;
  if (findSite(world, 0, 0, 0, 5.0, 200) < 0) { findSite(world, 0, 0, 0, 7.0, 400); }
  fx = site[0]; fz = site[1];
  const c = newCamp(world, fx, fz, S.campFood0);
  addHome(world, c, fx, fz, 1);
  for (let k = 0; k < S.startPeople; k++) {
    const adult = k < S.startAdults;
    const age = adult ? 600 + rng.next() * 300 : rng.next() * 300;
    const a = rng.next() * 6.283, r = 0.15 + rng.next() * 0.45;
    let px = fx + Math.cos(a) * r, pz = fz + Math.sin(a) * r;
    if (world.water[cellOf(px, pz)] > 0.006) { px = fx; pz = fz; }
    spawnVillager(world, c, px, pz, age);
  }
}

// Old start (14 homes, 120 villagers, every gate open): kept for the subsystem tests and ?town=1.
export function markTownAlive(civ) {
  civ.societyOn = 0; civ.gates = GATE_ALL;
  civ.vAlive.fill(1); civ.nAlive = civ.nV; civ.vCamp.fill(0);
  for (let v = 0; v < civ.nV; v++) civ.vAge[v] = 600, civ.vLife[v] = 1e9;
  civ.cActive[0] = 1; civ.cHomeSlot[0] = 0;
  for (let s = 0; s < civ.nS; s++) if (civ.sKind[s] === 0) civ.sCamp[s] = 0;
}

function homeHealthy(civ, s) { return s >= 0 && civ.sKind[s] === 0 && civ.sDecay[s] < 0.9; }

// fewest-member healthy home of camp c (hCount must be current)
function roomiestHome(civ, c) {
  let best = -1, bn = 1e9;
  for (let s = 0; s < civ.nS; s++) {
    if (civ.sCamp[s] !== c || !homeHealthy(civ, s)) continue;
    if (civ.hCount[s] < bn) { bn = civ.hCount[s]; best = s; }
  }
  return best;
}

function recount(world) {
  const civ = world.civ;
  civ.cPop.fill(0); civ.cHomes.fill(0); civ.cOldest.fill(-1); civ.hCount.fill(0);
  for (let s = 0; s < civ.nS; s++) {
    const c = civ.sCamp[s];
    if (c >= 0 && civ.cActive[c] === 1 && homeHealthy(civ, s)) civ.cHomes[c]++;
  }
  let n = 0;
  for (let v = 0; v < civ.nV; v++) {
    if (civ.vAlive[v] === 0) continue;
    n++;
    const c = civ.vCamp[v];
    if (c < 0) continue;
    civ.cPop[c]++;
    const o = civ.cOldest[c];
    if (o < 0 || civ.vAge[v] > civ.vAge[o]) civ.cOldest[c] = v;
    const h = civ.vHome[v];
    if (homeHealthy(civ, h) && civ.sCamp[h] === c) civ.hCount[h]++;
  }
  civ.nAlive = n;
  // homeless (home ruined, or belongs to another camp): move into the roomiest home of their own camp
  for (let v = 0; v < civ.nV; v++) {
    if (civ.vAlive[v] === 0 || civ.vCamp[v] < 0) continue;
    const h = civ.vHome[v], c = civ.vCamp[v];
    if (homeHealthy(civ, h) && civ.sCamp[h] === c) continue;
    const r = roomiestHome(civ, c);
    civ.vHome[v] = r;
    if (r >= 0) civ.hCount[r]++;
  }
}

function campCap() { return S.campCapBase; }

function trySplit(world, c) {
  const civ = world.civ;
  if (civ.cPop[c] < campCap() || civ.cHomes[c] < 2 || world.stats.time - civ.cSplitT[c] < S.splitGap) return;
  let free = 0; for (let k = 0; k < MAX_CAMPS; k++) if (civ.cActive[k] === 0) free++;
  if (free === 0) return;
  civ.cSplitT[c] = world.stats.time;
  // the leaving household: the fullest home that has an adult in it
  let leave = -1, ln = 0;
  for (let s = 0; s < civ.nS; s++) {
    if (civ.sCamp[s] !== c || !homeHealthy(civ, s) || civ.hCount[s] <= ln) continue;
    let adult = false;
    for (let v = 0; v < civ.nV; v++) if (civ.vAlive[v] === 1 && civ.vHome[v] === s && civ.vAge[v] >= S.adultAge) { adult = true; break; }
    if (adult) { ln = civ.hCount[s]; leave = s; }
  }
  if (leave < 0 || ln >= civ.cPop[c]) return;
  if (findSite(world, civ.cX[c], civ.cZ[c], S.splitMin, S.splitMax, 40) < 0) return;
  const food = civ.cFood[c] * ln / civ.cPop[c];
  const n = newCamp(world, site[0], site[1], food);
  if (n < 0) return;
  civ.cFood[c] -= food;
  civ.cPop[n] = ln; civ.cPop[c] -= ln;   // counted now, so the new camp is not taken for abandoned later this tick
  civ.splits++;
  for (let v = 0; v < civ.nV; v++) {
    if (civ.vAlive[v] === 0 || civ.vHome[v] !== leave) continue;
    H.releaseVillager(world, v);
    civ.vCamp[v] = n; civ.vHome[v] = -1;
    civ.vState[v] = ST_SETTLE; civ.vTX[v] = site[0]; civ.vTZ[v] = site[1]; civ.vTimer[v] = 99;
  }
  civ.hCount[leave] = 0;
}

// a settler reached its camp's site (or gave up the walk): the first one puts up a hide shelter
export function settleArrive(world, v) {
  const civ = world.civ, c = civ.vCamp[v];
  if (c < 0) return;
  if (civ.cHomeSlot[c] < 0 || !homeHealthy(civ, civ.cHomeSlot[c])) {
    const hx = civ.vX[v], hz = civ.vZ[v];
    civ.cX[c] = hx; civ.cZ[c] = hz;
    civ.cHomeSlot[c] = -1;
    addHome(world, c, hx, hz, 0.3);
  }
  for (let u = 0; u < civ.nV; u++) {
    if (civ.vAlive[u] === 0 || civ.vCamp[u] !== c || civ.vState[u] !== ST_SETTLE) continue;
    if (civ.vHome[u] < 0) civ.vHome[u] = civ.cHomeSlot[c];
    if (u !== v) continue;
    civ.vState[u] = 0; civ.vTimer[u] = 0.5;
  }
  civ.vHome[v] = civ.cHomeSlot[c];
}

function wanderers(world) {
  const civ = world.civ, rng = world.rng;
  if (findSite(world, 0, 0, 0, 7.0, 300) < 0) return;
  const sx = site[0], sz = site[1];
  const c = newCamp(world, sx, sz, S.campFood0);
  if (c < 0) return;
  const r = Math.hypot(sx, sz) || 1, ex = sx / r * 7.4, ez = sz / r * 7.4;
  for (let k = 0; k < S.wanderers; k++) {
    const age = k < 2 ? 600 + rng.next() * 300 : rng.next() * 300;
    const v = spawnVillager(world, c, ex + (rng.next() - 0.5) * 0.4, ez + (rng.next() - 0.5) * 0.4, age);
    if (v < 0) continue;
    civ.vState[v] = ST_SETTLE; civ.vTX[v] = sx; civ.vTZ[v] = sz; civ.vTimer[v] = 99;
  }
}

export function societyTick(world) {
  const civ = world.civ;
  if (civ.societyOn === 0) return;
  const rng = world.rng, t = world.stats.time;
  // ageing and old age
  for (let v = 0; v < civ.nV; v++) {
    if (civ.vAlive[v] === 0) continue;
    civ.vAge[v] += 1;
    if (civ.vAge[v] >= civ.vLife[v]) killVillager(world, v);
  }
  recount(world);
  // floor rule: an empty island gets a wandering family
  if (civ.nAlive === 0) {
    civ.emptyT += 1;
    if (civ.emptyT >= S.emptyWait) { civ.emptyT = 0; wanderers(world); recount(world); }
  } else civ.emptyT = 0;
  for (let c = 0; c < MAX_CAMPS; c++) {
    if (civ.cActive[c] === 0) continue;
    const pop = civ.cPop[c];
    if (pop === 0) { civ.cActive[c] = 0; continue; }   // abandoned: its homes ruin on their own (civ secondTick)
    // a settling party that cannot reach its site founds the camp where its first member stands
    if (civ.cHomeSlot[c] < 0 && t - civ.cFounded[c] > S.settleGiveUp) {
      for (let v = 0; v < civ.nV; v++) if (civ.vAlive[v] === 1 && civ.vCamp[v] === c) { settleArrive(world, v); break; }
    }
    // upkeep and starvation
    civ.cFood[c] -= S.eatRate * pop;
    if (civ.cFood[c] <= 0) {
      civ.cFood[c] = 0;
      civ.cStarveT[c] += 1;
      if (civ.cStarveT[c] >= S.starveAfter) { civ.cStarveT[c] = 0; if (civ.cOldest[c] >= 0) killVillager(world, civ.cOldest[c]); }
      continue;
    }
    civ.cStarveT[c] = 0;
    if (civ.cHomeSlot[c] < 0) continue;   // still on the way
    // births
    if (civ.cFood[c] >= S.birthFood + S.birthReserve * pop && pop < campCap() && t - civ.cBirthT[c] >= S.birthGap) {
      const a = rng.next() * 6.283;
      const v = spawnVillager(world, c, civ.cX[c] + Math.cos(a) * 0.3, civ.cZ[c] + Math.sin(a) * 0.3, 0);
      if (v >= 0) {
        civ.cFood[c] -= S.birthFood; civ.cBirthT[c] = t; civ.cPop[c]++;
        const h = roomiestHome(civ, c); civ.vHome[v] = h; if (h >= 0) civ.hCount[h]++;
      }
    }
    // households: one home per householdSize people
    const want = Math.ceil(civ.cPop[c] / S.householdSize);
    if (civ.cHomes[c] < want && civ.cFood[c] >= S.homeFood) {
      for (let k = 0; k < 40; k++) {
        const a = rng.next() * 6.283, r = 0.9 + rng.next() * 1.1;
        const x = civ.cX[c] + Math.cos(a) * r, z = civ.cZ[c] + Math.sin(a) * r;
        if (!H.siteOk(world, x, z, 1.3 * 1.3, 0.35)) continue;
        if (addHome(world, c, x, z, 0.02) >= 0) { civ.cFood[c] -= S.homeFood; civ.cHomes[c]++; }
        break;
      }
    }
    trySplit(world, c);
  }
}
