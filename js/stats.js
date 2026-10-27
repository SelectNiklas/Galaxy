// Small resource readout in the bottom-right corner.
// Browsers do not expose real CPU/GPU usage, so GPU memory is calculated
// from the buffers this page allocates; JS heap is only available in Chromium.

const UPDATE_INTERVAL = 0.5; // seconds

const MB = 1024 * 1024;

function formatMB(bytes) {
  return `${(bytes / MB).toFixed(1)} MB`;
}

function geometryBytes(geometry) {
  return Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
}

function renderTargetBytes(target) {
  // RGBA half float = 8 bytes per pixel, plus a 4-byte depth buffer
  const bytesPerPixel = 8 + (target.depthBuffer ? 4 : 0);
  return target.width * target.height * bytesPerPixel;
}

export function createStats({ element, renderer, composer, bloomPass, objects }) {
  renderer.info.autoReset = false;

  let frames = 0;
  let elapsed = 0;

  function render() {
    const fps = frames / elapsed;
    const info = renderer.info.render;

    const geometry = objects.reduce((sum, object) => sum + geometryBytes(object.geometry), 0);
    const targets = [
      composer.renderTarget1,
      composer.renderTarget2,
      bloomPass.renderTargetBright,
      ...bloomPass.renderTargetsHorizontal,
      ...bloomPass.renderTargetsVertical,
    ];
    const canvas = renderer.domElement;
    // Default framebuffer: RGBA8 colour only (depth and stencil are disabled)
    const framebuffers = targets.reduce((sum, t) => sum + renderTargetBytes(t), 0) + canvas.width * canvas.height * 4;

    const lines = [
      `${fps.toFixed(0)} FPS · ${((elapsed / frames) * 1000).toFixed(1)} ms`,
      `${(info.points / frames / 1000).toFixed(0)}k Punkte · ${(info.calls / frames).toFixed(0)} Draw-Calls`,
      `GPU ≈ ${formatMB(geometry + framebuffers)} (Sterne ${formatMB(geometry)})`,
    ];

    if (performance.memory) {
      lines.push(`JS-Heap ${formatMB(performance.memory.usedJSHeapSize)}`);
    }

    lines.push(`${canvas.width} × ${canvas.height} px`);
    element.textContent = lines.join('\n');
  }

  return {
    // Call once per frame after rendering
    update(delta) {
      frames++;
      elapsed += delta;

      if (elapsed >= UPDATE_INTERVAL) {
        render();
        frames = 0;
        elapsed = 0;
        renderer.info.reset();
      }
    },

    setVisible(visible) {
      element.hidden = !visible;
    },
  };
}
