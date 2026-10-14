import { GRID_W, GRID_H, GRID_N, CELL_SIZE } from './grid.js';
import { sampleGrid } from './sample.js';
import { KIND_DWELLING, KIND_MONOLITH, KIND_MYTH } from './civ.js';

// Sun shadows from the heightfield (replaces a GPU shadow-map pass, which lost the WebGL context on the phone GPU).
// world.shade[i] in [0,1]: 1 = fully lit, 0 = in the shadow of higher ground. Refreshed a slice of rows per call.
export function createShade() {
  return { rows: 0, sweepDone: 0 };
}

const STEPS = 14;

// Cast a ray from every cell in rows [row0, row1) toward the sun (dx,dy,dz unit vector pointing at the sun).
export function computeShadeRows(world, dx, dy, dz, row0, row1) {
  const { elev, mask, shade } = world;
  const hl = Math.sqrt(dx * dx + dz * dz);
  const ux = hl > 1e-4 ? dx / hl : 0, uz = hl > 1e-4 ? dz / hl : 0;
  const slope = hl > 1e-4 ? dy / hl : 100;                  // rise per unit of horizontal travel toward the sun
  for (let z = row0; z < row1; z++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = z * GRID_W + x;
      if (mask[i] === 1) { shade[i] = 1; continue; }
      const wx = -10 + (x + 0.5) * CELL_SIZE, wz = -10 + (z + 0.5) * CELL_SIZE;
      const h0 = elev[i] + 0.03;
      let lit = 1;
      let t = 0.12;
      for (let s = 0; s < STEPS; s++) {
        const px = wx + ux * t, pz = wz + uz * t;
        if (px < -10 || px > 10 || pz < -10 || pz > 10) break;
        const rayH = h0 + slope * t;
        const gap = rayH - sampleGrid(elev, px, pz);
        // soft penumbra: widen with distance travelled
        const soft = 0.04 + 0.05 * t;
        const f = gap <= -soft ? 0 : gap >= soft ? 1 : (gap + soft) / (2 * soft);
        if (f < lit) lit = f;
        if (lit <= 0) break;
        t *= 1.38;
      }
      shade[i] = lit;
    }
  }
  void GRID_H; void GRID_N;
}

// Amortised refresh: advance by `rows` rows each call; returns true when a full sweep just finished.
export function stepShade(world, state, sun, rowsPerCall) {
  const r0 = state.rows;
  const r1 = Math.min(GRID_H, r0 + rowsPerCall);
  computeShadeRows(world, sun.x, sun.y, sun.z, r0, r1);
  stampObjectShadows(world, sun.x, sun.y, sun.z, r0, r1);
  state.rows = r1 >= GRID_H ? 0 : r1;
  if (r1 >= GRID_H) { state.sweepDone++; return true; }
  return false;
}

// Soft cast shadows of buildings, monoliths and myth stones as ellipses stretched away from the sun, stamped into the
// shade field for rows [row0, row1). Heights are rough world-space object heights.
export function stampObjectShadows(world, dx, dy, dz, row0, row1) {
  const civ = world.civ, shade = world.shade;
  const hl = Math.sqrt(dx * dx + dz * dz);
  if (hl < 1e-4) return;
  const ux = dx / hl, uz = dz / hl;                     // toward the sun
  const rise = Math.max(0.2, dy / hl);
  for (let s = 0; s < civ.nS; s++) {
    const k = civ.sKind[s];
    let H, wide;
    if (k === KIND_DWELLING) { H = 0.55 * Math.min(1, civ.sBuild[s]); wide = 0.3; }
    else if (k === KIND_MONOLITH) { H = 1.2 * Math.min(1, civ.sBuild[s]); wide = 0.13; }
    else if (k === KIND_MYTH) { H = 0.55; wide = 0.16; }
    else continue;
    if (H <= 0.02) continue;
    const len = Math.min(1.5, H / rise);
    const along = len * 0.5 + wide;                      // semi-axis along the shadow
    const cx = civ.sX[s] - ux * len * 0.5, cz = civ.sZ[s] - uz * len * 0.5;
    const reach = along + 0.15;
    const gz0 = Math.max(row0, Math.floor(((cz - reach) + 10) / CELL_SIZE) - 1), gz1 = Math.min(row1 - 1, Math.ceil(((cz + reach) + 10) / CELL_SIZE) + 1);
    const gx0 = Math.max(0, Math.floor(((cx - reach) + 10) / CELL_SIZE) - 1), gx1 = Math.min(GRID_W - 1, Math.ceil(((cx + reach) + 10) / CELL_SIZE) + 1);
    for (let z = gz0; z <= gz1; z++) {
      for (let x = gx0; x <= gx1; x++) {
        const wx = -10 + (x + 0.5) * CELL_SIZE - cx, wz = -10 + (z + 0.5) * CELL_SIZE - cz;
        const a = wx * ux + wz * uz, b = -wx * uz + wz * ux;
        const q = (a * a) / (along * along) + (b * b) / (wide * wide);
        if (q >= 1) continue;
        const dark = 0.62 * (1 - q * q);                // soft edge, darkest at the core
        const i = z * GRID_W + x;
        const v = 1 - dark;
        if (v < shade[i]) shade[i] = v;
      }
    }
  }
}
