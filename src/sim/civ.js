import { TUNING } from './tuning.js';
import { GRID_W, GRID_H, CELL_SIZE } from './grid.js';
import { sampleGrid, worldToGridX, worldToGridZ } from './sample.js';
import { stepHomeField, homeFieldAt, homeFieldNext, HF_INF } from './paths.js';
import {
  nextEvent, emitEvent, EV_BUILD_DONE, EV_DUST, EV_LANTERN, EV_CHIME, EV_GREET, EV_REVIVE, EV_MYTH,
} from './events.js';
import {
  createSocietyArrays, bindCivHelpers, seedFamily, markTownAlive, societyTick, settleArrive, killVillager,
  ST_SETTLE, GATE_MASON, GATE_RITUAL, GATE_FARM, SOCIETY,
} from './society.js';
export { ST_SETTLE, GATE_MASON, GATE_RITUAL, GATE_FARM, GATE_ALL, MAX_CAMPS, killVillager, spawnVillager, SOCIETY } from './society.js';

// Roles
export const ROLE_FORAGER = 0, ROLE_HAULER = 1, ROLE_MASON = 2, ROLE_MYSTIC = 3;
// Villager states
export const ST_IDLE = 0, ST_WALK = 1, ST_FORAGE = 2, ST_HAUL = 3, ST_BUILD = 4, ST_MIGRATE = 5, ST_PROCESSION = 6, ST_REST = 7, ST_GREET = 8, ST_CONSECRATE = 9;
// Structure kinds
export const KIND_DWELLING = 0, KIND_MONOLITH = 1, KIND_BRIDGE = 2, KIND_STEPS = 3, KIND_PAVING = 4, KIND_MYTH = 5;
export const ST_GATHER = 10;
export const ST_FETCH = 11, ST_SUPPLY = 12;          // hauler material runs: walk to forest/quarry, then to the work
export const MAT_FOOD = 0, MAT_TIMBER = 1, MAT_STONE = 2;
// Myth kinds (spec 1.2)
export const MYTH_BRIDGE = 1, MYTH_REVIVE = 2, MYTH_MONOLITH = 3, MYTH_FLOOD = 4, MYTH_STEPS = 5, MYTH_LANTERNS = 6;
export const MYTH_MAX = 12;
const ANNIVERSARY = 120;      // sim seconds between gatherings at a myth stone

const MAX_ORDERS = 12;
const HEAD_COS = new Float32Array([1, Math.cos(0.6), Math.cos(-0.6), Math.cos(1.2), Math.cos(-1.2)]);
const HEAD_SIN = new Float32Array([0, Math.sin(0.6), Math.sin(-0.6), Math.sin(1.2), Math.sin(-1.2)]);

export function createCiv() {
  const nV = TUNING.villagers, nS = TUNING.structureCap;
  const f = (n) => new Float32Array(n);
  return {
    nV,
    vX: f(nV), vZ: f(nV), vVX: f(nV), vVZ: f(nV), vTX: f(nV), vTZ: f(nV), vCargo: f(nV), vEnergy: f(nV), vPhase: f(nV), vTimer: f(nV), vHeading: f(nV),
    vRole: new Uint8Array(nV), vState: new Uint8Array(nV),
    vHome: new Int32Array(nV).fill(-1), vJob: new Int32Array(nV).fill(-1), vAux: new Int32Array(nV).fill(-1),
    vSupply: new Int32Array(nV).fill(-1), vSupplyT0: f(nV), vCargoKind: new Uint8Array(nV),   // runtime-only (not saved)
    nS: 0, dwellings: 0, sEpoch: 0,   // sEpoch: bumped when an existing slot moves, so the renderer rewrites its matrices
    sX: f(nS), sZ: f(nS), sRot: f(nS), sBias: f(nS), sBuild: f(nS), sDecay: f(nS), sLum: f(nS), sDirX: f(nS), sDirZ: f(nS), sLen: f(nS),
    sKind: new Uint8Array(nS), sActive: new Uint8Array(nS),
    oX: f(MAX_ORDERS), oZ: f(MAX_ORDERS), oDirX: f(MAX_ORDERS), oDirZ: f(MAX_ORDERS), oLen: f(MAX_ORDERS), oProg: f(MAX_ORDERS), oDust: f(MAX_ORDERS),
    oMat: f(MAX_ORDERS), oSupp: new Uint8Array(MAX_ORDERS),   // delivered loads, haulers on the way
    oKind: new Uint8Array(MAX_ORDERS), oState: new Uint8Array(MAX_ORDERS), oWorker: new Int32Array(MAX_ORDERS).fill(-1), oStruct: new Int32Array(MAX_ORDERS).fill(-1),
    food: 0, masons: 0, built: 0, bridges: 0, revived: 0, mythFirstBridge: false,
    monoStruct: new Int32Array(8).fill(-1), monoX: new Float32Array(8), monoZ: new Float32Array(8),
    nM: 0, mX: f(MYTH_MAX), mZ: f(MYTH_MAX), mT0: f(MYTH_MAX), mSeed: f(MYTH_MAX),
    mKind: new Uint8Array(MYTH_MAX), mStruct: new Int32Array(MYTH_MAX).fill(-1), mAnniv: new Int32Array(MYTH_MAX), mMotif: new Uint8Array(MYTH_MAX * 4), mythFlags: 0, mythClock: 0,
    orderClock: 0, lastOrderT: -1e9, foundClock: 0, secClock: 0, lanternClock: 0, eventCursor: { i: 0 },
    ...createSocietyArrays(nV, nS),
  };
}

// food lands in the villager's camp store (society) or the shared store (old full-town start)
function addFood(civ, v, amount) {
  if (civ.societyOn === 1 && civ.vCamp[v] >= 0) civ.cFood[civ.vCamp[v]] += amount;
  else civ.food += amount;
}

function cellOf(x, z) {
  let gx = Math.round(worldToGridX(x)), gz = Math.round(worldToGridZ(z));
  if (gx < 0) gx = 0; else if (gx > GRID_W - 1) gx = GRID_W - 1;
  if (gz < 0) gz = 0; else if (gz > GRID_H - 1) gz = GRID_H - 1;
  return gz * GRID_W + gx;
}

export function slopeAtCell(elev, i) {
  const x = i % GRID_W, z = (i / GRID_W) | 0;
  const l = x > 0 ? elev[i - 1] : elev[i], r = x < GRID_W - 1 ? elev[i + 1] : elev[i];
  const u = z > 0 ? elev[i - GRID_W] : elev[i], d = z < GRID_H - 1 ? elev[i + GRID_W] : elev[i];
  const gx = (r - l) * 0.5, gz = (d - u) * 0.5;
  return Math.sqrt(gx * gx + gz * gz);
}

function addStructure(civ, kind, x, z, bias, build, dirX, dirZ, len) {
  if (civ.nS >= TUNING.structureCap) return -1;
  const s = civ.nS++;
  civ.sKind[s] = kind; civ.sActive[s] = 1;
  civ.sX[s] = x; civ.sZ[s] = z; civ.sBias[s] = bias; civ.sBuild[s] = build; civ.sDecay[s] = 0; civ.sLum[s] = 0;
  civ.sDirX[s] = dirX; civ.sDirZ[s] = dirZ; civ.sLen[s] = len;
  civ.sRot[s] = Math.atan2(dirX, dirZ);
  if (kind === KIND_DWELLING) civ.dwellings++;
  return s;
}

