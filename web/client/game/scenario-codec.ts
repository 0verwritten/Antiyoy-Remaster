// Parse the original game's level strings into generic Scenarios.
// Two formats are supported, exactly as the legacy game distinguishes them:
//
//   * Legacy full-level: "difficulty size players fractions/HEX#HEX#..."
//     where each HEX is "i1 i2 fraction obj unit ready money" (7 ints).
//   * Sectioned: "antiyoy_level_code#level_size:..#general:diff players fr#
//     land:i1 i2 fraction obj,...#units:i1 i2 strength,...#..".
//
// Object codes follow core/.../Obj.java. Coordinates (index1,index2) map
// directly to the web's axial (q,r) — the adjacency sets are identical.
//
// Anything the web engine cannot represent (fraction outside 0..5 or the
// neutral 7, unit strength outside 1..4, unknown object) makes parsing throw,
// so the converter can reject the level rather than ship a broken map.

import { NEUTRAL_FRACTION } from "./constants";
import type { Difficulty, GameMode, HexObj } from "./types";
import type { Scenario, ScenarioHex } from "./scenario";

const MAX_PLAYER_FRACTION = 5; // web palette has 6 colors (0..5)

const OBJ_BY_CODE: Record<number, HexObj> = {
  0: "none",
  1: "pine",
  2: "palm",
  3: "town",
  4: "tower",
  5: "grave",
  6: "farm",
  7: "strongTower",
};

export class ScenarioParseError extends Error {}

function objFromCode(code: number): HexObj {
  const obj = OBJ_BY_CODE[code];
  if (obj === undefined) throw new ScenarioParseError(`unknown object code ${code}`);
  return obj;
}

function checkFraction(fraction: number): number {
  if (fraction === NEUTRAL_FRACTION) return fraction;
  if (fraction < 0 || fraction > MAX_PLAYER_FRACTION) {
    throw new ScenarioParseError(`unsupported fraction id ${fraction}`);
  }
  return fraction;
}

function checkUnit(strength: number): number {
  if (strength < 1 || strength > 4) throw new ScenarioParseError(`unsupported unit strength ${strength}`);
  return strength;
}

function difficultyFromCode(code: number): Difficulty {
  // Legacy: 0 easy, 1 normal, 2 hard, 3+ expert/balancer/master — clamp to
  // the three the web AI actually distinguishes.
  if (code <= 0) return "easy";
  if (code === 1) return "normal";
  return "hard";
}

/** Distinct colored fractions present, so playerCount reflects the real map. */
function derivePlayerCount(hexes: ScenarioHex[]): number {
  let max = -1;
  for (const h of hexes) {
    if (h.fraction !== NEUTRAL_FRACTION && h.fraction > max) max = h.fraction;
  }
  return Math.max(2, max + 1);
}

function isSectioned(raw: string): boolean {
  return raw.includes("antiyoy_level_code") || raw.includes("#land:");
}

function getSection(raw: string, name: string): string | null {
  const at = raw.indexOf("#" + name);
  if (at < 0) return null;
  const colon = raw.indexOf(":", at);
  if (colon < 0) return null;
  let hash = raw.indexOf("#", colon);
  if (hash < 0) hash = raw.length;
  if (hash - colon < 2) return null;
  return raw.slice(colon + 1, hash);
}

function parseSectioned(raw: string, id: string): Scenario {
  const land = getSection(raw, "land");
  if (!land) throw new ScenarioParseError("sectioned level has no land section");

  const byCoord = new Map<string, ScenarioHex>();
  for (const token of land.split(",")) {
    const t = token.trim();
    if (!t) continue;
    const parts = t.split(/\s+/).map(Number);
    const [i1, i2, fraction, obj] = parts;
    if (![i1, i2, fraction, obj].every(Number.isFinite)) {
      throw new ScenarioParseError(`bad land token "${t}"`);
    }
    const hex: ScenarioHex = {
      q: i1,
      r: i2,
      fraction: checkFraction(fraction),
      obj: objFromCode(obj),
    };
    byCoord.set(`${i1},${i2}`, hex);
  }

  const units = getSection(raw, "units");
  if (units) {
    for (const token of units.split(",")) {
      const t = token.trim();
      if (!t) continue;
      const [i1, i2, strength] = t.split(/\s+/).map(Number);
      const hex = byCoord.get(`${i1},${i2}`);
      if (hex) hex.unit = checkUnit(strength);
    }
  }

  // Province treasuries live in "provinces": "i1@i2@id@name@money" per entry,
  // attached to the province's capital hex.
  const provinces = getSection(raw, "provinces");
  if (provinces) {
    for (const token of provinces.split(",")) {
      const t = token.trim();
      if (!t) continue;
      const fields = t.split("@");
      if (fields.length < 5) continue;
      const i1 = Number(fields[0]);
      const i2 = Number(fields[1]);
      const money = Number(fields[fields.length - 1]);
      const hex = byCoord.get(`${i1},${i2}`);
      if (hex && Number.isFinite(money)) hex.money = money;
    }
  }

  const hexes = [...byCoord.values()];
  const general = getSection(raw, "general");
  const generalParts = general ? general.split(/\s+/).map(Number) : [];
  const difficulty = generalParts.length ? difficultyFromCode(generalParts[0]) : "normal";
  const name = getSection(raw, "map_name") ?? id;
  const editorInfo = getSection(raw, "editor_info");
  const editorParts = editorInfo ? editorInfo.trim().split(/\s+/) : [];
  const diplomacy = editorParts[1] === "true";
  const fogOfWar = editorParts[2] === "true";

  return {
    id,
    name,
    mode: "antiyoy",
    playerCount: derivePlayerCount(hexes),
    humanCount: 1,
    difficulty,
    hexes,
    diplomacy,
    fogOfWar,
  };
}

function parseFullLevel(raw: string, id: string): Scenario {
  const slash = raw.indexOf("/");
  if (slash < 0) throw new ScenarioParseError("full level has no '/' header separator");
  const header = raw
    .slice(0, slash)
    .trim()
    .split(/\s+/)
    .map(Number);
  const difficulty = difficultyFromCode(header[0] ?? 1);

  const hexes: ScenarioHex[] = [];
  for (const token of raw.slice(slash + 1).split("#")) {
    const t = token.trim();
    if (!t) continue;
    const v = t.split(/\s+/).map(Number);
    if (v.length < 3 || !v.every(Number.isFinite)) {
      throw new ScenarioParseError(`bad hex token "${t}"`);
    }
    const hex: ScenarioHex = {
      q: v[0],
      r: v[1],
      fraction: checkFraction(v[2]),
      obj: objFromCode(v[3] ?? 0),
    };
    if (v[4] > 0) {
      hex.unit = checkUnit(v[4]);
      hex.unitReady = v[5] === 1;
    }
    if (Number.isFinite(v[6])) hex.money = v[6];
    hexes.push(hex);
  }
  if (hexes.length === 0) throw new ScenarioParseError("full level has no hexes");

  return {
    id,
    name: id,
    mode: "antiyoy",
    playerCount: derivePlayerCount(hexes),
    humanCount: 1,
    difficulty,
    hexes,
  };
}

/** Parse either legacy format into a Scenario, throwing on unsupported content. */
export function parseLevelString(raw: string, id: string): Scenario {
  const trimmed = raw.trim();
  if (trimmed === "-" || trimmed.length < 5) {
    throw new ScenarioParseError("empty level slot");
  }
  return isSectioned(trimmed) ? parseSectioned(trimmed, id) : parseFullLevel(trimmed, id);
}
