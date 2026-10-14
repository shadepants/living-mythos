import * as THREE from 'three';
import { GLSL_COMPOSITE_VERT, GLSL_COMPOSITE_FRAG } from './glsl.js';

// Offscreen scene target (spec 4.4). Falls back to 8-bit color if half-float is unavailable.
export function createSceneTarget(width, height, caps) {
  const opts = { depthBuffer: true };
  if (caps.halfFloatTarget) opts.type = THREE.HalfFloatType;
  if (caps.depthTexture) opts.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
  return new THREE.WebGLRenderTarget(width, height, opts);
}

// Fullscreen composite: the single place ACES tone mapping and sRGB encoding happen.
export function createComposite(caps, taps) {
  const defines = { TAPS: taps };
  if (!caps.depthTexture) defines.NO_DEPTH = '';
  const material = new THREE.ShaderMaterial({
    vertexShader: GLSL_COMPOSITE_VERT,
    fragmentShader: GLSL_COMPOSITE_FRAG,
    defines,
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, uExposure: { value: 1.0 },
      uNear: { value: 0.5 }, uFar: { value: 140 }, uFocusDist: { value: 30 }, uFocusY: { value: 0.5 }, uBand: { value: 0.13 },
      uMaxBlur: { value: 6 }, uTexel: { value: new THREE.Vector2(1 / 800, 1 / 500) }, uCA: { value: 0.006 },
    },
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, camera, material };
}
