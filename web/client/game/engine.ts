// Antiyoy game engine — a faithful TypeScript port of the original Java rules
// (yio.tro.antiyoy, generic ruleset). Pure logic: no DOM, no Lakebed imports.

import {
  DEFENSE_STRONG_TOWER,
  DEFENSE_TOWER,
  DEFENSE_TOWN,
  FARM_EXTRA_COST,
  FARM_INCOME,
  INITIAL_PROVINCE_MONEY,
  MAP_GRID,
  MAP_SIZE_TILES,
  MAX_UNIT_STRENGTH,
  NEUTRAL_FRACTION,
  PALM_SPREAD_CHANCE,
  PINE_SPREAD_CHANCE,
  PRICE_FARM,
  PRICE_STRONG_TOWER,
  PRICE_TOWER,
  PRICE_UNIT,
  TAX_STRONG_TOWER,
  TAX_TOWER,
  TREE_CUT_REWARD,
  UNIT_MOVE_LIMIT,
  UNIT_TAX,
} from "./constants";
import type {
  Action,
  ActionResult,
  Fraction,
  GameConfig,
  GameState,
  HexTile,
  Province,
} from "./types";

// ---------------------------------------------------------------- RNG

/** Mulberry32 — deterministic, state lives in GameState.rngState. */
function nextRandom(state: GameState): number {
  let t = (state.rngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomInt(state: GameState, n: number): number {
  return Math.floor(nextRandom(state) * n);
}

// ---------------------------------------------------------------- Grid

/** Axial neighbor offsets for pointy-top hexes. */
const AXIAL_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

function buildGrid(w: number, h: number): HexTile[] {
  const hexes: HexTile[] = [];
  // Rectangular axial region: r in [0,h), q offset so the map is roughly square.
  for (let r = 0; r < h; r++) {
    for (let col = 0; col < w; col++) {
      const q = col - Math.floor(r / 2);
      hexes.push({
        index: hexes.length,
        q,
        r,
        active: false,
        fraction: NEUTRAL_FRACTION,
        obj: "none",
        unit: null,
        neighbors: [],
      });
    }
  }
  const byCoord = new Map<string, number>();
  for (const hex of hexes) byCoord.set(hex.q + "," + hex.r, hex.index);
  for (const hex of hexes) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const idx = byCoord.get(hex.q + dq + "," + (hex.r + dr));
      if (idx !== undefined) hex.neighbors.push(idx);
    }
  }
  return hexes;
}

function activeNeighbors(state: GameState, hex: HexTile): HexTile[] {
  const result: HexTile[] = [];
  for (const n of hex.neighbors) {
    const tile = state.hexes[n];
    if (tile.active) result.push(tile);
  }
  return result;
}

export function isNearWater(state: GameState, hex: HexTile): boolean {
  let activeCount = 0;
  for (const n of hex.neighbors) if (state.hexes[n].active) activeCount++;
  return activeCount < 6;
}

// ---------------------------------------------------------------- Map generation

export function createGame(config: GameConfig): GameState {
  const grid = MAP_GRID[config.mapSize];
  const targetTiles = MAP_SIZE_TILES[config.mapSize];
  const state: GameState = {
    config,
    hexes: buildGrid(grid.w, grid.h),
    provinces: [],
    turn: 0,
    round: 0,
    rngState: config.seed | 0 || 1,
    alive: new Array(config.playerCount).fill(true),
    winner: null,
    version: 0,
  };

  growIsland(state, targetTiles, grid);
  assignFractions(state);
  rebuildAllProvinces(state, true);
  sprinkleTrees(state);
  beginTurn(state); // income for player 0
  return state;
}

