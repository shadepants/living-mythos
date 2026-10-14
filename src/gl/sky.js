import * as THREE from 'three';
import { SHARED } from './shared.js';
import { GLSL_SKY_VERT, GLSL_SKY_FRAG } from './glsl_sky.js';

// Inside-out dome pinned to the far plane. Carries the aurora, stars, moon/sun and monsoon cloud deck.
export function createSkyDome() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: GLSL_SKY_VERT,
    fragmentShader: GLSL_SKY_FRAG,
    uniforms: {
      uTime: SHARED.uTime, uSunDir: SHARED.uSunDir, uSunColor: SHARED.uSunColor, uSkyTop: SHARED.uSkyTop,
      uSkyHor: SHARED.uSkyHor, uFogColor: SHARED.uFogColor, uAurora: SHARED.uAurora, uRain: SHARED.uRain, uNight: SHARED.uNight,
    },
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
