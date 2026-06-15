// Campaign metadata and level construction. A campaign level is either a
// fixed scenario (raw string hosted on the CDN, metadata in-bundle) or a
// procedurally generated map with size/fractions/difficulty fixed by index
// and a deterministic seed — mirroring the original's
// createLevelWithPredictableRandom (seed = index). Levels whose original
// string can't be represented on the web fall back to a generated map.

import { createGame, createScenarioGame } from "./engine";
import { createCampaignGame } from "./scenario-loader";
import { ensureCampaignData, getFixedLevelRaw, isCampaignDataLoaded } from "./campaign-data";
import { CAMPAIGN_LEVEL_COUNT, FIXED_LEVEL_META } from "./__generated__/campaign-index";
import type { GameState, MapSize } from "./types";

export { CAMPAIGN_LEVEL_COUNT, ensureCampaignData };

export type CampaignDifficulty = "easy" | "normal" | "hard";

export interface CampaignLevelInfo {
  level: number;
  difficulty: CampaignDifficulty;
  /** "fixed" = hand-made scenario from the packs; "generated" = seeded map. */
  kind: "fixed" | "generated";
}

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

function isFixed(level: number): boolean {
  return Object.prototype.hasOwnProperty.call(FIXED_LEVEL_META, level);
}

export function campaignLevels(): CampaignLevelInfo[] {
  const out: CampaignLevelInfo[] = [];
  for (let level = 1; level <= CAMPAIGN_LEVEL_COUNT; level++) {
    const fixed = FIXED_LEVEL_META[level];
    out.push({
      level,
      kind: fixed ? "fixed" : "generated",
      difficulty: fixed ? fixed.difficulty : difficultyByIndex(level),
    });
  }
  return out;
}

/** True if the level needs the hosted data fetched before it can be built. */
export function levelNeedsData(level: number): boolean {
  return isFixed(level) && !isCampaignDataLoaded();
}

function buildGeneratedLevel(level: number): GameState {
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

/**
 * Build the game for a campaign level. For fixed levels the hosted data must
 * already be loaded (call ensureCampaignData() first, e.g. on the campaign
 * screen); if it isn't, falls back to a generated map so play never blocks.
 */
export function createCampaignLevelGame(level: number): GameState {
  const meta = FIXED_LEVEL_META[level];
  if (meta) {
    const raw = getFixedLevelRaw(level);
    if (raw) {
      return createCampaignGame({
        level,
        name: meta.name,
        raw,
        difficulty: meta.difficulty,
        playerCount: meta.playerCount,
      });
    }
  }
  return buildGeneratedLevel(level);
}

/** Result of the human player's campaign objective. */
export type ObjectiveStatus = "ongoing" | "won" | "lost";

export function evaluateCampaign(state: GameState): ObjectiveStatus {
  if (state.endReason === "draw") return "lost";
  // The human is always fraction 0 in the campaign.
  if (!state.alive[0]) return "lost";
  const objective = state.session?.objective ?? { type: "destroyEveryone" };
  switch (objective.type) {
    case "destroyKingdom":
      return state.alive[objective.target] ? "ongoing" : "won";
    case "ensureKingdomWins":
      return state.winner === objective.target ? "won" : state.winner !== null ? "lost" : "ongoing";
    case "diplomacy":
      return state.winner === 0 ? "won" : state.winner !== null ? "lost" : "ongoing";
    case "destroyEveryone":
    default:
      return state.winner === 0 ? "won" : state.winner !== null ? "lost" : "ongoing";
  }
}

export { createScenarioGame };
