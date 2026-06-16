// Diplomacy rule tests. Run from repo root:
//   npx tsx devtools/diplomacy-tests.ts

import {
  applyAction,
  canAttackFraction,
  createScenarioGame,
  diplomaticVictor,
  getBuyZone,
  getMoveZone,
  getProvinceProfit,
  getProvincesOf,
  getRelation,
  transferMoney,
} from "../web/client/game/engine";
import type { GameState, Province } from "../web/client/game/types";
import type { Scenario } from "../web/client/game/scenario";

let checks = 0;
function assert(cond: boolean, message: string) {
  checks++;
  if (!cond) throw new Error("FAIL: " + message);
}

function baseScenario(): Scenario {
  return {
    id: "diplo-fixture",
    name: "Diplomacy Fixture",
    mode: "antiyoy",
    playerCount: 3,
    humanCount: 2,
    difficulty: "normal",
    diplomacy: true,
    hexes: [
      { q: 0, r: 0, fraction: 0, obj: "town", money: 100 },
      { q: 1, r: 0, fraction: 0, obj: "none", unit: 4, unitReady: true },
      { q: 2, r: 0, fraction: 1, obj: "none", unit: 1, unitReady: true },
      { q: 3, r: 0, fraction: 1, obj: "town", money: 0 },
      { q: 0, r: 1, fraction: 2, obj: "town", money: 20 },
      { q: 1, r: 1, fraction: 2, obj: "none" },
    ],
  };
}

function game(): GameState {
  const state = createScenarioGame(baseScenario());
  state.turnStartedAt = 0;
  state.turnHistory = [];
  return state;
}

function province(state: GameState, fraction: number): Province {
  const p = getProvincesOf(state, fraction)[0];
  assert(!!p, `fraction ${fraction} has a province`);
  return p;
}

function money(state: GameState, fraction: number): number {
  return getProvincesOf(state, fraction).reduce((sum, p) => sum + p.money, 0);
}

// Relations start neutral and are symmetric.
{
  const state = game();
  assert(state.diplomacy !== undefined, "diplomacy state initialized");
  assert(getRelation(state, 0, 1) === "neutral", "relation starts neutral");
  assert(getRelation(state, 1, 0) === "neutral", "relation symmetry at start");
  assert(applyAction(state, { type: "declareWar", target: 1 }).ok, "declare war action succeeds");
  assert(getRelation(state, 0, 1) === "war", "war relation set");
  assert(getRelation(state, 1, 0) === "war", "war relation symmetric");
}

// Neutral blocks attacks in both move and buy zones; war allows them.
{
  const state = game();
  const attacker = state.hexes.find((h) => h.fraction === 0 && h.unit)?.index ?? -1;
  const defender = state.hexes.find((h) => h.fraction === 1 && h.unit)?.index ?? -1;
  assert(attacker >= 0 && defender >= 0, "fixture has adjacent units");
  assert(!canAttackFraction(state, 0, 1), "neutral enemy cannot be attacked");
  assert(!getMoveZone(state, attacker).includes(defender), "neutral enemy excluded from move zone");
  assert(!getBuyZone(state, province(state, 0), 4).includes(defender), "neutral enemy excluded from buy zone");
  assert(applyAction(state, { type: "declareWar", target: 1 }).ok, "war declaration for attack test");
  assert(canAttackFraction(state, 0, 1), "war enemy can be attacked");
  assert(getMoveZone(state, attacker).includes(defender), "war enemy included in move zone");
  assert(getBuyZone(state, province(state, 0), 4).includes(defender), "war enemy included in buy zone");
}

// Transfers conserve integer treasury exactly, including a recipient at zero.
{
  const state = game();
  const before = money(state, 0) + money(state, 1);
  assert(money(state, 1) === 0, "recipient starts at zero");
  const moved = transferMoney(state, 0, 1, 7.9);
  assert(moved === 7, "transfer floors to integer amount");
  assert(money(state, 1) === 7, "zero-money recipient receives coins");
  assert(money(state, 0) + money(state, 1) === before, "transfer conserves total treasury");
}

