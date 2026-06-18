// Headless engine/AI verification: runs AI-vs-AI games in both modes and
// checks invariants. Run from repo root: npx tsx devtools/sim.ts
import { applyAction, computeVisibility, createGame, createScenarioGame, getMoveZone, setActionObserver } from "../web/client/game/engine";
import { parseLevelString } from "../web/client/game/scenario-codec";
import { aiTakeTurn } from "../web/client/game/ai";
import { NEUTRAL_FRACTION } from "../web/client/game/constants";
import type { GameState } from "../web/client/game/types";
import type { Action } from "../web/client/game/types";

function check(state: GameState, label: string) {
  const seen = new Set<number>();
  for (const p of state.provinces) {
    if (p.hexes.length < 2) throw new Error(`${label}: province ${p.id} has <2 hexes`);
    if (!Number.isFinite(p.money)) throw new Error(`${label}: province ${p.id} money=${p.money}`);
    if (p.capital < 0 || state.hexes[p.capital].obj !== "town")
      throw new Error(`${label}: province ${p.id} bad capital`);
    const towns = p.hexes.filter((h) => state.hexes[h].obj === "town");
    if (towns.length !== 1)
      throw new Error(`${label}: province ${p.id} has ${towns.length} capitals`);
    for (const h of p.hexes) {
      if (seen.has(h)) throw new Error(`${label}: hex ${h} in two provinces`);
      seen.add(h);
      if (state.hexes[h].fraction !== p.fraction) throw new Error(`${label}: fraction mismatch`);
    }
  }
  for (const hex of state.hexes) {
    if (hex.active && hex.unit && (hex.unit.strength < 1 || hex.unit.strength > 4))
      throw new Error(`${label}: bad unit strength`);
    if (!hex.active && (hex.unit || hex.obj !== "none"))
      throw new Error(`${label}: water hex ${hex.index} has content`);
  }
}

const sizeByRun = ["small", "medium", "large", "huge"] as const;
for (const mode of ["antiyoy", "slay"] as const) {
  for (let t = 0; t < 4; t++) {
    const players = 2 + t;
    const mapSize = sizeByRun[t];
    const st = createGame({
      mapSize,
      playerCount: players,
      humanCount: 0,
      seed: 500 + t * 13,
      mode,
      treePercentage: [0, 10, 33, 75][t],
      startingProvinces: (t === 3 ? 2 : 0) as 0 | 2,
      colorOffset: t,
    });
    const replayStart = structuredClone(st);
    const replayActions: Action[] = [];
    setActionObserver(st, (event) => replayActions.push(event.action));
    check(st, `${mode} init`);
    const neutral = st.hexes.filter((h) => h.active && h.fraction === NEUTRAL_FRACTION).length;
    let guard = 0;
    while (st.winner === null && st.round < 300 && guard++ < 5000) {
      aiTakeTurn(st);
      if (guard % 15 === 0) check(st, `${mode} r${st.round}`);
    }
    check(st, `${mode} end`);
    const replayed = structuredClone(replayStart);
    for (const action of replayActions) {
      const result = applyAction(replayed, action);
      if (!result.ok) throw new Error(`${mode} replay failed: ${result.reason}`);
    }
    if (JSON.stringify(replayed) !== JSON.stringify(st)) {
      throw new Error(`${mode} ${players}p replay diverged from recorded game`);
    }
    console.log(
      `${mode} ${players}p ${mapSize}: neutral@start=${neutral}, rounds=${st.round}, winner=${
        st.winner === null ? "none (stalemate!)" : "P" + st.winner
      }`
    );
  }
}

// A decisive capture must remain on the board until the player ends the turn.
{
  const scenario = parseLevelString(
    "1 1 1 7/" +
      "0 0 0 3 0 0 100#" +
      "1 0 0 0 4 1 100#" +
      "2 0 1 3 0 0 10#" +
      "3 0 1 0 0 0 10",
    "deferred-victory"
  );
  const st = createScenarioGame(scenario);
  const attacker = st.hexes.find((h) => h.active && h.q === 1 && h.r === 0)!;
  const target = st.hexes.find((h) => h.active && h.q === 2 && h.r === 0)!;
  const capture = applyAction(st, { type: "moveUnit", from: attacker.index, to: target.index });
  if (!capture.ok) throw new Error(`deferred victory: capture failed: ${capture.reason}`);
  if (st.winner !== null || !st.victoryPending) {
    throw new Error("deferred victory: game finished before end turn");
  }
  const endTurn = applyAction(st, { type: "endTurn" });
  if (!endTurn.ok || st.winner !== 0 || st.victoryPending) {
    throw new Error("deferred victory: end turn did not finalize winner");
  }
  console.log("deferred victory: winner finalized on end turn");
}

