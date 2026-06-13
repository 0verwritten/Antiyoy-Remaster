// Serializable scenario contract: a fully-specified starting position the
// engine can load (campaign levels today; editor/user levels later). The
// engine consumes generic Scenarios and never depends on campaign modules.

import type { Difficulty, Fraction, GameMode, HexObj, Objective } from "./types";

/** One placed tile. Coordinates are axial (q,r) — legacy index1/index2 map directly. */
export interface ScenarioHex {
  q: number;
  r: number;
  /** 0..5 player, 7 neutral. */
  fraction: Fraction;
  obj: HexObj;
  /** Unit strength 1..4, if any. */
  unit?: number;
  /** Whether that unit can move on turn 1 (legacy "ready" flag). */
  unitReady?: boolean;
  /** Province treasury carried on this hex (only meaningful on a capital). */
  money?: number;
}

export interface Scenario {
  id: string;
  name: string;
  mode: GameMode;
  /** Total fractions in play (colored players, not counting neutral). */
  playerCount: number;
  /** How many are humans (campaign = 1). */
  humanCount: number;
  difficulty?: Difficulty;
  hexes: ScenarioHex[];
  objective?: Objective;
  /** Introductory messages shown before the level. */
  intro?: string[];
  /** Carried for forward compatibility; not yet consumed by the engine. */
  fogOfWar?: boolean;
  diplomacy?: boolean;
}
