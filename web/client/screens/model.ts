// UI screen model shared by the app shell and the screen components.

/** Top-level UI screen. Grows as legacy menus are ported (main, chooseMode, …). */
export type Screen =
  | { kind: "start" }
  | { kind: "game" }
  | { kind: "pass"; fraction: number }; // hotseat interstitial

/** In-game placement / selection mode. */
export type Pending =
  | { kind: "none" }
  | { kind: "unit"; from: number } // a unit is selected, show its move zone
  | { kind: "buy"; provinceId: number; strength: number }
  | { kind: "build"; provinceId: number; buildKind: "farm" | "tower" | "strongTower" };
