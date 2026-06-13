// Scenario foundation tests: the codec parses both legacy formats and the
// engine loads them with the expected map, owners, units, structures,
// province money, capitals and starting turn. Also smoke-loads every
// converted campaign level. Run from repo root: npx tsx devtools/scenario-tests.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScenarioGame, getProvinceByHex } from "../web/client/game/engine";
import { parseLevelString } from "../web/client/game/scenario-codec";
import { scenarioFromLevel, createCampaignGame, type CampaignLevelData } from "../web/client/game/scenario-loader";
import { FIXED_LEVEL_META } from "../web/client/game/__generated__/campaign-index";
import { NEUTRAL_FRACTION } from "../web/client/game/constants";
import type { GameState } from "../web/client/game/types";

// Hosted level strings live on disk (CDN at runtime); load them for tests.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawByLevel: Record<number, string> = JSON.parse(
  readFileSync(join(repoRoot, "assets/web/campaign-levels.json"), "utf8")
);
const CAMPAIGN_LEVELS: CampaignLevelData[] = Object.entries(FIXED_LEVEL_META).map(([lvl, meta]) => ({
  level: Number(lvl),
  name: meta.name,
  difficulty: meta.difficulty,
  playerCount: meta.playerCount,
  raw: rawByLevel[Number(lvl)],
}));

let checks = 0;
function assert(cond: boolean, message: string) {
  checks++;
  if (!cond) throw new Error("FAIL: " + message);
}

function hexAt(state: GameState, q: number, r: number) {
  return state.hexes.find((h) => h.q === q && h.r === r && h.active) ?? null;
}

// --- hand-crafted full-level fixture: exact owners/units/structures/money ----
{
  // header: difficulty size players fractions ; hexes: i1 i2 fraction obj unit ready money
  const raw =
    "1 1 1 7/" +
    "0 0 0 3 0 0 25#" + // fraction 0 capital (town), money 25
    "1 0 0 0 2 1 10#" + // fraction 0, strength-2 unit, ready
    "0 1 0 0 0 0 10#" + // fraction 0, empty
    "5 0 1 3 0 0 15#" + // fraction 1 capital (town), money 15
    "6 0 1 0 0 0 10#" + // fraction 1, empty
    "5 1 1 4 0 0 10#" + // fraction 1, tower
    "3 0 7 0 0 0 10"; //   neutral
  const scenario = parseLevelString(raw, "fixture-full");
  assert(scenario.mode === "antiyoy", "full fixture mode antiyoy");
  assert(scenario.playerCount === 2, `full fixture playerCount 2 (got ${scenario.playerCount})`);

  const st = createScenarioGame(scenario);
  assert(st.turn === 0 && st.round === 0, "fresh scenario starts at turn 0, round 0");
  assert(st.provinces.length === 2, `two provinces (got ${st.provinces.length})`);

  // Owners
  assert(hexAt(st, 0, 0)!.fraction === 0, "hex (0,0) owned by fraction 0");
  assert(hexAt(st, 5, 0)!.fraction === 1, "hex (5,0) owned by fraction 1");
  assert(hexAt(st, 3, 0)!.fraction === NEUTRAL_FRACTION, "hex (3,0) neutral");

  // Structures + capitals
  assert(hexAt(st, 0, 0)!.obj === "town", "capital town at (0,0)");
  assert(hexAt(st, 5, 1)!.obj === "tower", "tower preserved at (5,1)");
  const p0 = getProvinceByHex(st, hexAt(st, 0, 0)!.index)!;
  const p1 = getProvinceByHex(st, hexAt(st, 5, 0)!.index)!;
  assert(st.hexes[p0.capital].q === 0 && st.hexes[p0.capital].r === 0, "province 0 capital is (0,0)");
  assert(st.hexes[p1.capital].obj === "town", "province 1 capital is a town");

  // Units
  const u = hexAt(st, 1, 0)!.unit;
  assert(!!u && u.strength === 2, "strength-2 unit at (1,0)");

  // Province money: fraction 1 untouched on turn 0 keeps its scenario value.
  assert(p1.money === 15, `province 1 keeps scenario money 15 (got ${p1.money})`);
  // Fraction 0 got first-turn income on top of its scenario money.
  assert(p0.money !== 10, "province 0 money came from the scenario, not the default");
}

// --- hand-crafted sectioned fixture: land/units/provinces sections -----------
{
  const raw =
    "antiyoy_level_code#level_size:2#general:1 1 2#map_name:Test#editor_info:0 false false " +
    "#land:0 0 0 3,1 0 0 0,0 1 0 0,5 0 1 3,6 0 1 0,5 1 1 0,3 0 7 0" +
    "#units:1 0 3 false," +
    "#provinces:0@0@1@Alpha@40,5@0@2@Beta@20#messages:#";
  const scenario = parseLevelString(raw, "fixture-sectioned");
  assert(scenario.name === "Test", "sectioned map_name parsed");
  assert(scenario.playerCount === 2, "sectioned playerCount 2");

  const st = createScenarioGame(scenario);
  assert(st.provinces.length === 2, "sectioned: two provinces");
  assert(hexAt(st, 0, 0)!.obj === "town", "sectioned capital town at (0,0)");
  const u = hexAt(st, 1, 0)!.unit;
  assert(!!u && u.strength === 3, "sectioned strength-3 unit at (1,0)");
  const beta = getProvinceByHex(st, hexAt(st, 5, 0)!.index)!;
  assert(beta.money === 20, `sectioned province Beta money 20 (got ${beta.money})`);
}

// --- rejection: unsupported content makes the codec throw --------------------
{
  let threw = false;
  try {
    parseLevelString("1 1 1 7/0 0 9 0 0 0 10#1 0 9 0 0 0 10", "bad-fraction");
  } catch {
    threw = true;
  }
  assert(threw, "unsupported fraction id is rejected");

  threw = false;
  try {
    parseLevelString("1 1 1 7/0 0 0 0 9 0 10#1 0 0 0 0 0 10", "bad-unit");
  } catch {
    threw = true;
  }
  assert(threw, "unsupported unit strength is rejected");
}

// --- every converted campaign level loads and is structurally sane ----------
{
  assert(CAMPAIGN_LEVELS.length > 0, "campaign data is non-empty");
  for (const data of CAMPAIGN_LEVELS) {
    const scenario = scenarioFromLevel(data);
    const st = createCampaignGame(data);
    assert(st.session?.source === "campaign", `level ${data.level}: campaign session`);
    assert(st.session?.campaignLevel === data.level, `level ${data.level}: session level matches`);
    assert(st.provinces.length >= 1, `level ${data.level}: has provinces`);
    assert(st.config.playerCount >= 2, `level ${data.level}: 2+ players`);
    // Every province must have a real town capital and >=2 hexes.
    for (const p of st.provinces) {
      if (st.hexes[p.capital]?.obj !== "town") {
        throw new Error(`FAIL: level ${data.level} province ${p.id} has no town capital`);
      }
      if (p.hexes.length < 2) throw new Error(`FAIL: level ${data.level} province ${p.id} < 2 hexes`);
    }
    // Determinism: same data loads identically.
    const again = createCampaignGame(data);
    if (JSON.stringify(again) !== JSON.stringify(st)) {
      throw new Error(`FAIL: level ${data.level} not deterministic`);
    }
    // Replay/undo rely on structuredClone working on the state.
    structuredClone(st);
    void scenario;
  }
}

console.log(`SCENARIO TESTS PASSED (${checks} assertions, ${CAMPAIGN_LEVELS.length} campaign levels)`);
