import GUI from 'lil-gui';

// Folders that only apply to one effect; all other folders are always shown
const folderEffect = new WeakMap();

export function createGui(params, defaults, callbacks) {
  const {
    onGalaxyChange, onSizeChange, onTreesChange, onLeafSizeChange, onNewTrees,
    onBloomChange, onResolutionChange, onStatsChange, onReset,
  } = callbacks;

  const gui = new GUI({ title: 'Effekt-Regler' });

  const shape = gui.addFolder('Form');
  shape.add(params, 'count', 1000, 200000, 1000).name('Sterne').onFinishChange(onGalaxyChange);
  shape.add(params, 'branches', 2, 12, 1).name('Spiralarme').onFinishChange(onGalaxyChange);
  shape.add(params, 'spin', -5, 5, 0.01).name('Verdrehung').onFinishChange(onGalaxyChange);
  shape.add(params, 'radius', 1, 10, 0.1).name('Radius').onFinishChange(onGalaxyChange);
  shape.add(params, 'randomness', 0, 2, 0.01).name('Streuung').onFinishChange(onGalaxyChange);
  shape.add(params, 'randomnessPower', 1, 10, 0.1).name('Streu-Kurve').onFinishChange(onGalaxyChange);
  folderEffect.set(shape, 'galaxy');

  const look = gui.addFolder('Aussehen');
  look.add(params, 'size', 5, 100, 1).name('Sterngröße').onChange(onSizeChange);
  look.addColor(params, 'insideColor').name('Farbe innen').onFinishChange(onGalaxyChange);
  look.addColor(params, 'outsideColor').name('Farbe außen').onFinishChange(onGalaxyChange);
  look.add(params, 'speed', -1, 1, 0.01).name('Tempo');
  folderEffect.set(look, 'galaxy');

  const trees = gui.addFolder('Bäume');
  trees.add(params, 'treeSpeed', 0, 5, 0.1).name('Jahreszeit-Tempo');
  trees.add(params, 'leafSize', 10, 150, 1).name('Blattgröße').onChange(onLeafSizeChange);
  trees.add({ newTrees: onNewTrees }, 'newTrees').name('Neue Bäume wachsen lassen');
  folderEffect.set(trees, 'trees');

  const bloom = gui.addFolder('Leuchten');
  bloom.add(params, 'bloomStrength', 0, 3, 0.01).name('Stärke').onChange(onBloomChange);
  bloom.add(params, 'bloomRadius', 0, 1, 0.01).name('Radius').onChange(onBloomChange);
  bloom.add(params, 'bloomThreshold', 0, 1, 0.01).name('Schwelle').onChange(onBloomChange);

  const quality = gui.addFolder('Qualität');
  quality.add(params, 'renderScale', 0.5, 2, 0.25).name('Renderqualität').onFinishChange(onResolutionChange);
  quality.add(params, 'stats').name('Ressourcen anzeigen').onChange(onStatsChange);

  gui.folders.forEach((folder) => folder.close());

  gui.add({
    reset() {
      // The active effect is chosen in the switcher, not a slider, so it survives a reset
      const { effect } = params;
      Object.assign(params, defaults, { effect });
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      onGalaxyChange();
      onSizeChange();
      onTreesChange();
      onLeafSizeChange();
      onBloomChange();
      onResolutionChange();
      onStatsChange();
      onReset();
    },
  }, 'reset').name('Zurücksetzen');

  // Gear icon (collapsed) and label (expanded) are crossfaded in CSS
  gui.$title.innerHTML = '<span class="gui-icon" aria-hidden="true">⚙︎</span><span class="gui-label">Effekt-Regler</span>';

  return gui;
}

export function showEffectFolders(gui, effect) {
  gui.folders.forEach((folder) => {
    const only = folderEffect.get(folder);
    folder.show(!only || only === effect);
  });
}