// Primitive start: one family (Phase 5, docs/SPEC-phase5-society.md).
export function seedCivilization(world) {
  world.civ.eventCursor.i = world.events.head;
  seedFamily(world);
}

// The pre-Phase-5 start: 14 homes and 120 villagers with every feature open (subsystem tests, ?town=1).
export function seedTown(world) {
  const civ = world.civ, rng = world.rng;
  civ.eventCursor.i = world.events.head;
  const want = TUNING.startDwellings;
  const minD2 = 1.7 * 1.7;
  for (let attempt = 0; attempt < 6000 && civ.dwellings < want; attempt++) {
    const x = rng.range(-6.6, 6.6), z = rng.range(-6.6, 6.6);
    if (!siteOk(world, x, z, minD2, 0.5)) continue;
    addStructure(civ, KIND_DWELLING, x, z, sampleGrid(world.culturalBias, x, z), 1, Math.sin(rng.next() * 6.28), Math.cos(rng.next() * 6.28), 0);
    civ.sRot[civ.nS - 1] = rng.next() * 6.283;
  }
  // relax: if the island is too wet/steep for 14 sites, take what we found (at least a few)
  for (let v = 0; v < civ.nV; v++) {
    const role = v < 68 ? ROLE_FORAGER : v < 92 ? ROLE_HAULER : v < 102 ? ROLE_MASON : ROLE_MYSTIC;
    civ.vRole[v] = role;
    if (role === ROLE_MASON) civ.masons++;
    const home = civ.dwellings > 0 ? v % civ.dwellings : -1;
    civ.vHome[v] = home;
    const hx = home >= 0 ? civ.sX[home] : 0, hz = home >= 0 ? civ.sZ[home] : 0;
    let px = hx, pz = hz;
    for (let t = 0; t < 30; t++) {
      const a = rng.next() * 6.283, r = 0.15 + rng.next() * 0.6;
      const cx = hx + Math.cos(a) * r, cz = hz + Math.sin(a) * r;
      if (world.water[cellOf(cx, cz)] < 0.006 && Math.hypot(cx, cz) < 8.2) { px = cx; pz = cz; break; }
    }
    civ.vX[v] = px; civ.vZ[v] = pz;
    civ.vTX[v] = civ.vX[v]; civ.vTZ[v] = civ.vZ[v];
    civ.vEnergy[v] = 0.6 + rng.next() * 0.4;
    civ.vTimer[v] = rng.next() * 1.5;
    civ.vPhase[v] = rng.next() * 6.283;
    civ.vHeading[v] = rng.next() * 6.283;
    civ.vState[v] = ST_IDLE;
  }
  markTownAlive(civ);
}

function siteOk(world, x, z, minD2, minFert) {
  if (Math.hypot(x, z) > 7.6) return false;
  const i = cellOf(x, z);
  if (world.water[i] > 0.004 || world.engCover[i] !== 0) return false;
  if (slopeAtCell(world.elev, i) > 0.026) return false;
  if (world.fertility[i] < minFert) return false;
  const civ = world.civ;
  for (let s = 0; s < civ.nS; s++) {
    if (civ.sKind[s] !== KIND_DWELLING && civ.sKind[s] !== KIND_MONOLITH) continue;
    const dx = civ.sX[s] - x, dz = civ.sZ[s] - z;
    if (dx * dx + dz * dz < minD2) return false;
  }
  return true;
}

