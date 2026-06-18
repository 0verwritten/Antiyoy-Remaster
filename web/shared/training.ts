import type { GameConfig, GameState, ReplayStep } from "../client/game/types";

export const TRAINING_RECORD_VERSION = 1;
export const TRAINING_CHUNK_SIZE = 60_000;

export type BattleSource = "local" | "online";

export interface TrainingBattleMetadata {
  version: typeof TRAINING_RECORD_VERSION;
  source: BattleSource;
  config: GameConfig;
  winner: number | null;
  outcome: "victory" | "draw" | "resignation" | "campaign-won" | "campaign-lost";
  rounds: number;
  humanCount: number;
  initialChunkCount: number;
  stepChunkCount: number;
}

export interface TrainingBattleExport extends TrainingBattleMetadata {
  id: string;
  createdAt: string;
  initial: GameState;
  steps: ReplayStep[];
}

