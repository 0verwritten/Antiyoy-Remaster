// Headless engine/AI verification: runs AI-vs-AI games in both modes and
// checks invariants. Run from repo root: npx tsx devtools/sim.ts
import { applyAction, createGame, getBuyZone, marchUnitsToHex, setActionObserver } from "../web/client/game/engine";
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
// Hold-to-march: a bought unit walks to the marched-to tile through own land.
{
  const st = createGame({ mapSize: "medium", playerCount: 2, humanCount: 2, seed: 777, mode: "slay" });
  // Pick a province big enough to hold a unit, a destination and the capital.
  const prov = st.provinces.find((p) => {
    if (p.fraction !== 0 || p.hexes.length < 4) return false;
    return getBuyZone(st, { ...p, money: 100 }, 1).some((h) => p.hexes.includes(h));
  })!;
  prov.money = 100;
  const spot = getBuyZone(st, prov, 1).find((h) => prov.hexes.includes(h))!;
  const buy = applyAction(st, { type: "buyUnit", provinceId: prov.id, strength: 1, target: spot });
  if (!buy.ok) throw new Error(`march test: buy failed: ${buy.reason}`);
  const provAfter = st.provinces.find((p) => p.id === prov.id)!;
  const dest = provAfter.hexes.find(
    (h) => h !== spot && !st.hexes[h].unit && st.hexes[h].obj !== "town"
  )!;
  const moves = marchUnitsToHex(st, provAfter, dest);
  if (moves < 1) throw new Error("march test: no unit moved");
  if (!st.hexes[dest].unit) throw new Error("march test: unit did not reach the target tile");
  check(st, "march");
  console.log(`march: ${moves} unit(s) marched to target`);
}

console.log("ALL INVARIANTS PASSED");