function nearestDwelling(civ, x, z, needHealthy, camp = -1) {
  let best = -1, bd = 1e9;
  for (let s = 0; s < civ.nS; s++) {
    if (civ.sKind[s] !== KIND_DWELLING || civ.sBuild[s] < 1) continue;
    if (camp >= 0 && civ.sCamp[s] !== camp) continue;
    if (needHealthy && civ.sDecay[s] > 0.5) continue;
    const dx = civ.sX[s] - x, dz = civ.sZ[s] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function nearestMonolith(world, x, z) {
  const m = world.monoliths;
  let best = -1, bd = 1e9;
  for (let k = 0; k < 8; k++) {
    if (m[k * 4 + 3] === 0) continue;
    const dx = m[k * 4] - x, dz = m[k * 4 + 1] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// Local cost of stepping on a world position (slope, wading, unbridged deep water, cliff edge).
function stepCost(world, x, z) {
  const i = cellOf(x, z);
  const cov = world.engCover[i];
  let c = slopeAtCell(world.elev, i) * 14;
  const w = world.water[i];
  if (cov === 0) { if (w > 0.025) c += 2.4; if (w > 0.07) c += 22; }
  else c -= 0.35;
  if (x * x + z * z > 8.5 * 8.5) c += 60;
  return c;
}

function pickFertile(world, x, z, radius, out) {
  // best of 7 random candidate cells within radius; returns fertility, writes the cell centre to out indices
  const rng = world.rng;
  let bf = -1, bs = -1, bx = x, bz = z;
  for (let k = 0; k < 7; k++) {
    const a = rng.next() * 6.283, r = Math.sqrt(rng.next()) * radius;
    const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
    if (cx * cx + cz * cz > 7.8 * 7.8) continue;
    const i = cellOf(cx, cz);
    if (world.water[i] > 0.02) continue;
    const f = world.fertility[i] * (1 - world.compaction[i] * 0.5);
    const sc = world.civ.societyOn === 1 ? f * (1 - 0.12 * r) : f;   // society start: near ground wins ties (on evenly fertile land the best spot was a random far one)
    if (sc > bs) { bs = sc; bf = f; bx = cx; bz = cz; }
  }
  out[0] = bx; out[1] = bz;
  return bf;
}
const tmpDir = new Float32Array(2);
const tmp2 = new Float32Array(2);

function decide(world, v) {
  const civ = world.civ, rng = world.rng;
  const x = civ.vX[v], z = civ.vZ[v], e = civ.vEnergy[v], c = civ.vCargo[v];
  let role = civ.vRole[v];
  const home = civ.vHome[v];
  if (civ.vState[v] === ST_SETTLE) { civ.vTimer[v] = 5; return; }   // walking out to found a camp: only arrival ends it
  civ.vTimer[v] = 0.6 + rng.next() * 1.0;
  const camp = civ.societyOn === 1 ? civ.vCamp[v] : -1;
  const child = civ.vAge[v] < SOCIETY.adultAge;
  // society roles by need (5a: foragers and haulers only; Masons and Mystics come with their ideas in 5c)
  if (civ.societyOn === 1 && role !== ROLE_MASON && role !== ROLE_MYSTIC) {
    role = civ.vRole[v] = child || (camp >= 0 && civ.cFood[camp] < 2 * SOCIETY.birthFood) || v % 3 !== 0 ? ROLE_FORAGER : ROLE_HAULER;
  }

  // Mason with an assigned job keeps walking to it
  if (civ.vJob[v] >= 0) { civ.vState[v] = ST_BUILD; civ.vTX[v] = civ.oX[civ.vJob[v]]; civ.vTZ[v] = civ.oZ[civ.vJob[v]]; return; }
  // a hauler on a material run keeps going (state and target unchanged) unless it has dragged on too long
  if (civ.vSupply[v] >= 0) {
    if (world.stats.time - civ.vSupplyT0[v] < TUNING.supplyGiveUp) return;
    releaseSupply(civ, v);
  }
  let supplyO = -1;

  let bestU = 0.08, bestA = ST_IDLE, tx = x, tz = z;

  // rest
  if (home >= 0) {
    const u = (1 - e) * (1 - e) * 1.3;
    if (u > bestU) { bestU = u; bestA = ST_REST; tx = civ.sX[home]; tz = civ.sZ[home]; }
  }
  // haul cargo home
  if (c > 0.2) {
    const d = nearestDwelling(civ, x, z, true, camp);
    if (d >= 0) { const u = c * (role === ROLE_HAULER ? 1.25 : 1.0); if (u > bestU) { bestU = u; bestA = ST_HAUL; tx = civ.sX[d]; tz = civ.sZ[d]; civ.vAux[v] = d; } }
  }
  // forage fertile ground
  if (c < 0.7 && e > 0.15) {
    // society start: keep walking to the spot already chosen (re-picking every decision made foragers dither and rarely arrive); the town keeps its tested behaviour
    let f;
    if (civ.vState[v] === ST_FORAGE && civ.societyOn === 1) {
      tmp2[0] = civ.vTX[v]; tmp2[1] = civ.vTZ[v];
      const i = cellOf(tmp2[0], tmp2[1]);
      f = world.fertility[i] * (1 - world.compaction[i] * 0.5);
    } else f = pickFertile(world, x, z, 3.2, tmp2);
    if (f > 0.3) {
      const w = (role === ROLE_FORAGER ? 1.0 : role === ROLE_HAULER ? 0.85 : 0.45) * (child ? 0.5 : 1);
      const u = (1 - c) * (0.35 + 0.65 * e) * f * w * 1.1;
      if (u > bestU) { bestU = u; bestA = ST_FORAGE; tx = tmp2[0]; tz = tmp2[1]; }
    }
  }
  // haulers bring timber / stone to open Mason works
  if (role === ROLE_HAULER && c < 0.2 && e > 0.25) {
    const o = orderNeedingMaterial(civ, x, z);
    if (o >= 0) {
      const sc = pickSource(world, civ.oX[o], civ.oZ[o], matForKind(civ.oKind[o]), tmp2);
      if (sc > 0 && 1.05 > bestU) { bestU = 1.05; bestA = ST_FETCH; tx = tmp2[0]; tz = tmp2[1]; supplyO = o; }
    }
  }
  // migrate away from a barren or ruined home
  if (home >= 0) {
    const hf = sampleGrid(world.fertility, civ.sX[home], civ.sZ[home]);
    if (civ.sDecay[home] > 0.5 || hf < TUNING.ruinFertility) {
      const d = nearestHealthyOther(civ, home, camp);
      if (d >= 0 && 1.0 > bestU) { bestU = 1.0; bestA = ST_MIGRATE; tx = civ.sX[d]; tz = civ.sZ[d]; civ.vAux[v] = d; }
    }
  }
  // processions to the nearest monolith
  const mono = nearestMonolith(world, x, z);
  if (mono >= 0 && (civ.gates & GATE_RITUAL) !== 0) {
    const bias = sampleGrid(world.culturalBias, x, z);
    const u = role === ROLE_MYSTIC ? 0.95 : 0.2 + 0.35 * Math.max(0, bias);
    if (u > bestU) {
      const a = rng.next() * 6.283;
      bestU = u; bestA = ST_PROCESSION;
      tx = world.monoliths[mono * 4] + Math.cos(a) * 0.75; tz = world.monoliths[mono * 4 + 1] + Math.sin(a) * 0.75; civ.vAux[v] = mono;
      const r = Math.sqrt(tx * tx + tz * tz);   // a monolith near the rim must not send the circle past the cliff (walk cost spikes beyond 8.5)
      if (r > 8.3) { tx *= 8.3 / r; tz *= 8.3 / r; }
    }
  }
  // mystics wander out to re-consecrate ruins
  if (role === ROLE_MYSTIC) {
    let ruin = -1, bd = 1e9;
    for (let s = 0; s < civ.nS; s++) {
      if (civ.sKind[s] !== KIND_DWELLING || civ.sDecay[s] < 0.6) continue;
      const dx = civ.sX[s] - x, dz = civ.sZ[s] - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; ruin = s; }
    }
    if (ruin >= 0 && 0.9 > bestU) { bestU = 0.9; bestA = ST_CONSECRATE; tx = civ.sX[ruin]; tz = civ.sZ[ruin]; civ.vAux[v] = ruin; }
  }
  civ.vState[v] = bestA;
  civ.vTX[v] = tx; civ.vTZ[v] = tz;
  if (bestA === ST_FETCH) {
    addFood(civ, v, c * 10); civ.vCargo[v] = 0;   // drop off any scraps of food first
    civ.vSupply[v] = supplyO; civ.vSupplyT0[v] = world.stats.time; civ.oSupp[supplyO]++;
  }
}

function matForKind(kind) { return kind === KIND_BRIDGE ? MAT_TIMBER : MAT_STONE; }

// nearest open work (waiting, Mason on the way, or being built) still short of material, within supplyRange
function orderNeedingMaterial(civ, x, z) {
  let best = -1, bd = TUNING.supplyRange * TUNING.supplyRange;
  for (let o = 0; o < MAX_ORDERS; o++) {
    const st = civ.oState[o];
    if (st === 0 || civ.oMat[o] + civ.oSupp[o] >= TUNING.matPerOrder) continue;
    const dx = civ.oX[o] - x, dz = civ.oZ[o] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// Stone only from steep, dry upland well away from water (quarrying a pond's rim would drain it: depositLip is 0.03)
// and from homes.
function quarryOk(world, i) {
  const gx = i % GRID_W, gz = (i / GRID_W) | 0;
  if (gx < 3 || gz < 3 || gx > GRID_W - 4 || gz > GRID_H - 4) return false;
  if (world.mask[i] !== 0 || world.engCover[i] !== 0 || slopeAtCell(world.elev, i) <= TUNING.steepSlope) return false;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const j = i + dz * GRID_W + dx;
    if (world.water[j] > 0.001 || world.mask[j] !== 0) return false;
  }
  return true;
}

// best of 12 random cells around an order: mature forest for timber, quarry-able rock for stone. Returns score.
function pickSource(world, ox, oz, mat, out) {
  const rng = world.rng, civ = world.civ;
  let best = -1, bx = ox, bz = oz;
  for (let k = 0; k < 12; k++) {
    const a = rng.next() * 6.283, r = 0.4 + Math.sqrt(rng.next()) * (TUNING.sourceRadius - 0.4);
    const cx = ox + Math.cos(a) * r, cz = oz + Math.sin(a) * r;
    if (cx * cx + cz * cz > 7.8 * 7.8) continue;
    const i = cellOf(cx, cz);
    let sc = -1;
    if (mat === MAT_TIMBER) { if (world.mask[i] === 0 && world.water[i] < 0.02 && world.biomass[i] > TUNING.timberMin) sc = world.biomass[i]; }
    else if (quarryOk(world, i)) {
      const d = nearestDwelling(civ, cx, cz, false);
      if (d < 0 || Math.hypot(civ.sX[d] - cx, civ.sZ[d] - cz) > 0.8) sc = slopeAtCell(world.elev, i) * 10;
    }
    if (sc > best) { best = sc; bx = cx; bz = cz; }
  }
  out[0] = bx; out[1] = bz;
  return best;
}

// take one load from the source cell: fell trees (biomass) or cut stone (elevation, tracked for the mass budget)
function extractMaterial(world, i, mat) {
  const gx = i % GRID_W, gz = (i / GRID_W) | 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const X = gx + dx, Z = gz + dz;
    if (X < 0 || Z < 0 || X >= GRID_W || Z >= GRID_H) continue;
    const j = Z * GRID_W + X, centre = dx === 0 && dz === 0;
    if (mat === MAT_TIMBER) {
      const b = world.biomass[j] - (centre ? TUNING.fellCenter : TUNING.fellRing);
      world.biomass[j] = b < 0 ? 0 : b;
    } else if (world.mask[j] === 0) {
      const e = world.elev[j], ne = Math.max(TUNING.elevFloor, e - (centre ? TUNING.quarryCenter : TUNING.quarryRing));
      world.elev[j] = ne; world.stats.quarried += e - ne;
    }
  }
  if (mat === MAT_TIMBER) world.stats.timberLoads++; else world.stats.stoneLoads++;
}

function releaseSupply(civ, v) {
  const o = civ.vSupply[v];
  if (o >= 0 && civ.oSupp[o] > 0) civ.oSupp[o]--;
  civ.vSupply[v] = -1;
  if (civ.vCargoKind[v] !== MAT_FOOD) { civ.vCargo[v] = 0; civ.vCargoKind[v] = MAT_FOOD; }
}

// an order closed (built or cancelled): haulers still bringing material to it stop
function releaseOrderSuppliers(civ, o) {
  for (let v = 0; v < civ.nV; v++) if (civ.vSupply[v] === o) { releaseSupply(civ, v); civ.vState[v] = ST_IDLE; civ.vTimer[v] = 0.3; }
  civ.oSupp[o] = 0; civ.oMat[o] = 0;
}

function nearestHealthyOther(civ, home, camp) {
  let best = -1, bd = 1e9;
  for (let s = 0; s < civ.nS; s++) {
    if (s === home || civ.sKind[s] !== KIND_DWELLING || civ.sBuild[s] < 1 || civ.sDecay[s] > 0.3) continue;
    if (camp >= 0 && civ.sCamp[s] !== camp) continue;
    const dx = civ.sX[s] - civ.sX[home], dz = civ.sZ[s] - civ.sZ[home], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function arrive(world, v) {
  const civ = world.civ;
  const st = civ.vState[v];
  if (st === ST_FORAGE) {
    civ.vCargo[v] = Math.min(1, civ.vCargo[v] + 0.35);
    const i = cellOf(civ.vX[v], civ.vZ[v]);
    world.fertility[i] = Math.max(0, world.fertility[i] - 0.01);
    world.biomass[i] = Math.max(0, world.biomass[i] - TUNING.forageClear);
  } else if (st === ST_HAUL) {
    addFood(civ, v, civ.vCargo[v] * 10);
    civ.vCargo[v] = 0;
    civ.vEnergy[v] = Math.min(1, civ.vEnergy[v] + 0.15);
  } else if (st === ST_REST) {
    civ.vEnergy[v] = Math.min(1, civ.vEnergy[v] + 0.5);
    if (civ.vCargoKind[v] === MAT_FOOD && civ.vCargo[v] > 0) { addFood(civ, v, civ.vCargo[v] * 10); civ.vCargo[v] = 0; }   // home anyway: drop off the food
    const d = nearestDwelling(civ, civ.vX[v], civ.vZ[v], true, civ.societyOn === 1 ? civ.vCamp[v] : -1);   // rested at the nearest reachable home of its camp: settle there
    if (d >= 0 && Math.hypot(civ.sX[d] - civ.vX[v], civ.sZ[d] - civ.vZ[v]) < 0.5) civ.vHome[v] = d;
  } else if (st === ST_MIGRATE) {
    if (civ.vAux[v] >= 0) civ.vHome[v] = civ.vAux[v];
  } else if (st === ST_CONSECRATE) {
    const s = civ.vAux[v];
    if (s >= 0 && civ.sDecay[s] > 0.4) { reviveStructure(world, s); }
  } else if (st === ST_SETTLE) {
    settleArrive(world, v);
    return;
  } else if (st === ST_GATHER) {
    civ.vTimer[v] = 8;
    civ.vState[v] = ST_IDLE;
    return;
  } else if (st === ST_FETCH) {
    const o = civ.vSupply[v];
    if (o >= 0 && civ.oState[o] !== 0) {
      const mat = matForKind(civ.oKind[o]);
      extractMaterial(world, cellOf(civ.vX[v], civ.vZ[v]), mat);
      civ.vCargo[v] = 1; civ.vCargoKind[v] = mat;
      civ.vState[v] = ST_SUPPLY; civ.vTX[v] = civ.oX[o]; civ.vTZ[v] = civ.oZ[o];
      return;
    }
    releaseSupply(civ, v);
  } else if (st === ST_SUPPLY) {
    const o = civ.vSupply[v];
    if (o >= 0 && civ.oState[o] !== 0) civ.oMat[o] += 1;
    releaseSupply(civ, v);
    civ.vEnergy[v] = Math.min(1, civ.vEnergy[v] + 0.1);
  } else if (st === ST_PROCESSION) {
    civ.vTimer[v] = 2.5 + world.rng.next() * 2;
    civ.lanternClock += 0;
    if (world.rng.next() < 0.45) emitEvent(world.events, EV_LANTERN, civ.vX[v], civ.vZ[v], 1);
  }
  civ.vState[v] = ST_IDLE;
}

// A notable thing happened here: carve a standing stone with its glyph, keep a 4-note motif for the audio leitmotif.
export function recordMyth(world, kind, x, z) {
  const civ = world.civ, rng = world.rng;
  let slot = civ.nM;
  if (slot >= MYTH_MAX) {
    slot = 0;
    for (let k = 1; k < MYTH_MAX; k++) if (civ.mT0[k] < civ.mT0[slot]) slot = k;
  } else civ.nM++;
  // find a dry spot just beside the event for the stone
  let sx = x + 0.55, sz = z + 0.25;
  for (let t = 0; t < 12; t++) {
    const a = rng.next() * 6.283, r = 0.5 + rng.next() * 0.35;
    const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
    if (world.water[cellOf(cx, cz)] < 0.006 && Math.hypot(cx, cz) < 8.3) { sx = cx; sz = cz; break; }
  }
  civ.mX[slot] = sx; civ.mZ[slot] = sz; civ.mKind[slot] = kind; civ.mT0[slot] = world.stats.time;
  civ.mSeed[slot] = rng.next(); civ.mAnniv[slot] = 0;
  for (let j = 0; j < 4; j++) civ.mMotif[slot * 4 + j] = (kind * 2 + ((rng.next() * 5) | 0) + j * 2) % 7;
  const dirYaw = Math.atan2(-sx, -sz);   // the stone faces the island's centre
  let st = civ.mStruct[slot];
  if (st < 0) st = addStructure(civ, KIND_MYTH, sx, sz, civ.mSeed[slot], 1, Math.sin(dirYaw), Math.cos(dirYaw), 1);
  else { civ.sX[st] = sx; civ.sZ[st] = sz; civ.sBias[st] = civ.mSeed[slot]; civ.sDecay[st] = 0; civ.sEpoch++; }
  if (st >= 0) { civ.mStruct[slot] = st; civ.sRot[st] = dirYaw; civ.sDirX[st] = Math.sin(dirYaw); civ.sDirZ[st] = Math.cos(dirYaw); civ.sLen[st] = 1; }
  emitEvent(world.events, EV_MYTH, sx, sz, slot);
  return slot;
}

export function reviveStructure(world, s) {
  const civ = world.civ;
  civ.sDecay[s] = 0; civ.sLum[s] = 1; civ.revived++;
  emitEvent(world.events, EV_REVIVE, civ.sX[s], civ.sZ[s], 1);
  if ((civ.mythFlags & 2) === 0) { civ.mythFlags |= 2; recordMyth(world, MYTH_REVIVE, civ.sX[s], civ.sZ[s]); }
}

function moveVillager(world, v, dt) {
  const civ = world.civ;
  const x = civ.vX[v], z = civ.vZ[v];
  const dx = civ.vTX[v] - x, dz = civ.vTZ[v] - z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const st = civ.vState[v];
  if (st === ST_IDLE || st === ST_GREET) { civ.vVX[v] *= 0.8; civ.vVZ[v] *= 0.8; return dist; }
  if (dist < 0.12) { civ.vVX[v] = 0; civ.vVZ[v] = 0; return dist; }
  const dirx = dx / dist, dirz = dz / dist;
  let bestC = 1e9, bx = dirx, bz = dirz;
  // resting and food-hauling villagers can go to any healthy home: walk down the shared home field (finds bridges and
  // fords), then switch to direct steering for the last stretch to the nearest door
  let followed = false;
  if (st === ST_REST || st === ST_HAUL) {
    const here = homeFieldAt(world, x, z);
    if (here < HF_INF && here > TUNING.homeFieldNear) {
      followed = homeFieldNext(world, x, z, tmpDir);   // head for the lowest neighbouring cell (gradients stalled on narrow paths)
      if (followed) { const ex = tmpDir[0] - x, ez = tmpDir[1] - z, el = Math.sqrt(ex * ex + ez * ez) || 1; bx = ex / el; bz = ez / el; }
    } else if (here <= TUNING.homeFieldNear) {
      const d = nearestDwelling(civ, x, z, true);
      if (d >= 0 && (civ.vTX[v] !== civ.sX[d] || civ.vTZ[v] !== civ.sZ[d])) { civ.vTX[v] = civ.sX[d]; civ.vTZ[v] = civ.sZ[d]; if (st === ST_HAUL) civ.vAux[v] = d; }
    }
  }
  // otherwise five candidate headings, lowest local cost + remaining distance wins (gradient descent on the cost field)
  if (!followed) bestC = 1e9;
  for (let k = 0; k < 5 && !followed; k++) {
    const hx = dirx * HEAD_COS[k] - dirz * HEAD_SIN[k], hz = dirx * HEAD_SIN[k] + dirz * HEAD_COS[k];
    const nx = x + hx * 0.38, nz = z + hz * 0.38;
    const rx = civ.vTX[v] - nx, rz = civ.vTZ[v] - nz;
    const cst = stepCost(world, nx, nz) + Math.sqrt(rx * rx + rz * rz) * 2.0 + (k === 0 ? 0 : 0.15);
    if (cst < bestC) { bestC = cst; bx = hx; bz = hz; }
  }
  const i = cellOf(x, z);
  const slope = slopeAtCell(world.elev, i);
  const wet = world.water[i] > 0.025 && world.engCover[i] === 0;
  let speed = TUNING.walkSpeed / (1 + slope * TUNING.slopePenalty);
  if (world.engCover[i] !== 0) speed *= 1.4;
  if (wet) speed *= 0.5;
  if (civ.vCargo[v] > 0.3) speed *= 0.88;
  civ.vVX[v] += (bx * speed - civ.vVX[v]) * Math.min(1, dt * 6);
  civ.vVZ[v] += (bz * speed - civ.vVZ[v]) * Math.min(1, dt * 6);
  civ.vX[v] = x + civ.vVX[v] * dt;
  civ.vZ[v] = z + civ.vVZ[v] * dt;
  civ.vPhase[v] += speed * dt * 9;
  civ.vEnergy[v] = Math.max(0, civ.vEnergy[v] - 0.012 * dt);

  // footfall: wear the path, and frustration where the way is steep or wet and nobody has built anything
  const c = world.compaction[i] + 0.05 * dt;
  world.compaction[i] = c > 1 ? 1 : c;
  if ((slope > TUNING.steepSlope || world.water[i] > 0.025) && world.engCover[i] === 0) {
    const f = world.frustration[i] + TUNING.frustrateRate * dt;
    world.frustration[i] = f > 1 ? 1 : f;
  }
  return dist;
}

function startOrder(world, i, kind, x, z, dirX, dirZ, len) {
  const civ = world.civ;
  civ.lastOrderT = world.stats.time;
  civ.oKind[i] = kind; civ.oState[i] = 1; civ.oX[i] = x; civ.oZ[i] = z; civ.oDirX[i] = dirX; civ.oDirZ[i] = dirZ; civ.oLen[i] = len;
  civ.oProg[i] = 0; civ.oWorker[i] = -1; civ.oStruct[i] = -1; civ.oDust[i] = 0; civ.oMat[i] = 0; civ.oSupp[i] = 0;
}

function scanForOrders(world) {
  const civ = world.civ, rng = world.rng;
  let free = -1, open = 0;
  for (let o = 0; o < MAX_ORDERS; o++) { if (civ.oState[o] === 0) { if (free < 0) free = o; } else open++; }
  if ((civ.gates & GATE_MASON) === 0) return;
  if (free < 0 || open >= TUNING.maxOpenOrders || civ.built >= TUNING.maxWorks || world.stats.time - civ.lastOrderT < TUNING.orderGap) return;
  let bestI = -1, bestF = TUNING.orderThreshold;
  for (let k = 0; k < 140; k++) {
    const i = (rng.next() * (GRID_W * GRID_H)) | 0;
    if (world.mask[i] === 1) continue;
    const f = world.frustration[i];
    if (f > bestF && world.engCover[i] === 0) { bestF = f; bestI = i; }
  }
  for (let k = 0; k < 40; k++) {
    const v = (rng.next() * civ.nV) | 0;
    if (civ.vAlive[v] === 0) continue;
    const i = cellOf(civ.vX[v], civ.vZ[v]);
    const f = world.frustration[i];
    if (f > bestF && world.engCover[i] === 0 && world.mask[i] === 0) { bestF = f; bestI = i; }
  }
  if (bestI < 0) return;
  const gx = bestI % GRID_W, gz = (bestI / GRID_W) | 0;
  const x = -10 + (gx + 0.5) * CELL_SIZE, z = -10 + (gz + 0.5) * CELL_SIZE;
  for (let o = 0; o < MAX_ORDERS; o++) {
    if (civ.oState[o] === 0) continue;
    const dx = civ.oX[o] - x, dz = civ.oZ[o] - z;
    if (dx * dx + dz * dz < 2.0 * 2.0) return;
  }
  for (let q = 0; q < civ.nS; q++) {
    const k = civ.sKind[q];
    if (k < 2 || k > 4) continue;
    const dx = civ.sX[q] - x, dz = civ.sZ[q] - z;
    if (dx * dx + dz * dz < 1.6 * 1.6) return;
  }
  const wet = world.water[bestI] > 0.025;
  const slope = slopeAtCell(world.elev, bestI);
  if (wet) {
    // span across the flow: perpendicular to the local velocity (fall back to the water-surface gradient)
    let fx = world.vx[bestI], fz = world.vz[bestI];
    let m = Math.sqrt(fx * fx + fz * fz);
    if (m < 0.05) {
      const l = world.elev[bestI - 1] + world.water[bestI - 1], r = world.elev[bestI + 1] + world.water[bestI + 1];
      const u = world.elev[bestI - GRID_W] + world.water[bestI - GRID_W], d = world.elev[bestI + GRID_W] + world.water[bestI + GRID_W];
      fx = -(r - l); fz = -(d - u); m = Math.sqrt(fx * fx + fz * fz);
    }
    if (m < 1e-6) { fx = 1; fz = 0; m = 1; }
    const dirX = -fz / m, dirZ = fx / m;
    // measure the wet width along dirX/dirZ
    let half = 0.3;
    for (let s = 0; s < 12; s++) {
      const px = x + dirX * (0.1 + s * 0.1), pz = z + dirZ * (0.1 + s * 0.1), mx = x - dirX * (0.1 + s * 0.1), mz = z - dirZ * (0.1 + s * 0.1);
      const wp = world.water[cellOf(px, pz)], wm = world.water[cellOf(mx, mz)];
      if (wp > 0.012 || wm > 0.012) half = 0.1 + s * 0.1 + 0.25;
    }
    if (half * 2 > 1.5) return;      // a lake is not something you bridge
    startOrder(world, free, KIND_BRIDGE, x, z, dirX, dirZ, half * 2 + 0.3);
  } else if (slope > TUNING.steepSlope) {
    const l = world.elev[bestI - 1], r = world.elev[bestI + 1], u = world.elev[bestI - GRID_W], d = world.elev[bestI + GRID_W];
    let gxs = r - l, gzs = d - u; const m = Math.sqrt(gxs * gxs + gzs * gzs) || 1;
    startOrder(world, free, KIND_STEPS, x, z, -gxs / m, -gzs / m, 1.1);
  } else if (world.compaction[bestI] > 0.5) {
    startOrder(world, free, KIND_PAVING, x, z, 1, 0, 0.7);
  }
}

function assignOrders(world) {
  const civ = world.civ;
  for (let o = 0; o < MAX_ORDERS; o++) {
    if (civ.oState[o] !== 1) continue;
    let best = -1, bd = 1e9;
    for (let v = 0; v < civ.nV; v++) {
      if (civ.vAlive[v] === 0 || civ.vRole[v] !== ROLE_MASON || civ.vJob[v] >= 0) continue;
      const dx = civ.vX[v] - civ.oX[o], dz = civ.vZ[v] - civ.oZ[o], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = v; }
    }
    if (best < 0 && civ.masons < TUNING.maxMasons) {
      for (let v = 0; v < civ.nV; v++) {
        if (civ.vAlive[v] === 0 || civ.vRole[v] === ROLE_MASON || civ.vRole[v] === ROLE_MYSTIC || civ.vJob[v] >= 0 || civ.vCargo[v] > 0.3) continue;
        const dx = civ.vX[v] - civ.oX[o], dz = civ.vZ[v] - civ.oZ[o], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = v; }
      }
      if (best >= 0) { civ.vRole[best] = ROLE_MASON; civ.masons++; }
    }
    if (best < 0) continue;
    civ.oState[o] = 2; civ.oWorker[o] = best; civ.vJob[best] = o;
    civ.vState[best] = ST_BUILD; civ.vTX[best] = civ.oX[o]; civ.vTZ[best] = civ.oZ[o];
  }
}

function progressBuilds(world, dt) {
  const civ = world.civ;
  for (let o = 0; o < MAX_ORDERS; o++) {
    const st = civ.oState[o];
    if (st !== 2 && st !== 3) continue;
    const w = civ.oWorker[o];
    if (w < 0) { civ.oState[o] = 0; releaseOrderSuppliers(civ, o); continue; }
    const dx = civ.vX[w] - civ.oX[o], dz = civ.vZ[w] - civ.oZ[o];
    if (st === 2) {
      if (dx * dx + dz * dz < 0.2 * 0.2) {
        const s = addStructure(civ, civ.oKind[o], civ.oX[o], civ.oZ[o], 0, 0, civ.oDirX[o], civ.oDirZ[o], civ.oLen[o]);
        if (s < 0) { civ.oState[o] = 0; civ.vJob[w] = -1; civ.oWorker[o] = -1; releaseOrderSuppliers(civ, o); continue; }
        civ.oStruct[o] = s; civ.oState[o] = 3; civ.vState[w] = ST_IDLE; civ.vTimer[w] = 99;
      }
      continue;
    }
    civ.vState[w] = ST_IDLE; civ.vTimer[w] = 99; civ.vVX[w] = 0; civ.vVZ[w] = 0;
    // full speed while delivered material lasts (matPerOrder loads cover the whole build), a crawl without
    const supplied = civ.oMat[o] > 0;
    civ.oProg[o] += dt / TUNING.buildTime * (supplied ? 1 : TUNING.unsuppliedRate);
    if (supplied) civ.oMat[o] = Math.max(0, civ.oMat[o] - dt / TUNING.buildTime * TUNING.matPerOrder);
    civ.sBuild[civ.oStruct[o]] = civ.oProg[o] > 1 ? 1 : civ.oProg[o];
    civ.oDust[o] -= dt;
    if (civ.oDust[o] <= 0) { civ.oDust[o] = 0.4; emitEvent(world.events, EV_DUST, civ.oX[o] + (world.rng.next() - 0.5) * 0.3, civ.oZ[o] + (world.rng.next() - 0.5) * 0.3, 1); }
    if (civ.oProg[o] >= 1) completeOrder(world, o);
  }
}

function completeOrder(world, o) {
  const civ = world.civ;
  const s = civ.oStruct[o], kind = civ.oKind[o];
  civ.sBuild[s] = 1;
  const radius = kind === KIND_PAVING ? 0.4 : 0.2;
  markCoverFor(world, civ.oX[o], civ.oZ[o], civ.oDirX[o], civ.oDirZ[o], kind === KIND_PAVING ? 0.5 : civ.oLen[o], radius, kind);
  civ.built++; if (kind === KIND_BRIDGE) civ.bridges++;
  emitEvent(world.events, EV_BUILD_DONE, civ.oX[o], civ.oZ[o], kind);
  if (kind === KIND_BRIDGE && (civ.mythFlags & 1) === 0) { civ.mythFlags |= 1; civ.mythFirstBridge = true; recordMyth(world, MYTH_BRIDGE, civ.oX[o], civ.oZ[o]); }
  if (kind === KIND_STEPS && (civ.mythFlags & 16) === 0) { civ.mythFlags |= 16; recordMyth(world, MYTH_STEPS, civ.oX[o], civ.oZ[o]); }
  const w = civ.oWorker[o];
  civ.vJob[w] = -1; civ.vTimer[w] = 0.3; civ.vState[w] = ST_IDLE;
  civ.oState[o] = 0; civ.oWorker[o] = -1; civ.oStruct[o] = -1;
  releaseOrderSuppliers(civ, o);
}

function markCoverFor(world, x, z, dirX, dirZ, len, radius, kind) {
  const steps = Math.max(1, Math.ceil(len / (CELL_SIZE * 0.5)));
  const rc = Math.max(1, Math.ceil(radius / CELL_SIZE));
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps - 0.5) * len;
    const gx = Math.round(worldToGridX(x + dirX * t)), gz = Math.round(worldToGridZ(z + dirZ * t));
    for (let dz = -rc; dz <= rc; dz++) {
      for (let dx = -rc; dx <= rc; dx++) {
        const X = gx + dx, Z = gz + dz;
        if (X < 0 || Z < 0 || X >= GRID_W || Z >= GRID_H) continue;
        world.engCover[Z * GRID_W + X] = kind;
      }
    }
  }
}

function secondTick(world) {
  const civ = world.civ;
  // farmers keep the ground around healthy homes open: biomass near a dwelling is pushed back toward crop level
  // (without this, forest grows right up to the doors, since settlements sit on the most fertile ground)
  if ((civ.gates & GATE_FARM) !== 0) {
    const bm = world.biomass, R = TUNING.homeClearRadius, LVL = TUNING.homeClearLevel;
    const rc = Math.ceil(R / 20 * GRID_W);
    for (let s = 0; s < civ.nS; s++) {
      if (civ.sKind[s] !== KIND_DWELLING || civ.sDecay[s] > 0.4) continue;
      const gx = Math.round((civ.sX[s] + 10) / 20 * GRID_W - 0.5), gz = Math.round((civ.sZ[s] + 10) / 20 * GRID_H - 0.5);
      for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
        const x = gx + dx, z = gz + dz;
        if (x < 0 || z < 0 || x >= GRID_W || z >= GRID_H) continue;
        const d = Math.sqrt(dx * dx + dz * dz) * 20 / GRID_W;
        if (d > R) continue;
        const i = z * GRID_W + x, lim = LVL + (1 - LVL) * (d / R) * (d / R);
        if (bm[i] > lim) bm[i] -= (bm[i] - lim) * 0.25;
      }
    }
  }
  // ruins: dwellings in barren ground slump; luminescence fades unless a monolith sustains it
  for (let s = 0; s < civ.nS; s++) {
    if (civ.sKind[s] !== KIND_DWELLING || civ.sBuild[s] < 1) continue;
    const f = sampleGrid(world.fertility, civ.sX[s], civ.sZ[s]);
    const abandoned = civ.societyOn === 1 && (civ.sCamp[s] < 0 || civ.cActive[civ.sCamp[s]] === 0);
    if (f < TUNING.ruinFertility || abandoned) civ.sDecay[s] = Math.min(1, civ.sDecay[s] + TUNING.ruinRate);
    else if (civ.sDecay[s] < 1 && f > 0.4) civ.sDecay[s] = Math.max(0, civ.sDecay[s] - 0.012);
    civ.sLum[s] = Math.max(0, civ.sLum[s] - 0.05);
    civ.sBias[s] = sampleGrid(world.culturalBias, civ.sX[s], civ.sZ[s]);
  }
  // monoliths revive nearby ruins
  const m = world.monoliths;
  for (let k = 0; k < 8; k++) {
    if (m[k * 4 + 3] === 0) continue;
    for (let s = 0; s < civ.nS; s++) {
      if (civ.sKind[s] !== KIND_DWELLING || civ.sDecay[s] < 0.3) continue;
      const dx = civ.sX[s] - m[k * 4], dz = civ.sZ[s] - m[k * 4 + 1];
      if (dx * dx + dz * dz < 2.8 * 2.8) reviveStructure(world, s);
    }
  }
  // cultural drift: engineering pushes toward Industrious, tilled land toward Pastoral
  for (let s = 0; s < civ.nS; s++) {
    const k = civ.sKind[s];
    if (k === KIND_BRIDGE || k === KIND_STEPS || k === KIND_PAVING) nudgeBias(world, civ.sX[s], civ.sZ[s], 2.0, -1, 0.05);
    else if (k === KIND_DWELLING && civ.sBuild[s] >= 1 && civ.sDecay[s] < 0.5) nudgeBias(world, civ.sX[s], civ.sZ[s], 1.6, 0, 0.02);
  }
  for (let k = 0; k < civ.nM; k++) if (civ.mStruct[k] >= 0) civ.sDecay[civ.mStruct[k]] = Math.min(1, (world.stats.time - civ.mT0[k]) / 900);
  // first monolith, floods, and anniversaries at myth stones
  if ((civ.mythFlags & 4) === 0 && (civ.gates & GATE_RITUAL) !== 0) {
    for (let k = 0; k < 8; k++) if (m[k * 4 + 3] !== 0) { civ.mythFlags |= 4; recordMyth(world, MYTH_MONOLITH, m[k * 4], m[k * 4 + 1]); break; }
  }
  for (let s = 0; s < civ.nS; s++) {
    if (civ.sKind[s] !== KIND_DWELLING || civ.sBuild[s] < 1 || civ.sDecay[s] > 0.9) continue;
    if (world.water[cellOf(civ.sX[s], civ.sZ[s])] > 0.035 && world.stats.time - civ.mythClock > 90) {
      civ.mythClock = world.stats.time;
      civ.sDecay[s] = Math.min(1, civ.sDecay[s] + 0.5);
      recordMyth(world, MYTH_FLOOD, civ.sX[s], civ.sZ[s]);
    }
  }
  for (let k = 0; k < civ.nM && (civ.gates & GATE_RITUAL) !== 0; k++) {
    const n = Math.floor((world.stats.time - civ.mT0[k]) / ANNIVERSARY);
    if (n > civ.mAnniv[k]) {
      civ.mAnniv[k] = n;
      emitEvent(world.events, EV_MYTH, civ.mX[k], civ.mZ[k], 100 + k);
      let called = 0;
      for (let v = 0; v < civ.nV && called < 10; v++) {
        if (civ.vAlive[v] === 0 || civ.vJob[v] >= 0 || civ.vState[v] === ST_BUILD || civ.vState[v] === ST_SETTLE) continue;
        const dx = civ.vX[v] - civ.mX[k], dz = civ.vZ[v] - civ.mZ[k];
        if (dx * dx + dz * dz > 6 * 6) continue;
        const a = world.rng.next() * 6.283, r = 0.35 + world.rng.next() * 0.35;
        civ.vState[v] = ST_GATHER; civ.vTX[v] = civ.mX[k] + Math.cos(a) * r; civ.vTZ[v] = civ.mZ[k] + Math.sin(a) * r; civ.vTimer[v] = 99;
        called++;
      }
    }
  }
  // growth: spend stored food on a new dwelling in fertile ground near the busiest part of the settlement
  if (civ.societyOn === 0 && civ.food >= TUNING.foodPerDwelling && civ.dwellings < TUNING.dwellingCap) {
    const rng = world.rng;
    for (let attempt = 0; attempt < 80; attempt++) {
      const base = (rng.next() * civ.nS) | 0;
      if (civ.sKind[base] !== KIND_DWELLING || civ.sDecay[base] > 0.4) continue;
      const a = rng.next() * 6.283, r = 1.2 + rng.next() * 1.8;
      const x = civ.sX[base] + Math.cos(a) * r, z = civ.sZ[base] + Math.sin(a) * r;
      if (!siteOk(world, x, z, 1.3 * 1.3, 0.5)) continue;
      const s = addStructure(civ, KIND_DWELLING, x, z, sampleGrid(world.culturalBias, x, z), 0, 0, 1, 0);
      if (s >= 0) { civ.sRot[s] = rng.next() * 6.283; civ.food -= TUNING.foodPerDwelling * 0.7; civ.sBuild[s] = 0.02; }
      break;
    }
  }
  // dwellings under construction by the community rise on their own
  for (let s = 0; s < civ.nS; s++) {
    if (civ.sKind[s] === KIND_DWELLING && civ.sBuild[s] > 0 && civ.sBuild[s] < 1) civ.sBuild[s] = Math.min(1, civ.sBuild[s] + TUNING.dwellingRise);
  }
  societyTick(world);
}

