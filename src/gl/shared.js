import * as THREE from 'three';

// Uniforms shared by every material so atmosphere/sim changes propagate in one write.
export const SHARED = {
  uSimTexA: { value: null },
  uSimTexB: { value: null },
  uTime: { value: 0 },
  uCell: { value: 20 / 128 },
  uSunDir: { value: new THREE.Vector3(-0.55, 0.42, 0.7).normalize() },
  uSunColor: { value: new THREE.Color(1.0, 0.72, 0.46) },
  uSkyTop: { value: new THREE.Color(0.32, 0.30, 0.62) },
  uSkyHor: { value: new THREE.Color(1.0, 0.70, 0.45) },
  uFogColor: { value: new THREE.Color(0.80, 0.55, 0.45) },
  uFogDensity: { value: 0.012 },
  uAtmo: { value: 0 },
  uWet: { value: 0 },
  uWind: { value: 0.35 },
  uRain: { value: 0 },
  uNight: { value: 0 },
  uAurora: { value: 0 },
  uCloud: { value: new THREE.Vector4(0, 0, 3, 0) },    // x, z, radius, strength (raincloud tool)
  uBreeze: { value: new THREE.Vector4(0, 0, 2.5, 0) }, // x, z, radius, strength (breeze tool)
};
