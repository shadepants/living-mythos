// Geometry sanity tests that need three but no GPU (run: node tools/test-geo.mjs).
import * as THREE from 'three';
import { createGridGeometry, createBasaltSkirt } from '../src/gl/terrain.js';
import { createAtmosphere } from '../src/gl/atmo.js';
import { SHARED } from '../src/gl/shared.js';
import { createVillagerGeometry } from '../src/gl/villagers.js';

let failed = 0;
const check = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); if (!ok) failed++; };

{
  const g = createGridGeometry();
  const p = g.attributes.position.array, ix = g.index.array;
  let up = 0, down = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const e1y = [p[b] - p[a], p[b + 2] - p[a + 2]], e2y = [p[c] - p[a], p[c + 2] - p[a + 2]];
    // cross product y component of (e1 x e2) for vectors in the xz plane: e1.z*e2.x - e1.x*e2.z
    const ny = e1y[1] * e2y[0] - e1y[0] * e2y[1];
    if (ny > 0) up++; else down++;
  }
  check('grid triangles all face +Y', down === 0 && up > 30000, `up ${up}, down ${down}`);
  const minX = Math.min(...Array.from({ length: 128 }, (_, i) => p[i * 3]));
  check('grid spans ~[-10,10] at cell centres', Math.abs(minX + 10 - 20 / 256) < 1e-5, `minX ${minX}`);
}

{
  const sk = createBasaltSkirt();
  const g = sk.geometry;
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  let out = 0, inn = 0, minY = 0, topMaxR = 0, topMinR = 99;
  for (let i = 0; i < p.length; i += 9) {
    const cx = (p[i] + p[i + 3] + p[i + 6]) / 3, cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
    const len = Math.hypot(cx, cz);
    if (len < 1e-6) continue;
    const dot = (n[i] * cx + n[i + 2] * cz) / len;
    if (dot > 0) out++; else inn++;
  }
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1] < minY) minY = p[i + 1];
    if (Math.abs(p[i + 1] + 0.6) < 1e-6) { const r = Math.hypot(p[i], p[i + 2]); topMaxR = Math.max(topMaxR, r); topMinR = Math.min(topMinR, r); }
  }
  check('skirt normals face outward', inn === 0 && out > 800, `out ${out}, in ${inn}`);
  check('skirt tip at y = -9.5', Math.abs(minY + 9.5) < 1e-4, `minY ${minY}`);
  check('skirt top ring meets island rim (r = 9.2, y = -0.6)', Math.abs(topMaxR - 9.2) < 1e-4 && Math.abs(topMinR - 9.2) < 1e-4, `r ${topMinR}..${topMaxR}`);
}

{
  const scene = { fog: { color: new THREE.Color(), density: 0 }, background: new THREE.Color() };
  const sun = new THREE.DirectionalLight(), hemi = new THREE.HemisphereLight();
  const comp = { material: { uniforms: { uExposure: { value: 1 } } } };
  const at = createAtmosphere(scene, sun, hemi, comp);
  const at_ = (v) => { at.setTarget(v); at.state = v; at.update(0.016); return { i: sun.intensity, a: SHARED.uAurora.value, r: SHARED.uRain.value, n: SHARED.uNight.value, w: SHARED.uWet.value, e: comp.material.uniforms.uExposure.value }; };
  const g = at_(0), a = at_(0.5), m = at_(1), q = at_(0.25);
  check('atmosphere: golden hour is bright with no aurora/rain', g.i > 3 && g.a === 0 && g.r === 0, JSON.stringify(g));
  check('atmosphere: aurora state is night with aurora', a.a === 1 && a.n === 1 && a.i < g.i, JSON.stringify(a));
  check('atmosphere: monsoon has rain and wet sheen', m.r === 1 && m.w === 1, JSON.stringify(m));
  check('atmosphere: 0.25 blends smoothly between golden and aurora', q.i < g.i && q.i > a.i && q.a > 0 && q.a < 1, JSON.stringify(q));
  // easing: from golden toward monsoon should move monotonically
  at.setTarget(0); at.state = 0; at.setTarget(1);
  let prev = 0, mono = true;
  for (let i = 0; i < 300; i++) { at.update(0.016); if (at.state < prev - 1e-9) mono = false; prev = at.state; }
  check('atmosphere: state eases monotonically to target', mono && prev > 0.95, `state ${prev.toFixed(3)}`);
  check('atmosphere: drift cycles all three states when unpinned', (() => {
    const at2 = createAtmosphere(scene, sun, hemi, comp);
    let sawAurora = false, sawMonsoon = false, sawGolden = false;
    for (let t = 0; t < 360 * 2 / 0.1; t++) { at2.update(0.1); if (at2.state > 0.47 && at2.state < 0.53) sawAurora = true; if (at2.state > 0.97) sawMonsoon = true; if (t > 100 && at2.state < 0.03) sawGolden = true; }
    return sawAurora && sawMonsoon && sawGolden;
  })());
}

{ // spec 6 budget: the villager mesh stays within 2x its 5c vertex count (288) with the role tools added
  const n = createVillagerGeometry().attributes.position.count;
  check('villager mesh within 2x the 5c vertex count', n > 288 && n <= 576, `${n} vertices`);
}

if (failed) { console.error(`${failed} geometry test(s) failed`); process.exit(1); }
console.log('geometry tests passed');
