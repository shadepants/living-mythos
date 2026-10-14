import { sampleGrid, visualHeight } from './sample.js';
import {
  nextEvent, EV_ROCKFALL, EV_DUST, EV_LANTERN, EV_RAIN_DROP, EV_MONOLITH_PULSE, EV_MONOLITH_PLACE,
} from './events.js';
import { KIND_DWELLING } from './civ.js';

export const PARTICLE_CAP = 1000;
export const P_SPRAY = 0, P_RAIN = 1, P_EMBER = 2, P_ROCK = 3, P_LANTERN = 4;
// subtype 2 doubles as stone dust (flag in `aux`: 0 ember, 1 dust)

// Zero-GC particle sim (spec 4.2 Pool 4). Struct-of-arrays, oldest-first recycling.
export function createParticles() {
  const f = () => new Float32Array(PARTICLE_CAP);
  return {
    x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(), life: f(), maxLife: f(), size: f(), aux: f(), spin: f(),
    type: new Uint8Array(PARTICLE_CAP), alive: new Uint8Array(PARTICLE_CAP),
    next: 0, count: 0, cursor: { i: 0 }, sprayClock: 0, rainClock: 0, emberClock: 0, rainAccum: 0,
    rainSlots: 380,          // budget kept for ambient/cloud rain so it can't starve the other effects
  };
}

function spawn(p, type, x, y, z, vx, vy, vz, life, size, aux) {
  // Recycle the slot after the last one used; rain is limited to its own budget by the callers.
  const k = p.next; p.next = (p.next + 1) % PARTICLE_CAP;
  p.type[k] = type; p.alive[k] = 1;
  p.x[k] = x; p.y[k] = y; p.z[k] = z; p.vx[k] = vx; p.vy[k] = vy; p.vz[k] = vz;
  p.life[k] = 0; p.maxLife[k] = life; p.size[k] = size; p.aux[k] = aux; p.spin[k] = Math.random() * 6.28;
}

