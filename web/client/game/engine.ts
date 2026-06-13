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
import { generateMap } from "./mapgen";
import type {
  Action,
  ActionResult,
  Fraction,
  GameConfig,
  GameSession,
  GameState,
  HexTile,
  Province,
} from "./types";
import type { Scenario } from "./scenario";

export interface ActionEvent {
  action: Action;
  actor: Fraction;
  moneyBefore: number[];
  moneyAfter: number[];
}

const actionObservers = new WeakMap<GameState, (event: ActionEvent) => void>();

/** Observe successful actions on one live game state (used by replay recording). */
export function setActionObserver(state: GameState, observer: ((event: ActionEvent) => void) | null) {
  if (observer) actionObservers.set(state, observer);
  else actionObservers.delete(state);
}

function playerMoney(state: GameState): number[] {
  const totals = new Array(state.config.playerCount).fill(0);
  for (const province of state.provinces) totals[province.fraction] += province.money;
  return totals;
}

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
    nextProvinceId: 1,
  };

  generateMap(state); // original Antiyoy island + province generator
  rebuildAllProvinces(state, true);
  beginTurn(state); // income for player 0
  return state;
}

/**
 * Build a game from a fully-specified Scenario (campaign level, editor,
 * import…). Shares province/capital/income/turn finalization with
 * createGame; the engine stays independent of campaign modules.
 */
export function createScenarioGame(scenario: Scenario, session?: GameSession): GameState {
  // Grid bounds covering every placed hex, padded by 2 so neighbors and the
  // surrounding water exist for rendering and tree spread.
  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const h of scenario.hexes) {
    if (h.q < minQ) minQ = h.q;
    if (h.q > maxQ) maxQ = h.q;
    if (h.r < minR) minR = h.r;
    if (h.r > maxR) maxR = h.r;
  }
  if (!Number.isFinite(minQ)) throw new Error("scenario has no hexes");
  const pad = 2;
  const hexes = buildGridForBounds(minQ - pad, maxQ + pad, minR - pad, maxR + pad);
  const byCoord = new Map<string, HexTile>();
  for (const hex of hexes) byCoord.set(hex.q + "," + hex.r, hex);

  const config: GameConfig = {
    mapSize: "medium", // scenarios carry their own grid; size is informational
    playerCount: scenario.playerCount,
    humanCount: scenario.humanCount,
    seed: 1,
    difficulty: scenario.difficulty,
    mode: scenario.mode,
    fogOfWar: scenario.fogOfWar,
    diplomacy: scenario.diplomacy,
  };

  const state: GameState = {
    config,
    session: session ?? { source: "campaign", objective: scenario.objective },
    hexes,
    provinces: [],
    turn: 0,
    round: 0,
    rngState: 1,
    alive: new Array(scenario.playerCount).fill(true),
    winner: null,
    version: 0,
    nextProvinceId: 1,
  };

  // Money carried per (capital) hex, applied after provinces are detected.
  const moneyByCoord = new Map<string, number>();
  for (const sh of scenario.hexes) {
    const hex = byCoord.get(sh.q + "," + sh.r);
    if (!hex) continue;
    hex.active = true;
    hex.fraction = sh.fraction;
    hex.obj = sh.obj;
    if (sh.unit && sh.unit > 0) {
      hex.unit = { strength: sh.unit, readyToMove: sh.unitReady ?? false };
    }
    if (sh.money !== undefined) moneyByCoord.set(sh.q + "," + sh.r, sh.money);
  }

  rebuildAllProvinces(state, true);
  // Override starting treasuries from the scenario (capital, else any hex).
  for (const province of state.provinces) {
    let money: number | undefined;
    const cap = province.capital >= 0 ? state.hexes[province.capital] : null;
    if (cap) money = moneyByCoord.get(cap.q + "," + cap.r);
    if (money === undefined) {
      for (const h of province.hexes) {
        const hex = state.hexes[h];
        const m = moneyByCoord.get(hex.q + "," + hex.r);
        if (m !== undefined) {
          money = m;
          break;
        }
      }
    }
    if (money !== undefined) province.money = money;
  }

  beginTurn(state); // income for player 0, units refreshed
  return state;
}