function nudgeBias(world, x, z, radius, target, rate) {
  const gx = worldToGridX(x), gz = worldToGridZ(z);
  const rc = Math.ceil(radius / CELL_SIZE);
  const x0 = Math.max(0, Math.floor(gx - rc)), x1 = Math.min(GRID_W - 1, Math.ceil(gx + rc));
  const z0 = Math.max(0, Math.floor(gz - rc)), z1 = Math.min(GRID_H - 1, Math.ceil(gz + rc));
  const r2 = radius * radius;
  for (let zz = z0; zz <= z1; zz++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = (xx - gx) * CELL_SIZE, dz = (zz - gz) * CELL_SIZE, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const i = zz * GRID_W + xx;
      world.culturalBias[i] += (target - world.culturalBias[i]) * rate * (1 - d2 / r2);
    }
  }
}

// React to sim events that villagers care about (wind chimes: greet).
function readEvents(world) {
  const civ = world.civ;
  let k;
  while ((k = nextEvent(world.events, civ.eventCursor)) >= 0) {
    if (world.events.type[k] === EV_LANTERN && (civ.mythFlags & 32) === 0) { civ.mythFlags |= 32; recordMyth(world, MYTH_LANTERNS, world.events.x[k], world.events.z[k]); continue; }
    if (world.events.type[k] !== EV_CHIME) continue;
    const cx = world.events.x[k], cz = world.events.z[k];
    let greeted = 0;
    for (let v = 0; v < civ.nV && greeted < 6; v++) {
      const dx = civ.vX[v] - cx, dz = civ.vZ[v] - cz;
      if (dx * dx + dz * dz < 2.6 * 2.6 && civ.vJob[v] < 0 && civ.vAlive[v] === 1 && civ.vState[v] !== ST_SETTLE) {
        civ.vState[v] = ST_GREET; civ.vTimer[v] = 1.6;
        civ.vHeading[v] = Math.atan2(dx * -1, dz * -1);
        greeted++;
      }
    }
    if (greeted > 0) emitEvent(world.events, EV_GREET, cx, cz, greeted);
  }
}

