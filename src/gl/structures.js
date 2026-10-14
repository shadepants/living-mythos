import * as THREE from 'three';
import { SHARED } from './shared.js';
import { GLSL_SIM, GLSL_TERRAIN_HEIGHT } from './glsl.js';
import { GLSL_STRUCT_PARS, GLSL_STRUCT_NORMAL, GLSL_STRUCT_POS, GLSL_STRUCT_FRAG_PARS, GLSL_STRUCT_FRAG_COLOR, GLSL_STRUCT_FRAG_EMISSIVE, GLSL_SHADE_FRAG } from './glsl_civ.js';
import { kitNew, kitBox, kitFrustum, kitPyramid, kitRoof, kitFinish } from './geomkit.js';
import { KIND_DWELLING, KIND_MONOLITH, KIND_BRIDGE, KIND_STEPS, KIND_PAVING, KIND_MYTH } from '../sim/civ.js';
import { TUNING } from '../sim/tuning.js';

const GLOW_N = 24;

// One parametric block mesh holding every structure archetype; shaders show the parts that belong (spec 4.2 Pool 2).
export function createStructureGeometry() {
  const b = kitNew();
  const yn = (y) => y / 1.1;
  const flat = (t) => () => t;

  // --- common plinth
  kitBox(b, 0, 0.04, 0, 0.64, 0.08, 0.64, 0, yn);

  // --- Pastoral cottage with a windmill (pid 1 wall, 2 thatch, 5 blades, 13 post)
  kitBox(b, 0, 0.21, 0, 0.44, 0.26, 0.36, 1, yn);
  kitRoof(b, 0, 0.34, 0, 0.58, 0.2, 0.46, 2, yn);
  kitBox(b, 0.12, 0.47, -0.08, 0.06, 0.12, 0.06, 1, yn);
  kitBox(b, 0.38, 0.22, 0.0, 0.05, 0.28, 0.05, 13, yn);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    kitBox(b, 0.38 + Math.cos(a) * 0.15, 0.40 + Math.sin(a) * 0.15, 0.06, Math.abs(Math.cos(a)) > 0.5 ? 0.3 : 0.05, Math.abs(Math.sin(a)) > 0.5 ? 0.3 : 0.05, 0.012, 5, yn);
  }

  // --- Industrious quarry house (pid 11 basalt blocks, 4 forge chimney, 14 aqueduct arch)
  kitBox(b, 0, 0.15, 0, 0.5, 0.14, 0.5, 11, yn);
  kitBox(b, 0, 0.29, 0, 0.38, 0.14, 0.38, 11, yn);
  kitBox(b, 0, 0.42, 0, 0.24, 0.12, 0.24, 11, yn);
  kitBox(b, 0.14, 0.62, 0.1, 0.07, 0.3, 0.07, 4, yn);
  kitBox(b, -0.34, 0.2, 0.3, 0.06, 0.24, 0.06, 14, yn);
  kitBox(b, 0.34, 0.2, 0.3, 0.06, 0.24, 0.06, 14, yn);
  kitBox(b, 0, 0.34, 0.3, 0.74, 0.06, 0.07, 14, yn);

  // --- Mystical crystal shrine (pid 3 spire, 10 lantern pylons, 15 gilded ring)
  kitPyramid(b, 0, 0.08, 0, 0.13, 0.9, 4, 3, yn, 0.4);
  kitPyramid(b, 0.17, 0.08, 0.08, 0.07, 0.45, 4, 3, yn, 0.9);
  kitPyramid(b, -0.15, 0.08, -0.1, 0.06, 0.38, 4, 3, yn, 0.1);
  for (const sx of [-1, 1]) {
    kitBox(b, sx * 0.3, 0.2, 0.28, 0.05, 0.24, 0.05, 10, yn);
    kitBox(b, sx * 0.3, 0.36, 0.28, 0.08, 0.07, 0.08, 10, yn);
  }
  kitFrustum(b, 0, 0.08, 0, 0.3, 0.28, 0.04, 10, 15, yn);

  // --- Harmonic monolith (pid 19 plinth, 8 basalt body, 18 gold bands, 17 gold cap)
  kitFrustum(b, 0, 0.0, 0, 0.22, 0.2, 0.1, 8, 19, yn);
  kitFrustum(b, 0, 0.1, 0, 0.11, 0.065, 0.95, 4, 8, yn, 0.785);
  kitFrustum(b, 0, 0.44, 0, 0.088, 0.086, 0.04, 4, 18, yn, 0.785);
  kitFrustum(b, 0, 0.74, 0, 0.076, 0.074, 0.04, 4, 18, yn, 0.785);
  kitPyramid(b, 0, 1.05, 0, 0.068, 0.17, 4, 17, yn, 0.785);

  // --- Bridge across x in [-0.5, 0.5] (pid 6 arch stone, 9 deck, 20 pillars/parapet, 22 lamp)
  const arch = (x) => 0.17 * (1 - (2 * x) * (2 * x)) + 0.02;
  const N = 8;
  for (let k = 0; k < N; k++) {
    const x0 = -0.5 + k / N, x1 = -0.5 + (k + 1) / N, xm = (x0 + x1) / 2;
    kitBox(b, xm, arch(xm) - 0.045, 0, (x1 - x0) * 1.04, 0.09, 0.3, 6, yn);
  }
  for (let k = 0; k < 10; k++) { const xm = -0.5 + (k + 0.5) / 10; kitBox(b, xm, arch(xm) + 0.01, 0, 0.1, 0.02, 0.32, 9, yn); }
  for (const sx of [-1, 1]) kitBox(b, sx * 0.5, 0.08, 0, 0.08, 0.16, 0.36, 20, yn);
  for (let k = 0; k < 8; k++) { const xm = -0.5 + (k + 0.5) / 8; for (const sz of [-1, 1]) kitBox(b, xm, arch(xm) + 0.05, sz * 0.15, 0.12, 0.05, 0.025, 20, yn); }
  for (const sx of [-1, 1]) {
    kitBox(b, sx * 0.5, 0.26, 0.19, 0.03, 0.2, 0.03, 20, yn);
    kitBox(b, sx * 0.5, 0.38, 0.19, 0.07, 0.07, 0.07, 22, yn);
  }

  // --- Switchback stairs: 6 slabs along x; aPart.y carries the slab's t (0..1) so each slab sits on the ground under it
  for (let k = 0; k < 6; k++) {
    const t = (k + 0.5) / 6;
    kitBox(b, -0.5 + t, 0.03 + k * 0.012, 0, 0.17, 0.06, 0.36, 7, flat(t));
  }

  // --- Lantern-lit cobble paving (pid 16 cobbles, 21 lantern post and lamp)
  kitBox(b, 0, 0.012, 0, 0.22, 0.025, 0.22, 16, yn);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    kitBox(b, Math.cos(a) * 0.27, 0.012, Math.sin(a) * 0.27, 0.2, 0.025, 0.2, 16, yn);
  }
  kitBox(b, 0, 0.18, 0, 0.04, 0.36, 0.04, 21, yn);
  kitBox(b, 0, 0.39, 0, 0.09, 0.09, 0.09, 21, yn);

  // --- Myth stone: carved slab facing the island centre (pid 23 slab, 24 base); the glyph is drawn in the fragment shader
  kitBox(b, 0, 0.04, 0, 0.34, 0.08, 0.18, 24, yn);
  kitBox(b, 0, 0.31, 0, 0.26, 0.46, 0.07, 23, yn);
  kitPyramid(b, 0, 0.54, 0, 0.13, 0.07, 4, 23, yn, 0.785);

  return kitFinish(b);
}