function buildGridForBounds(minQ: number, maxQ: number, minR: number, maxR: number): HexTile[] {
  const hexes: HexTile[] = [];
  for (let r = minR; r <= maxR; r++) {
    for (let q = minQ; q <= maxQ; q++) {
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

// ---------------------------------------------------------------- Provinces

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
      id: state.nextProvinceId++,
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
  // Adopt a pre-placed town (scenarios/editor specify capitals explicitly);
  // generated maps have no towns, so this branch is skipped there. Prefer a
  // town without a unit on it.
  const towns = province.hexes.filter((h) => state.hexes[h].obj === "town");
  if (towns.length > 0) {
    const preferred = towns.find((h) => !state.hexes[h].unit) ?? towns[0];
    province.capital = preferred;
    for (const h of towns) if (h !== preferred) state.hexes[h].obj = "none";
    return;
  }
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
  const actor = state.turn;
  const moneyBefore = playerMoney(state);
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
  if (result.ok) {
    state.version++;
    actionObservers.get(state)?.({
      action: structuredClone(action),
      actor,
      moneyBefore,
      moneyAfter: playerMoney(state),
    });
  }
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

/**
 * Original hold-to-march (MassMarchManager): every ready unit of the
 * province walks toward `target` through the province's own land — no
 * attacks, only empty or tree tiles, sideways moves allowed. Each step is
 * an ordinary moveUnit action, so undo/replay observe it normally.
 * Returns the number of units moved.
 */
export function marchUnitsToHex(state: GameState, province: Province, target: number): number {
  const targetHex = state.hexes[target];
  if (!targetHex.active || targetHex.fraction !== province.fraction) return 0;
  // BFS distance from the target across same-fraction connected land.
  const dist = new Map<number, number>([[target, 0]]);
  const queue = [targetHex];
  for (let i = 0; i < queue.length; i++) {
    const d = dist.get(queue[i].index)!;
    for (const n of queue[i].neighbors) {
      const nh = state.hexes[n];
      if (nh.active && nh.fraction === province.fraction && !dist.has(n)) {
        dist.set(n, d + 1);
        queue.push(nh);
      }
    }
  }
  const unitHexes = province.hexes.filter((h) => state.hexes[h].unit?.readyToMove);
  let moves = 0;
  for (const from of unitHexes) {
    if (!dist.has(from)) continue;
    const fromHex = state.hexes[from];
    if (!fromHex.unit?.readyToMove) continue; // merged into earlier marcher
    const zone = getMoveZone(state, from);
    let best = -1;
    let bestD = Infinity;
    for (const z of zone) {
      const h = state.hexes[z];
      if (h.fraction !== province.fraction || h.unit) continue;
      if (h.obj !== "none" && h.obj !== "pine" && h.obj !== "palm") continue;
      const d = dist.get(z);
      if (d !== undefined && d < bestD) {
        bestD = d;
        best = z;
      }
    }
    if (best >= 0 && best !== from) {
      if (applyAction(state, { type: "moveUnit", from, to: best }).ok) moves++;
    }
  }
  return moves;
}

/**
 * Next ready unit worth selecting (original AutomaticTransitionWorker,
 * simplified): prefer the current province, skip units whose move zone
 * contains only own land. Returns a hex index or -1.
 */
export function findNextReadyUnit(state: GameState, preferProvinceId: number): number {
  const candidates: number[] = [];
  const preferred = state.provinces.find((p) => p.id === preferProvinceId);
  const pools = preferred
    ? [preferred, ...state.provinces.filter((p) => p.fraction === state.turn && p !== preferred)]
    : state.provinces.filter((p) => p.fraction === state.turn);
  for (const province of pools) {
    if (province.fraction !== state.turn) continue;
    for (const h of province.hexes) {
      const hex = state.hexes[h];
      if (!hex.unit?.readyToMove) continue;
      const zone = getMoveZone(state, h);
      if (zone.some((z) => state.hexes[z].fraction !== state.turn)) return h;
      candidates.push(h);
    }
  }
  return candidates.length > 0 ? candidates[0] : -1;
}

export { PRICE_TOWER as TOWER_PRICE, PRICE_STRONG_TOWER as STRONG_TOWER_PRICE };
