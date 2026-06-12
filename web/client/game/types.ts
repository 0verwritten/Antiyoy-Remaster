// Shared game types for the Antiyoy web remaster.
// Keep this file free of DOM, Node, env, and Lakebed runtime imports.

/** Object occupying a hex tile. */
export type HexObj =
  | "none"
  | "pine"
  | "palm"
  | "town" // province capital, defense 1
  | "tower" // defense 2
  | "strongTower" // defense 3
  | "farm"
  | "grave";

/** Fraction 0..N-1 are players; NEUTRAL_FRACTION marks unowned land. */
export type Fraction = number;

export interface Unit {
  /** 1..4 */
  strength: number;
  /** True if the unit can still move this turn. */
  readyToMove: boolean;
}

export interface HexTile {
  /** Stable index into GameState.hexes */
  index: number;
  /** Axial coordinates */
  q: number;
  r: number;
  /** False = water (not part of the island) */
  active: boolean;
  fraction: Fraction;
  obj: HexObj;
  unit: Unit | null;
  /** Round when a tree sprouted here; it may seed only on later rounds. */
  treeBorn?: number;
  /** Precomputed indices of the (up to 6) active neighbors. */
  neighbors: number[];
}

export interface Province {
  id: number;
  fraction: Fraction;
  /** Hex indices belonging to this province (always >= 2). */
  hexes: number[];
  money: number;
  /** Hex index of the capital (town). -1 if capital was destroyed and not yet re-placed. */
  capital: number;
}

export type MapSize = "small" | "medium" | "large" | "huge";

export type Difficulty = "easy" | "normal" | "hard";

/**
 * "antiyoy": players start with one small province each and conquer the
 * neutral island (like the original game). "slay": the whole island is
 * divided between players from the start.
 */
export type GameMode = "antiyoy" | "slay";

export interface GameConfig {
  mapSize: MapSize;
  /** Total players, 2..6 (2..5 on small maps). Player fraction 0 is always the human unless humanCount is 0. */
  playerCount: number;
  /** How many of the players are humans (hotseat). 0 = AI-only spectator game. */
  humanCount: number;
  /** RNG seed. Same seed + config => same map. */
  seed: number;
  /** AI strength. Defaults to "normal" when omitted. */
  difficulty?: Difficulty;
  /** Territory setup. Defaults to "antiyoy" when omitted. */
  mode?: GameMode;
  /** Tree spawn chance in percent (legacy values 0..100). Defaults to 10. */
  treePercentage?: number;
  /** Starting provinces per player in antiyoy mode. 0/omitted = map-size default (1/2/3/4). */
  startingProvinces?: 0 | 1 | 2 | 3 | 4;
  /** Rotates the fraction palette so the first human gets the chosen color. */
  colorOffset?: number;
  /** Not implemented yet — reserved so saved configs stay forward-compatible. */
  fogOfWar?: boolean;
  /** Not implemented yet — reserved so saved configs stay forward-compatible. */
  diplomacy?: boolean;
}

export interface GameState {
  config: GameConfig;
  /** All tiles, including inactive water tiles. Index = HexTile.index. */
  hexes: HexTile[];
  provinces: Province[];
  /** Fraction whose turn it is. */
  turn: Fraction;
  /** Increments every full round (all players moved). */
  round: number;
  /** Mutable RNG state for deterministic tree spread. */
  rngState: number;
  /** Fractions still alive (own at least one province). */
  alive: boolean[];
  /** Winner fraction, or null while the game is running. */
  winner: Fraction | null;
  /** Monotonic counter bumped on every applied action (for UI memoization). */
  version: number;
  /** Deterministic allocator for province identities, including replay reconstruction. */
  nextProvinceId: number;
}

/** Actions a player (human or AI) can take. All validated by the engine. */
export type Action =
  | {
      type: "buyUnit";
      provinceId: number;
      strength: number;
      /** Target hex: own empty/mergeable hex, or attackable border hex. */
      target: number;
    }
  | { type: "moveUnit"; from: number; to: number }
  | {
      type: "build";
      kind: "farm" | "tower" | "strongTower";
      provinceId: number;
      target: number;
    }
  | { type: "endTurn" };

export interface ActionResult {
  ok: boolean;
  /** Human-readable reason when ok=false. */
  reason?: string;
}
