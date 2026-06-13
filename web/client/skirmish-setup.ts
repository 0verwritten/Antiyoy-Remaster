// Last-used skirmish setup, persisted like the original's "skirmish"
// preferences. Versioned; extend migrate() when the shape changes.

import { maxPlayersForMapSize, TREES_PERCENTAGES } from "./game/constants";
import type { Difficulty, GameMode, MapSize } from "./game/types";

export interface SkirmishSetup {
  mapSize: MapSize;
  playerCount: number;
  humanCount: number;
  difficulty: Difficulty;
  mode: GameMode;
  treePercentage: number;
  startingProvinces: 0 | 1 | 2 | 3 | 4;
  colorOffset: number;
  fogOfWar: boolean;
}

const KEY = "antiyoy.skirmish";
const STORAGE_VERSION = 1;

export const DEFAULT_SETUP: SkirmishSetup = {
  mapSize: "medium",
  playerCount: 2,
  humanCount: 1,
  difficulty: "normal",
  mode: "antiyoy",
  treePercentage: 10,
  startingProvinces: 0,
  colorOffset: 0,
  fogOfWar: false,
};

function migrate(raw: unknown): SkirmishSetup {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETUP };
  const data = raw as Partial<SkirmishSetup>;
  const out = { ...DEFAULT_SETUP };
  if (data.mapSize === "small" || data.mapSize === "medium" || data.mapSize === "large" || data.mapSize === "huge") {
    out.mapSize = data.mapSize;
  }
  const maxPlayers = maxPlayersForMapSize(out.mapSize);
  if (typeof data.playerCount === "number") {
    out.playerCount = Math.min(Math.max(Math.round(data.playerCount), 2), maxPlayers);
  }
  if (typeof data.humanCount === "number") {
    out.humanCount = Math.min(Math.max(Math.round(data.humanCount), 0), out.playerCount);
  }
  if (data.difficulty === "easy" || data.difficulty === "normal" || data.difficulty === "hard") {
    out.difficulty = data.difficulty;
  }
  if (data.mode === "antiyoy" || data.mode === "slay") out.mode = data.mode;
  if (typeof data.treePercentage === "number" && TREES_PERCENTAGES.includes(data.treePercentage)) {
    out.treePercentage = data.treePercentage;
  }
  if (
    data.startingProvinces === 0 ||
    data.startingProvinces === 1 ||
    data.startingProvinces === 2 ||
    data.startingProvinces === 3 ||
    data.startingProvinces === 4
  ) {
    out.startingProvinces = data.startingProvinces;
  }
  if (typeof data.colorOffset === "number" && data.colorOffset >= 0 && data.colorOffset < 6) {
    out.colorOffset = Math.round(data.colorOffset);
  }
  if (typeof data.fogOfWar === "boolean") out.fogOfWar = data.fogOfWar;
  return out;
}

export function loadSkirmishSetup(): SkirmishSetup {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETUP };
    return migrate(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETUP };
  }
}

export function saveSkirmishSetup(setup: SkirmishSetup) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: STORAGE_VERSION, ...setup }));
  } catch {
    /* private browsing etc. */
  }
}
