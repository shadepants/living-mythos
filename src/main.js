import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { detectCaps } from './gl/caps.js';
import { createSceneTarget, createComposite } from './gl/post.js';
import { SHARED } from './gl/shared.js';
import { createSimTextures, packSimTextures } from './gl/simtex.js';
import { createSkyDome } from './gl/sky.js';
import { createAtmosphere } from './gl/atmo.js';
import { createGridGeometry, createIslandTop, createWaterSurface, createBasaltSkirt } from './gl/terrain.js';
import { createWorld } from './sim/world.js';
import { hydroStep } from './sim/hydro.js';
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

  // --- simulation ---
  const world = createWorld(query.has('seed') ? parseInt(query.get('seed'), 10) : TUNING.seedDefault);
  prewarm(world);
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

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 9;
  controls.maxDistance = 44;
  controls.maxPolarAngle = 1.38;
  controls.update();

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
    if (ev.code in ATMO_KEYS) atmo.setTarget(ATMO_KEYS[ev.code]);
    else if (ev.code === 'KeyD') { atmo.pinned = false; atmo.drift = true; }
  });

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
    while (simAcc >= world.params.dt && n < MAX_SUBSTEPS) { hydroStep(world); simAcc -= world.params.dt; n++; }
    if (n === 0 && simAcc > world.params.dt) simAcc = 0;
    if (n > 0) packSimTextures(world, simTex);

    controls.update();
    atmo.update(dt);
    post.material.uniforms.uFocusDist.value = camera.position.distanceTo(controls.target);
    renderFrame();
    frame++;
    if (DEBUG && frame === 3) console.info('[mythos] programs compiled:', renderer.info.programs.length);
  });

  if (DEBUG) console.info('[mythos] caps', JSON.stringify(caps));
}

boot();
