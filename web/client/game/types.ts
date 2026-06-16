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

export type Difficulty = "easy" | "normal" | "hard" | "expert" | "balancer" | "master";

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
  /**
   * "Night Battle" visual mode: a black battlefield lit only by bases, houses
   * and lanterns. Friendly (human) territory glows warm yellow; each enemy
   * glows a distinct cold-to-warm white (4000K–7000K). Purely cosmetic — the
   * rules are unchanged.
   */
  nightBattle?: boolean;
  /** Fog-of-war visibility for human/spectator rendering. */
  fogOfWar?: boolean;
  /** Enables neutral/friend/war relations, proposals, contracts and diplomatic victory. */
  diplomacy?: boolean;
}

/** Pairwise diplomatic relation (original: NEUTRAL / FRIEND / ENEMY). */
export type Relation = "neutral" | "friend" | "war";

/** A timed diplomatic agreement; expires at round `expires`. */
export interface DiploContract {
  type: "friendship" | "peace" | "blackMark" | "subsidy";
  a: Fraction;
  b: Fraction;
  /** Round at which the contract lapses. */
  expires: number;
  /** Subsidy only: `a` pays `b` this much per round (capped at pay time). */
  subsidy?: number;
}

/** A pending offer from one player to another, awaiting accept/reject. */
export interface DiploProposal {
  id: number;
  from: Fraction;
  to: Fraction;
  kind: "friendship" | "stopWar" | "subsidy" | "gift";
  /** Money amount for gift/subsidy. */
  amount?: number;
}

export interface DiploLogEntry {
  round: number;
  from: Fraction;
  to: Fraction;
  text: string;
}

export interface DiplomacyState {
  /** relations[a][b] — always symmetric. */
  relations: Relation[][];
  /** Rounds remaining before war between a,b can be ended again. */
  stopWarCooldown: number[][];
  /** Fractions currently black-marked (open season). */
  blackMarks: Fraction[];
  contracts: DiploContract[];
  proposals: DiploProposal[];
  log: DiploLogEntry[];
  nextProposalId: number;
  /** Per-fraction reputation/attitude, consumed by the diplomatic AI. */
  reputation: number[];
}

/** Win condition for a scenario/campaign level. */
export type Objective =
  | { type: "destroyEveryone" }
  | { type: "destroyKingdom"; target: Fraction }
  | { type: "ensureKingdomWins"; target: Fraction }
  | { type: "diplomacy" };

/** Where a game came from, plus its objective. Generated games omit objective. */
export interface GameSession {
  source: "generated" | "campaign";
  campaignLevel?: number;
  objective?: Objective;
}

export interface GameState {
  config: GameConfig;
  /** Provenance + objective. Omitted on legacy/older saves (treated as generated). */
  session?: GameSession;
  /** Diplomacy state, present only when config.diplomacy is on. */
  diplomacy?: DiplomacyState;
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
  /** A capture eliminated a player; victory is finalized by the next end-turn action. */
  victoryPending?: boolean;
  /** Non-victory ending, or why the final winner was decided early. */
  endReason?: "draw" | "resignation";
  /** Fractions that voluntarily left the match. */
  resigned?: Fraction[];
  /** Wall-clock timestamp for the beginning of the current turn. */
  turnStartedAt?: number;
  /** Completed and interrupted turns, retained across saves and online sync. */
  turnHistory?: TurnTiming[];
  /** Monotonic counter bumped on every applied action (for UI memoization). */
  version: number;
  /** Deterministic allocator for province identities, including replay reconstruction. */
  nextProvinceId: number;
}

export interface TurnTiming {
  fraction: Fraction;
  round: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  endedBy: "endTurn" | "draw" | "resignation";
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
  | { type: "endTurn"; endedAt?: number }
  | { type: "draw"; endedAt?: number }
  | { type: "resign"; fraction: Fraction; endedAt?: number }
  // --- diplomacy (only valid when config.diplomacy is on); actor = current turn ---
  | { type: "declareWar"; target: Fraction }
  | { type: "setBlackMark"; target: Fraction }
  | { type: "proposeExchange"; to: Fraction; kind: "friendship" | "stopWar" | "subsidy" | "gift"; amount?: number }
  | { type: "acceptExchange"; proposalId: number }
  | { type: "rejectExchange"; proposalId: number };

export interface ActionResult {
  ok: boolean;
  /** Human-readable reason when ok=false. */
  reason?: string;
}

/** One recorded step of a game, for replays and saved games. */
export interface ReplayStep {
  action: Action;
  actor: number;
  /** Per-fraction treasury change caused by this action. */
  moneyDelta: number[];
}
