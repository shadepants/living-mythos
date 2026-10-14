import * as THREE from 'three';
import { detectCaps } from './gl/caps.js';
import { createSceneTarget } from './gl/post.js';

const canvas = document.getElementById('stage');
const fallback = document.getElementById('fallback');

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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1530);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(0, 14, 26);
  camera.lookAt(0, 0, 0);

  // M0 placeholder: a rotating marker proving the loop, timer and target pipeline work.
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(2),
    new THREE.MeshNormalMaterial()
  );
  scene.add(marker);

  let sceneTarget = null;
  const pr = Math.min(window.devicePixelRatio || 1, 1.5);

  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tw = Math.floor(w * pr), th = Math.floor(h * pr);
    if (sceneTarget) sceneTarget.dispose();
    sceneTarget = createSceneTarget(tw, th, caps);
  }
  window.addEventListener('resize', resize);
  resize();

  // Timer is core in three r186 (no addon copy ships in r186; see NOTES.md).
  const timer = new THREE.Timer();
  timer.connect(document);

  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    marker.rotation.y += dt * 0.8;
    marker.rotation.x += dt * 0.3;
    renderer.render(scene, camera);
  });

  if (new URLSearchParams(location.search).has('debug')) {
    console.info('[mythos] caps', caps);
  }
}

boot();
