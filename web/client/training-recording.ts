import type { GameState, ReplayStep } from "./game/types";
import {
  TRAINING_CHUNK_SIZE,
  TRAINING_RECORD_VERSION,
  type TrainingBattleMetadata,
} from "../shared/training";

export interface TrainingMutations {
  create: (metadata: TrainingBattleMetadata) => Promise<string>;
  append: (battleId: string, kind: "initial" | "steps", sequence: number, content: string) => Promise<void>;
  finish: (battleId: string) => Promise<void>;
}

function splitText(value: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += TRAINING_CHUNK_SIZE) {
    chunks.push(value.slice(offset, offset + TRAINING_CHUNK_SIZE));
  }
  return chunks.length ? chunks : [""];
}

/** Split steps into independently parseable JSON arrays below the DB value limit. */
function batchSteps(steps: ReplayStep[]): string[] {
  const batches: string[] = [];
  let current: ReplayStep[] = [];
  for (const step of steps) {
    const candidate = JSON.stringify([...current, step]);
    if (candidate.length > TRAINING_CHUNK_SIZE && current.length) {
      batches.push(JSON.stringify(current));
      current = [step];
    } else {
      current.push(step);
    }
  }
  if (current.length) batches.push(JSON.stringify(current));
  return batches;
}

export async function uploadHumanBattle(
  mutations: TrainingMutations,
  state: GameState,
  initial: GameState,
  steps: ReplayStep[],
  outcome: TrainingBattleMetadata["outcome"]
): Promise<void> {
  if (state.config.humanCount < 1) return;
  const initialChunks = splitText(JSON.stringify(initial));
  const stepChunks = batchSteps(steps);
  const battleId = await mutations.create({
    version: TRAINING_RECORD_VERSION,
    source: "local",
    config: state.config,
    winner: state.winner,
    outcome,
    rounds: state.round,
    humanCount: state.config.humanCount,
    initialChunkCount: initialChunks.length,
    stepChunkCount: stepChunks.length,
  });
  for (let i = 0; i < initialChunks.length; i++) await mutations.append(battleId, "initial", i, initialChunks[i]);
  for (let i = 0; i < stepChunks.length; i++) await mutations.append(battleId, "steps", i, stepChunks[i]);
  await mutations.finish(battleId);
}

