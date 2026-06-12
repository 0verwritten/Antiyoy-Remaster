// Map generator verification: determinism, connectivity, density, per-player
// viability, tree-density tolerance, starting-province counts and Slay
// province balance, across all supported sizes and player counts.
// Run from repo root: npx tsx devtools/mapgen-tests.ts

import { createGame } from "../web/client/game/engine";
import { maxPlayersForMapSize, NEUTRAL_FRACTION } from "../web/client/game/constants";
import type { GameConfig, GameState, MapSize } from "../web/client/game/types";

let checks = 0;

function fail(label: string, message: string): never {
  throw new Error(`${label}: ${message}`);
}

function assert(cond: boolean, label: string, message: string) {
  checks++;
  if (!cond) fail(label, message);
}

function landIsConnected(state: GameState): boolean {
  const active = state.hexes.filter((h) => h.active);
  if (active.length === 0) return false;
  const seen = new Set([active[0].index]);
  const queue = [active[0]];
  while (queue.length > 0) {
    const hex = queue.pop()!;
    for (const n of hex.neighbors) {
      const nh = state.hexes[n];
      if (nh.active && !seen.has(n)) {
        seen.add(n);
        queue.push(nh);
      }
    }
  }
  return seen.size === active.length;
}

function provincesPerFraction(state: GameState): number[] {
  const numbers = new Array(state.config.playerCount).fill(0);
  for (const p of state.provinces) {
    if (p.fraction < state.config.playerCount) numbers[p.fraction]++;
  }
  return numbers;
}

const sizes: MapSize[] = ["small", "medium", "large", "huge"];

// --- determinism, connectivity, density, viability over the full matrix -----
for (const mode of ["antiyoy", "slay"] as const) {
  for (const mapSize of sizes) {
    const maxPlayers = maxPlayersForMapSize(mapSize);
    for (let players = 2; players <= maxPlayers; players++) {
      const config: GameConfig = {
        mapSize,
        playerCount: players,
        humanCount: 0,
        seed: 9000 + players * 7 + sizes.indexOf(mapSize) * 131,
        mode,
      };
      const label = `${mode}/${mapSize}/${players}p`;
      const a = createGame(config);
      const b = createGame(structuredClone(config));
      assert(JSON.stringify(a) === JSON.stringify(b), label, "not deterministic for same seed+config");
      assert(landIsConnected(a), label, "land is not connected");

      const active = a.hexes.filter((h) => h.active).length;
      const grid = a.hexes.length;
      // isGood guarantees >25% of bounded hexes; bounded ≈ grid minus the outer ring.
      const rows = Math.max(...a.hexes.map((h) => h.r)) + 1;
      const cols = grid / rows;
      const bounded = (cols - 2) * (rows - 2);
      assert(active > 0.25 * bounded, label, `land density too low: ${active}/${bounded}`);

      const numbers = provincesPerFraction(a);
      for (let p = 0; p < players; p++) {
        assert(numbers[p] >= 1, label, `player ${p} starts without a province`);
      }

      // Slay: no fraction may start starved. The legacy pipeline
      // (achieveFairNumberOfProvinces + balance measures) is noisy by
      // design, so this is a starvation guard, not a tight balance bound.
      if (mode === "slay") {
        const hexCounts = new Array(players).fill(0);
        for (const h of a.hexes) {
          if (h.active && h.fraction < players) hexCounts[h.fraction]++;
        }
        const mean = hexCounts.reduce((x, y) => x + y, 0) / players;
        for (let p = 0; p < players; p++) {
          assert(
            hexCounts[p] >= 0.4 * mean,
            label,
            `fraction ${p} starved: ${hexCounts.join(",")} (mean ${mean.toFixed(0)})`
          );
        }
      }
    }
  }
}

// --- tree density ------------------------------------------------------------
for (const treePercentage of [0, 25, 75]) {
  for (let run = 0; run < 3; run++) {
    const st = createGame({
      mapSize: "large",
      playerCount: 4,
      humanCount: 0,
      seed: 4242 + run,
      mode: "antiyoy",
      treePercentage,
    });
    const active = st.hexes.filter((h) => h.active);
    const trees = active.filter((h) => h.obj === "pine" || h.obj === "palm").length;
    const share = trees / active.length;
    const label = `trees ${treePercentage}% run${run}`;
    if (treePercentage === 0) {
      assert(trees === 0, label, `expected no trees, got ${trees}`);
    } else {
      // Town/capital placement clears a few tiles, so allow a generous
      // statistical tolerance around the requested share.
      assert(
        Math.abs(share - treePercentage / 100) < 0.08,
        label,
        `tree share ${share.toFixed(3)} too far from ${treePercentage / 100}`
      );
    }
  }
}

// --- starting provinces ------------------------------------------------------
for (const startingProvinces of [1, 2, 3, 4] as const) {
  for (let run = 0; run < 3; run++) {
    const st = createGame({
      mapSize: "large",
      playerCount: 3,
      humanCount: 0,
      seed: 7100 + run * 17 + startingProvinces,
      mode: "antiyoy",
      startingProvinces,
    });
    const numbers = provincesPerFraction(st);
    const label = `provinces=${startingProvinces} run${run}`;
    for (let p = 0; p < 3; p++) {
      assert(numbers[p] >= 1, label, `player ${p} has no province`);
      assert(
        numbers[p] <= startingProvinces,
        label,
        `player ${p} has ${numbers[p]} provinces (> requested ${startingProvinces})`
      );
    }
    if (startingProvinces === 1) {
      assert(
        numbers.every((n) => n === 1),
        label,
        `expected exactly one province each, got ${numbers.join(",")}`
      );
    }
  }
}

// --- neutral land sanity (antiyoy mode keeps a neutral island) ----------------
{
  const st = createGame({
    mapSize: "medium",
    playerCount: 2,
    humanCount: 0,
    seed: 31337,
    mode: "antiyoy",
  });
  const neutral = st.hexes.filter((h) => h.active && h.fraction === NEUTRAL_FRACTION).length;
  assert(neutral > 0, "antiyoy neutral", "no neutral land in antiyoy mode");
}

console.log(`MAPGEN TESTS PASSED (${checks} assertions)`);
