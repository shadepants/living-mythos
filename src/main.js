import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { detectCaps } from './gl/caps.js';
import { createSceneTarget, createComposite } from './gl/post.js';
import { SHARED } from './gl/shared.js';
import { createSimTextures, packSimTextures, packShadeTexture } from './gl/simtex.js';
import { createCursor } from './gl/cursor.js';
import { createRaincloud } from './gl/cloud.js';
import { createRingFx } from './gl/fxbridge.js';
import { createDock, createMuteButton, createPhotoButton, TOOL_HINTS } from './ui/dock.js';
import { createDebugOverlay } from './ui/debug.js';
import { createReporter } from './ui/report.js';
import { QUALITY, TIER_NAMES, pickInitialTier, createGovernor, governorSample } from './gl/quality.js';
import { createAudioEngine } from './audio/engine.js';
import { createDirector, directorStep } from './audio/director.js';
import { createController } from './input/controller.js';
import { createStructures } from './gl/structures.js';
import { createVillagers } from './gl/villagers.js';
import { createParticlePool } from './gl/particlepool.js';
import { createFlora } from './gl/flora.js';
import { createSkyDome } from './gl/sky.js';
import { createAtmosphere } from './gl/atmo.js';
import { createGridGeometry, createIslandTop, createWaterSurface, createBasaltSkirt } from './gl/terrain.js';
import { createWorld } from './sim/world.js';
import { simStep } from './sim/sim.js';
import { prewarm } from './sim/prewarm.js';
import { seedCivilization } from './sim/civ.js';
import { loadFromStorage, saveToStorage, SAVE_KEY } from './sim/persist.js';
import { createShade, stepShade, computeShadeRows } from './sim/shade.js';
import { createParticles, stepParticles, breezeLanterns } from './sim/particles.js';
import { sampleGrid, visualHeight } from './sim/sample.js';
import { TUNING } from './sim/tuning.js';

const canvas = document.getElementById('stage');
const fallback = document.getElementById('fallback');
const query = new URLSearchParams(location.search);
const DEBUG = query.has('debug');
const NORENDER = DEBUG && query.has('norender');   // test aid: run the whole loop but skip the GL draw

function fail(msg) {
  fallback.textContent = msg;
  fallback.hidden = false;
  canvas.hidden = true;
}

