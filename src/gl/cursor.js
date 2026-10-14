import * as THREE from 'three';
import { SHARED } from './shared.js';
import { GLSL_CURSOR_VERT, GLSL_CURSOR_FRAG } from './glsl_fx.js';

export function createCursor(caps) {
  const geo = new THREE.PlaneGeometry(2, 2, 40, 40);
  geo.rotateX(-Math.PI / 2);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);
  const mat = new THREE.ShaderMaterial({
    vertexShader: GLSL_CURSOR_VERT,
    fragmentShader: GLSL_CURSOR_FRAG,
    uniforms: {
      uSimTexA: SHARED.uSimTexA, uSimTexB: SHARED.uSimTexB, uTime: SHARED.uTime, uCell: SHARED.uCell,
      uCursor: SHARED.uCursor, uCursorCol: SHARED.uCursorCol, uCursorA: SHARED.uCursorA,
    },
    defines: caps.floatLinear ? {} : { MANUAL_BILINEAR: '' },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}
