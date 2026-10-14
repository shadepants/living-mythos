import * as THREE from 'three';

// Offscreen scene target (spec 4.4). Falls back to 8-bit color if half-float is unavailable.
export function createSceneTarget(width, height, caps) {
  const opts = { depthBuffer: true };
  if (caps.halfFloatTarget) opts.type = THREE.HalfFloatType;
  if (caps.depthTexture) opts.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
  return new THREE.WebGLRenderTarget(width, height, opts);
}
