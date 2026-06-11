// Player settings, persisted in localStorage like the original's preferences.
// The stored payload is versioned; bump STORAGE_VERSION and extend migrate()
// when the shape changes.

export interface Settings {
  /** Delay between AI players' turns. */
  aiSpeed: "slow" | "normal" | "fast";
  /** Draw hex outlines inside territories too (original draws only province borders). */
  showAllBorders: boolean;
  /** Ready-unit jump animation. */
  unitAnimations: boolean;
  /** Ask before ending the turn. */
  confirmEndTurn: boolean;
}

const KEY = "antiyoy.settings";
const STORAGE_VERSION = 1;

interface StoredSettings extends Settings {
  version: typeof STORAGE_VERSION;
}

const DEFAULTS: Settings = {
  aiSpeed: "normal",
  showAllBorders: false,
  unitAnimations: true,
  confirmEndTurn: false,
};

/** Upgrades any previously stored payload to the current shape. */
function migrate(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULTS };
  // v0 (versionless) and v1 share field names; unknown fields are dropped,
  // missing ones get defaults.
  const data = raw as Partial<StoredSettings>;
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = data[key];
    if (value !== undefined && typeof value === typeof DEFAULTS[key]) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export const settings: Settings = loadSettings();

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return migrate(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings() {
  try {
    const stored: StoredSettings = { version: STORAGE_VERSION, ...settings };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* private browsing etc. — settings just won't persist */
  }
}

export function aiDelayMs(): number {
  switch (settings.aiSpeed) {
    case "slow":
      return 800;
    case "fast":
      return 120;
    default:
      return 400;
  }
}
