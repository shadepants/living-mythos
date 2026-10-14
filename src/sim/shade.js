import { GRID_W, GRID_H, GRID_N, CELL_SIZE } from './grid.js';
import { sampleGrid } from './sample.js';

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
  state.rows = r1 >= GRID_H ? 0 : r1;
  if (r1 >= GRID_H) { state.sweepDone++; return true; }
  return false;
}
