// Tree territory rule tests. Run from repo root:
//   npx tsx devtools/tree-territory-tests.ts

import {
  applyAction,
  createScenarioGame,
  getBuyZone,
  getMoveZone,
  getProvinceByHex,
} from "../web/client/game/engine";
import { TREE_CUT_REWARD } from "../web/client/game/constants";
import type { Scenario } from "../web/client/game/scenario";
import type { GameState } from "../web/client/game/types";

let checks = 0;
function assert(cond: boolean, message: string) {
  checks++;
  if (!cond) throw new Error("FAIL: " + message);
}

function treeRulesScenario(unitStrength: number): Scenario {
  return {
    id: "tree-territory-fixture",
    name: "Tree Territory Fixture",
    mode: "antiyoy",
    playerCount: 2,
    humanCount: 2,
    difficulty: "normal",
    diplomacy: true,
    hexes: [
      { q: 0, r: 0, fraction: 0, obj: "town", money: 100 },
      { q: 1, r: 0, fraction: 0, obj: "none", unit: unitStrength, unitReady: true },
      { q: 0, r: 1, fraction: 0, obj: "pine" },
      { q: 2, r: 0, fraction: 1, obj: "pine" },
      { q: 3, r: 0, fraction: 1, obj: "tower" },
      { q: 4, r: 0, fraction: 1, obj: "town", money: 25 },
    ],
  };
}

function game(unitStrength = 1): GameState {
  const state = createScenarioGame(treeRulesScenario(unitStrength));
  state.turnStartedAt = 0;
  state.turnHistory = [];
  return state;
}

function hexAt(state: GameState, q: number, r: number) {
  const hex = state.hexes.find((h) => h.q === q && h.r === r && h.active);
  assert(!!hex, `fixture has active hex (${q},${r})`);
  return hex!;
}

function province0(state: GameState) {
  const province = getProvinceByHex(state, hexAt(state, 0, 0).index);
  assert(!!province, "fraction 0 has a province");
  return province!;
}

// Trees do not bypass diplomacy: neutral relations block both movement and buy attacks.
{
  const state = game();
  const unit = hexAt(state, 1, 0);
  const enemyTree = hexAt(state, 2, 0);
  const province = province0(state);

  assert(!getMoveZone(state, unit.index).includes(enemyTree.index), "neutral enemy tree excluded from move zone");
  assert(!getBuyZone(state, province, 1).includes(enemyTree.index), "neutral enemy tree excluded from buy zone");
  assert(!applyAction(state, { type: "moveUnit", from: unit.index, to: enemyTree.index }).ok, "cannot move onto neutral enemy tree");
  assert(!applyAction(state, { type: "buyUnit", provinceId: province.id, strength: 1, target: enemyTree.index }).ok, "cannot buy onto neutral enemy tree");
}

// Trees do not bypass defense: after war, a protected enemy tree still needs enough strength.
{
  const state = game();
  const unit = hexAt(state, 1, 0);
  const enemyTree = hexAt(state, 2, 0);
  const province = province0(state);

  assert(applyAction(state, { type: "declareWar", target: 1 }).ok, "war declaration succeeds");
  assert(!getMoveZone(state, unit.index).includes(enemyTree.index), "defended enemy tree excluded from weak unit move zone");
  assert(!getBuyZone(state, province, 1).includes(enemyTree.index), "defended enemy tree excluded from weak buy zone");
  assert(getBuyZone(state, province, 3).includes(enemyTree.index), "strong buy can attack defended enemy tree");
}

// Attackable enemy trees can be captured; the tree is cut only after normal attack validation.
{
  const state = game(3);
  const unit = hexAt(state, 1, 0);
  const enemyTree = hexAt(state, 2, 0);
  const province = province0(state);
  const moneyBefore = province.money;

  assert(applyAction(state, { type: "declareWar", target: 1 }).ok, "war declaration succeeds for strong unit");
  assert(getMoveZone(state, unit.index).includes(enemyTree.index), "strong unit can attack defended enemy tree");
  assert(applyAction(state, { type: "moveUnit", from: unit.index, to: enemyTree.index }).ok, "strong unit captures enemy tree");
  assert(enemyTree.fraction === 0, "captured tree hex changes owner");
  assert(enemyTree.obj === "none", "captured tree is cut");
  assert(enemyTree.unit?.strength === 3 && enemyTree.unit.readyToMove === false, "capturing unit lands spent");
  assert(province.money === moneyBefore + TREE_CUT_REWARD, "capturing tree pays cut reward");
}

// Own-land trees remain valid movement targets and are cut for the same reward.
{
  const state = game();
  const unit = hexAt(state, 1, 0);
  const ownTree = hexAt(state, 0, 1);
  const province = province0(state);
  const moneyBefore = province.money;

  assert(getMoveZone(state, unit.index).includes(ownTree.index), "own tree included in move zone");
  assert(applyAction(state, { type: "moveUnit", from: unit.index, to: ownTree.index }).ok, "unit moves onto own tree");
  assert(ownTree.obj === "none", "own tree is cut");
  assert(ownTree.unit?.strength === 1, "unit lands on own tree hex");
  assert(province.money === moneyBefore + TREE_CUT_REWARD, "own tree pays cut reward");
}

console.log(`TREE TERRITORY TESTS PASSED (${checks} assertions)`);
