import * as THREE from 'three';
import { SHARED } from './shared.js';

const PUFFS = 16;

// Billowing cluster of cloud puffs that hovers above the filtered cursor while the Raincloud tool is used.
export function createRaincloud() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6ebf3, roughness: 1, metalness: 0, transparent: true, opacity: 0.93, emissive: 0x1a1e26 });
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), mat, PUFFS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const off = new Float32Array(PUFFS * 5);
  for (let k = 0; k < PUFFS; k++) {
    const a = (k / PUFFS) * Math.PI * 2 * 2.3;
    const r = 0.15 + 0.85 * ((k * 0.61803) % 1);
    off[k * 5] = Math.cos(a) * r * 1.1;
    off[k * 5 + 1] = (((k * 0.37) % 1) - 0.4) * 0.45;
    off[k * 5 + 2] = Math.sin(a) * r * 1.1;
    off[k * 5 + 3] = 0.42 + 0.34 * ((k * 0.43) % 1);
    off[k * 5 + 4] = k * 1.7;
  }
  const m = new THREE.Matrix4();
  const slate = new THREE.Color(0x8d96a3), white = new THREE.Color(0xe6ebf3);
  mesh.userData.update = function update(t, cx, cy, cz, strength) {
    mesh.visible = strength > 0.02;
    if (!mesh.visible) return;
    mat.color.copy(white).lerp(slate, SHARED.uRain.value * 0.7);
    mat.opacity = 0.93 * Math.min(1, strength * 1.5);
    for (let k = 0; k < PUFFS; k++) {
      const o = k * 5, ph = off[o + 4];
      const s = off[o + 3] * strength * (1 + 0.13 * Math.sin(t * 1.7 + ph));
      m.makeScale(s * 1.25, s * 0.8, s * 1.25);
      m.setPosition(cx + off[o] + 0.12 * Math.sin(t * 0.6 + ph), cy + off[o + 1] + 0.05 * Math.sin(t * 1.1 + ph), cz + off[o + 2] + 0.12 * Math.cos(t * 0.5 + ph));
      mesh.setMatrixAt(k, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  mesh.visible = false;
  return mesh;
}
