import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { detectCaps } from './gl/caps.js';
import { createSceneTarget, createComposite } from './gl/post.js';
import { SHARED } from './gl/shared.js';
import { createSimTextures, packSimTextures } from './gl/simtex.js';
import { createCursor } from './gl/cursor.js';
import { createRaincloud } from './gl/cloud.js';
import { createRingFx } from './gl/fxbridge.js';
import { createDock, TOOL_HINTS } from './ui/dock.js';
import { createController } from './input/controller.js';
import { createFlora } from './gl/flora.js';
import { createSkyDome } from './gl/sky.js';
import { createAtmosphere } from './gl/atmo.js';
import { createGridGeometry, createIslandTop, createWaterSurface, createBasaltSkirt } from './gl/terrain.js';
import { createWorld } from './sim/world.js';
import { simStep } from './sim/sim.js';
import { prewarm } from './sim/prewarm.js';
import { TUNING } from './sim/tuning.js';

const canvas = document.getElementById('stage');
const fallback = document.getElementById('fallback');
const query = new URLSearchParams(location.search);
const DEBUG = query.has('debug');

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
  const world = createWorld(query.has('seed') ? parseInt(query.get('seed'), 10) : TUNING.seedDefault);
  prewarm(world);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (e) {
    fail('Could not start WebGL2 on this device.');
    return;
  }
  renderer.getContext().getExtension('OES_texture_float_linear');
  const caps = detectCaps(renderer);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  const simTex = createSimTextures(caps.floatLinear);
  SHARED.uSimTexA.value = simTex.texA;
  SHARED.uSimTexB.value = simTex.texB;
  packSimTextures(world, simTex);

  // --- scene ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6a5a78);
  scene.fog = new THREE.FogExp2(0xcc8c73, SHARED.uFogDensity.value);
  const atmoQuery = query.get('atmo');

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 140);
  camera.position.set(0, 15, 25);

  const hemi = new THREE.HemisphereLight(0x8f86c8, 0x5a4236, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb878, 3.2);
  sun.position.copy(SHARED.uSunDir.value).multiplyScalar(30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -13; sc.right = 13; sc.top = 13; sc.bottom = -13; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const grid = createGridGeometry();
  scene.add(createSkyDome());
  scene.add(createIslandTop(grid, caps));
  scene.add(createBasaltSkirt());
  scene.add(createWaterSurface(grid, caps));
  const flora = createFlora(caps, 3500);
  scene.add(flora);
  scene.add(createCursor(caps));
  const cloudFx = createRaincloud();
  scene.add(cloudFx);
  const ringFx = createRingFx(world);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 9;
  controls.maxDistance = 44;
  controls.maxPolarAngle = 1.38;
  controls.update();
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  // --- input + dock ---
  const dock = createDock(document.getElementById('ui'), {
    onTool: (i) => { ctl.setTool(i); },
    onAtmo: (v) => { atmo.setTarget(v); syncAtmoUi(); },
    onDrift: () => { atmo.pinned = false; atmo.drift = true; syncAtmoUi(); },
  });
  const ctl = createController({
    canvas, camera, controls, world, cloud: cloudFx,
    onChange: (i) => { dock.setTool(i); dock.showHint(TOOL_HINTS[i]); },
  });
  function syncAtmoUi() { dock.setAtmo(atmo.pinned ? (atmo.target < 0.25 ? 0 : atmo.target < 0.75 ? 1 : 2) : -1, !atmo.pinned && atmo.drift); }

  // --- post ---
  const post = createComposite(caps, 12);
  const atmo = createAtmosphere(scene, sun, hemi, post);
  if (atmoQuery !== null) { atmo.setTarget(parseFloat(atmoQuery)); atmo.state = atmo.target; }
  let sceneTarget = null;
  const pr = Math.min(window.devicePixelRatio || 1, 1.5);

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (sceneTarget) sceneTarget.dispose();
    sceneTarget = createSceneTarget(Math.floor(w * pr), Math.floor(h * pr), caps);
    post.material.uniforms.tColor.value = sceneTarget.texture;
    post.material.uniforms.tDepth.value = sceneTarget.depthTexture;
    post.material.uniforms.uTexel.value.set(1 / sceneTarget.width, 1 / sceneTarget.height);
    post.material.uniforms.uMaxBlur.value = 6.0 * (sceneTarget.height / 900);
  }
  window.addEventListener('resize', resize);
  resize();

  const ATMO_KEYS = { KeyQ: 0, KeyW: 0.5, KeyE: 1 };
  window.addEventListener('keydown', (ev) => {
    if (ev.code in ATMO_KEYS) { atmo.setTarget(ATMO_KEYS[ev.code]); syncAtmoUi(); }
    else if (ev.code === 'KeyD') { atmo.pinned = false; atmo.drift = true; syncAtmoUi(); }
    else if (ev.code >= 'Digit1' && ev.code <= 'Digit4') ctl.setTool(parseInt(ev.code.slice(5), 10) - 1);
  });
  ctl.setTool(0);
  syncAtmoUi();
  dock.showHint('Drag to orbit · pinch or scroll to zoom · pick a tool below', 6000);

  // Timer is core in three r186 (no addon copy ships in r186; see NOTES.md).
  const timer = new THREE.Timer();
  timer.connect(document);

  let simAcc = 0;
  let frame = 0;
  const SIM_SPEED = 2.0;      // sim seconds per real second
  const MAX_SUBSTEPS = 3;

  function renderFrame() {
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post.scene, post.camera);
  }

  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    SHARED.uTime.value += dt;

    simAcc += dt * SIM_SPEED;
    let n = 0;
    while (simAcc >= world.params.dt && n < MAX_SUBSTEPS) { simStep(world); simAcc -= world.params.dt; n++; }
    if (n === 0 && simAcc > world.params.dt) simAcc = 0;
    if (n > 0) packSimTextures(world, simTex);

    controls.update();
    ctl.update(dt, SHARED.uTime.value);
    ringFx.update();
    atmo.update(dt);
    // the weather feeds back into the sim: monsoon rains harder and evaporates less; golden hour grows crops fastest
    world.params.rain = TUNING.rain * (1 + 8 * SHARED.uRain.value);
    world.params.evapMul = 1 - 0.6 * SHARED.uRain.value;
    world.params.ecoGrow = 1.3 - 0.6 * SHARED.uAurora.value - 0.3 * SHARED.uRain.value;
    post.material.uniforms.uFocusDist.value = camera.position.distanceTo(controls.target);
    renderFrame();
    frame++;
    if (DEBUG && frame === 1) console.info('[mythos] programs compiled:', renderer.info.programs.length);
  });

  if (DEBUG) {
    console.info('[mythos] caps', JSON.stringify(caps));
    // Test hook (debug builds only): lets tools/test-interact.mjs drive and inspect the live app.
    const pv = new THREE.Vector3();
    window.__mythos = {
      world, ctl, atmo, camera, controls, flora,
      project(x, y, z) {
        pv.set(x, y, z).project(camera);
        const r = canvas.getBoundingClientRect();
        return [r.left + (pv.x * 0.5 + 0.5) * r.width, r.top + (-pv.y * 0.5 + 0.5) * r.height];
      },
    };
  }
}

boot();