export function createStructures(caps) {
  const cap = TUNING.structureCap;
  const geo = createStructureGeometry();
  const state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  const kindAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  state.setUsage(THREE.DynamicDrawUsage); kindAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aInstanceState', state);
  geo.setAttribute('aKind', kindAttr);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  if (!caps.floatLinear) mat.defines = { MANUAL_BILINEAR: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSimTexA = SHARED.uSimTexA; shader.uniforms.uSimTexB = SHARED.uSimTexB;
    shader.uniforms.uSimTexC = SHARED.uSimTexC; shader.uniforms.uTime = SHARED.uTime; shader.uniforms.uCell = SHARED.uCell; shader.uniforms.uNight = SHARED.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_SIM}\n${GLSL_TERRAIN_HEIGHT}\n${GLSL_STRUCT_PARS}`)
      .replace('#include <beginnormal_vertex>', GLSL_STRUCT_NORMAL)
      .replace('#include <begin_vertex>', GLSL_STRUCT_POS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_SIM}\n${GLSL_STRUCT_FRAG_PARS}`)
      .replace('#include <color_fragment>', GLSL_STRUCT_FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', GLSL_STRUCT_FRAG_EMISSIVE)
      .replace('#include <lights_fragment_end>', GLSL_SHADE_FRAG);
  };

  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.count = 0;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let placed = 0, glowClock = 0;
  const gl = SHARED.uGlow.value;

  // Sync instance buffers from the sim every frame (allocation-free).
  mesh.userData.update = function update(world, dt) {
    const civ = world.civ;
    const n = civ.nS;
    mesh.count = n;
    mesh.visible = n > 0;
    for (; placed < n; placed++) {
      pv.set(civ.sX[placed], 0, civ.sZ[placed]);
      const k = civ.sKind[placed];
      // local +X is the span / descent direction for engineering; dwellings just use their stored yaw
      const theta = k === KIND_DWELLING || k === KIND_MONOLITH || k === KIND_MYTH ? civ.sRot[placed] : Math.atan2(-civ.sDirZ[placed], civ.sDirX[placed]);
      q.setFromAxisAngle(up, theta);
      m.compose(pv, q, sc);
      mesh.setMatrixAt(placed, m);
      mesh.instanceMatrix.needsUpdate = true;
    }
    const sa = state.array, ka = kindAttr.array;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      sa[o] = civ.sBias[i]; sa[o + 1] = civ.sBuild[i]; sa[o + 2] = civ.sDecay[i]; sa[o + 3] = civ.sLum[i];
      ka[o] = civ.sKind[i]; ka[o + 1] = civ.sLen[i] > 0 ? civ.sLen[i] : 1; ka[o + 2] = civ.sKind[i] === KIND_MYTH ? civ.sBias[i] : 0;
    }
    state.needsUpdate = true; kindAttr.needsUpdate = true;
    mesh.userData.dt = dt;

    // warm light pools: monoliths first, then lamps (bridges, paving), then hearths; refreshed twice a second
    glowClock += dt;
    if (glowClock > 0.5) {
      glowClock = 0;
      let g = 0;
      const mo = world.monoliths;
      for (let k = 0; k < 8 && g < GLOW_N; k++) if (mo[k * 4 + 3] !== 0) gl[g++].set(mo[k * 4], mo[k * 4 + 1], 1.5, 1.4);
      for (let i = 0; i < n && g < GLOW_N; i++) {
        const k = civ.sKind[i];
        if ((k === KIND_BRIDGE || k === KIND_PAVING) && civ.sBuild[i] >= 1) gl[g++].set(civ.sX[i], civ.sZ[i], 0.9, 0.9);
      }
      for (let i = 0; i < n && g < GLOW_N; i++) if (civ.sKind[i] === KIND_MYTH) gl[g++].set(civ.sX[i], civ.sZ[i], 0.7, 0.7 * (1 - 0.7 * civ.sDecay[i]));
      for (let i = 0; i < n && g < GLOW_N; i++) {
        if (civ.sKind[i] === KIND_DWELLING && civ.sBuild[i] >= 1 && civ.sDecay[i] < 0.5) gl[g++].set(civ.sX[i], civ.sZ[i], 0.8, 0.6 + civ.sLum[i]);
      }
      for (; g < GLOW_N; g++) gl[g].set(0, 0, 1, 0);
    }
    void KIND_STEPS;
  };
  return mesh;
}
