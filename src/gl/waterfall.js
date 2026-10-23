import * as THREE from 'three';
import { SHARED } from './shared.js';

const SECTORS = 64, SEGS = 14;

// Cascade ribbons hugging the basalt skirt, one per compass sector; width/opacity follow the real rim outflow.
export function createWaterfalls(world) {
  // vertex layout: x across the ribbon (-0.5..0.5), y = v along the fall (0..1), z unused; aSector per vertex
  const pos = [], sec = [], idx = [];
  for (let s = 0; s < SECTORS; s++) {
    const base = pos.length / 3;
    for (let j = 0; j <= SEGS; j++) for (let i = 0; i < 2; i++) { pos.push(i - 0.5, j / SEGS, 0); sec.push(s); }
    for (let j = 0; j < SEGS; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSector', new THREE.Float32BufferAttribute(sec, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -3, 0), 14);

  const flow = new Float32Array(SECTORS);
  const uFlow = { value: flow };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFlow, uTime: SHARED.uTime, uNight: SHARED.uNight, uSunColor: SHARED.uSunColor, uSkyHor: SHARED.uSkyHor },
    vertexShader: /* glsl */`
      uniform float uFlow[${SECTORS}];
      attribute float aSector;
      varying vec2 vUv;
      varying float vFlow;
      void main() {
        int k = int(aSector + 0.5);
        float fl = uFlow[k];
        float ang = (aSector + 0.5) / ${SECTORS}.0 * 6.2831853;
        float v = position.y;
        float tt = mix(-0.08, 0.5, v);            // negative: the lip, from the land edge down to the skirt top
        float y, rad;
        if (tt < 0.0) { float u = -tt / 0.08; y = -0.6 + 0.85 * u; rad = 9.2 - 0.5 * u * u; }
        else { y = -0.6 - 8.9 * pow(tt, 0.92); rad = 9.2 * pow(1.0 - tt, 0.78) * 1.012 + 0.04; }
        float width = 0.95 * (0.3 + 0.7 * fl) * (1.0 - 0.35 * v);
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 tang = vec2(-dir.y, dir.x);
        vec3 p = vec3(dir * rad + tang * position.x * width, y);
        p = vec3(p.x, y, p.y);
        vUv = vec2(position.x + 0.5, v);
        vFlow = fl;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      varying float vFlow;
      uniform float uTime;
      uniform float uNight;
      uniform vec3 uSunColor;
      uniform vec3 uSkyHor;
      float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
      void main() {
        if (vFlow < 0.03) discard;
        float streak = vn(vec2(vUv.x * 11.0, vUv.y * 4.0 - uTime * 2.6)) * 0.6 + vn(vec2(vUv.x * 27.0 + 3.0, vUv.y * 9.0 - uTime * 4.1)) * 0.4;
        float edge = 1.0 - pow(abs(vUv.x * 2.0 - 1.0), 2.5);
        float fade = 1.0 - smoothstep(0.6, 1.0, vUv.y);
        float a = vFlow * (0.3 + 0.7 * smoothstep(0.25, 0.85, streak)) * edge * fade;
        if (a < 0.02) discard;
        vec3 water = mix(vec3(0.42, 0.72, 0.9), vec3(0.96, 0.98, 1.0), smoothstep(0.35, 0.9, streak));
        float day = 1.0 - 0.55 * uNight;
        vec3 lit = water * (0.55 + 0.45 * normalize(uSunColor + 0.001)) * day + uSkyHor * 0.08;
        gl_FragColor = vec4(lit, a * 0.9);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;

  // which compass sector each rim cell belongs to
  const cellSector = new Uint8Array(world.rimCells.length);
  for (let k = 0; k < world.rimCells.length; k++) {
    const c = world.rimCells[k];
    const x = (c % 128 + 0.5) / 128 * 20 - 10, z = (((c / 128) | 0) + 0.5) / 128 * 20 - 10;
    let a = Math.atan2(z, x); if (a < 0) a += Math.PI * 2;
    cellSector[k] = Math.min(SECTORS - 1, Math.floor(a / (Math.PI * 2) * SECTORS));
  }
  const sums = new Float32Array(SECTORS);
  let first = true;

  mesh.userData.update = function update(w, dt) {
    sums.fill(0);
    const rim = w.rimCells, out = w.rimOut;
    for (let k = 0; k < rim.length; k++) sums[cellSector[k]] += out[rim[k]];
    // the first update starts at full flow: easing in from 0 made frame 1 depend on how long it took (the smoke
    // check counts programs at frame 1 and missed the waterfall's when that frame was quick)
    const a = first ? 1 : 1 - Math.exp(-dt / 0.6);
    first = false;
    let any = 0;
    for (let s = 0; s < SECTORS; s++) {
      const target = Math.pow(Math.min(1, sums[s] / 0.006), 0.6);       // 0.006 ~ the strongest sector's mean outflow per substep
      flow[s] += (target - flow[s]) * a;
      if (flow[s] > 0.03) any++;
    }
    mesh.visible = any > 0;
  };
  mesh.userData.flow = flow;
  return mesh;
}
