import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;

  attribute float aScale;
  attribute vec3 aRandomness;

  varying vec3 vColor;
  varying float vSize;
  varying float vSprite;

  void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);

    // Differential rotation: inner stars orbit faster than outer ones
    float angle = atan(modelPosition.z, modelPosition.x);
    float dist = max(length(modelPosition.xz), 0.15);
    angle += (1.0 / dist) * uTime;
    modelPosition.x = cos(angle) * dist;
    modelPosition.z = sin(angle) * dist;

    modelPosition.xyz += aRandomness;

    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;

    // Size attenuation: farther stars appear smaller
    vSize = uSize * aScale / -viewPosition.z;
    // Tiny stars get a minimum-size sprite so their glow can be sampled smoothly
    vSprite = max(vSize, 3.0);
    gl_PointSize = vSprite;

    vColor = color;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vSize;
  varying float vSprite;

  void main() {
    float r = distance(gl_PointCoord, vec2(0.5));

    // Exponential glow, at least half a pixel wide so tiny stars do not
    // flicker depending on how they line up with the pixel grid
    float glow = vSize * 0.1;
    float falloff = max(glow, 0.5);
    float strength = exp(-r * vSprite / falloff);

    // Widened glow keeps the brightness of the star its real size
    strength *= (glow * glow) / (falloff * falloff);

    // Fade out before the sprite edge to avoid square corners
    strength *= 1.0 - smoothstep(0.35, 0.5, r);

    gl_FragColor = vec4(vColor * strength, 1.0);
  }
`;

export class Galaxy {
  constructor(scene, params, pixelRatio) {
    this.scene = scene;
    this.params = params;
    this.geometry = null;
    this.elapsed = 0;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: params.size * pixelRatio },
      },
    });

    this.points = new THREE.Points(undefined, this.material);
    scene.add(this.points);
    this.build();
  }

  build() {
    const p = this.params;
    const positions = new Float32Array(p.count * 3);
    const randomness = new Float32Array(p.count * 3);
    const colors = new Float32Array(p.count * 3);
    const scales = new Float32Array(p.count);

    const inside = new THREE.Color(p.insideColor);
    const outside = new THREE.Color(p.outsideColor);
    const mixed = new THREE.Color();

    for (let i = 0; i < p.count; i++) {
      const i3 = i * 3;
      const radius = Math.random() * p.radius;
      const branchAngle = ((i % p.branches) / p.branches) * Math.PI * 2;
      const spinAngle = radius * p.spin;

      positions[i3] = Math.cos(branchAngle + spinAngle) * radius;
      positions[i3 + 1] = 0;
      positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * radius;

      // Power curve keeps most stars close to their arm
      for (let axis = 0; axis < 3; axis++) {
        const sign = Math.random() < 0.5 ? 1 : -1;
        const flatten = axis === 1 ? 0.5 : 1;
        randomness[i3 + axis] = Math.pow(Math.random(), p.randomnessPower) * sign * p.randomness * radius * flatten;
      }

      mixed.copy(inside).lerp(outside, radius / p.radius);
      colors[i3] = mixed.r;
      colors[i3 + 1] = mixed.g;
      colors[i3 + 2] = mixed.b;

      scales[i] = Math.random();
    }

    this.geometry?.dispose();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aRandomness', new THREE.BufferAttribute(randomness, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    this.points.geometry = this.geometry;
  }

  setPixelRatio(pixelRatio) {
    this.material.uniforms.uSize.value = this.params.size * pixelRatio;
  }

  update(delta) {
    this.elapsed += delta * this.params.speed;
    this.material.uniforms.uTime.value = this.elapsed;
  }
}
