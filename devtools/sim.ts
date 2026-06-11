// Headless engine/AI verification: runs AI-vs-AI games in both modes and
// checks invariants. Run from repo root: npx tsx devtools/sim.ts
import { createGame } from "../web/client/game/engine";
import { aiTakeTurn } from "../web/client/game/ai";
import { NEUTRAL_FRACTION } from "../web/client/game/constants";
import type { GameState } from "../web/client/game/types";

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

for (const mode of ["antiyoy", "slay"] as const) {
  for (let t = 0; t < 4; t++) {
    const players = 2 + t;
    const st = createGame({
      mapSize: "medium",
      playerCount: players,
      humanCount: 0,
      seed: 500 + t * 13,
      mode,
    });
    check(st, `${mode} init`);
    const neutral = st.hexes.filter((h) => h.active && h.fraction === NEUTRAL_FRACTION).length;
    let guard = 0;
    while (st.winner === null && st.round < 300 && guard++ < 5000) {
      aiTakeTurn(st);
      if (guard % 15 === 0) check(st, `${mode} r${st.round}`);
    }
    check(st, `${mode} end`);
    console.log(
      `${mode} ${players}p: neutral@start=${neutral}, rounds=${st.round}, winner=${
        st.winner === null ? "none (stalemate!)" : "P" + st.winner
      }`
    );
  }
}
console.log("ALL INVARIANTS PASSED");
