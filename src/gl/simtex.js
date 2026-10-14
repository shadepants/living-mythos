import * as THREE from 'three';
import { GRID_W, GRID_H, GRID_N } from '../sim/grid.js';

// Two RGBA float DataTextures bridging CPU sim state to shaders (spec 3.3/4.1).
export function createSimTextures(floatLinear) {
  const bufA = new Float32Array(GRID_N * 4);
  const bufB = new Float32Array(GRID_N * 4);
  const filter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
  const make = (buf) => {
    const t = new THREE.DataTexture(buf, GRID_W, GRID_H, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = filter; t.minFilter = filter;
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return { bufA, bufB, texA: make(bufA), texB: make(bufB) };
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