// Gift proposal acceptance uses the same zero-safe transfer path.
{
  const state = game();
  const before = money(state, 0) + money(state, 1);
  assert(applyAction(state, { type: "proposeExchange", to: 1, kind: "gift", amount: 5 }).ok, "gift proposed");
  const proposalId = state.diplomacy!.proposals[0].id;
  assert(applyAction(state, { type: "endTurn", endedAt: 1 }).ok, "advance to recipient");
  assert(applyAction(state, { type: "acceptExchange", proposalId }).ok, "gift accepted");
  assert(money(state, 1) === 5, "gift credited recipient");
  assert(money(state, 0) + money(state, 1) === before, "gift conserves treasury");
}

// Subsidies are capped by payer income and available funds.
{
  const state = game();
  const payer = province(state, 0);
  payer.money = 30;
  const recipientBefore = money(state, 1);
  const cap = Math.max(0, getProvinceProfit(state, payer));
  state.diplomacy!.contracts.push({ type: "subsidy", a: 0, b: 1, subsidy: cap + 10, expires: 10 });
  assert(applyAction(state, { type: "endTurn", endedAt: 1 }).ok, "round step 1");
  assert(applyAction(state, { type: "endTurn", endedAt: 2 }).ok, "round step 2");
  assert(applyAction(state, { type: "endTurn", endedAt: 3 }).ok, "round step 3");
  assert(money(state, 1) - recipientBefore === cap, "subsidy capped by income");
}

// Expired friendship returns the pair to neutral.
{
  const state = game();
  assert(applyAction(state, { type: "proposeExchange", to: 1, kind: "friendship" }).ok, "friendship proposed");
  const proposalId = state.diplomacy!.proposals[0].id;
  assert(applyAction(state, { type: "endTurn", endedAt: 1 }).ok, "recipient turn");
  assert(applyAction(state, { type: "acceptExchange", proposalId }).ok, "friendship accepted");
  assert(getRelation(state, 0, 1) === "friend", "friendship active");
  state.round = state.diplomacy!.contracts.find((c) => c.type === "friendship")!.expires;
  assert(applyAction(state, { type: "endTurn", endedAt: 2 }).ok, "advance from player 1");
  assert(applyAction(state, { type: "endTurn", endedAt: 3 }).ok, "round processes expiry");
  assert(getRelation(state, 0, 1) === "neutral", "friendship expiry resets relation");
}

// Eliminated fractions are scrubbed from diplomacy collections.
{
  const state = game();
  state.diplomacy!.contracts.push({ type: "friendship", a: 0, b: 2, expires: 10 });
  state.diplomacy!.proposals.push({ id: 99, from: 2, to: 0, kind: "gift", amount: 1 });
  state.diplomacy!.blackMarks.push(2);
  assert(applyAction(state, { type: "resign", fraction: 2, endedAt: 1 }).ok, "fraction 2 resigns");
  assert(!state.diplomacy!.contracts.some((c) => c.a === 2 || c.b === 2), "eliminated contracts removed");
  assert(!state.diplomacy!.proposals.some((p) => p.from === 2 || p.to === 2), "eliminated proposals removed");
  assert(!state.diplomacy!.blackMarks.includes(2), "eliminated black mark removed");
}

// Diplomatic victory requires all survivors to be mutual friends.
{
  const state = game();
  state.alive[2] = false;
  assert(diplomaticVictor(state) === null, "neutral survivors do not trigger diplomatic victory");
  assert(applyAction(state, { type: "proposeExchange", to: 1, kind: "friendship" }).ok, "victory friendship proposed");
  const proposalId = state.diplomacy!.proposals[0].id;
  assert(applyAction(state, { type: "endTurn", endedAt: 1 }).ok, "recipient turn for victory");
  assert(applyAction(state, { type: "acceptExchange", proposalId }).ok, "victory friendship accepted");
  assert(diplomaticVictor(state) === 0, "friend survivors produce diplomatic victor");
}

console.log(`DIPLOMACY TESTS PASSED (${checks} assertions)`);
