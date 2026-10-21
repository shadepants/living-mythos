import * as THREE from 'three';
import { SHARED } from './shared.js';
import { GLSL_VILL_PARS, GLSL_VILL_POS, GLSL_VILL_FRAG_COLOR, GLSL_VILL_FRAG_EMISSIVE, GLSL_SHADE_FRAG } from './glsl_civ.js';
import { kitNew, kitBox, kitFrustum, kitPyramid, kitFinish } from './geomkit.js';
import { sampleGrid } from '../sim/sample.js';
import { SIZE } from './scale.js';
import { ST_PROCESSION, ST_GREET, ROLE_MYSTIC } from '../sim/civ.js';
import { TUNING } from '../sim/tuning.js';

// Cloaked figurine: pid 0 cloak, 1 head, 2 hood, 3 cargo bundle, 4 lantern, 5 lantern stick.
function createVillagerGeometry() {
  const b = kitNew();
  const yn = (y) => y / 0.42;
  kitFrustum(b, 0, 0.0, 0, 0.10, 0.045, 0.26, 6, 0, yn);
  kitFrustum(b, 0, 0.26, 0, 0.048, 0.04, 0.07, 6, 1, yn);
  kitPyramid(b, 0, 0.31, 0, 0.056, 0.09, 6, 2, yn);
  kitBox(b, 0, 0.17, -0.095, 0.11, 0.12, 0.07, 3, yn);
  kitBox(b, 0.115, 0.15, 0.05, 0.012, 0.24, 0.012, 5, yn);
  kitBox(b, 0.115, 0.045, 0.05, 0.05, 0.06, 0.05, 4, yn);
  return kitFinish(b);
}

export function createVillagers(caps) {
  const n = TUNING.villagers;
  const geo = createVillagerGeometry();
  const state = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  state.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aInstanceState', state);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = SHARED.uNight;
    shader.uniforms.uSimTexC = SHARED.uSimTexC;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_VILL_PARS}`)
      .replace('#include <begin_vertex>', GLSL_VILL_POS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVCol;\nvarying vec3 vVGlow;\nvarying float vShade;')
      .replace('#include <color_fragment>', GLSL_VILL_FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', GLSL_VILL_FRAG_EMISSIVE)
      .replace('#include <lights_fragment_end>', GLSL_SHADE_FRAG);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const m = new THREE.Matrix4(), nrm = new THREE.Vector3(), nrmS = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), pos = new THREE.Vector3();
  const SCALE = SIZE.villager;
  const sa = state.array;

  // Orient along velocity, pitch into the slope, bob with the walk cycle (spec 4.2 Pool 3).
  mesh.userData.update = function update(world) {
    const civ = world.civ, elev = world.elev;
    for (let i = 0; i < n; i++) {
      const x = civ.vX[i], z = civ.vZ[i];
      const gxs = (sampleGrid(elev, x + 0.1, z) - sampleGrid(elev, x - 0.1, z)) / 0.2;
      const gzs = (sampleGrid(elev, x, z + 0.1) - sampleGrid(elev, x, z - 0.1)) / 0.2;
      const moving = civ.vVX[i] * civ.vVX[i] + civ.vVZ[i] * civ.vVZ[i] > 0.004;
      const st = civ.vState[i];
      const ph = civ.vPhase[i] * SIZE.villagerStride;
      let bob = moving ? Math.abs(Math.sin(ph)) * 0.03 * SIZE.villagerBob : 0;
      if (st === ST_GREET) bob = Math.abs(Math.sin(civ.vTimer[i] * 9)) * 0.07 * SIZE.villagerBob;
      const y = sampleGrid(elev, x, z) + bob;
      nrm.set(-gxs, 1, -gzs).normalize();
      const h = civ.vHeading[i];
      fwd.set(Math.sin(h), 0, Math.cos(h));
      fwd.addScaledVector(nrm, -fwd.dot(nrm)).normalize();
      right.crossVectors(nrm, fwd);
      nrmS.copy(nrm).multiplyScalar(SCALE);
      m.makeBasis(right.multiplyScalar(SCALE), nrmS, fwd.multiplyScalar(SCALE));
      pos.set(x, y, z);
      m.setPosition(pos);
      mesh.setMatrixAt(i, m);
      const o = i * 4;
      sa[o] = civ.vRole[i]; sa[o + 1] = civ.vCargo[i] + 2 * civ.vCargoKind[i];   // cargo 0..1 + 2 x kind (food / timber / stone) sa[o + 2] = ph;
      sa[o + 3] = st === ST_PROCESSION ? 1 : civ.vRole[i] === ROLE_MYSTIC ? 0.5 : 0;
    }
    mesh.instanceMatrix.needsUpdate = true;
    state.needsUpdate = true;
  };
  return mesh;
}
