// Glue between stored/compact campaign data and the engine's scenario loader.
// Campaign levels are stored as their original (compact) legacy strings and
// parsed on demand through the codec, so no large expanded data ships in the
// bundle.

import { createScenarioGame } from "./engine";
import { parseLevelString } from "./scenario-codec";
import type { Scenario } from "./scenario";
import type { GameState, Objective } from "./types";

/** A campaign level: metadata from __generated__/campaign-index.ts plus its
 * raw string (hosted, fetched via campaign-data.ts). */
export interface CampaignLevelData {
  /** 1-based campaign index. */
  level: number;
  name: string;
  /** Original legacy level string (full-level or sectioned). */
  raw: string;
  difficulty: "easy" | "normal" | "hard";
  playerCount: number;
}

export function scenarioFromLevel(data: CampaignLevelData): Scenario {
  const scenario = parseLevelString(data.raw, `campaign-${data.level}`);
  scenario.name = data.name;
  // Campaign levels are won by being the last kingdom standing unless a
  // future diplomatic objective overrides it.
  scenario.objective = scenario.objective ?? { type: "destroyEveryone" };
  return scenario;
}

export function createCampaignGame(data: CampaignLevelData): GameState {
  const scenario = scenarioFromLevel(data);
  const objective: Objective = scenario.objective ?? { type: "destroyEveryone" };
  return createScenarioGame(scenario, {
    source: "campaign",
    campaignLevel: data.level,
    objective,
  });
}