function growIsland(state: GameState, target: number, grid: { w: number; h: number }) {
  const centerR = Math.floor(grid.h / 2);
  const centerCol = Math.floor(grid.w / 2);
  const centerIdx = centerR * grid.w + centerCol;
  const frontier: number[] = [centerIdx];
  state.hexes[centerIdx].active = true;
  let count = 1;
  while (count < target && frontier.length > 0) {
    const pick = randomInt(state, frontier.length);
    const hex = state.hexes[frontier[pick]];
    const candidates = hex.neighbors.filter((n) => !state.hexes[n].active);
    if (candidates.length === 0) {
      frontier.splice(pick, 1);
      continue;
    }
    const grown = candidates[randomInt(state, candidates.length)];
    state.hexes[grown].active = true;
    frontier.push(grown);
    count++;
  }
  // Fill single-hex lakes to avoid degenerate coastlines.
  for (const hex of state.hexes) {
    if (hex.active) continue;
    const act = hex.neighbors.filter((n) => state.hexes[n].active).length;
    if (hex.neighbors.length === 6 && act === 6) {
      hex.active = true;
    }
  }
}

/**
 * Divide the island into small interleaved patches (2-4 hexes) so every
 * player starts with several small provinces, like the original generator.
 */
function assignFractions(state: GameState) {
  const active = state.hexes.filter((h) => h.active);
  const players = state.config.playerCount;
  // Shuffle active hexes (Fisher-Yates with the seeded RNG).
  const order = [...active];
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  let nextFraction = randomInt(state, players);
  for (const start of order) {
    if (start.fraction !== NEUTRAL_FRACTION) continue;
    const fraction = nextFraction;
    nextFraction = (nextFraction + 1) % players; // round-robin keeps it fair
    const blobSize = 2 + randomInt(state, 3);
    let current = start;
    current.fraction = fraction;
    for (let i = 1; i < blobSize; i++) {
      const free = activeNeighbors(state, current).filter((n) => n.fraction === NEUTRAL_FRACTION);
      if (free.length === 0) break;
      current = free[randomInt(state, free.length)];
      current.fraction = fraction;
    }
  }
}

function sprinkleTrees(state: GameState) {
  for (const hex of state.hexes) {
    if (!hex.active || hex.obj !== "none" || hex.unit) continue;
    const roll = nextRandom(state);
    if (isNearWater(state, hex)) {
      if (roll < 0.1) hex.obj = "palm";
    } else if (roll < 0.12) {
      hex.obj = "pine";
    }
  }
}

// ---------------------------------------------------------------- Provinces

let nextProvinceId = 1;

