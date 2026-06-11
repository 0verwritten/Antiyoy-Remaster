// Gameplay constants taken verbatim from the original Antiyoy source
// (core/src/yio/tro/antiyoy/gameplay/rules/GameRules.java, generic ruleset).

export const NEUTRAL_FRACTION = 7;
export const MAX_PLAYERS = 6;

export const UNIT_MOVE_LIMIT = 4;

export const PRICE_UNIT = 10; // per strength tier
export const PRICE_TOWER = 15;
export const PRICE_FARM = 12; // +2 per farm already in the province
export const FARM_EXTRA_COST = 2;
export const PRICE_STRONG_TOWER = 35;

export const FARM_INCOME = 4; // farm hex yields FARM_INCOME + 1
export const TREE_CUT_REWARD = 3;

export const TAX_TOWER = 1;
export const TAX_STRONG_TOWER = 6;
/** Index by unit strength (1..4). */
export const UNIT_TAX = [0, 2, 6, 18, 36];

export const MAX_UNIT_STRENGTH = 4;

/** Defense value contributed by objects. */
export const DEFENSE_TOWN = 1;
export const DEFENSE_TOWER = 2;
export const DEFENSE_STRONG_TOWER = 3;

/** Tree spread probabilities per turn (original generic ruleset). */
export const PINE_SPREAD_CHANCE = 0.2;
export const PALM_SPREAD_CHANCE = 0.3;

/** Starting treasury for each initial province. */
export const INITIAL_PROVINCE_MONEY = 10;

/** Active island tile counts per map size. */
export const MAP_SIZE_TILES: Record<string, number> = {
  small: 120,
  medium: 230,
  large: 380,
};

/** Bounding grid dimensions (axial) per map size. */
export const MAP_GRID: Record<string, { w: number; h: number }> = {
  small: { w: 17, h: 13 },
  medium: { w: 23, h: 17 },
  large: { w: 29, h: 21 },
};

/** Player fraction colors (UI + minimap). Index = fraction. */
export const FRACTION_COLORS = [
  "#5ac568", // green
  "#e35d5d", // red
  "#5d9be3", // blue
  "#e3c95d", // yellow
  "#b15de3", // purple
  "#5dd6d6", // cyan
];
export const NEUTRAL_COLOR = "#b8b29c";
