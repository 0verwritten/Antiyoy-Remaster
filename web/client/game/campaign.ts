// Campaign metadata and level construction. A campaign level is either a
// fixed scenario (stored from the Java packs) or a procedurally generated map
// with size/fractions/difficulty fixed by index and a deterministic seed —
// mirroring the original's createLevelWithPredictableRandom (seed = index).

import { createGame, createScenarioGame } from "./engine";
import { scenarioFromLevel, createCampaignGame, type CampaignLevelData } from "./scenario-loader";
import { CAMPAIGN_LEVELS } from "./__generated__/campaign-data";
import type { Difficulty, GameState, MapSize } from "./types";

/** MVP campaign size. Level 0 is the (deferred) scripted tutorial. */
export const CAMPAIGN_LEVEL_COUNT = 24;

export type CampaignDifficulty = "easy" | "normal" | "hard";

export interface CampaignLevelInfo {
  level: number;
  difficulty: CampaignDifficulty;
  /** "fixed" = hand-made scenario from the packs; "generated" = seeded map. */
  kind: "fixed" | "generated";
}

const fixedByLevel = new Map<number, CampaignLevelData>(CAMPAIGN_LEVELS.map((d) => [d.level, d]));

// Original CampaignLevelFactory.getDifficultyByIndex.
function difficultyByIndex(level: number): CampaignDifficulty {
  if (level <= 8) return "easy";
  if (level <= 23) return "normal";
  return "hard";
}

// Original getFractionsQuantityByIndex.
function fractionsByIndex(level: number): number {
  if (level <= 4 || level === 20) return 3;
  if (level <= 7) return 4;
  if (level >= 10 && level <= 13) return 4;
  return 5;
}

// Original getLevelSizeByIndex (LevelSize SMALL/MEDIUM/BIG -> web sizes).
function sizeByIndex(level: number): MapSize {
  if (level === 4 || level === 7) return "medium";
  if (level === 15) return "small";
  if (level === 20 || level === 30 || level === 35) return "large";
  if (level <= 10) return "small";
  if (level <= 40) return "medium";
  return "large";
}

export function campaignLevels(): CampaignLevelInfo[] {
  const out: CampaignLevelInfo[] = [];
  for (let level = 1; level <= CAMPAIGN_LEVEL_COUNT; level++) {
    const fixed = fixedByLevel.get(level);
    out.push({
      level,
      kind: fixed ? "fixed" : "generated",
      difficulty: fixed ? fixed.difficulty : difficultyByIndex(level),
    });
  }
  return out;
}

/** Build the game for a campaign level (fixed scenario or seeded generation). */
export function createCampaignLevelGame(level: number): GameState {
  const fixed = fixedByLevel.get(level);
  if (fixed) return createCampaignGame(fixed);

  // Generated level: deterministic per index, human is fraction 0.
  const state = createGame({
    mapSize: sizeByIndex(level),
    playerCount: fractionsByIndex(level),
    humanCount: 1,
    seed: level,
    difficulty: difficultyByIndex(level),
    mode: "antiyoy",
  });
  state.session = { source: "campaign", campaignLevel: level, objective: { type: "destroyEveryone" } };
  return state;
}

/** A scenario's intro messages, if any (fixed levels only). */
export function campaignIntro(level: number): string[] | undefined {
  const fixed = fixedByLevel.get(level);
  if (!fixed) return undefined;
  return scenarioFromLevel(fixed).intro;
}

/** Result of the human player's campaign objective. */
export type ObjectiveStatus = "ongoing" | "won" | "lost";

export function evaluateCampaign(state: GameState): ObjectiveStatus {
  // The human is always fraction 0 in the campaign.
  if (!state.alive[0]) return "lost";
  const objective = state.session?.objective ?? { type: "destroyEveryone" };
  switch (objective.type) {
    case "destroyKingdom":
      return state.alive[objective.target] ? "ongoing" : "won";
    case "ensureKingdomWins":
      return state.winner === objective.target ? "won" : state.winner !== null ? "lost" : "ongoing";
    case "diplomacy":
      // Diplomatic victory is evaluated once the diplomacy engine exists.
      return state.winner === 0 ? "won" : state.winner !== null ? "lost" : "ongoing";
    case "destroyEveryone":
    default:
      return state.winner === 0 ? "won" : state.winner !== null ? "lost" : "ongoing";
  }
}

// Re-export so the editor/loader path stays available from one module later.
export { createScenarioGame };
