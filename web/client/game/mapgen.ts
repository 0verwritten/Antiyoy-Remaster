// Map generator ported from the original game's MapGenerator /
// MapGeneratorGeneric (core/src/yio/tro/antiyoy/gameplay): land is built from
// several potential-decay island blobs united by "roads", regenerated until the
// island is connected and covers enough of the bounds; then provinces are
// spawned, cut down to small sizes and lightly balanced, like the original.

import { DEFAULT_TREE_PERCENTAGE, NEUTRAL_FRACTION } from "./constants";
import type { GameState, HexTile } from "./types";

const SMALL_PROVINCE_SIZE = 5;
const ISLAND_POTENTIAL = 7;

// --- RNG (same mulberry32 stream as the engine, advancing state.rngState) ----

function nextRandom(state: GameState): number {
  let t = (state.rngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomInt(state: GameState, n: number): number {
  return Math.floor(nextRandom(state) * n);
}

// --- small helpers ------------------------------------------------------------

function hexPos(hex: HexTile): { x: number; y: number } {
  // Unit-size axial-to-pixel, only used for island roads/geometry.
  return { x: Math.sqrt(3) * (hex.q + hex.r / 2), y: 1.5 * hex.r };
}

function activeNeighbors(state: GameState, hex: HexTile): HexTile[] {
  const out: HexTile[] = [];
  for (const n of hex.neighbors) if (state.hexes[n].active) out.push(state.hexes[n]);
  return out;
}

function friendlyNeighbors(state: GameState, hex: HexTile): number {
  let c = 0;
  for (const n of activeNeighbors(state, hex)) if (n.fraction === hex.fraction) c++;
  return c;
}

function isNearWater(state: GameState, hex: HexTile): boolean {
  let act = 0;
  for (const n of hex.neighbors) if (state.hexes[n].active) act++;
  return act < 6;
}

function randomFraction(state: GameState): number {
  return randomInt(state, state.config.playerCount);
}

/** Connected component of same-fraction hexes containing `start`. */
function detectProvince(state: GameState, start: HexTile): HexTile[] {
  const out: HexTile[] = [start];
  const seen = new Set([start.index]);
  for (let i = 0; i < out.length; i++) {
    for (const n of activeNeighbors(state, out[i])) {
      if (!seen.has(n.index) && n.fraction === start.fraction) {
        seen.add(n.index);
        out.push(n);
      }
    }
  }
  return out;
}

// --- land creation (original MapGenerator.createLand) --------------------------

function islandsByMapSize(state: GameState): number {
  switch (state.config.mapSize) {
    case "small":
      return 2;
    case "medium":
      return 4;
    case "huge":
      return 35;
    default:
      return 20; // original "big"
  }
}

function gridDims(state: GameState): { cols: number; rows: number } {
  let rows = 0;
  let cols = 0;
  for (const hex of state.hexes) {
    rows = Math.max(rows, hex.r + 1);
  }
  cols = state.hexes.length / rows;
  return { cols, rows };
}

function randomHexInsideBounds(state: GameState): HexTile {
  const { cols, rows } = gridDims(state);
  if (state.config.mapSize !== "large" && state.config.mapSize !== "huge") {
    return state.hexes[randomInt(state, rows) * cols + randomInt(state, cols)];
  }
  // Bigger maps bias island centers toward the middle (original radial pick).
  const center = state.hexes[Math.floor(rows / 2) * cols + Math.floor(cols / 2)];
  const cpos = hexPos(center);
  const boundHeight = 1.5 * rows;
  for (let attempt = 0; attempt < 100; attempt++) {
    const a = nextRandom(state) * 2 * Math.PI;
    const r = nextRandom(state) * nextRandom(state) * 0.5 * boundHeight;
    const x = cpos.x + r * Math.cos(a);
    const y = cpos.y + r * Math.sin(a);
    const rr = Math.round(y / 1.5);
    const qq = Math.round(x / Math.sqrt(3) - rr / 2);
    const col = qq + Math.floor(rr / 2);
    if (rr >= 0 && rr < rows && col >= 0 && col < cols) return state.hexes[rr * cols + col];
  }
  return center;
}

/**
 * Potential-decay island blob (original spawnIsland): each frontier hex
 * activates with probability potential/size and passes potential-1 onward.
 */
function spawnIsland(state: GameState, start: HexTile, size: number, slay: boolean) {
  const visited = new Set<number>([start.index]);
  const queue: { hex: HexTile; potential: number }[] = [{ hex: start, potential: size }];
  while (queue.length > 0) {
    const { hex, potential } = queue.shift()!;
    if (randomInt(state, size) > potential) continue;
    const wasActive = hex.active;
    if (!wasActive) {
      hex.active = true;
      hex.fraction = slay ? randomFraction(state) : NEUTRAL_FRACTION;
    }
    if (potential === 0 || wasActive) continue;
    for (const n of hex.neighbors) {
      if (visited.has(n)) continue;
      visited.add(n);
      queue.push({ hex: state.hexes[n], potential: potential - 1 });
    }
  }
}

function unifyIslandsWithRoads(state: GameState, centers: HexTile[], slay: boolean) {
  const linked = new Set<string>();
  for (let i = 0; i < centers.length; i++) {
    // Closest not-yet-linked island (original getClosestIslandIndex).
    const from = hexPos(centers[i]);
    let bestJ = -1;
    let bestDist = Infinity;
    for (let j = 0; j < centers.length; j++) {
      if (j === i || linked.has(i + ":" + j)) continue;
      const to = hexPos(centers[j]);
      const d = Math.hypot(to.x - from.x, to.y - from.y);
      if (d < bestDist) {
        bestDist = d;
        bestJ = j;
      }
    }
    if (bestJ < 0) continue;
    linked.add(i + ":" + bestJ).add(bestJ + ":" + i);
    // Walk the line between centers, sprinkling tiny islands (the "road").
    const to = hexPos(centers[bestJ]);
    const a = Math.atan2(to.y - from.y, to.x - from.x);
    const step = Math.sqrt(3) / 2;
    const n = Math.floor(bestDist / step);
    const { cols, rows } = gridDims(state);
    for (let k = 0; k < n; k++) {
      const x = from.x + step * k * Math.cos(a);
      const y = from.y + step * k * Math.sin(a);
      const rr = Math.round(y / 1.5);
      const qq = Math.round(x / Math.sqrt(3) - rr / 2);
      const col = qq + Math.floor(rr / 2);
      if (rr < 0 || rr >= rows || col < 0 || col >= cols) continue;
      spawnIsland(state, state.hexes[rr * cols + col], 2, slay);
    }
  }
}

function isLinked(state: GameState): boolean {
  const active = state.hexes.filter((h) => h.active);
  if (active.length === 0) return false;
  const seen = new Set([active[0].index]);
  const queue = [active[0]];
  while (queue.length > 0) {
    for (const n of activeNeighbors(state, queue.pop()!)) {
      if (!seen.has(n.index)) {
        seen.add(n.index);
        queue.push(n);
      }
    }
  }
  return seen.size === active.length;
}

function createLand(state: GameState, slay: boolean) {
  const islands = islandsByMapSize(state);
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const hex of state.hexes) {
      hex.active = false;
      hex.fraction = NEUTRAL_FRACTION;
    }
    const centers: HexTile[] = [];
    for (let i = 0; i < islands; i++) {
      const hex = randomHexInsideBounds(state);
      centers.push(hex);
      spawnIsland(state, hex, ISLAND_POTENTIAL, slay);
    }
    unifyIslandsWithRoads(state, centers, slay);
    const activeCount = state.hexes.filter((h) => h.active).length;
    if (isLinked(state) && activeCount > 0.25 * state.hexes.length) break;
  }
  // Original removeSingleHoles: fill lakes of exactly one hex.
  for (const hex of state.hexes) {
    if (hex.active || hex.neighbors.length < 6) continue;
    if (hex.neighbors.every((n) => state.hexes[n].active)) {
      hex.active = true;
      hex.fraction = slay ? randomFraction(state) : NEUTRAL_FRACTION;
    }
  }
}

