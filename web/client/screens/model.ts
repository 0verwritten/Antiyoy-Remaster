// UI screen model shared by the app shell and the screen components.

/**
 * Top-level UI screen. Mirrors the legacy menu hierarchy; destinations are
 * added as they are implemented (campaign, load, replays, editor…) — never
 * as dead buttons. "Play" routes straight to skirmish until a second game
 * destination exists.
 */
export type Screen =
  | { kind: "main" }
  | { kind: "skirmish" }
  | { kind: "settings" }
  | { kind: "about" }
  | { kind: "game" }
  | { kind: "pass"; fraction: number }; // hotseat interstitial

/** In-game placement / selection mode. */
export type Pending =
  | { kind: "none" }
  | { kind: "unit"; from: number } // a unit is selected, show its move zone
  | { kind: "buy"; provinceId: number; strength: number }
  | { kind: "build"; provinceId: number; buildKind: "farm" | "tower" | "strongTower" };
