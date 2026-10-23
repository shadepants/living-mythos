import * as THREE from 'three';
import { GRID_W, GRID_H, GRID_N } from '../sim/grid.js';

// Two RGBA float DataTextures bridging CPU sim state to shaders (spec 3.3/4.1).
export function createSimTextures(floatLinear) {
  const bufA = new Float32Array(GRID_N * 4);
  const bufB = new Float32Array(GRID_N * 4);
  const bufC = new Float32Array(GRID_N * 4);   // R = sun shade (heightfield shadows), G = sediment, B = biomass (vegetation), A = field (5d-2)
  const filter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
  const make = (buf) => {
    const t = new THREE.DataTexture(buf, GRID_W, GRID_H, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = filter; t.minFilter = filter;
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return { bufA, bufB, bufC, texA: make(bufA), texB: make(bufB), texC: make(bufC) };
}

// A: elev, water, vx, vz   B: moisture, fertility, compaction, culturalBias
export function packSimTextures(world, st) {
  const { elev, water, vx, vz, moisture, fertility, compaction, culturalBias } = world;
  const a = st.bufA, b = st.bufB;
  for (let i = 0, j = 0; i < GRID_N; i++, j += 4) {
    a[j] = elev[i]; a[j + 1] = water[i]; a[j + 2] = vx[i]; a[j + 3] = vz[i];
    b[j] = moisture[i]; b[j + 1] = fertility[i]; b[j + 2] = compaction[i]; b[j + 3] = culturalBias[i];
  }
  st.texA.needsUpdate = true;
  st.texB.needsUpdate = true;
}

// Shade factor (0 shadowed .. 1 lit) from the CPU heightfield march, into R of uSimTexC.
export function packShadeTexture(world, st) {
  const sh = world.shade, c = st.bufC;
  // biomass rides along on the shade sweep's upload (~every 16 frames): it changes over minutes, and packing it
  // every frame would re-upload the whole 256 KB texture each frame
  // sediment (G) rides along too: the water shader tints silty floodwater; plumes move slowly enough for this cadence
  // the field mask (A) is rebuilt at 1 Hz, so this cadence is plenty
  const bm = world.biomass, sd = world.sediment, fd = world.field;
  for (let i = 0, j = 0; i < GRID_N; i++, j += 4) { c[j] = sh[i]; c[j + 1] = sd[i]; c[j + 2] = bm[i]; c[j + 3] = fd[i]; }
  st.texC.needsUpdate = true;
}