// Mirror the player's monoliths into the structure pool (they rise over 1.5 s; a recycled slot rises again elsewhere).
function syncMonoliths(world, dt) {
  const civ = world.civ, m = world.monoliths;
  for (let k = 0; k < 8; k++) {
    if (m[k * 4 + 3] === 0) continue;
    let s = civ.monoStruct[k];
    if (s < 0) {
      s = addStructure(civ, KIND_MONOLITH, m[k * 4], m[k * 4 + 1], 1, 0, 0, 1, 1);
      if (s < 0) continue;
      civ.sRot[s] = world.rng.next() * 6.283;
      civ.monoStruct[k] = s; civ.monoX[k] = m[k * 4]; civ.monoZ[k] = m[k * 4 + 1];
    } else if (civ.monoX[k] !== m[k * 4] || civ.monoZ[k] !== m[k * 4 + 1]) {
      civ.sX[s] = m[k * 4]; civ.sZ[s] = m[k * 4 + 1]; civ.sBuild[s] = 0; civ.sEpoch++;
      civ.monoX[k] = m[k * 4]; civ.monoZ[k] = m[k * 4 + 1];
    }
    if (civ.sBuild[s] < 1) civ.sBuild[s] = Math.min(1, civ.sBuild[s] + dt / 1.5);
  }
}

