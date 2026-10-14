import * as THREE from 'three';
import { SHARED } from './shared.js';

// Three presets (spec 5.2). Colours are linear working-space values.
function makePreset(o) {
  return {
    sunDir: new THREE.Vector3(o.sunDir[0], o.sunDir[1], o.sunDir[2]).normalize(),
    sunColor: new THREE.Color(o.sunColor[0], o.sunColor[1], o.sunColor[2]),
    sunI: o.sunI,
    hemiSky: new THREE.Color(o.hemiSky[0], o.hemiSky[1], o.hemiSky[2]),
    hemiGround: new THREE.Color(o.hemiGround[0], o.hemiGround[1], o.hemiGround[2]),
    hemiI: o.hemiI,
    fog: new THREE.Color(o.fog[0], o.fog[1], o.fog[2]),
    fogD: o.fogD,
    skyTop: new THREE.Color(o.skyTop[0], o.skyTop[1], o.skyTop[2]),
    skyHor: new THREE.Color(o.skyHor[0], o.skyHor[1], o.skyHor[2]),
    exposure: o.exposure, wet: o.wet, wind: o.wind, rain: o.rain, night: o.night, aurora: o.aurora,
  };
}

const PRESETS = [
  // Golden Hour: low warm amber key, violet fill, golden horizon
  makePreset({ sunDir: [-0.55, 0.30, 0.78], sunColor: [1.0, 0.68, 0.38], sunI: 3.6, hemiSky: [0.55, 0.42, 0.85], hemiGround: [0.40, 0.26, 0.22],
    hemiI: 1.0, fog: [0.85, 0.56, 0.42], fogD: 0.010, skyTop: [0.20, 0.17, 0.52], skyHor: [1.0, 0.62, 0.34], exposure: 1.25,
    wet: 0.0, wind: 0.35, rain: 0.0, night: 0.0, aurora: 0.0 }),
  // Midnight Aurora: deep indigo, cool moon key
  makePreset({ sunDir: [0.40, 0.62, -0.45], sunColor: [0.40, 0.52, 1.0], sunI: 0.95, hemiSky: [0.08, 0.12, 0.34], hemiGround: [0.03, 0.03, 0.09],
    hemiI: 0.9, fog: [0.025, 0.035, 0.10], fogD: 0.013, skyTop: [0.005, 0.01, 0.06], skyHor: [0.03, 0.06, 0.20], exposure: 1.9,
    wet: 0.1, wind: 0.25, rain: 0.0, night: 1.0, aurora: 1.0 }),
  // Monsoon: overcast slate, wet sheen, wind
  makePreset({ sunDir: [0.20, 0.75, 0.30], sunColor: [0.58, 0.66, 0.74], sunI: 1.1, hemiSky: [0.40, 0.46, 0.52], hemiGround: [0.20, 0.22, 0.24],
    hemiI: 1.3, fog: [0.26, 0.30, 0.34], fogD: 0.026, skyTop: [0.14, 0.17, 0.21], skyHor: [0.30, 0.34, 0.38], exposure: 1.3,
    wet: 1.0, wind: 1.5, rain: 1.0, night: 0.55, aurora: 0.0 }),
];

function lerpPreset(out, a, b, t) {
  out.sunDir.lerpVectors(a.sunDir, b.sunDir, t).normalize();
  out.sunColor.lerpColors(a.sunColor, b.sunColor, t);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.fog.lerpColors(a.fog, b.fog, t);
  out.skyTop.lerpColors(a.skyTop, b.skyTop, t);
  out.skyHor.lerpColors(a.skyHor, b.skyHor, t);
  out.sunI = a.sunI + (b.sunI - a.sunI) * t;
  out.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
  out.fogD = a.fogD + (b.fogD - a.fogD) * t;
  out.exposure = a.exposure + (b.exposure - a.exposure) * t;
  out.wet = a.wet + (b.wet - a.wet) * t;
  out.wind = a.wind + (b.wind - a.wind) * t;
  out.rain = a.rain + (b.rain - a.rain) * t;
  out.night = a.night + (b.night - a.night) * t;
  out.aurora = a.aurora + (b.aurora - a.aurora) * t;
}

// Live atmosphere: `state` eases toward `target`; every frame the blended preset is pushed to lights, fog and shared uniforms.
export function createAtmosphere(scene, sun, hemi, composite) {
  const cur = makePreset({ sunDir: [0, 1, 0], sunColor: [1, 1, 1], sunI: 1, hemiSky: [1, 1, 1], hemiGround: [1, 1, 1], hemiI: 1, fog: [1, 1, 1],
    fogD: 0.01, skyTop: [1, 1, 1], skyHor: [1, 1, 1], exposure: 1, wet: 0, wind: 0, rain: 0, night: 0, aurora: 0 });
  const atmo = {
    state: 0, target: 0, pinned: false, drift: true, driftClock: 0, cur,
    setTarget(v) { atmo.target = v < 0 ? 0 : v > 1 ? 1 : v; atmo.pinned = true; atmo.driftClock = 0; },
  };

  atmo.update = function update(dt) {
    // Drift: slowly walk Golden -> Aurora -> Monsoon -> Golden unless the player pinned a state (spec 1.3).
    if (atmo.drift && !atmo.pinned) {
      atmo.driftClock += dt;
      const cycle = atmo.driftClock / 360;               // ~6 minute loop
      const ph = cycle - Math.floor(cycle);
      // 0..1/3 golden hold -> aurora, 1/3..2/3 aurora hold -> monsoon, 2/3..1 monsoon hold -> golden
      const seg = ph * 3, k = seg - Math.floor(seg), idx = Math.floor(seg);
      const ease = k < 0.7 ? 0 : (k - 0.7) / 0.3;
      const s = ease * ease * (3 - 2 * ease);
      atmo.target = idx === 0 ? 0.5 * s : idx === 1 ? 0.5 + 0.5 * s : 1 - s;
    }
    const a = 1 - Math.exp(-dt / 1.1);
    atmo.state += (atmo.target - atmo.state) * a;
    const st = atmo.state;
    if (st <= 0.5) lerpPreset(cur, PRESETS[0], PRESETS[1], st * 2);
    else lerpPreset(cur, PRESETS[1], PRESETS[2], (st - 0.5) * 2);

    SHARED.uAtmo.value = st;
    SHARED.uSunDir.value.copy(cur.sunDir);
    SHARED.uSunColor.value.copy(cur.sunColor).multiplyScalar(cur.sunI / 3.6);
    SHARED.uSkyTop.value.copy(cur.skyTop);
    SHARED.uSkyHor.value.copy(cur.skyHor);
    SHARED.uFogColor.value.copy(cur.fog);
    SHARED.uFogDensity.value = cur.fogD;
    SHARED.uWet.value = cur.wet; SHARED.uWind.value = cur.wind; SHARED.uRain.value = cur.rain;
    SHARED.uNight.value = cur.night; SHARED.uAurora.value = cur.aurora;

    sun.color.copy(cur.sunColor);
    sun.intensity = cur.sunI;
    sun.position.copy(cur.sunDir).multiplyScalar(30);
    hemi.color.copy(cur.hemiSky);
    hemi.groundColor.copy(cur.hemiGround);
    hemi.intensity = cur.hemiI;
    scene.fog.color.copy(cur.fog);
    scene.fog.density = cur.fogD;
    scene.background.copy(cur.skyHor);
    composite.material.uniforms.uExposure.value = cur.exposure;
  };
  return atmo;
}
