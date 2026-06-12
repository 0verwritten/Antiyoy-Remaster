// Fraction → display color with the player's preferred-color rotation
// (legacy "color_offset": the whole palette rotates so the first player gets
// the chosen color).

import { NEUTRAL_FRACTION } from "./game/constants";
import type { GameConfig } from "./game/types";
import { ORIGINAL_FRACTION_COLORS, ORIGINAL_NEUTRAL_COLOR } from "./sprites";

export function displayFractionColor(config: GameConfig | null | undefined, fraction: number): string {
  if (fraction >= NEUTRAL_FRACTION || fraction < 0) return ORIGINAL_NEUTRAL_COLOR;
  const offset = config?.colorOffset ?? 0;
  return (
    ORIGINAL_FRACTION_COLORS[(fraction + offset) % ORIGINAL_FRACTION_COLORS.length] ??
    ORIGINAL_NEUTRAL_COLOR
  );
}
