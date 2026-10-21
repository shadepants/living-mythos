import { GRID_W, GRID_H, GRID_N, CELL_SIZE } from './grid.js';

// Phase 3: a shared "distance to the nearest healthy home" field over the grid, measured in walking effort (steep
// ground, wading and deep water cost more; bridges / paving less; the cliff rim is near-impassable). Resting and
// food-hauling villagers walk down it, so they find a bridge or ford instead of pacing on a river bank.
// Built incrementally inside simStep (deterministic, no RNG): one 8-neighbour chamfer sweep per substep into a scratch
// field, cycling the four sweep directions; every HF_CYCLE sweeps the scratch is published and a new build starts.
export const HF_INF = 1e9;
const HF_CYCLE = 12;   // 3 passes x 4 directions
const D1 = CELL_SIZE, D2 = CELL_SIZE * Math.SQRT2;

// per-cell walking effort multiplier, consistent with the local steering cost (civ.js stepCost)
export function homeFieldCost(world, i, slope) {
  let c = 1 + slope * 14;
  const w = world.water[i];
  if (world.engCover[i] === 0) { if (w > 0.025) c += 2.4; if (w > 0.07) c += 22; }
  else c = Math.max(0.65, c - 0.35);
  if (world.mask[i] === 1) c += 60;
  return c;
}

export function stepHomeField(world, slopeAtCell) {
  const civ = world.civ, pf = world.pathField;
  pf.skip = !pf.skip;
  if (pf.skip) return;   // one sweep every other substep: ~0.1 ms, a fresh field every 0.6 sim s (homes change over minutes)
  const k = pf.phase;
  const s = pf.scratch, cost = pf.cost;
  if (k === 0) {
    // start a build: costs for this cycle, sources at healthy finished dwellings
    for (let i = 0; i < GRID_N; i++) { s[i] = HF_INF; cost[i] = homeFieldCost(world, i, slopeAtCell(world.elev, i)); }
    let n = 0;
    for (let d = 0; d < civ.nS; d++) {
      if (civ.sKind[d] !== 0 || civ.sBuild[d] < 1 || civ.sDecay[d] > 0.3) continue;
      const gx = Math.round((civ.sX[d] + 10) / 20 * GRID_W - 0.5), gz = Math.round((civ.sZ[d] + 10) / 20 * GRID_H - 0.5);
      if (gx < 0 || gz < 0 || gx >= GRID_W || gz >= GRID_H) continue;
      s[gz * GRID_W + gx] = 0; n++;
    }
    pf.sources = n;
  }
  // one sweep in direction k % 4: (+x,+z), (-x,+z), (+x,-z), (-x,-z)
  const dir = k % 4, sx = dir & 1 ? -1 : 1, sz = dir & 2 ? -1 : 1;
  const x0 = sx > 0 ? 1 : GRID_W - 2, z0 = sz > 0 ? 1 : GRID_H - 2;
  for (let zz = 0, z = z0; zz < GRID_H - 2; zz++, z += sz) {
    for (let xx = 0, x = x0; xx < GRID_W - 2; xx++, x += sx) {
      const i = z * GRID_W + x;
      let best = s[i];
      const ci = cost[i];
      // upwind neighbours for this sweep direction (already updated this pass) plus their diagonal
      const a = i - sx, b = i - sz * GRID_W, c = i - sx - sz * GRID_W, e = i + sx - sz * GRID_W;
      let v = s[a] + (ci + cost[a]) * 0.5 * D1; if (v < best) best = v;
      v = s[b] + (ci + cost[b]) * 0.5 * D1; if (v < best) best = v;
      v = s[c] + (ci + cost[c]) * 0.5 * D2; if (v < best) best = v;
      v = s[e] + (ci + cost[e]) * 0.5 * D2; if (v < best) best = v;
      s[i] = best;
    }
  }
  pf.phase = k + 1;
  if (pf.phase >= HF_CYCLE) {
    // publish: swap the finished field in, recycle the old one as the next scratch
    const done = pf.scratch; pf.scratch = pf.field; pf.field = done; pf.phase = 0; pf.ready = pf.sources > 0;
  }
}

// field value at a world position (nearest cell); HF_INF when unknown / not ready
export function homeFieldAt(world, x, z) {
  const pf = world.pathField;
  if (!pf.ready) return HF_INF;
  let gx = Math.round((x + 10) / 20 * GRID_W - 0.5), gz = Math.round((z + 10) / 20 * GRID_H - 0.5);
  if (gx < 0) gx = 0; else if (gx > GRID_W - 1) gx = GRID_W - 1;
  if (gz < 0) gz = 0; else if (gz > GRID_H - 1) gz = GRID_H - 1;
  return pf.field[gz * GRID_W + gx];
}

// Next step down the home field: the centre of the neighbouring cell (of 8) with the lowest value, written to out
// as world x/z. Values strictly fall toward a home, so following cell to cell can't ping-pong (a smooth gradient
// did: on narrow paths, e.g. along a terrace edge, central differences straddle the path and flip sign).
// Returns false when the field isn't ready, the cell is unknown, or no neighbour is lower (at a home).
export function homeFieldNext(world, x, z, out) {
  const pf = world.pathField;
  if (!pf.ready) return false;
  let gx = Math.round((x + 10) / 20 * GRID_W - 0.5), gz = Math.round((z + 10) / 20 * GRID_H - 0.5);
  if (gx < 1 || gz < 1 || gx > GRID_W - 2 || gz > GRID_H - 2) return false;
  const f = pf.field, i = gz * GRID_W + gx;
  let best = f[i], bi = -1;
  if (!(best < HF_INF)) return false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dz === 0) continue;
    const j = i + dz * GRID_W + dx;
    if (f[j] < best) { best = f[j]; bi = j; }
  }
  if (bi < 0) return false;
  out[0] = ((bi % GRID_W) + 0.5) / GRID_W * 20 - 10;
  out[1] = (((bi / GRID_W) | 0) + 0.5) / GRID_H * 20 - 10;
  return true;
}
