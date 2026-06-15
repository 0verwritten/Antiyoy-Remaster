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
  /** Ask before ending the turn (original "cautious end turn"). */
  confirmEndTurn: boolean;
  /** Camera pan/zoom speed multiplier (original sensitivity, index/6, default 1.0). */
  cameraSensitivity: number;
  /** Long-press a tile of the selected province to march its units there. */
  holdToMarch: boolean;
  /** Swap the undo and end-turn corners for left-handed play. */
  leftHanded: boolean;
  /** Show the Resume button on the main menu when a game is running. */
  showResumeButton: boolean;
  /** After a unit moves, automatically select the next useful ready unit. */
  autoTransition: boolean;
  /** Show elapsed time for the current turn and duration of the previous turn. */
  showTurnTimer: boolean;
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
  cameraSensitivity: 1,
  holdToMarch: true,
  leftHanded: false,
  showResumeButton: true,
  autoTransition: false,
  showTurnTimer: false,
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

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings();
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
