import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Galaxy } from './galaxy.js';
import { Trees } from './trees.js';
import { createGui, showEffectFolders } from './gui.js';
import { createStats } from './stats.js';
import { loadSettings, saveSettings, clearSettings } from './settings.js';

const isMobile = window.matchMedia('(max-width: 600px)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const devicePixelRatio = window.devicePixelRatio;

const defaults = {
  effect: 'galaxy',
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
  treeSeed: 1,
  treeSpeed: reducedMotion ? 0.3 : 1,
  leafSize: 50,
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
// The scene renders into the composer target (which has depth); the canvas only receives the final image
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
scene.add(camera);

let pixelRatio = params.renderScale;

// ---------- Effects ----------

const galaxyGroup = new THREE.Group();
const galaxy = new Galaxy(galaxyGroup, params, pixelRatio);
const trees = new Trees(scene, params, pixelRatio);
scene.add(galaxyGroup);

// Far enough to keep the whole disc in frame on narrow (portrait) screens
function treeViewDistance() {
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  return Math.max(9.5, 14 / (2 * Math.tan(halfFov) * camera.aspect));
}

const effects = {
  galaxy: {
    group: galaxyGroup,
    instance: galaxy,
    view: () => ({ position: new THREE.Vector3(0, 6, 7.5), target: new THREE.Vector3(0, 0, 0) }),
    maxDistance: 25,
    maxPolarAngle: Math.PI,
  },
  trees: {
    group: trees.group,
    instance: trees,
    // Looking down slightly so the disc reads as a surface
    view: () => ({ position: new THREE.Vector3(0, 4, treeViewDistance()), target: new THREE.Vector3(0, 1.3, 0) }),
    maxDistance: 40,
    // Keep the camera above the disc
    maxPolarAngle: Math.PI / 2,
  },
};
if (!effects[params.effect]) params.effect = defaults.effect;

// ---------- Mouse controls: drag to rotate, wheel to zoom ----------

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1;

// ---------- Post-processing ----------

// HDR target for bloom; its depth buffer keeps near trees in front of far ones from any camera angle
const renderTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
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
  trees.setPixelRatio(pixelRatio);
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
  objects: [galaxy.points, ...trees.objects],
});

// ---------- GUI ----------

const gui = createGui(params, defaults, {
  onGalaxyChange: () => galaxy.build(),
  onSizeChange: () => galaxy.setPixelRatio(pixelRatio),
  onTreesChange: () => trees.build(),
  onLeafSizeChange: () => trees.setPixelRatio(pixelRatio),
  onNewTrees: () => {
    params.treeSeed = Math.floor(Math.random() * 1e9);
    trees.build();
    saveSettings(params);
  },
  onBloomChange: () => {
    bloomPass.strength = params.bloomStrength;
    bloomPass.radius = params.bloomRadius;
    bloomPass.threshold = params.bloomThreshold;
  },
  onResolutionChange: applyResolution,
  onStatsChange: () => stats.setVisible(params.stats),
  onReset: () => {
    clearSettings();
    // Keep only the chosen effect, so a reload after a reset stays on it
    if (params.effect !== defaults.effect) saveSettings({ effect: params.effect });
  },
});
gui.close();
stats.setVisible(params.stats);

// Fires for every controller in every folder once a change is complete
gui.onFinishChange(() => saveSettings(params));

// ---------- Effect switcher ----------

const fade = document.getElementById('fade');
const switchButtons = document.querySelectorAll('#effects button');
let switching = false;

function applyEffect(name) {
  const effect = effects[name];
  params.effect = name;

  for (const [key, { group }] of Object.entries(effects)) group.visible = key === name;

  const { position, target } = effect.view();
  camera.position.copy(position);
  controls.target.copy(target);
  controls.maxDistance = effect.maxDistance;
  controls.maxPolarAngle = effect.maxPolarAngle;
  controls.update();

  showEffectFolders(gui, name);
  switchButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.effect === name)));
}
applyEffect(params.effect);

// Fade to black, swap while hidden, fade back in
function switchEffect(name) {
  if (switching || name === params.effect) return;
  switching = true;

  fade.addEventListener(
    'transitionend',
    () => {
      applyEffect(name);
      saveSettings(params);
      fade.classList.remove('visible');
      switching = false;
    },
    { once: true },
  );
  fade.classList.add('visible');
}

switchButtons.forEach((button) => button.addEventListener('click', () => switchEffect(button.dataset.effect)));

// ---------- Render loop ----------

let previousTime = performance.now();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  previousTime = now;

  // Only the visible effect is animated
  effects[params.effect].instance.update(delta);
  controls.update();

  composer.render();
  stats.update(delta);
});