// --- trees (original addTrees) --------------------------------------------------

function addTrees(state: GameState) {
  const chance = (state.config.treePercentage ?? DEFAULT_TREE_PERCENTAGE) / 100;
  for (const hex of state.hexes) {
    if (!hex.active || hex.obj !== "none") continue;
    if (nextRandom(state) >= chance) continue;
    hex.obj = isNearWater(state, hex) ? "palm" : "pine";
    hex.treeBorn = -1;
  }
}

// --- province balancing shared bits ----------------------------------------------

function findHexToExclude(state: GameState, province: HexTile[]): HexTile {
  let result = province[0];
  let min = Infinity;
  for (const hex of province) {
    const c = friendlyNeighbors(state, hex);
    if (c < min) {
      min = c;
      result = hex;
    }
  }
  return result;
}

function cutProvincesToSmallSizes(state: GameState, makeNeutral: boolean) {
  for (let loop = 0; loop < 100; loop++) {
    let cutSomething = false;
    const seen = new Set<number>();
    for (const hex of state.hexes) {
      if (!hex.active || hex.fraction === NEUTRAL_FRACTION || seen.has(hex.index)) continue;
      const province = detectProvince(state, hex);
      for (const h of province) seen.add(h.index);
      while (province.length > SMALL_PROVINCE_SIZE) {
        const out = findHexToExclude(state, province);
        province.splice(province.indexOf(out), 1);
        out.fraction = makeNeutral
          ? NEUTRAL_FRACTION
          : (out.fraction + 1 + randomInt(state, state.config.playerCount - 1)) %
            state.config.playerCount;
        cutSomething = true;
      }
    }
    if (!cutSomething) break;
  }
}