// Detached units stay as doomed sprites until the owner starts their next turn.
{
  const scenario = parseLevelString(
    "1 1 1 7/" +
      "0 0 0 3 0 0 100#" +
      "1 0 0 0 4 1 100#" +
      "2 0 1 0 0 0 10#" +
      "3 0 1 0 1 1 10#" +
      "10 0 1 3 0 0 10#" +
      "11 0 1 0 0 0 10",
    "deferred-detached-death"
  );
  const st = createScenarioGame(scenario);
  const attacker = st.hexes.find((h) => h.active && h.q === 1 && h.r === 0)!;
  const target = st.hexes.find((h) => h.active && h.q === 2 && h.r === 0)!;
  const detached = st.hexes.find((h) => h.active && h.q === 3 && h.r === 0)!;
  const capture = applyAction(st, { type: "moveUnit", from: attacker.index, to: target.index });
  if (!capture.ok) throw new Error(`deferred detached death: capture failed: ${capture.reason}`);
  if (!detached.unit?.deathPending) throw new Error("deferred detached death: unit died before owner turn");
  if (detached.obj === "grave") throw new Error("deferred detached death: grave appeared before owner turn");
  const endTurn = applyAction(st, { type: "endTurn" });
  if (!endTurn.ok) throw new Error(`deferred detached death: end turn failed: ${endTurn.reason}`);
  if (detached.unit || detached.obj !== "grave") {
    throw new Error("deferred detached death: owner turn did not remove doomed unit");
  }
  console.log("deferred detached death: unit removed on owner turn");
}

// Eliminating a faction also leaves its remaining warriors visible until the
// next active turn starts. Eliminated factions have no owner turn to clean up on.
{
  const scenario = parseLevelString(
    "1 1 1 7/" +
      "0 0 0 3 0 0 100#" +
      "1 0 0 0 4 1 100#" +
      "2 0 1 0 0 0 10#" +
      "3 0 1 0 1 1 10#" +
      "10 0 2 3 0 0 10#" +
      "11 0 2 0 0 0 10",
    "deferred-elimination-death"
  );
  const st = createScenarioGame(scenario);
  const attacker = st.hexes.find((h) => h.active && h.q === 1 && h.r === 0)!;
  const target = st.hexes.find((h) => h.active && h.q === 2 && h.r === 0)!;
  const survivor = st.hexes.find((h) => h.active && h.q === 3 && h.r === 0)!;
  const capture = applyAction(st, { type: "moveUnit", from: attacker.index, to: target.index });
  if (!capture.ok) throw new Error(`deferred elimination death: capture failed: ${capture.reason}`);
  if (st.alive[1]) throw new Error("deferred elimination death: opponent was not eliminated");
  if (!survivor.unit?.deathPending) {
    throw new Error("deferred elimination death: remaining warrior died immediately");
  }
  const endTurn = applyAction(st, { type: "endTurn" });
  if (!endTurn.ok) throw new Error(`deferred elimination death: end turn failed: ${endTurn.reason}`);
  if (survivor.unit || survivor.obj !== "grave") {
    throw new Error("deferred elimination death: warrior survived the next turn start");
  }
  console.log("deferred elimination death: warrior removed at next active turn start");
}