function boot() {
  if (typeof WebGL2RenderingContext === 'undefined') {
    fail('Living Mythos needs WebGL2, which this browser does not provide.');
    return;
  }
  // Simulation first: the pre-warm blocks for a moment, and the GL context should not sit idle behind it.
  const seed = query.has('seed') ? parseInt(query.get('seed'), 10) : TUNING.seedDefault;
  const world = createWorld(seed);
  let storage = null;
  try { storage = window.localStorage; if (query.has('fresh')) storage.removeItem(SAVE_KEY); } catch (e) { storage = null; }
  // restore a saved island if there is a valid one for this seed; otherwise pre-warm and found a settlement
  const restored = storage ? loadFromStorage(storage, world) : { ok: false };
  if (!restored.ok) { prewarm(world); seedCivilization(world); }
  const particles = createParticles();
  particles.cursor.i = world.events.head;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (e) {
    fail('Could not start WebGL2 on this device.');
    return;
  }
  renderer.getContext().getExtension('OES_texture_float_linear');
  const lossLog = { lost: 0, restored: 0, lostAt: -1 };
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lossLog.lost++; if (lossLog.lostAt < 0) lossLog.lostAt = performance.now() / 1000; }, false);
  canvas.addEventListener('webglcontextrestored', () => { lossLog.restored++; }, false);
  const caps = detectCaps(renderer);

  renderer.shadowMap.enabled = !query.has('noshadow');
  renderer.shadowMap.type = THREE.PCFShadowMap;
  if (query.get('shadowtype') === 'basic') renderer.shadowMap.type = THREE.BasicShadowMap;   // diagnostic switch
  renderer.toneMapping = THREE.NoToneMapping;

  const simTex = createSimTextures(caps.floatLinear);
  SHARED.uSimTexA.value = simTex.texA;
  SHARED.uSimTexB.value = simTex.texB;
  SHARED.uSimTexC.value = simTex.texC;
  const shadeState = createShade();
  computeShadeRows(world, SHARED.uSunDir.value.x, SHARED.uSunDir.value.y, SHARED.uSunDir.value.z, 0, 128);
  packShadeTexture(world, simTex);
  packSimTextures(world, simTex);

  // --- scene ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6a5a78);
  scene.fog = new THREE.FogExp2(0xcc8c73, SHARED.uFogDensity.value);
  const atmoQuery = query.get('atmo');

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 140);
  camera.position.set(0, 8.5, 28);

  const hemi = new THREE.HemisphereLight(0x8f86c8, 0x5a4236, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb878, 3.2);
  sun.position.copy(SHARED.uSunDir.value).multiplyScalar(30);
  const REALSHADOW = query.has('realshadow');   // GPU shadow maps lost the WebGL context on the phone GPU; heightfield shading is the default
  sun.castShadow = REALSHADOW;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -13; sc.right = 13; sc.top = 13; sc.bottom = -13; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const grid = createGridGeometry();
  scene.add(createSkyDome());
  const islandTop = createIslandTop(grid, caps);
  if (query.has('nocustomdepth')) islandTop.customDepthMaterial = null;
  scene.add(islandTop);
  scene.add(createBasaltSkirt());
  scene.add(createWaterSurface(grid, caps));
  const flora = createFlora(caps, 3500);
  scene.add(flora);
  const structures = createStructures(caps);
  scene.add(structures);
  const villagers = createVillagers(caps);
  scene.add(villagers);
  const particlePool = createParticlePool();
  scene.add(particlePool);
  scene.add(createCursor(caps));
  const cloudFx = createRaincloud();
  scene.add(cloudFx);
  const ringFx = createRingFx(world);

  if (!REALSHADOW) scene.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 9;
  controls.maxDistance = 58;
  controls.maxPolarAngle = 1.38;
  controls.update();
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  // --- input + dock ---
  const dock = createDock(document.getElementById('ui'), {
    onTool: (i) => { ctl.setTool(i); },
    onAtmo: (v) => { atmo.setTarget(v); syncAtmoUi(); if (v === 0.5) dock.showHint('Orbit the camera low to see the aurora and the stars', 5000); },
    onDrift: () => { atmo.pinned = false; atmo.drift = true; syncAtmoUi(); },
  });
  const ctl = createController({
    canvas, camera, controls, world, cloud: cloudFx,
    onChange: (i) => { dock.setTool(i); dock.showHint(TOOL_HINTS[i]); },
  });
  // --- audio: created lazily on the first gesture (autoplay policy) ---
  const audio = createAudioEngine(() => new (window.AudioContext || window.webkitAudioContext)());
  const director = createDirector(world);
  const muteUi = createMuteButton(document.getElementById('ui'), (m) => audio.setMuted(m));
  const gesture = () => { if (!audio.ensure() && audio.ctx === null && !audio.failed) { audio.failed = true; } };
  window.addEventListener('pointerdown', gesture, { capture: true });
  window.addEventListener('keydown', gesture, { capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspend(); else audio.resume(); });
  const aState = { atmo: 0, bias: 0, wind: 0, windSpeed: 0, flux: 0, sculpt: 0, night: 0, aurora: 0 };
  const aPv = new THREE.Vector3(), aCam = new THREE.Vector3(), aTgt = new THREE.Vector3();
  const spatial = (x, z, out) => {
    aPv.set(x, visualHeight(world.elev, x, z), z).project(camera);
    out.pan = Math.max(-1, Math.min(1, aPv.x * 0.8));
    aTgt.copy(controls.target);
    const d = Math.hypot(x - aTgt.x, z - aTgt.z);
    out.gain = (1 / (1 + d / 14)) * (Math.abs(aPv.x) > 1.2 || Math.abs(aPv.y) > 1.2 ? 0.4 : 1);
  };
  function syncAtmoUi() { dock.setAtmo(atmo.pinned ? (atmo.target < 0.25 ? 0 : atmo.target < 0.75 ? 1 : 2) : -1, !atmo.pinned && atmo.drift); }

  // --- post ---
  const post = createComposite(caps, 12);
  const atmo = createAtmosphere(scene, sun, hemi, post);
  if (restored.ok && restored.extra && restored.extra.atmo) {
    const ea = restored.extra.atmo;
    atmo.state = +ea.state || 0; atmo.target = +ea.target || 0; atmo.pinned = !!ea.pinned; atmo.drift = ea.drift !== false; atmo.driftClock = +ea.driftClock || 0;
  }
  if (atmoQuery !== null) { atmo.setTarget(parseFloat(atmoQuery)); atmo.state = atmo.target; }
  let sceneTarget = null;
  let pr = 1.5;
  let maxSubsteps = 2;
  const gov = createGovernor(pickInitialTier({
    coarse: window.matchMedia && window.matchMedia('(pointer: coarse)').matches,
    mem: navigator.deviceMemory, cores: navigator.hardwareConcurrency, override: query.get('q'),
  }));
  const dprNow = () => window.devicePixelRatio || 1;

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Portrait phones: widen the vertical FOV so the whole island still fits across the narrow screen.
    const a = camera.aspect;
    camera.fov = a >= 1.2 ? 32 : 32 + (1.2 - Math.max(a, 0.45)) / 0.75 * 26;
    camera.updateProjectionMatrix();
    if (sceneTarget) sceneTarget.dispose();
    sceneTarget = createSceneTarget(Math.floor(w * pr), Math.floor(h * pr), caps);
    post.material.uniforms.tColor.value = sceneTarget.texture;
    post.material.uniforms.tDepth.value = sceneTarget.depthTexture;
    post.material.uniforms.uTexel.value.set(1 / sceneTarget.width, 1 / sceneTarget.height);
    post.material.uniforms.uMaxBlur.value = 6.0 * (sceneTarget.height / 900);
  }
  // Apply a quality tier (spec 2.3): pixel ratio, bokeh taps, shadow map, flora count, sim substeps per frame.
  function applyTier(i) {
    const q = QUALITY[TIER_NAMES[i]];
    pr = query.has('pr') ? parseFloat(query.get('pr')) : Math.min(dprNow(), q.pr);
    maxSubsteps = q.substeps;
    if (post.material.defines.TAPS !== q.taps) { post.material.defines.TAPS = q.taps; post.material.needsUpdate = true; }
    const shadowN = query.has('shadowsize') ? parseInt(query.get('shadowsize'), 10) : q.shadow;
    if (REALSHADOW && sun.shadow.mapSize.x !== shadowN) {
      sun.shadow.mapSize.set(shadowN, shadowN);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    flora.count = query.has('flora') ? Math.min(flora.userData.full, parseInt(query.get('flora'), 10)) : Math.min(flora.userData.full, q.flora);
    resize();
  }
  window.addEventListener('resize', resize);
  applyTier(gov.tier);
  if (camera.aspect < 0.9) { camera.position.multiplyScalar(1.2); controls.update(); }   // portrait phones: start a little further back

  const ATMO_KEYS = { KeyQ: 0, KeyW: 0.5, KeyE: 1 };
  window.addEventListener('keydown', (ev) => {
    if (ev.code in ATMO_KEYS) { atmo.setTarget(ATMO_KEYS[ev.code]); syncAtmoUi(); if (ev.code === 'KeyW') dock.showHint('Orbit the camera low to see the aurora and the stars', 5000); }
    else if (ev.code === 'KeyM') { audio.setMuted(!audio.muted); muteUi.set(audio.muted); }
    else if (ev.code === 'KeyP') takePhoto();
    else if (ev.code === 'KeyD') { atmo.pinned = false; atmo.drift = true; syncAtmoUi(); }
    else if (ev.code >= 'Digit1' && ev.code <= 'Digit4') ctl.setTool(parseInt(ev.code.slice(5), 10) - 1);
  });
  // --- autosave every 20 s and whenever the page is hidden; photo mode on P ---
  const save = () => { if (storage) saveToStorage(storage, world, { atmo: { state: atmo.state, target: atmo.target, pinned: atmo.pinned, drift: atmo.drift, driftClock: atmo.driftClock } }); };
  setInterval(save, 20000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  const uiEl = document.getElementById('ui');
  const photo = { busy: false, pending: false, paused: false, count: 0 };
  function takePhoto() {
    if (photo.busy) return;
    photo.busy = true;
    uiEl.classList.add('hidden');
    setTimeout(() => {
      photo.paused = true;
      pr = Math.min(dprNow(), 2.0);
      if (post.material.defines.TAPS !== 12) { post.material.defines.TAPS = 12; post.material.needsUpdate = true; }
      resize();
      photo.pending = true;
    }, 380);
  }
  function finishPhoto(blob) {
    if (blob) {
      const d = new Date(), z = (n) => String(n).padStart(2, '0');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `living-mythos-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    photo.count++;
    applyTier(gov.tier);
    photo.paused = false; photo.busy = false;
    uiEl.classList.remove('hidden');
  }
  createPhotoButton(uiEl, takePhoto);
  const debugUi = DEBUG ? createDebugOverlay() : null;
  const reporter = query.has('report') ? createReporter(renderer, canvas, {
    tier: () => TIER_NAMES[gov.tier], loss: () => lossLog, simTime: () => world.stats.time,
    input: () => ({ ...ctl.st.stats, log: ctl.st.stats.log.slice(-12), camDist: +camera.position.distanceTo(controls.target).toFixed(1), tool: ctl.st.tool, monoliths: world.monoliths.filter((v, i) => i % 4 === 3 && v).length, cursorA: +ctl.st.alpha.toFixed(2) }), villagers: () => world.civ.nV, structures: () => world.civ.nS, particles: () => particles.count,
  }) : null;
  let rock0 = 0;
  const landSum = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) if (!world.mask[i]) t += a[i] + (b ? b[i] : 0); return t; };
  if (DEBUG) rock0 = landSum(world.elev, world.sediment);

  ctl.setTool(0);
  syncAtmoUi();
  dock.showHint('Drag to orbit · pinch or scroll to zoom · pick a tool below', 6000);

  // Timer is core in three r186 (no addon copy ships in r186; see NOTES.md).
  const timer = new THREE.Timer();
  timer.connect(document);

  let simAcc = 0;
  let camSpeed = 0;
  const camPrev = new THREE.Vector3().copy(camera.position);
  let frame = 0;
  const SIM_SPEED = 2.0;      // sim seconds per real second

  function renderFrame() {
    if (query.has('nopost')) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post.scene, post.camera);
  }

  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.05);
    SHARED.uTime.value += dt;
    if (!photo.busy) { const nt = governorSample(gov, Math.min(rawDt, 0.2)); if (nt >= 0) applyTier(nt); }

    const t0 = (DEBUG || query.has('report')) ? performance.now() : 0;
    let n = 0;
    if (!photo.paused) {
      simAcc += dt * SIM_SPEED;
      while (simAcc >= world.params.dt && n < maxSubsteps) { simStep(world); simAcc -= world.params.dt; n++; }
      if (n === 0 && simAcc > world.params.dt) simAcc = 0;
      if (n > 0) packSimTextures(world, simTex);
      if (stepShade(world, shadeState, SHARED.uSunDir.value, 8)) packShadeTexture(world, simTex);
    }
    const simMs = (DEBUG || query.has('report')) ? performance.now() - t0 : 0;

    controls.update();
    camSpeed += (camera.position.distanceTo(camPrev) / Math.max(dt, 1e-3) - camSpeed) * Math.min(1, dt * 6);
    camPrev.copy(camera.position);
    ctl.update(dt, SHARED.uTime.value);
    ringFx.update();
    {
      const cst = ctl.st;
      stepParticles(particles, world, dt, SHARED.uTime.value, SHARED.uRain.value, SHARED.uWind.value, cst.cloudVis > 0.5 && cst.rainAmt > 0.3, cst.spos[0], cst.spos[1] + 2.9, cst.spos[2], 0, 0);
      breezeLanterns(particles, cst.spos[0], cst.spos[2], 2.6, cst.breezeAmt, dt);
      particlePool.userData.update(particles);
      structures.userData.update(world, dt);
      villagers.userData.update(world);
    }
    if (audio.ready) {
      try {
        const sp = Math.hypot(ctl.st.svel[0], ctl.st.svel[2]);
        aCam.copy(camera.position);
        aState.atmo = SHARED.uAtmo.value; aState.night = SHARED.uNight.value; aState.aurora = SHARED.uAurora.value;
        aState.wind = Math.min(1, SHARED.uWind.value / 1.5);
        aState.windSpeed = Math.min(1, sp * 0.12 + ctl.st.breezeAmt * 0.4 + camSpeed * 0.02);
        aState.flux = Math.min(1, world.stats.flux / 120);
        aState.sculpt = Math.max(director.rumble, ctl.st.active && ctl.st.tool === 0 ? 0.55 : 0);
        aState.bias = sampleGrid(world.culturalBias, controls.target.x, controls.target.z);
        audio.update(dt, aState);
        directorStep(director, world, audio, aState, spatial, SHARED.uTime.value);
      } catch (err) { audio.ready = false; console.warn('[mythos] audio disabled:', err && err.message); }
    }
    atmo.update(dt);
    // the weather feeds back into the sim: monsoon rains harder and evaporates less; golden hour grows crops fastest
    world.params.rain = TUNING.rain * (1 + 8 * SHARED.uRain.value);
    world.params.evapMul = 1 - 0.6 * SHARED.uRain.value;
    world.params.ecoGrow = 1.3 - 0.6 * SHARED.uAurora.value - 0.3 * SHARED.uRain.value;
    post.material.uniforms.uFocusDist.value = camera.position.distanceTo(controls.target);
    if (!NORENDER) renderFrame();
    if (reporter) { reporter.maybeShot(query.get('report') || 'phone', 10); reporter.tick(rawDt, simMs, renderer.info.programs.length); }
    if (photo.pending) { photo.pending = false; canvas.toBlob(finishPhoto, 'image/png'); }
    frame++;
    if (debugUi) {
      debugUi.sample(dt, simMs);
      debugUi.update(dt, () => {
        let w = 0; for (let i = 0; i < world.water.length; i++) if (!world.mask[i]) w += world.water[i];
        const rock = landSum(world.elev, world.sediment);
        return { tier: TIER_NAMES[gov.tier], water: w, rock, drift: (rock - rock0) / rock0 * 100, villagers: world.civ.nV, structures: world.civ.nS, myths: world.civ.nM, particles: particles.count };
      });
    }
    if (DEBUG && frame === 1) console.info('[mythos] programs compiled:', renderer.info.programs.length);
  });

  if (DEBUG) {
    console.info('[mythos] caps', JSON.stringify(caps));
    // Test hook (debug builds only): lets tools/test-interact.mjs drive and inspect the live app.
    const pv = new THREE.Vector3();
    window.__mythos = {
      world, ctl, atmo, camera, controls, flora, particles, structures, villagers, audio, director, photo, gov, save, takePhoto, restored,
      snapshot() { renderFrame(); return canvas.toDataURL('image/png'); },
      project(x, y, z) {
        pv.set(x, y, z).project(camera);
        const r = canvas.getBoundingClientRect();
        return [r.left + (pv.x * 0.5 + 0.5) * r.width, r.top + (-pv.y * 0.5 + 0.5) * r.height];
      },
    };
  }
}

boot();
