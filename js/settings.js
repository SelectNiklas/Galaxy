// Persists the slider values in this browser via localStorage.
// Storage can be unavailable (private mode, blocked site data), so every access falls back to defaults.

const STORAGE_KEY = 'galaxy-settings';

// Stored values override the defaults; unknown keys and values of the wrong type are ignored
export function loadSettings(defaults) {
  const params = { ...defaults };

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored) {
      for (const key of Object.keys(defaults)) {
        if (typeof stored[key] === typeof defaults[key]) params[key] = stored[key];
      }
    }
  } catch {
    // Unreadable or corrupt storage: keep the defaults
  }

  return params;
}

export function saveSettings(params) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // Storage full or blocked: settings just won't persist
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored or storage blocked
  }
}