// Bankruptcy leaves units visible but immobile for one owner turn, then removes them.
{
  const scenario = parseLevelString(
    "1 1 1 7/" +
      "0 0 0 3 0 0 100#" +
      "1 0 0 0 4 1 100#" +
      "5 0 1 3 0 0 10#" +
      "6 0 1 0 0 0 10",
    "deferred-bankruptcy-death"
  );
  const st = createScenarioGame(scenario);
  const province = st.provinces.find((p) => p.fraction === 0)!;
  const unitHex = st.hexes.find((h) => h.active && h.q === 1 && h.r === 0)!;
  province.money = -10;
  const toPlayer1 = applyAction(st, { type: "endTurn" });
  if (!toPlayer1.ok) throw new Error(`deferred bankruptcy death: first end turn failed: ${toPlayer1.reason}`);
  const toPlayer0 = applyAction(st, { type: "endTurn" });
  if (!toPlayer0.ok) throw new Error(`deferred bankruptcy death: second end turn failed: ${toPlayer0.reason}`);
  if (!unitHex.unit?.deathPending) throw new Error("deferred bankruptcy death: unit died immediately");
  if (unitHex.unit.readyToMove || getMoveZone(st, unitHex.index).length > 0) {
    throw new Error("deferred bankruptcy death: doomed unit can still move");
  }
  const backToPlayer1 = applyAction(st, { type: "endTurn" });
  if (!backToPlayer1.ok) throw new Error(`deferred bankruptcy death: third end turn failed: ${backToPlayer1.reason}`);
  const backToPlayer0 = applyAction(st, { type: "endTurn" });
  if (!backToPlayer0.ok) throw new Error(`deferred bankruptcy death: fourth end turn failed: ${backToPlayer0.reason}`);
  if (unitHex.unit || unitHex.obj !== "grave") {
    throw new Error("deferred bankruptcy death: next owner turn did not remove doomed unit");
  }
  console.log("deferred bankruptcy death: unit removed on next owner turn");
}

// Bought units are spent immediately: they cannot move or march until that
// player's next turn, whether placed on owned land or used to capture.
{
  const scenario = parseLevelString(
    "1 1 1 7/" +
      "0 0 0 3 0 0 100#" +
      "1 0 0 0 0 0 10#" +
      "2 0 0 0 0 0 10#" +
      "3 0 1 0 0 0 10#" +
      "4 0 1 3 0 0 10#" +
      "5 0 1 0 0 0 10",
    "bought-units-spent"
  );
  const st = createScenarioGame(scenario);
  const prov = st.provinces.find((p) => p.fraction === 0)!;
  prov.money = 100;
  const spot = st.hexes.find((h) => h.active && h.q === 1 && h.r === 0)!.index;
  const buy = applyAction(st, { type: "buyUnit", provinceId: prov.id, strength: 1, target: spot });
  if (!buy.ok) throw new Error(`bought spent test: buy failed: ${buy.reason}`);
  if (st.hexes[spot].unit?.readyToMove) throw new Error("bought spent test: own-land unit is ready");
  if (getMoveZone(st, spot).length !== 0) throw new Error("bought spent test: own-land unit has a move zone");
  const dest = st.hexes.find((h) => h.active && h.q === 2 && h.r === 0)!.index;
  const immediateMove = applyAction(st, { type: "moveUnit", from: spot, to: dest });
  if (immediateMove.ok) throw new Error("bought spent test: own-land unit moved immediately");

  const enemy = st.hexes.find((h) => h.active && h.q === 3 && h.r === 0)!.index;
  const capture = applyAction(st, { type: "buyUnit", provinceId: prov.id, strength: 4, target: enemy });
  if (!capture.ok) throw new Error(`bought spent test: capture buy failed: ${capture.reason}`);
  if (st.hexes[enemy].unit?.readyToMove) throw new Error("bought spent test: capture unit is ready");
  if (getMoveZone(st, enemy).length !== 0) throw new Error("bought spent test: capture unit has a move zone");

  const end0 = applyAction(st, { type: "endTurn" });
  if (!end0.ok) throw new Error(`bought spent test: player 0 end failed: ${end0.reason}`);
  const end1 = applyAction(st, { type: "endTurn" });
  if (!end1.ok) throw new Error(`bought spent test: player 1 end failed: ${end1.reason}`);
  if (!st.hexes[spot].unit?.readyToMove || !st.hexes[enemy].unit?.readyToMove) {
    throw new Error("bought spent test: bought units were not refreshed next turn");
  }
  check(st, "bought-spent");
  console.log("bought spent: units wait until next turn");
}

