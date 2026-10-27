import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GROUND_Y = 0;
const CYCLE = 180; // seconds for a full year at speed 1
const DISC_RADIUS = 5;
const TREE_COUNT = 6;
const TREE_MIN_DISTANCE = 2.4;
const MAX_DEPTH = 7;
const LEAVES_PER_TIP = 3;

// Autumn colours; spring and summer greens are shared by all leaves
const LEAF_COLORS = ['#ff8a2b', '#ffb13b', '#e8452c', '#c9302c', '#ffd36b'].map((c) => new THREE.Color(c));
const SPRING_GREEN = new THREE.Color('#9be15d');
const SUMMER_GREEN = new THREE.Color('#2f9e44');
const BARK_BASE = new THREE.Color('#2e2640');
const BARK_TIP = new THREE.Color('#6a5c8c');

const leafVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uCycle;
  uniform float uSize;
  uniform float uGround;
  uniform float uDiscRadius;
  uniform vec3 uSpringColor;
  uniform vec3 uSummerColor;

  attribute vec3 aSeed;
  attribute float aDetach;
  attribute float aScale;

  varying vec3 vColor;
  varying float vSize;
  varying float vSprite;
  varying float vAlpha;

  // Path of a falling leaf after s seconds: steady descent, light wind drift, flutter
  vec3 fallOffset(float s, float speed, vec3 seed) {
    float flutter = min(s, 1.0);
    return vec3(
      s * (0.02 + seed.z * 0.04) + sin(s * (1.5 + seed.x * 2.0) + seed.y * 6.2832) * 0.25 * flutter,
      -s * speed,
      sin(s * (1.1 + seed.y) + seed.z * 6.2832) * 0.2 * flutter
    );
  }

  void main() {
    float t = mod(uTime, uCycle);
    float phase = t / uCycle;

    // Spring: leaves bud one after another at the start of each year
    float bud = aSeed.x * 0.06;
    float grown = smoothstep(bud, bud + 0.04, phase);

    // Leaves that fall early also turn early, so every leaf is coloured before it lets go
    float turnAt = (0.28 + aDetach * 0.15) * uCycle;
    float detachAt = (0.45 + aDetach * 0.3) * uCycle;

    // Fresh spring green deepens over summer, turns to the leaf's autumn colour, then darkens before falling
    vec3 green = mix(uSpringColor, uSummerColor, smoothstep(0.04, 0.25, phase)) * (0.85 + aSeed.y * 0.3);
    vec3 autumn = mix(color, color * vec3(1.0, 0.55, 0.45), smoothstep(detachAt - 20.0, detachAt, t));
    vColor = mix(green, autumn, smoothstep(turnAt, turnAt + 0.08 * uCycle, t));

    // Autumn: each leaf lets go at its own moment and drifts down
    float falling = max(t - detachAt, 0.0);
    float speed = 0.18 + aSeed.y * 0.2;
    float landAfter = (position.y - uGround) / speed;
    vec3 landing = position + fallOffset(landAfter, speed, aSeed);
    bool onDisc = length(landing.xz) < uDiscRadius;

    // Leaves blown past the edge keep falling into space
    float s = onDisc ? min(falling, landAfter) : falling;
    vec3 p = position + fallOffset(s, speed, aSeed);
    p.x += sin(uTime * 1.3 + aSeed.z * 20.0) * 0.015 * (1.0 - min(s, 1.0));

    // Landed leaves rest for a moment, then fade; leaves past the edge fade as they sink below the disc
    float rest = onDisc
      ? 1.0 - smoothstep(0.0, 6.0, falling - landAfter)
      : 1.0 - smoothstep(0.0, 1.5, uGround - p.y);
    vAlpha = grown * rest;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    // Same sub-pixel handling as the galaxy stars; invisible leaves are not rasterised at all
    vSize = uSize * aScale / -viewPosition.z;
    vSprite = max(vSize, 3.0);
    gl_PointSize = vAlpha > 0.0 ? vSprite : 0.0;
  }
