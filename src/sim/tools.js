import { TUNING } from './tuning.js';
import { GRID_W, GRID_H, CELL_SIZE } from './grid.js';
import { worldToGridX, worldToGridZ } from './sample.js';
import { emitEvent, EV_MONOLITH_PLACE, EV_MONOLITH_PULSE } from './events.js';

export const MAX_MONOLITHS = 8;
const ELEV_MAX = 2.8;

// Gaussian elevation delta (positive raises, negative carves). sigma = radius / 2. Also bumps slope frustration.
export function sculptAt(world, wx, wz, radius, amount) {
  const { elev, mask, frustration } = world;
  const gx = worldToGridX(wx), gz = worldToGridZ(wz);
  const rc = Math.ceil(radius / CELL_SIZE) + 1;
  const sigma = radius * 0.5, inv = 1 / (2 * sigma * sigma);
  const x0 = Math.max(1, Math.floor(gx - rc)), x1 = Math.min(GRID_W - 2, Math.ceil(gx + rc));
  const z0 = Math.max(1, Math.floor(gz - rc)), z1 = Math.min(GRID_H - 2, Math.ceil(gz + rc));
  const r2max = radius * radius;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const i = z * GRID_W + x;
      if (mask[i] === 1) continue;
      const dx = (x - gx) * CELL_SIZE, dz = (z - gz) * CELL_SIZE;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2max) continue;
      let e = elev[i] + amount * Math.exp(-d2 * inv);
      if (e > ELEV_MAX) e = ELEV_MAX; else if (e < TUNING.elevFloor) e = TUNING.elevFloor;
      elev[i] = e;
    }
  }
  // freshly steepened ground frustrates travellers immediately
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const i = z * GRID_W + x;
      if (mask[i] === 1) continue;
      const dx = (x - gx) * CELL_SIZE, dz = (z - gz) * CELL_SIZE;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2max) continue;
      const sx = (elev[i + 1] - elev[i - 1]) * 0.5, sz = (elev[i + GRID_W] - elev[i - GRID_W]) * 0.5;
      if (Math.sqrt(sx * sx + sz * sz) > TUNING.steepSlope) {
        const f = frustration[i] + 0.12 * Math.exp(-d2 * inv) * Math.abs(amount) * 10;
        frustration[i] = f > 1 ? 1 : f;
      }
    }
  }
}

// Raincloud: injects standing water, soil moisture and fertility under the cloud.
export function rainAt(world, wx, wz, radius, dt) {
  const { water, moisture, fertility, mask } = world;
  const gx = worldToGridX(wx), gz = worldToGridZ(wz);
  const rc = Math.ceil(radius / CELL_SIZE) + 1;
  const sigma = radius * 0.5, inv = 1 / (2 * sigma * sigma);
  const x0 = Math.max(1, Math.floor(gx - rc)), x1 = Math.min(GRID_W - 2, Math.ceil(gx + rc));
  const z0 = Math.max(1, Math.floor(gz - rc)), z1 = Math.min(GRID_H - 2, Math.ceil(gz + rc));
  const r2max = radius * radius;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const i = z * GRID_W + x;
      if (mask[i] === 1) continue;
      const dx = (x - gx) * CELL_SIZE, dz = (z - gz) * CELL_SIZE;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2max) continue;
      const w = Math.exp(-d2 * inv);
      water[i] += TUNING.cloudRain * dt * w;
      let m = moisture[i] + 0.9 * dt * w; moisture[i] = m > 1 ? 1 : m;
      let f = fertility[i] + 0.05 * dt * w; fertility[i] = f > 1 ? 1 : f;
    }
  }
}

// Up to 8 monoliths; the 9th recycles the oldest. Returns the slot used, or -1 if the spot is off-island.
export function placeMonolith(world, wx, wz) {
  if (Math.sqrt(wx * wx + wz * wz) > 8.4) return -1;
  const m = world.monoliths;
  let slot = -1;
  for (let k = 0; k < MAX_MONOLITHS; k++) if (m[k * 4 + 3] === 0) { slot = k; break; }
  if (slot < 0) {
    let oldest = Infinity;
    for (let k = 0; k < MAX_MONOLITHS; k++) if (m[k * 4 + 2] < oldest) { oldest = m[k * 4 + 2]; slot = k; }
  }
  m[slot * 4] = wx; m[slot * 4 + 1] = wz; m[slot * 4 + 2] = world.stats.time; m[slot * 4 + 3] = 1;
  world.monoPulse[slot] = world.stats.time + 1.2;
  emitEvent(world.events, EV_MONOLITH_PLACE, wx, wz, slot);
  return slot;
}

// Called once per ecology tick: pulls regional culture toward Mystical, nudges fertility, fires harmonic pulses.
export function monolithEffects(world, dt) {
  const { culturalBias, fertility, mask } = world;
  const m = world.monoliths;
  for (let k = 0; k < MAX_MONOLITHS; k++) {
    if (m[k * 4 + 3] === 0) continue;
    const wx = m[k * 4], wz = m[k * 4 + 1];
    const gx = worldToGridX(wx), gz = worldToGridZ(wz);
    const R = TUNING.monolithRadius, rc = Math.ceil(R / CELL_SIZE) + 1;
    const inv = 1 / (2 * (R * 0.45) * (R * 0.45)), r2max = R * R;
    const x0 = Math.max(1, Math.floor(gx - rc)), x1 = Math.min(GRID_W - 2, Math.ceil(gx + rc));
    const z0 = Math.max(1, Math.floor(gz - rc)), z1 = Math.min(GRID_H - 2, Math.ceil(gz + rc));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const i = z * GRID_W + x;
        if (mask[i] === 1) continue;
        const dx = (x - gx) * CELL_SIZE, dz = (z - gz) * CELL_SIZE;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2max) continue;
        const w = Math.exp(-d2 * inv);
        culturalBias[i] += (1 - culturalBias[i]) * TUNING.monolithPull * dt * w;
        const f = fertility[i] + 0.01 * dt * w; fertility[i] = f > 1 ? 1 : f;
      }
    }
    if (world.stats.time >= world.monoPulse[k]) {
      emitEvent(world.events, EV_MONOLITH_PULSE, wx, wz, k);
      world.monoPulse[k] = world.stats.time + TUNING.monolithPulseEvery;
    }
  }
}
