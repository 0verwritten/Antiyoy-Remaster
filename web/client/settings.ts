// Player settings, persisted in localStorage like the original's preferences.

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

const DEFAULTS: Settings = {
  aiSpeed: "normal",
  showAllBorders: false,
  unitAnimations: true,
  confirmEndTurn: false,
};

export const settings: Settings = loadSettings();

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
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
