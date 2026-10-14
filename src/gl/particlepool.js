import * as THREE from 'three';
import { SHARED } from './shared.js';
import { GLSL_PART_VERT, GLSL_PART_FRAG } from './glsl_civ.js';
import { PARTICLE_CAP } from '../sim/particles.js';

// Unified particle pool (spec 4.2 Pool 4): octahedra stretched along velocity per subtype in the vertex shader.
export function createParticlePool() {
  const n = PARTICLE_CAP;
  const geo = new THREE.OctahedronGeometry(1, 0);
  const state = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const vel = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  state.setUsage(THREE.DynamicDrawUsage); vel.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aInstanceState', state);
  geo.setAttribute('aVel', vel);
  const mat = new THREE.ShaderMaterial({
    vertexShader: GLSL_PART_VERT,
    fragmentShader: GLSL_PART_FRAG,
    uniforms: { uTime: SHARED.uTime },
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const ma = mesh.instanceMatrix.array;
  for (let i = 0; i < n; i++) { ma[i * 16] = 1; ma[i * 16 + 5] = 1; ma[i * 16 + 10] = 1; ma[i * 16 + 15] = 1; }
  const sa = state.array, va = vel.array;

  mesh.userData.update = function update(p) {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (!p.alive[i]) { sa[o + 2] = 0; continue; }
      ma[i * 16 + 12] = p.x[i]; ma[i * 16 + 13] = p.y[i]; ma[i * 16 + 14] = p.z[i];
      sa[o] = p.type[i]; sa[o + 1] = p.life[i] / p.maxLife[i]; sa[o + 2] = p.size[i]; sa[o + 3] = p.aux[i];
      va[o] = p.vx[i]; va[o + 1] = p.vy[i]; va[o + 2] = p.vz[i]; va[o + 3] = p.spin[i];
    }
    mesh.instanceMatrix.needsUpdate = true;
    state.needsUpdate = true; vel.needsUpdate = true;
  };
  return mesh;
}
