import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Galaxy } from './galaxy.js';
import { createGui } from './gui.js';
import { createStats } from './stats.js';
import { loadSettings, saveSettings, clearSettings } from './settings.js';

const isMobile = window.matchMedia('(max-width: 600px)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const devicePixelRatio = window.devicePixelRatio;

const defaults = {
  count: isMobile ? 30000 : 60000,
  radius: 5,
  branches: 4,
  spin: 1.2,
  randomness: 0.35,
  randomnessPower: 3,
  size: 25,
  insideColor: '#ff6bd6',
  outsideColor: '#2b6cff',
  speed: reducedMotion ? 0.03 : 0.2,
  bloomStrength: 0.7,
  bloomRadius: 0.5,
  bloomThreshold: 0.15,
  // Capped below the device ratio: the soft star glow does not need full high-DPI sharpness
  renderScale: Math.min(devicePixelRatio, 1.5),
  stats: true,
};
const params = loadSettings(defaults);

// ---------- Renderer, scene, camera ----------

const canvas = document.getElementById('webgl');
// Additive, depth-free particles need neither depth nor stencil buffers
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: 'high-performance',
});
// Filmic tone mapping keeps the dense core from clipping to flat white
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#05010d');

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 6, 7.5);
scene.add(camera);

let pixelRatio = params.renderScale;
const galaxy = new Galaxy(scene, params, pixelRatio);

// ---------- Mouse controls: drag to rotate, wheel to zoom ----------

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1;
controls.maxDistance = 25;

// ---------- Post-processing ----------

// HDR target for bloom, without a depth buffer (nothing in the scene depth-tests)
const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
const composer = new EffectComposer(renderer, renderTarget);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  params.bloomStrength,
  params.bloomRadius,
  params.bloomThreshold,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ---------- Resolution ----------

function applyResolution() {
  pixelRatio = params.renderScale;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(window.innerWidth, window.innerHeight);
  // Bloom is a blur anyway, so it runs at CSS resolution regardless of render scale
  bloomPass.setSize(window.innerWidth, window.innerHeight);
  galaxy.setPixelRatio(pixelRatio);
}
applyResolution();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyResolution();
});

// ---------- Resource stats ----------

const stats = createStats({
  element: document.getElementById('stats'),
  renderer,
  composer,
  bloomPass,
  objects: [galaxy.points],
});

// ---------- GUI ----------

const gui = createGui(params, defaults, {
  onGalaxyChange: () => galaxy.build(),
  onSizeChange: () => galaxy.setPixelRatio(pixelRatio),
  onBloomChange: () => {
    bloomPass.strength = params.bloomStrength;
    bloomPass.radius = params.bloomRadius;
    bloomPass.threshold = params.bloomThreshold;
  },
  onResolutionChange: applyResolution,
  onStatsChange: () => stats.setVisible(params.stats),
  onReset: clearSettings,
});
gui.close();
stats.setVisible(params.stats);

// Fires for every controller in every folder once a change is complete
gui.onFinishChange(() => saveSettings(params));

// ---------- Render loop ----------

let previousTime = performance.now();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  previousTime = now;

  galaxy.update(delta);
  controls.update();

  composer.render();
  stats.update(delta);
});