/** Original increaseProvince: border neighbors flip with probability `power`. */
function giveAdvantage(state: GameState, fraction: number, power: number, intoNeutralOnly: boolean) {
  const seen = new Set<number>();
  for (const hex of state.hexes) {
    if (!hex.active || hex.fraction !== fraction || seen.has(hex.index)) continue;
    const province = detectProvince(state, hex);
    for (const h of province) {
      for (const n of activeNeighbors(state, h)) {
        if (n.fraction === fraction) continue;
        if (intoNeutralOnly && n.fraction !== NEUTRAL_FRACTION) continue;
        if (nextRandom(state) < power) n.fraction = fraction;
      }
    }
    // Re-detect after growth so captured hexes don't cascade further
    // (the original tags the province only after increasing it).
    for (const h of detectProvince(state, hex)) seen.add(h.index);
  }
}

// --- antiyoy (generic) mode -------------------------------------------------------

function provincesQuantity(state: GameState): number {
  const explicit = state.config.startingProvinces ?? 0;
  if (explicit > 0) return explicit;
  switch (state.config.mapSize) {
    case "small":
      return 1;
    case "medium":
      return 2;
    case "huge":
      return 4;
    default:
      return 3;
  }
}

/** Original findGoodPlaceForNewProvince: the hex farthest from any player land. */
function findGoodPlaceForNewProvince(state: GameState): HexTile {
  const active = state.hexes.filter((h) => h.active);
  const dist = new Map<number, number>();
  const queue: HexTile[] = [];
  for (const hex of active) {
    if (hex.fraction !== NEUTRAL_FRACTION) {
      dist.set(hex.index, 0);
      queue.push(hex);
    }
  }
  if (queue.length === 0) return active[randomInt(state, active.length)];
  for (let i = 0; i < queue.length; i++) {
    const d = dist.get(queue[i].index)!;
    for (const n of activeNeighbors(state, queue[i])) {
      if (!dist.has(n.index)) {
        dist.set(n.index, d + 1);
        queue.push(n);
      }
    }
  }
  let best = active[0];
  let bestD = -1;
  for (const hex of active) {
    const d = dist.get(hex.index) ?? 0;
    if (d > bestD) {
      bestD = d;
      best = hex;
    }
  }
  return best;
}

/** Original generic spawnProvince: potential-2 blob expanding into neutral land. */
function spawnProvince(state: GameState, start: HexTile, fraction: number) {
  const potential0 = 2;
  start.fraction = fraction;
  const queue: { hex: HexTile; potential: number }[] = [{ hex: start, potential: potential0 }];
  const queued = new Set([start.index]);
  while (queue.length > 0) {
    const { hex, potential } = queue.shift()!;
    if (randomInt(state, potential0) > potential) continue;
    hex.fraction = fraction;
    if (potential === 0) continue;
    for (const n of activeNeighbors(state, hex)) {
      if (!queued.has(n.index) && n.fraction === NEUTRAL_FRACTION) {
        queued.add(n.index);
        queue.push({ hex: n, potential: potential - 1 });
      }
    }
  }
}