`;

const leafFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vSize;
  varying float vSprite;
  varying float vAlpha;

  void main() {
    float r = distance(gl_PointCoord, vec2(0.5));

    float glow = vSize * 0.1;
    float falloff = max(glow, 0.5);
    float strength = exp(-r * vSprite / falloff);
    strength *= (glow * glow) / (falloff * falloff);
    strength *= 1.0 - smoothstep(0.35, 0.5, r);

    gl_FragColor = vec4(vColor * strength * vAlpha, 1.0);
  }
`;

const groundVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const groundFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uEdge; // disc radius relative to the plane's half size
  varying vec2 vUv;

  void main() {
    float r = length(vUv * 2.0 - 1.0);

    // Light surface so the dark trunks stand out; kept just below the default bloom threshold (0.15) so it doesn't glow over the trees
    float inside = 1.0 - smoothstep(uEdge - 0.01, uEdge, r);
    float surface = inside * (0.11 + 0.03 * (1.0 - r / uEdge));

    // Bright rim with a soft outer halo that is fully gone before the plane's square edge
    float rim = exp(-abs(r - uEdge) * 80.0) * 0.5;
    float halo = (1.0 - inside) * exp(-(r - uEdge) * 20.0) * 0.1 * (1.0 - smoothstep(uEdge, 1.0, r));

    gl_FragColor = vec4(uColor * (surface + rim + halo), 1.0);
  }