// world: sim world; wind: {x,z,amp}; camera target for ambient rain; rainAmt 0..1 (monsoon), cloud {x,y,z,on}
export function stepParticles(p, world, dt, time, rainAmt, windAmp, cloudOn, cx, cy, cz, tx, tz) {
  const civ = world.civ;
  const rng = world.rng;

  // -------- events -> spawns --------
  let k;
  while ((k = nextEvent(world.events, p.cursor)) >= 0) {
    const t = world.events.type[k], ex = world.events.x[k], ez = world.events.z[k], ea = world.events.a[k];
    const ey = visualHeight(world.elev, ex, ez);
    if (t === EV_ROCKFALL) {
      for (let n = 0; n < 5; n++) spawn(p, P_ROCK, ex + (Math.random() - 0.5) * 0.9, ey + 0.1, ez + (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 0.9, 1.4, 0.035 + Math.random() * 0.035, 0);
    } else if (t === EV_DUST) {
      for (let n = 0; n < 4; n++) spawn(p, P_EMBER, ex + (Math.random() - 0.5) * 0.3, ey + 0.05, ez + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.25, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.25, 1.6, 0.07 + Math.random() * 0.05, 1);
    } else if (t === EV_LANTERN) {
      spawn(p, P_LANTERN, ex, ey + 0.4, ez, (Math.random() - 0.5) * 0.1, 0.35 + Math.random() * 0.15, (Math.random() - 0.5) * 0.1, 14 + Math.random() * 6, 0.16, Math.random());
    } else if (t === EV_MONOLITH_PULSE || t === EV_MONOLITH_PLACE) {
      for (let n = 0; n < 3; n++) { const a = n * 2.09 + time; spawn(p, P_LANTERN, ex + Math.cos(a) * 0.5, ey + 0.8, ez + Math.sin(a) * 0.5, 0, 0.45, 0, 11, 0.12, Math.random()); }
    } else if (t === EV_RAIN_DROP) {
      void ea;
    }
  }

  // -------- ambient emitters --------
  // waterfall spray and rising mist from rim outflow
  p.sprayClock += dt;
  if (p.sprayClock > 0.03 && world.rimCells) {
    p.sprayClock = 0;
    for (let n = 0; n < 6; n++) {
      const c = world.rimCells[(rng.next() * world.rimCells.length) | 0];
      const out = world.rimOut[c];
      if (out > 0.0004 && rng.next() < Math.min(1, out * 90)) {
        const gx = (c % 128 + 0.5) / 128 * 20 - 10, gz = (((c / 128) | 0) + 0.5) / 128 * 20 - 10;
        const r = Math.hypot(gx, gz) || 1;
        const px = gx / r * 9.2, pz = gz / r * 9.2;
        const mist = rng.next() < 0.45;
        spawn(p, P_SPRAY, px, -0.55, pz, gx / r * (0.2 + Math.random() * 0.5), mist ? 0.3 + Math.random() * 0.3 : -0.4 - Math.random() * 0.8, gz / r * (0.2 + Math.random() * 0.5), mist ? 2.4 : 1.1, mist ? 0.18 : 0.05, mist ? 1 : 0);
      }
    }
  }
  // forge embers from industrious dwellings
  p.emberClock += dt;
  if (p.emberClock > 0.25) {
    p.emberClock = 0;
    for (let n = 0; n < 8; n++) {
      const s = (rng.next() * civ.nS) | 0;
      if (civ.sKind[s] !== KIND_DWELLING || civ.sBuild[s] < 1 || civ.sDecay[s] > 0.5) continue;
      if (civ.sBias[s] > -0.35) continue;
      const y = visualHeight(world.elev, civ.sX[s], civ.sZ[s]);
      spawn(p, P_EMBER, civ.sX[s] + 0.06, y + 0.55, civ.sZ[s], (Math.random() - 0.5) * 0.12, 0.35 + Math.random() * 0.25, (Math.random() - 0.5) * 0.12, 2.0, 0.03, 0);
    }
  }
  // rain: monsoon over the whole island, plus a focused downpour under the raincloud tool
  p.rainAccum += dt * (rainAmt * 260 + (cloudOn ? 120 : 0));
  let alive = 0;
  for (let i = 0; i < PARTICLE_CAP; i++) if (p.alive[i] && p.type[i] === P_RAIN) alive++;
  while (p.rainAccum >= 1) {
    p.rainAccum -= 1;
    if (alive >= p.rainSlots) { p.rainAccum = 0; break; }
    const useCloud = cloudOn && (rainAmt < 0.05 || Math.random() < 0.45);
    let x, z, y;
    if (useCloud) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 1.5; x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r; y = cy - 0.15; }
    else { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 8.5; x = Math.cos(a) * r; z = Math.sin(a) * r; y = 5.5 + Math.random() * 1.5; }
    spawn(p, P_RAIN, x, y, z, windAmp * 0.9 + 0.3, -7.5 - Math.random() * 2, 0.15, 2.0, 0.02, 0);
    alive++;
  }
  void tx; void tz;

  // -------- integrate --------
  let count = 0;
  for (let i = 0; i < PARTICLE_CAP; i++) {
    if (!p.alive[i]) continue;
    const t = p.type[i];
    p.life[i] += dt;
    if (p.life[i] >= p.maxLife[i]) { p.alive[i] = 0; continue; }
    count++;
    if (t === P_RAIN) {
      p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
      const gh = visualHeight(world.elev, p.x[i], p.z[i]);
      if (p.y[i] < gh + 0.02 || p.y[i] < -0.8) {
        p.alive[i] = 0;
        // a splash: tiny spray puff where the drop lands on the island
        if (Math.hypot(p.x[i], p.z[i]) < 8.6 && Math.random() < 0.25) spawn(p, P_SPRAY, p.x[i], gh + 0.02, p.z[i], 0, 0.25, 0, 0.35, 0.03, 0);
      }
    } else if (t === P_ROCK) {
      p.vy[i] -= 4.2 * dt;
      p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
      p.spin[i] += dt * 6;
      const gh = visualHeight(world.elev, p.x[i], p.z[i]);
      if (p.y[i] < gh + 0.015) { p.y[i] = gh + 0.015; p.vy[i] = -p.vy[i] * 0.3; p.vx[i] *= 0.6; p.vz[i] *= 0.6; if (Math.abs(p.vy[i]) < 0.12) p.vy[i] = 0; }
    } else if (t === P_LANTERN) {
      // buoyant: slow rise, lateral wind drift, gentle sway
      p.x[i] += (p.vx[i] + windAmp * 0.12 + 0.05 * Math.sin(time * 0.7 + p.aux[i] * 9)) * dt;
      p.z[i] += (p.vz[i] + 0.04 * Math.cos(time * 0.6 + p.aux[i] * 7)) * dt;
      p.y[i] += p.vy[i] * dt;
    } else {
      // spray / mist / embers / dust: light, rising or settling with a touch of wind
      const grav = t === P_SPRAY && p.aux[i] === 0 ? -2.4 : 0;
      p.vy[i] += grav * dt;
      p.x[i] += (p.vx[i] + windAmp * 0.08) * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
    }
  }
  p.count = count;
}

// Wind pushes sky-lanterns harder when the Breeze tool is active near them (spec 6.2).
export function breezeLanterns(p, bx, bz, radius, strength, dt) {
  if (strength < 0.05) return;
  for (let i = 0; i < PARTICLE_CAP; i++) {
    if (!p.alive[i] || p.type[i] !== P_LANTERN) continue;
    const dx = p.x[i] - bx, dz = p.z[i] - bz, d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    const w = (1 - Math.sqrt(d2) / radius) * strength;
    const d = Math.sqrt(d2) + 1e-3;
    p.x[i] += dx / d * w * 1.6 * dt; p.z[i] += dz / d * w * 1.6 * dt; p.y[i] += w * 0.6 * dt;
  }
}
