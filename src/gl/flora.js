import * as THREE from 'three';
import { SHARED } from './shared.js';
import {
  GLSL_FLORA_VERT_PARS, GLSL_FLORA_VERT_NORMAL, GLSL_FLORA_VERT_POS, GLSL_FLORA_FRAG_COLOR, GLSL_FLORA_FRAG_EMISSIVE, GLSL_FLORA_SHADE,
} from './glsl_flora.js';
import { hash2 } from '../sim/noise.js';

export const FLORA_MAX = 3500;

// Low-poly tuft: 6 tapered blades, plus a short stem and faceted canopy that only "tree" archetypes show.
// aPart = (part id, yNorm): part 0 blade, 0.5 stem, 1 canopy.
export function createFloraGeometry() {
  const pos = [], part = [];
  const tri = (a, b, c, pa, pb, pc) => { pos.push(...a, ...b, ...c); part.push(...pa, ...pb, ...pc); };
  for (let b = 0; b < 6; b++) {
    const ang = (b / 6) * Math.PI * 2 + hash2(b, 1, 3) * 0.6;
    const h = 0.42 + hash2(b, 2, 3) * 0.34;
    const lean = 0.07 + hash2(b, 3, 3) * 0.07;
    const ca = Math.cos(ang), sa = Math.sin(ang), px = -sa, pz = ca;
    const r0 = 0.05, w0 = 0.045;
    const pt = (r, y, w, side) => [ca * r + px * w * side, y, sa * r + pz * w * side];
    const b0l = pt(r0, 0, w0, -1), b0r = pt(r0, 0, w0, 1);
    const m_l = pt(r0 + lean * 0.4, h * 0.5, w0 * 0.65, -1), m_r = pt(r0 + lean * 0.4, h * 0.5, w0 * 0.65, 1);
    const tip = pt(r0 + lean, h, 0, 0);
    tri(b0l, b0r, m_l, [0, 0], [0, 0], [0, 0.5]);
    tri(b0r, m_r, m_l, [0, 0], [0, 0.5], [0, 0.5]);
    tri(m_l, m_r, tip, [0, 0.5], [0, 0.5], [0, 1]);
  }
  // stem: 3-sided prism
  for (let k = 0; k < 3; k++) {
    const a0 = (k / 3) * Math.PI * 2, a1 = ((k + 1) / 3) * Math.PI * 2, r = 0.026, hs = 0.42;
    const p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
    const q0 = [Math.cos(a0) * r * 0.7, hs, Math.sin(a0) * r * 0.7], q1 = [Math.cos(a1) * r * 0.7, hs, Math.sin(a1) * r * 0.7];
    tri(p0, p1, q0, [0.5, 0], [0.5, 0], [0.5, 0.7]);
    tri(p1, q1, q0, [0.5, 0], [0.5, 0.7], [0.5, 0.7]);
  }
  // canopy: squashed octahedron-ish crown
  const cy = 0.6, rx = 0.27, ry = 0.25;   // fuller crown over a shorter trunk (Phase 1b; was 0.62 / 0.2 / 0.17)
  const top = [0, cy + ry, 0], bot = [0, cy - ry * 0.7, 0];
  const ring = [];
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; ring.push([Math.cos(a) * rx, cy + 0.02, Math.sin(a) * rx]); }
  for (let k = 0; k < 6; k++) {
    const a = ring[k], b = ring[(k + 1) % 6];
    tri(a, b, top, [1, 0.78], [1, 0.78], [1, 1]);
    tri(b, a, bot, [1, 0.78], [1, 0.78], [1, 0.72]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 2));
  g.computeVertexNormals();
  return g;
}

export function createFlora(caps, count) {
  const n = Math.min(count, FLORA_MAX);
  const geo = createFloraGeometry();
  const state = new THREE.InstancedBufferAttribute(new Float32Array(FLORA_MAX * 4), 4);
  geo.setAttribute('aInstanceState', state);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  if (!caps.floatLinear) mat.defines = { MANUAL_BILINEAR: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSimTexA = SHARED.uSimTexA; shader.uniforms.uSimTexB = SHARED.uSimTexB;
    shader.uniforms.uTime = SHARED.uTime; shader.uniforms.uCell = SHARED.uCell;
    shader.uniforms.uWind = SHARED.uWind; shader.uniforms.uNight = SHARED.uNight;
    shader.uniforms.uSimTexC = SHARED.uSimTexC; shader.uniforms.uCloud = SHARED.uCloud; shader.uniforms.uBreeze = SHARED.uBreeze;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_FLORA_VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', GLSL_FLORA_VERT_NORMAL)
      .replace('#include <begin_vertex>', GLSL_FLORA_VERT_POS);
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'void main() {');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloraCol;\nvarying vec3 vGlow;\nvarying float vShade;')
      .replace('#include <color_fragment>', GLSL_FLORA_FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', GLSL_FLORA_FRAG_EMISSIVE)
      .replace('#include <lights_fragment_end>', GLSL_FLORA_SHADE);
  };

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  // Jittered-grid placement over the island interior (deterministic), then shuffled so that lowering
  // mesh.count (quality tiers) thins the flora evenly instead of eating whole rows.
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const G = 80, step = 20 / G;
  const cand = [];
  for (let gz = 0; gz < G; gz++) {
    for (let gx = 0; gx < G; gx++) {
      const x = -10 + (gx + 0.15 + 0.7 * hash2(gx, gz, 41)) * step;
      const z = -10 + (gz + 0.15 + 0.7 * hash2(gx, gz, 43)) * step;
      if (Math.hypot(x, z) > 8.3) continue;
      cand.push([x, z, gx, gz]);
    }
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(hash2(i, 7, 61) * (i + 1)); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
  let k = 0;
  for (; k < cand.length && k < n; k++) {
    const [x, z, gx, gz] = cand[k];
    q.setFromAxisAngle(up, hash2(gx, gz, 47) * Math.PI * 2);
    p.set(x, 0, z);
    m.compose(p, q, sc);
    mesh.setMatrixAt(k, m);
    const o = k * 4;
    state.array[o] = hash2(gx, gz, 53);                  // archetype 0..1 (with biomass, decides which tufts are trees)
    state.array[o + 1] = 0.75 + 0.5 * hash2(gx, gz, 59); // growth stage
    state.array[o + 2] = 0;                              // decay
    state.array[o + 3] = 0;                              // luminescence
  }
  mesh.count = k;
  mesh.userData.full = k;
  mesh.instanceMatrix.needsUpdate = true;
  state.needsUpdate = true;
  mesh.userData.state = state;
  return mesh;
}