export function civStep(world, dt) {
  const civ = world.civ;
  syncMonoliths(world, dt);
  if (civ.dwellings === 0) return;
  stepHomeField(world, slopeAtCell);
  readEvents(world);
  for (let v = 0; v < civ.nV; v++) {
    if (civ.vAlive[v] === 0) continue;
    civ.vTimer[v] -= dt;
    if (civ.vState[v] === ST_GREET) { if (civ.vTimer[v] <= 0) civ.vState[v] = ST_IDLE; continue; }
    if (civ.vTimer[v] <= 0) decide(world, v);
    const dist = moveVillager(world, v, dt);
    const st = civ.vState[v];
    if (st !== ST_IDLE && st !== ST_BUILD && dist < 0.14) arrive(world, v);
    if (civ.vVX[v] * civ.vVX[v] + civ.vVZ[v] * civ.vVZ[v] > 1e-4) {
      const h = Math.atan2(civ.vVX[v], civ.vVZ[v]);
      let dh = h - civ.vHeading[v];
      while (dh > Math.PI) dh -= 6.2832;
      while (dh < -Math.PI) dh += 6.2832;
      civ.vHeading[v] += dh * Math.min(1, dt * 8);
    }
  }
  civ.orderClock += dt;
  if (civ.orderClock > 0.7) { civ.orderClock = 0; scanForOrders(world); }
  assignOrders(world);
  progressBuilds(world, dt);
  civ.secClock += dt;
  if (civ.secClock >= 1) { civ.secClock = 0; secondTick(world); }
}

function addDwelling(world, x, z) { return addStructure(world.civ, KIND_DWELLING, x, z, 0, 0, 0, 1, 0); }

// free a villager from any Mason job or material run (death, or leaving with a household)
function releaseVillager(world, v) {
  const civ = world.civ;
  const o = civ.vJob[v];
  if (o >= 0) { civ.vJob[v] = -1; if (civ.oWorker[o] === v) civ.oWorker[o] = -1; }
  if (civ.vSupply[v] >= 0) releaseSupply(civ, v);
  if (civ.vRole[v] === ROLE_MASON) { civ.masons--; civ.vRole[v] = ROLE_FORAGER; }
}

bindCivHelpers({ releaseVillager, addDwelling, siteOk });