`;

// Small seeded PRNG so a forest can be regrown reproducibly from its seed
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perpendicular(dir) {
  const reference = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3().crossVectors(dir, reference).normalize();
}

// Recursive branching: every branch splits into 2-3 shorter, thinner children spread around its axis
function growTree(rng, base, height, branches, tips) {
  function grow(start, dir, length, radius, depth) {
    const end = start.clone().addScaledVector(dir, length);
    branches.push({ start, end, radius, depth });

    if (depth === MAX_DEPTH) {
      tips.push(end);
      return;
    }

    const count = rng() < (depth < 2 ? 0.45 : 0.2) ? 3 : 2;
    const twist = rng() * Math.PI * 2;
    const side = perpendicular(dir);

    for (let i = 0; i < count; i++) {
      const axis = side.clone().applyAxisAngle(dir, twist + (i / count) * Math.PI * 2);
      const child = dir.clone().applyAxisAngle(axis, 0.35 + rng() * 0.35);
      child.y += 0.12;
      child.normalize();
      grow(end, child, length * (0.7 + rng() * 0.12), radius * 0.68, depth + 1);
    }
  }

  const trunk = new THREE.Vector3(rng() * 0.2 - 0.1, 1, rng() * 0.2 - 0.1).normalize();
  grow(base, trunk, height * 0.3, height * 0.035, 0);
}

// One tree near the centre, the rest spread around it in jittered sectors,
// kept apart so crowns don't grow into each other and away from the rim
function placeTrees(rng) {
  const maxRadius = DISC_RADIUS - 1.2;
  const bases = [new THREE.Vector3((rng() - 0.5) * 1.2, GROUND_Y, (rng() - 0.5) * 1.2)];
  const ring = TREE_COUNT - 1;
  const offset = rng() * Math.PI * 2;

  for (let i = 0; i < ring; i++) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const angle = offset + ((i + 0.2 + rng() * 0.6) / ring) * Math.PI * 2;
      const radius = 2 + rng() * (maxRadius - 2);
      const candidate = new THREE.Vector3(Math.cos(angle) * radius, GROUND_Y, Math.sin(angle) * radius);
      if (bases.every((base) => base.distanceTo(candidate) >= TREE_MIN_DISTANCE)) {
        bases.push(candidate);
        break;
      }
    }
  }

  return bases;
}

function branchGeometry({ start, end, radius, depth }) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius * 0.68, radius, length, depth < 3 ? 6 : 3, 1, true);

  geometry.translate(0, length / 2, 0);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  geometry.translate(start.x, start.y, start.z);

  const color = BARK_BASE.clone().lerp(BARK_TIP, depth / MAX_DEPTH);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return geometry;
}

export class Trees {
  constructor(parent, params, pixelRatio) {
    this.params = params;
    // Start with full crowns instead of in the middle of budding
    this.elapsed = CYCLE * 0.1;

    this.group = new THREE.Group();
    parent.add(this.group);

    this.branches = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ vertexColors: true }));

    this.leafMaterial = new THREE.ShaderMaterial({
      vertexShader: leafVertexShader,
      fragmentShader: leafFragmentShader,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: this.elapsed },
        uCycle: { value: CYCLE },
        uSize: { value: params.leafSize * pixelRatio },
        uGround: { value: GROUND_Y },
        uDiscRadius: { value: DISC_RADIUS },
        uSpringColor: { value: SPRING_GREEN },
        uSummerColor: { value: SUMMER_GREEN },
      },
    });
    this.leaves = new THREE.Points(undefined, this.leafMaterial);
    // Falling leaves leave the crown's bounding sphere, so never cull them
    this.leaves.frustumCulled = false;

    // Square plane with room around the disc for the rim's halo
    const groundSize = (DISC_RADIUS + 1.5) * 2;
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.ShaderMaterial({
        vertexShader: groundVertexShader,
        fragmentShader: groundFragmentShader,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color('#ffffff') },
          uEdge: { value: (DISC_RADIUS * 2) / groundSize },
        },
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = GROUND_Y;

    // Ground glow first so the opaque branches cover it; leaves last so they glow over the branches
    this.ground.renderOrder = -1;
    this.leaves.renderOrder = 1;

    this.group.add(this.branches, this.leaves, this.ground);
    this.build();
  }

  build() {
    const rng = mulberry32(this.params.treeSeed);
    const branches = [];
    const tips = [];
    const leafData = [];

    for (const base of placeTrees(rng)) {
      const height = 2 + rng();
      const treeTips = [];
      growTree(rng, base, height, branches, treeTips);
      treeTips.forEach((tip) => tips.push({ tip, spread: 0.18 * (height / 2.5) }));
    }

    const offset = new THREE.Vector3();
    for (const { tip, spread } of tips) {
      for (let k = 0; k < LEAVES_PER_TIP; k++) {
        offset.randomDirection().multiplyScalar(Math.cbrt(rng()) * spread);
        leafData.push({ position: tip.clone().add(offset), color: LEAF_COLORS[Math.floor(rng() * LEAF_COLORS.length)] });
      }
    }

    const count = leafData.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    const detach = new Float32Array(count);
    const scales = new Float32Array(count);

    leafData.forEach(({ position, color }, i) => {
      position.toArray(positions, i * 3);
      color.toArray(colors, i * 3);
      seeds[i * 3] = rng();
      seeds[i * 3 + 1] = rng();
      seeds[i * 3 + 2] = rng();
      detach[i] = rng();
      scales[i] = 0.6 + rng() * 0.4;
    });

    const leafGeometry = new THREE.BufferGeometry();
    leafGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    leafGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    leafGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    leafGeometry.setAttribute('aDetach', new THREE.BufferAttribute(detach, 1));
    leafGeometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

    const parts = branches.map(branchGeometry);
    const branchMerged = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());

    this.branches.geometry.dispose();
    this.leaves.geometry.dispose();
    this.branches.geometry = branchMerged;
    this.leaves.geometry = leafGeometry;

    // A new forest starts in full leaf
    this.elapsed = CYCLE * 0.1;
  }

  get objects() {
    return [this.branches, this.leaves, this.ground];
  }

  setPixelRatio(pixelRatio) {
    this.leafMaterial.uniforms.uSize.value = this.params.leafSize * pixelRatio;
  }

  update(delta) {
    this.elapsed += delta * this.params.treeSpeed;
    this.leafMaterial.uniforms.uTime.value = this.elapsed;
  }
}
