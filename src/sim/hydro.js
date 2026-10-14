import { GRID_W, GRID_H, GRID_N } from './grid.js';
import { TUNING } from './tuning.js';


// One virtual-pipe substep (spec 3.2). Allocation-free: only typed-array reads/writes and locals.
export function hydroStep(world) {
  const p = world.params;
  const dt = p.dt;
  const { elev, water, fluxL, fluxR, fluxT, fluxB, vx, vz, sediment, fertility, mask, rimOut, sedTmp, springs } = world;
  const g = p.gravity, damp = p.fluxDamp;

  // sources
  if (p.rain > 0) {
    const add = p.rain * dt;
    for (let i = 0; i < GRID_N; i++) if (mask[i] === 0) water[i] += add;
  }
  if (p.springRate > 0) {
    const add = p.springRate * dt;
    for (let s = 0; s < springs.length; s++) water[springs[s]] += add;
  }

  // 1+2: flux acceleration and conservation scaling
  for (let z = 0; z < GRID_H; z++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = z * GRID_W + x;
      const h0 = elev[i] + water[i];
      let fl = 0, fr = 0, ft = 0, fb = 0;
      if (x > 0) { fl = fluxL[i] * damp + dt * g * (h0 - elev[i - 1] - water[i - 1]); if (fl < 0) fl = 0; }
      if (x < GRID_W - 1) { fr = fluxR[i] * damp + dt * g * (h0 - elev[i + 1] - water[i + 1]); if (fr < 0) fr = 0; }
      if (z > 0) { ft = fluxT[i] * damp + dt * g * (h0 - elev[i - GRID_W] - water[i - GRID_W]); if (ft < 0) ft = 0; }
      if (z < GRID_H - 1) { fb = fluxB[i] * damp + dt * g * (h0 - elev[i + GRID_W] - water[i + GRID_W]); if (fb < 0) fb = 0; }
      let k = water[i] / (dt * (fl + fr + ft + fb) + 1e-6);
      if (k > 1) k = 1;
      fluxL[i] = fl * k; fluxR[i] = fr * k; fluxT[i] = ft * k; fluxB[i] = fb * k;
    }
  }

  // 3+4a: continuity, rim drain, evaporation, derived velocity
  let fluxTotal = 0, drainedTotal = 0;
  const drainFrac = Math.min(1, p.rimDrainRate * dt);
  const evap = p.evap * dt;
  const velMax = TUNING.velMax;
  for (let z = 0; z < GRID_H; z++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = z * GRID_W + x;
      const inL = x > 0 ? fluxR[i - 1] : 0;
      const inR = x < GRID_W - 1 ? fluxL[i + 1] : 0;
      const inT = z > 0 ? fluxB[i - GRID_W] : 0;
      const inB = z < GRID_H - 1 ? fluxT[i + GRID_W] : 0;
      const out = fluxL[i] + fluxR[i] + fluxT[i] + fluxB[i];
      const d0 = water[i];
      let d1 = d0 + dt * (inL + inR + inT + inB - out);
      if (d1 < 0) d1 = 0;
      fluxTotal += out;

      const dbar = 0.5 * (d0 + d1);
      if (dbar > TUNING.minDepthVel) {
        let ux = 0.5 * (inL - fluxL[i] + fluxR[i] - inR) / dbar;
        let uz = 0.5 * (inT - fluxT[i] + fluxB[i] - inB) / dbar;
        if (ux > velMax) ux = velMax; else if (ux < -velMax) ux = -velMax;
        if (uz > velMax) uz = velMax; else if (uz < -velMax) uz = -velMax;
        vx[i] = ux; vz[i] = uz;
      } else { vx[i] = 0; vz[i] = 0; }

      if (mask[i] === 1) {
        if (p.drainRim) {
          const dr = d1 * drainFrac;
          d1 -= dr;
          rimOut[i] = dr;
          drainedTotal += dr;
        }
      } else if (evap > 0) {
        d1 -= evap;
        if (d1 < 0) d1 = 0;
      }
      water[i] = d1;
    }
  }
  world.stats.rimDrained += drainedTotal;
  world.stats.flux = fluxTotal;

  // 4b: erosion / deposition, then semi-Lagrangian sediment transport
  if (p.erosion) {
    const kCap = p.kCap, kEr = p.kErode * dt, kDep = p.kDeposit * dt;
    const maxD = TUNING.maxDElev, floor = TUNING.elevFloor, gain = TUNING.alluvialGain;
    for (let i = 0; i < GRID_N; i++) {
      if (mask[i] === 1) { if (p.drainRim) sediment[i] = 0; continue; }
      const dep = water[i];
      let cap = 0;
      if (dep > TUNING.erodeMinDepth) {
        const s = Math.sqrt(vx[i] * vx[i] + vz[i] * vz[i]);
        cap = s * (dep < 0.08 ? dep : 0.08) * kCap;
      }
      const sed = sediment[i];
      if (cap > sed) {
        let d = kEr * (cap - sed);
        if (d > maxD) d = maxD;
        if (elev[i] - d < floor) d = elev[i] - floor > 0 ? elev[i] - floor : 0;
        elev[i] -= d;
        sediment[i] = sed + d;
      } else {
        let d = kDep * (sed - cap);
        if (d > maxD) d = maxD;
        if (d > sed) d = sed;
        // sediment never builds a spike above all four neighbours (it would be washed on in reality)
        const xx = i % GRID_W, zz = (i / GRID_W) | 0;
        const eL = xx > 0 ? elev[i - 1] : elev[i], eR = xx < GRID_W - 1 ? elev[i + 1] : elev[i];
        const eU = zz > 0 ? elev[i - GRID_W] : elev[i], eD = zz < GRID_H - 1 ? elev[i + GRID_W] : elev[i];
        let hmax = eL > eR ? eL : eR;
        if (eU > hmax) hmax = eU;
        if (eD > hmax) hmax = eD;
        const room = hmax + TUNING.depositLip - elev[i];
        if (d > room) d = room > 0 ? room : 0;
        elev[i] += d;
        sediment[i] = sed - d;
        const f = fertility[i] + d * gain;
        fertility[i] = f > 1 ? 1 : f;
      }
    }
    // conservative donor-cell transport: each cell hands a velocity-proportional fraction to its downstream neighbours
    sedTmp.set(sediment);
    for (let z = 0; z < GRID_H; z++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = z * GRID_W + x;
        const sed = sediment[i];
        if (sed <= 0) continue;
        const ux = vx[i] * dt, uz = vz[i] * dt;
        let ax = ux < 0 ? -ux : ux, az = uz < 0 ? -uz : uz;
        const nx = ux < 0 ? x - 1 : x + 1, nz = uz < 0 ? z - 1 : z + 1;
        if (nx < 0 || nx >= GRID_W) ax = 0;
        if (nz < 0 || nz >= GRID_H) az = 0;
        const tot = ax + az;
        const scale = tot > 0.9 ? 0.9 / tot : 1;
        ax *= scale; az *= scale;
        sedTmp[i] -= (ax + az) * sed;
        if (ax > 0) sedTmp[z * GRID_W + nx] += ax * sed;
        if (az > 0) sedTmp[nz * GRID_W + x] += az * sed;
      }
    }
    sediment.set(sedTmp);
  }
  world.stats.substeps++;
}