/** Recompute provinces from scratch. With init=true, gives starting money + capitals. */
function rebuildAllProvinces(state: GameState, init: boolean) {
  const oldByHex = new Map<number, Province>();
  for (const p of state.provinces) {
    for (const h of p.hexes) oldByHex.set(h, p);
  }
  state.provinces = [];
  const visited = new Set<number>();
  for (const hex of state.hexes) {
    if (!hex.active || hex.fraction >= NEUTRAL_FRACTION || visited.has(hex.index)) continue;
    const component: number[] = [];
    const queue = [hex.index];
    visited.add(hex.index);
    while (queue.length > 0) {
      const idx = queue.pop()!;
      component.push(idx);
      for (const n of state.hexes[idx].neighbors) {
        const tile = state.hexes[n];
        if (tile.active && tile.fraction === hex.fraction && !visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    if (component.length < 2) {
      // Single tiles are not provinces: structures fall, units die.
      handleDetachedTile(state, state.hexes[component[0]]);
      continue;
    }
    const province: Province = {
      id: nextProvinceId++,
      fraction: hex.fraction,
      hexes: component,
      money: init ? INITIAL_PROVINCE_MONEY : 0,
      capital: -1,
    };
    // Keep money/capital/identity of predecessor provinces.
    if (!init) {
      const donors = new Set<Province>();
      for (const h of component) {
        const old = oldByHex.get(h);
        if (old && old.fraction === province.fraction) donors.add(old);
      }
      for (const donor of donors) {
        // A donor's money and identity go to the component that holds its
        // capital; merged provinces sum their treasuries.
        if (donor.capital >= 0 && component.includes(donor.capital)) {
          province.money += donor.money;
          if (province.capital === -1) {
            province.capital = donor.capital;
            province.id = donor.id; // stable identity across captures
          }
        }
      }
    }
    ensureCapital(state, province);
    state.provinces.push(province);
  }
}

function handleDetachedTile(state: GameState, hex: HexTile) {
  if (hex.unit) {
    hex.unit = null;
    hex.obj = "grave";
  } else if (hex.obj === "town" || hex.obj === "tower" || hex.obj === "strongTower" || hex.obj === "farm") {
    hex.obj = "none";
  }
}

function ensureCapital(state: GameState, province: Province) {
  if (province.capital >= 0 && state.hexes[province.capital].obj === "town") return;
  // Remove stray towns left from merges.
  province.capital = -1;
  // Prefer an empty hex away from the border.
  let best = -1;
  let bestScore = -Infinity;
  for (const h of province.hexes) {
    const tile = state.hexes[h];
    if (tile.unit) continue;
    let score = 0;
    if (tile.obj === "none") score += 10;
    else if (tile.obj === "pine" || tile.obj === "palm" || tile.obj === "grave") score += 5;
    else continue; // don't replace farms/towers
    for (const n of activeNeighbors(state, tile)) {
      if (n.fraction === province.fraction) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  if (best === -1) best = province.hexes[0];
  const tile = state.hexes[best];
  tile.obj = "town";
  tile.unit = null;
  province.capital = best;
}

/** Remove duplicate towns after a merge: only the capital keeps a town. */
function pruneExtraTowns(state: GameState, province: Province) {
  for (const h of province.hexes) {
    const tile = state.hexes[h];
    if (tile.obj === "town" && h !== province.capital) tile.obj = "none";
  }
}

export function getProvinceByHex(state: GameState, hexIndex: number): Province | null {
  for (const p of state.provinces) {
    if (p.hexes.includes(hexIndex)) return p;
  }
  return null;
}

export function getProvincesOf(state: GameState, fraction: Fraction): Province[] {
  return state.provinces.filter((p) => p.fraction === fraction);
}

// ---------------------------------------------------------------- Economy

export function getHexIncome(state: GameState, hex: HexTile): number {
  if (hex.obj === "pine" || hex.obj === "palm") return 0;
  if (hex.obj === "farm") return FARM_INCOME + 1;
  return 1;
}

export function getHexTax(hex: HexTile): number {
  if (hex.unit) return UNIT_TAX[hex.unit.strength];
  if (hex.obj === "tower") return TAX_TOWER;
  if (hex.obj === "strongTower") return TAX_STRONG_TOWER;
  return 0;
}

export function getProvinceIncome(state: GameState, province: Province): number {
  let sum = 0;
  for (const h of province.hexes) sum += getHexIncome(state, state.hexes[h]);
  return sum;
}

export function getProvinceTaxes(state: GameState, province: Province): number {
  let sum = 0;
  for (const h of province.hexes) sum += getHexTax(state.hexes[h]);
  return sum;
}

export function getProvinceProfit(state: GameState, province: Province): number {
  return getProvinceIncome(state, province) - getProvinceTaxes(state, province);
}

export function getFarmPrice(state: GameState, province: Province): number {
  let farms = 0;
  for (const h of province.hexes) if (state.hexes[h].obj === "farm") farms++;
  return PRICE_FARM + farms * FARM_EXTRA_COST;
}

// ---------------------------------------------------------------- Defense

export function getDefenseNumber(state: GameState, hex: HexTile): number {
  let defense = 0;
  if (hex.obj === "town") defense = DEFENSE_TOWN;
  if (hex.obj === "tower") defense = DEFENSE_TOWER;
  if (hex.obj === "strongTower") defense = DEFENSE_STRONG_TOWER;
  if (hex.unit) defense = Math.max(defense, hex.unit.strength);
  for (const n of activeNeighbors(state, hex)) {
    if (n.fraction !== hex.fraction) continue;
    if (n.obj === "town") defense = Math.max(defense, DEFENSE_TOWN);
    if (n.obj === "tower") defense = Math.max(defense, DEFENSE_TOWER);
    if (n.obj === "strongTower") defense = Math.max(defense, DEFENSE_STRONG_TOWER);
    if (n.unit) defense = Math.max(defense, n.unit.strength);
  }
  return defense;
}

export function canUnitAttackHex(state: GameState, strength: number, hex: HexTile): boolean {
  if (strength === MAX_UNIT_STRENGTH) return true;
  return strength > getDefenseNumber(state, hex);
}

// ---------------------------------------------------------------- Move/buy/build zones

/** Can a friendly unit of given strength stop on this friendly tile? */
function canLandOn(hex: HexTile, strength: number): boolean {
  if (hex.obj === "town" || hex.obj === "tower" || hex.obj === "strongTower" || hex.obj === "farm") {
    return false;
  }
  if (hex.unit) return hex.unit.strength + strength <= MAX_UNIT_STRENGTH;
  return true; // empty, tree or grave (tree/grave get cleared)
}

/**
 * All hex indices a unit standing on `from` can move to this turn:
 * friendly tiles reachable within UNIT_MOVE_LIMIT steps through own province,
 * plus attackable enemy/neutral tiles adjacent to the reachable area.
 */
export function getMoveZone(state: GameState, from: number): number[] {
  const start = state.hexes[from];
  if (!start.unit || !start.unit.readyToMove) return [];
  const strength = start.unit.strength;
  const fraction = start.fraction;
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  const zone = new Set<number>();
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const d = dist.get(idx)!;
    for (const n of state.hexes[idx].neighbors) {
      const tile = state.hexes[n];
      if (!tile.active || dist.has(n)) continue;
      if (tile.fraction === fraction) {
        if (d + 1 <= UNIT_MOVE_LIMIT) {
          dist.set(n, d + 1);
          queue.push(n);
          if (canLandOn(tile, strength)) zone.add(n);
        }
      } else {
        // Border tile: capturing costs one step.
        if (d + 1 <= UNIT_MOVE_LIMIT && canUnitAttackHex(state, strength, tile)) {
          dist.set(n, d + 1);
          zone.add(n);
        }
      }
    }
  }
  zone.delete(from);
  return [...zone];
}

/** Where a newly bought unit of `strength` may be placed for `province`. */
export function getBuyZone(state: GameState, province: Province, strength: number): number[] {
  const zone = new Set<number>();
  for (const h of province.hexes) {
    const tile = state.hexes[h];
    if (canLandOn(tile, strength)) zone.add(h);
    for (const n of activeNeighbors(state, tile)) {
      if (n.fraction !== province.fraction && canUnitAttackHex(state, strength, n)) {
        zone.add(n.index);
      }
    }
  }
  return [...zone];
}

export function getBuildZone(
  state: GameState,
  province: Province,
  kind: "farm" | "tower" | "strongTower"
): number[] {
  const zone: number[] = [];
  for (const h of province.hexes) {
    const tile = state.hexes[h];
    if (tile.unit) continue;
    if (kind === "farm") {
      // Original rule: farms must touch the capital or another farm.
      if (tile.obj !== "none") continue;
      const nearHouse = activeNeighbors(state, tile).some(
        (n) => n.fraction === province.fraction && (n.obj === "town" || n.obj === "farm")
      );
      if (nearHouse) zone.push(h);
    } else if (kind === "tower") {
      if (tile.obj === "none") zone.push(h);
    } else {
      if (tile.obj === "none" || tile.obj === "tower") zone.push(h);
    }
  }
  return zone;
}

// ---------------------------------------------------------------- Actions

export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.winner !== null) return { ok: false, reason: "game over" };
  let result: ActionResult;
  switch (action.type) {
    case "moveUnit":
      result = doMoveUnit(state, action.from, action.to);
      break;
    case "buyUnit":
      result = doBuyUnit(state, action.provinceId, action.strength, action.target);
      break;
    case "build":
      result = doBuild(state, action.provinceId, action.kind, action.target);
      break;
    case "endTurn":
      result = doEndTurn(state);
      break;
  }
  if (result.ok) state.version++;
  return result;
}

function doMoveUnit(state: GameState, from: number, to: number): ActionResult {
  const source = state.hexes[from];
  if (!source.unit) return { ok: false, reason: "no unit" };
  if (source.fraction !== state.turn) return { ok: false, reason: "not your unit" };
  if (!source.unit.readyToMove) return { ok: false, reason: "unit already moved" };
  const zone = getMoveZone(state, from);
  if (!zone.includes(to)) return { ok: false, reason: "out of reach" };

  const unit = source.unit;
  const target = state.hexes[to];
  const isCapture = target.fraction !== source.fraction;
  const actingProvince = getProvinceByHex(state, from);
  source.unit = null;
  if (isCapture) target.unit = null; // the defender dies, never merges
  // A unit that moved is spent for this turn (capture or reposition).
  placeUnitOnHex(state, target, unit.strength, false, actingProvince);
  if (isCapture) {
    captureHex(state, target, state.turn);
  }
  return { ok: true };
}

function doBuyUnit(state: GameState, provinceId: number, strength: number, targetIdx: number): ActionResult {
  const province = state.provinces.find((p) => p.id === provinceId);
  if (!province) return { ok: false, reason: "no province" };
  if (province.fraction !== state.turn) return { ok: false, reason: "not your province" };
  if (strength < 1 || strength > MAX_UNIT_STRENGTH) return { ok: false, reason: "bad strength" };
  const price = PRICE_UNIT * strength;
  if (province.money < price) return { ok: false, reason: "not enough money" };
  const zone = getBuyZone(state, province, strength);
  if (!zone.includes(targetIdx)) return { ok: false, reason: "invalid placement" };

  const target = state.hexes[targetIdx];
  const isCapture = target.fraction !== province.fraction;
  province.money -= price;
  if (isCapture) target.unit = null; // the defender dies, never merges
  // Fresh units may still move when placed on own land; attacking spends them.
  placeUnitOnHex(state, target, strength, !isCapture, province);
  if (isCapture) {
    captureHex(state, target, province.fraction);
  }
  return { ok: true };
}

/** Put a unit on a destination tile, merging with friendlies and cutting trees. */
function placeUnitOnHex(
  state: GameState,
  target: HexTile,
  strength: number,
  readyToMove: boolean,
  actingProvince: Province | null
) {
  let finalStrength = strength;
  let ready = readyToMove;
  if (target.unit) {
    finalStrength = target.unit.strength + strength;
    ready = readyToMove && target.unit.readyToMove;
  }
  if (target.obj === "pine" || target.obj === "palm") {
    if (actingProvince) actingProvince.money += TREE_CUT_REWARD;
    target.obj = "none";
  } else if (target.obj === "grave") {
    target.obj = "none";
  }
  target.unit = { strength: finalStrength, readyToMove: ready };
}

function captureHex(state: GameState, target: HexTile, by: Fraction) {
  // The unit was already placed by placeUnitOnHex; clear defeated structures.
  if (target.obj === "town" || target.obj === "tower" || target.obj === "strongTower" || target.obj === "farm") {
    target.obj = "none";
  }
  target.fraction = by;
  // The unit just attacked: it is spent.
  if (target.unit) target.unit.readyToMove = false;
  rebuildAllProvinces(state, false);
  for (const p of state.provinces) pruneExtraTowns(state, p);
  checkElimination(state);
}

function doBuild(
  state: GameState,
  provinceId: number,
  kind: "farm" | "tower" | "strongTower",
  targetIdx: number
): ActionResult {
  const province = state.provinces.find((p) => p.id === provinceId);
  if (!province) return { ok: false, reason: "no province" };
  if (province.fraction !== state.turn) return { ok: false, reason: "not your province" };
  const price =
    kind === "farm" ? getFarmPrice(state, province) : kind === "tower" ? PRICE_TOWER : PRICE_STRONG_TOWER;
  if (province.money < price) return { ok: false, reason: "not enough money" };
  const zone = getBuildZone(state, province, kind);
  if (!zone.includes(targetIdx)) return { ok: false, reason: "invalid placement" };
  province.money -= price;
  state.hexes[targetIdx].obj = kind;
  return { ok: true };
}

// ---------------------------------------------------------------- Turn flow

function doEndTurn(state: GameState): ActionResult {
  // Find next alive fraction.
  let next = state.turn;
  for (let i = 0; i < state.config.playerCount; i++) {
    next = (next + 1) % state.config.playerCount;
    if (state.alive[next]) break;
  }
  if (next <= state.turn) {
    state.round++;
    spreadTrees(state);
  }
  state.turn = next;
  beginTurn(state);
  return { ok: true };
}

function beginTurn(state: GameState) {
  const fraction = state.turn;
  for (const hex of state.hexes) {
    if (!hex.active || hex.fraction !== fraction) continue;
    // Graves on this player's land become pines.
    if (hex.obj === "grave") {
      hex.obj = "pine";
      hex.treeBorn = state.round;
    }
    // Units are refreshed.
    if (hex.unit) hex.unit.readyToMove = true;
  }
  for (const province of getProvincesOf(state, fraction)) {
    province.money += getProvinceProfit(state, province);
    if (province.money < 0) {
      // Bankruptcy: every unit in the province dies.
      province.money = 0;
      for (const h of province.hexes) {
        const tile = state.hexes[h];
        if (tile.unit) {
          tile.unit = null;
          if (tile.obj === "none") tile.obj = "grave";
        }
      }
    }
  }
}

function spreadTrees(state: GameState) {
  // A tree may seed only if it has stood for at least one full round
  // (mirrors the original's "ready to expand" throttle).
  const ready = (n: HexTile) => (n.treeBorn ?? -1) < state.round;
  const toSprout: { index: number; obj: "pine" | "palm" }[] = [];
  for (const hex of state.hexes) {
    if (!hex.active || hex.obj !== "none" || hex.unit) continue;
    const neighbors = activeNeighbors(state, hex);
    const treesNearby = neighbors.filter((n) => n.obj === "pine" || n.obj === "palm").length;
    if (isNearWater(state, hex) && neighbors.some((n) => n.obj === "palm" && ready(n))) {
      if (nextRandom(state) < PALM_SPREAD_CHANCE) toSprout.push({ index: hex.index, obj: "palm" });
    } else if (treesNearby >= 2 && neighbors.some((n) => n.obj === "pine" && ready(n))) {
      if (nextRandom(state) < PINE_SPREAD_CHANCE) toSprout.push({ index: hex.index, obj: "pine" });
    }
  }
  for (const s of toSprout) {
    state.hexes[s.index].obj = s.obj;
    state.hexes[s.index].treeBorn = state.round;
  }
}

function checkElimination(state: GameState) {
  for (let p = 0; p < state.config.playerCount; p++) {
    if (!state.alive[p]) continue;
    if (getProvincesOf(state, p).length === 0) state.alive[p] = false;
  }
  const survivors: number[] = [];
  for (let p = 0; p < state.config.playerCount; p++) {
    if (state.alive[p]) survivors.push(p);
  }
  if (survivors.length === 1) state.winner = survivors[0];
}

// ---------------------------------------------------------------- Convenience for UI

export function isHumanTurn(state: GameState): boolean {
  return state.turn < state.config.humanCount;
}

/** Price of a unit of the given strength. */
export function getUnitPrice(strength: number): number {
  return PRICE_UNIT * strength;
}

export { PRICE_TOWER as TOWER_PRICE, PRICE_STRONG_TOWER as STRONG_TOWER_PRICE };
