import { GRID_W, GRID_H, WORLD_SIZE } from './grid.js';

// World <-> grid mapping. Cell (x,z) centre is at world -10 + (x+0.5)*CELL; the GPU textures use the same texel centres.
export function worldToGridX(wx) { return (wx + WORLD_SIZE * 0.5) / WORLD_SIZE * GRID_W - 0.5; }
export function worldToGridZ(wz) { return (wz + WORLD_SIZE * 0.5) / WORLD_SIZE * GRID_H - 0.5; }

// Bilinear sample of any grid channel at a world position (allocation-free).
export function sampleGrid(arr, wx, wz) {
  let gx = worldToGridX(wx), gz = worldToGridZ(wz);
  if (gx < 0) gx = 0; else if (gx > GRID_W - 1.001) gx = GRID_W - 1.001;
  if (gz < 0) gz = 0; else if (gz > GRID_H - 1.001) gz = GRID_H - 1.001;
  const x0 = gx | 0, z0 = gz | 0, fx = gx - x0, fz = gz - z0;
  const i = z0 * GRID_W + x0;
  const a = arr[i], b = arr[i + 1], c = arr[i + GRID_W], d = arr[i + GRID_W + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
