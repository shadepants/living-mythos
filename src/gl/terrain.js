import * as THREE from 'three';
import { SHARED } from './shared.js';
import {
  GLSL_SIM, GLSL_TERRAIN_HEIGHT, GLSL_ISLAND_VERT_NORMAL, GLSL_ISLAND_VERT_POS,
  GLSL_ISLAND_FRAG_COLOR, GLSL_ISLAND_FRAG_ROUGH, GLSL_ISLAND_FRAG_EMISSIVE, GLSL_WATER_VERT, GLSL_WATER_FRAG,
} from './glsl.js';
import { GRID_W, GRID_H, CELL_SIZE } from '../sim/grid.js';
import { hash2 } from '../sim/noise.js';

// 128x128 vertices at cell centres, flat at y=0; the shader displaces them from the sim textures.
export function createGridGeometry() {
  const n = GRID_W * GRID_H;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let z = 0; z < GRID_H; z++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = z * GRID_W + x;
      pos[i * 3] = -10 + (x + 0.5) * CELL_SIZE;
      pos[i * 3 + 2] = -10 + (z + 0.5) * CELL_SIZE;
      nor[i * 3 + 1] = 1;
    }
  }
  const idx = new Uint32Array((GRID_W - 1) * (GRID_H - 1) * 6);
  let k = 0;
  for (let z = 0; z < GRID_H - 1; z++) {
    for (let x = 0; x < GRID_W - 1; x++) {
      const i = z * GRID_W + x;
      idx[k++] = i; idx[k++] = i + GRID_W; idx[k++] = i + 1;
      idx[k++] = i + 1; idx[k++] = i + GRID_W; idx[k++] = i + GRID_W + 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 20);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-10, -1, -10), new THREE.Vector3(10, 3, 10));
  return g;
}

function addSimUniforms(shader) {
  shader.uniforms.uSimTexA = SHARED.uSimTexA;
  shader.uniforms.uSimTexB = SHARED.uSimTexB;
  shader.uniforms.uTime = SHARED.uTime;
  shader.uniforms.uCell = SHARED.uCell;
  shader.uniforms.uWet = SHARED.uWet;
  shader.uniforms.uRingA = SHARED.uRingA;
  shader.uniforms.uRingB = SHARED.uRingB;
}

export function createIslandTop(grid, caps) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.0 });
  if (!caps.floatLinear) mat.defines = { MANUAL_BILINEAR: '' };
  mat.onBeforeCompile = (shader) => {
    addSimUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\nvarying vec2 vSimUv;\n${GLSL_SIM}\n${GLSL_TERRAIN_HEIGHT}`)
      .replace('#include <beginnormal_vertex>', GLSL_ISLAND_VERT_NORMAL)
      .replace('#include <begin_vertex>', GLSL_ISLAND_VERT_POS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\nvarying vec2 vSimUv;\nuniform float uWet;\nuniform vec4 uRingA[8];\nuniform vec4 uRingB[8];\n${GLSL_SIM}`)
      .replace('#include <color_fragment>', GLSL_ISLAND_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', GLSL_ISLAND_FRAG_ROUGH)
      .replace('#include <emissivemap_fragment>', GLSL_ISLAND_FRAG_EMISSIVE);
  };
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  if (!caps.floatLinear) depth.defines = { MANUAL_BILINEAR: '' };
  depth.onBeforeCompile = (shader) => {
    addSimUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_SIM}\n${GLSL_TERRAIN_HEIGHT}`)
      .replace('#include <begin_vertex>', 'vec2 sPxz; float sElev = terrainHeight(position.xz, sPxz);\nvec3 transformed = vec3(sPxz.x, sElev, sPxz.y);');
  };
  const mesh = new THREE.Mesh(grid, mat);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function createWaterSurface(grid, caps) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: GLSL_WATER_VERT,
    fragmentShader: GLSL_WATER_FRAG,
    uniforms: {
      uSimTexA: SHARED.uSimTexA, uSimTexB: SHARED.uSimTexB, uTime: SHARED.uTime, uCell: SHARED.uCell,
      uSunDir: SHARED.uSunDir, uSunColor: SHARED.uSunColor, uSkyTop: SHARED.uSkyTop, uSkyHor: SHARED.uSkyHor,
      uFogColor: SHARED.uFogColor, uFogDensity: SHARED.uFogDensity, uRain: SHARED.uRain,
    },
    transparent: true, depthWrite: false,
    defines: caps.floatLinear ? {} : { MANUAL_BILINEAR: '' },
  });
  const mesh = new THREE.Mesh(grid, mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}

// Faceted basalt column skirt tapering to a tip at y = -9.5 (spec 4.1). Flat shaded, vertex coloured.
export function createBasaltSkirt() {
  const COLS = 56, ROWS = 18, TOP_Y = -0.6, TIP_Y = -9.5, R0 = 9.2;
  const ring = (c, r) => {
    const t = r / ROWS;
    const a = (c % COLS) / COLS * Math.PI * 2;
    const col = hash2(c % COLS, 7, 11);
    const ledge = hash2(c % COLS, r, 23);
    const bulge = Math.sin(Math.min(1, t * 1.6) * Math.PI) ;
    let rad = R0 * Math.pow(1 - t, 0.78);
    if (r > 0) rad *= 1 + (col - 0.5) * 0.22 * bulge + (ledge - 0.5) * 0.06;
    const y = TOP_Y + (TIP_Y - TOP_Y) * Math.pow(t, 0.92);
    return [Math.cos(a) * rad, y, Math.sin(a) * rad, col, t];
  };
  const tris = [];
  const cols = [];
  const color = new THREE.Color();
  const push = (p, shade) => {
    tris.push(p[0], p[1], p[2]);
    const t = p[4];
    const lip = 1 - Math.min(1, t * 14);
    const moss = hash2(Math.floor(p[3] * 977), Math.floor(t * 40), 5) > 0.82 ? 0.05 : 0;
    const base = 0.17 + shade * 0.12 + t * 0.02;
    color.setRGB(base + lip * 0.38 + moss * 0.2, base * 0.95 + lip * 0.22 + moss * 1.4, base * 1.1 + lip * 0.08, THREE.SRGBColorSpace);
    cols.push(color.r, color.g, color.b);
  };
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p00 = ring(c, r), p10 = ring(c + 1, r), p01 = ring(c, r + 1), p11 = ring(c + 1, r + 1);
      const sh = hash2(c, r, 31);
      push(p00, sh); push(p10, sh); push(p01, sh);
      if (r < ROWS - 1) { push(p10, sh); push(p11, sh); push(p01, sh); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0.0 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