// Merging two unmoved units preserves the destination unit's unused move.
{
  const scenario = parseLevelString(
    "1 1 1 7/" +
      "0 0 0 0 1 1 10#" +
      "1 0 0 0 1 1 10#" +
      "2 0 0 0 0 0 10#" +
      "2 1 0 3 0 0 10#" +
      "5 0 1 3 0 0 10#" +
      "6 0 1 0 0 0 10",
    "ready-unit-merge"
  );
  const st = createScenarioGame(scenario);
  const from = st.hexes.find((h) => h.active && h.q === 0 && h.r === 0)!;
  const merge = st.hexes.find((h) => h.active && h.q === 1 && h.r === 0)!;
  const onward = st.hexes.find((h) => h.active && h.q === 2 && h.r === 0)!;
  const first = applyAction(st, { type: "moveUnit", from: from.index, to: merge.index });
  if (!first.ok) throw new Error(`ready merge test: merge failed: ${first.reason}`);
  if (!merge.unit?.readyToMove) throw new Error("ready merge test: merged unit cannot move");
  const second = applyAction(st, { type: "moveUnit", from: merge.index, to: onward.index });
  if (!second.ok) throw new Error(`ready merge test: onward move failed: ${second.reason}`);
  console.log("ready merge: merged unit retained its move");
}

// Normal+ AI should spend a healthy treasury on practical border defense
// when the frontier is exposed and buying a capture is not viable.
{
  const scenario = parseLevelString(
    "1 1 2 7/" +
      "0 0 0 3 0 0 25#" +
      "1 0 0 0 0 0 10#" +
      "2 0 0 0 0 0 10#" +
      "0 1 0 0 0 0 10#" +
      "1 1 0 0 0 0 10#" +
      "2 1 0 0 0 0 10#" +
      "0 2 0 0 0 0 10#" +
      "1 2 0 0 0 0 10#" +
      "2 2 0 0 0 0 10#" +
      "3 0 1 7 0 0 10#" +
      "3 1 1 7 0 0 10#" +
      "3 2 1 7 0 0 10",
    "ai-border-defense"
  );
  const st = createScenarioGame(scenario);
  const actions: Action[] = [];
  setActionObserver(st, (event) => actions.push(event.action));
  aiTakeTurn(st);
  const towerBuild = actions.find((action) => action.type === "build" && action.kind === "tower");
  if (!towerBuild) throw new Error("ai defense: normal AI did not build a tower on an exposed border");
  const province = st.provinces.find((p) => p.fraction === 0)!;
  if (province.money < 0) throw new Error("ai defense: tower spending bankrupted the province");
  console.log(`ai defense: built tower at hex ${towerBuild.target} with ${province.money} gold left`);
}

// Fog of war: the viewer sees their own land; some enemy/far land is hidden;
// a tower reveals strictly more than a bare hex.
{
  const st = createGame({ mapSize: "large", playerCount: 4, humanCount: 1, seed: 99, mode: "antiyoy", fogOfWar: true });
  const vis = computeVisibility(st, 0);
  let own = 0;
  let hiddenActive = 0;
  for (const h of st.hexes) {
    if (!h.active) continue;
    if (h.fraction === 0) {
      own++;
      if (!vis.has(h.index)) throw new Error("fog test: player cannot see their own land");
    } else if (!vis.has(h.index)) {
      hiddenActive++;
    }
  }
  if (own === 0) throw new Error("fog test: player 0 has no land");
  if (hiddenActive === 0) throw new Error("fog test: no active land is hidden");

  // Radius semantics on a deterministic corridor: a strong tower (radius 5)
  // at the province tip reveals strictly further down a neutral line than a
  // bare hex (radius 1) would.
  const corridor = parseLevelString(
    "1 1 1 7/0 0 0 3 0 0 10#1 0 0 0 0 0 10#2 0 0 0 0 0 10#3 0 7 0 0 0 10#4 0 7 0 0 0 10#5 0 7 0 0 0 10#6 0 7 0 0 0 10#7 0 7 0 0 0 10",
    "fog-corridor"
  );
  const cs = createScenarioGame(corridor);
  const tip = cs.hexes.find((h) => h.q === 2 && h.r === 0 && h.active)!;
  const before = computeVisibility(cs, 0).size;
  tip.obj = "strongTower";
  const after = computeVisibility(cs, 0).size;
  if (after <= before) throw new Error("fog test: strong tower did not widen visibility");
  console.log(`fog: ${hiddenActive} active hexes hidden from player; strong tower +${after - before} on corridor`);
}

console.log("ALL INVARIANTS PASSED");