function makeSingleHexesIntoProvinces(state: GameState) {
  for (const hex of state.hexes) {
    if (!hex.active || hex.fraction === NEUTRAL_FRACTION) continue;
    if (friendlyNeighbors(state, hex) > 0) continue;
    let c = 3;
    for (const n of activeNeighbors(state, hex)) {
      if (n.fraction !== NEUTRAL_FRACTION) continue;
      n.fraction = hex.fraction;
      if (--c === 0) break;
    }
  }
}

/** Original generic changesArray: later players get a starting advantage. */
function balanceChanges(players: number): number[] {
  switch (players) {
    case 2:
      return [0, 0.3];
    case 3:
      return [0, 0.2, 0.4];
    case 4:
      return [0, 0.12, 0.3, 0.6];
    case 5:
      return [0, 0, 0.15, 0.32, 0.5];
    default:
      return [0, 0, 0.15, 0.25, 0.4, 0.6];
  }
}

function everyPlayerHasProvince(state: GameState): boolean {
  for (let p = 0; p < state.config.playerCount; p++) {
    let found = false;
    for (const hex of state.hexes) {
      if (hex.active && hex.fraction === p && friendlyNeighbors(state, hex) > 0) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function genericBalance(state: GameState) {
  for (const hex of state.hexes) {
    if (hex.active) hex.fraction = NEUTRAL_FRACTION;
  }
  const quantity = provincesQuantity(state);
  for (let i = 0; i < quantity; i++) {
    for (let fraction = 0; fraction < state.config.playerCount; fraction++) {
      spawnProvince(state, findGoodPlaceForNewProvince(state), fraction);
    }
  }
  cutProvincesToSmallSizes(state, true);
  makeSingleHexesIntoProvinces(state);
  const changes = balanceChanges(state.config.playerCount);
  for (let p = 0; p < changes.length && p < state.config.playerCount; p++) {
    if (changes[p] > 0) giveAdvantage(state, p, changes[p], true);
  }
}

// --- slay mode balancing (original base balanceMap) --------------------------------

function slayBalance(state: GameState) {
  // The original skips province cutting below 4 players ("to prevent
  // infinite loop"): with few fractions every cut hex lands on the same
  // opponent and the map degenerates. Keep the raw symmetric assignment.
  if (state.config.playerCount >= 4) {
    // Hexes with no province nearby seed a tiny province (spawnManySmallProvinces).
    for (const hex of state.hexes) {
      if (!hex.active) continue;
      if (friendlyNeighbors(state, hex) === 0) {
        const fraction = hex.fraction;
        for (const n of activeNeighbors(state, hex)) {
          if (nextRandom(state) < 0.5) n.fraction = fraction;
        }
      }
    }
    cutProvincesToSmallSizes(state, false);
  }
  // Like the original's no-player fix-up: every fraction must own at least
  // one real (2+) province, or it would be dead before its first turn.
  for (let p = 0; p < state.config.playerCount; p++) {
    if (hasRealProvince(state, p)) continue;
    const active = state.hexes.filter((h) => h.active);
    for (let attempt = 0; attempt < 200 && !hasRealProvince(state, p); attempt++) {
      const hex = active[randomInt(state, active.length)];
      const neighbors = activeNeighbors(state, hex);
      if (neighbors.length === 0) continue;
      hex.fraction = p;
      neighbors[randomInt(state, neighbors.length)].fraction = p;
    }
  }
}

function hasRealProvince(state: GameState, fraction: number): boolean {
  for (const hex of state.hexes) {
    if (hex.active && hex.fraction === fraction && friendlyNeighbors(state, hex) > 0) {
      return true;
    }
  }
  return false;
}

// --- entry --------------------------------------------------------------------------

export function generateMap(state: GameState) {
  const slay = (state.config.mode ?? "antiyoy") === "slay";
  createLand(state, slay);
  addTrees(state);
  if (slay) {
    slayBalance(state);
  } else {
    for (let attempt = 0; attempt < 20; attempt++) {
      genericBalance(state);
      if (everyPlayerHasProvince(state)) break;
    }
  }
}
