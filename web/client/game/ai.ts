// AI opponent for the Antiyoy web remaster. Greedy heuristics modeled on the
// original game's "normal" difficulty: expand aggressively, keep the economy
// solvent, defend valuable tiles, and never end a turn with idle ready units
// if a sensible move exists.

import {
  applyAction,
  canUnitAttackHex,
  getBuildZone,
  getBuyZone,
  getDefenseNumber,
  getFarmPrice,
  getMoveZone,
  getProvinceProfit,
  getProvincesOf,
  getRelation,
  getUnitPrice,
} from "./engine";
import { MAX_UNIT_STRENGTH, NEUTRAL_FRACTION, PRICE_TOWER, UNIT_TAX } from "./constants";
import type { Difficulty, GameState, HexTile, Province } from "./types";

interface AiTuning {
  /** Sweeps over the province list per turn. */
  passes: number;
  /** Turns of upkeep a cash pile must cover before deficit-buying a unit. */
  bufferTaxTurns: number;
  /** Whether idle units harvest trees and march to the front. */
  repositioning: boolean;
  /** Whether the AI invests in towers. */
  buildsTowers: boolean;
}

const TUNINGS: Record<Difficulty, AiTuning> = {
  easy: { passes: 1, bufferTaxTurns: Infinity, repositioning: false, buildsTowers: false },
  normal: { passes: 2, bufferTaxTurns: 3, repositioning: true, buildsTowers: true },
  hard: { passes: 4, bufferTaxTurns: 2, repositioning: true, buildsTowers: true },
  expert: { passes: 5, bufferTaxTurns: 1.5, repositioning: true, buildsTowers: true },
  balancer: { passes: 3, bufferTaxTurns: 2.5, repositioning: true, buildsTowers: true },
  master: { passes: 7, bufferTaxTurns: 1, repositioning: true, buildsTowers: true },
};

function tuning(state: GameState): AiTuning {
  return TUNINGS[state.config.difficulty ?? "normal"];
}

/** How valuable capturing a hex is. */
function captureValue(state: GameState, hex: HexTile): number {
  let value = 10;
  if (hex.obj === "town") value += 100; // beheading a province is huge
  if (hex.obj === "farm") value += 30;
  if (hex.obj === "tower") value += 20;
  if (hex.obj === "strongTower") value += 25;
  if (hex.obj === "pine" || hex.obj === "palm") value += 5; // tree-cut bonus
  if (hex.unit) value += hex.unit.strength * 15;
  if (hex.fraction !== NEUTRAL_FRACTION) value += 8; // hurting a player beats neutral land
  return value;
}

/** Performs the whole turn for the current fraction, including the final endTurn. */
export function aiTakeTurn(state: GameState): void {
  const fraction = state.turn;
  // Safety cap so a logic bug can never hang the browser.
  let budget = 500;

  handleDiplomacy(state, fraction);

  // Captures can merge/split provinces mid-turn, so sweep until quiet.
  for (let pass = 0; pass < tuning(state).passes && budget > 0; pass++) {
    const before = state.version;
    for (const province of getProvincesOf(state, fraction)) {
      // Province list can be invalidated by captures (rebuilds), so re-find it.
      const live = state.provinces.find((p) => p.id === province.id);
      if (!live || live.fraction !== fraction) continue;
      budget = runProvince(state, live.id, budget);
      if (budget <= 0) break;
    }
    if (state.version === before) break;
  }

  applyAction(state, { type: "endTurn" });
}

function handleDiplomacy(state: GameState, fraction: number) {
  const diplomacy = state.diplomacy;
  if (!state.config.diplomacy || !diplomacy) return;

  // Resolve inbox first. Gifts and subsidies are always useful. Friendship and
  // peace are accepted only when there is no shared border, so the basic AI
  // cannot lock itself out of necessary attacks.
  const incoming = diplomacy.proposals.filter((proposal) => proposal.to === fraction);
  for (const proposal of incoming) {
    const peaceful =
      proposal.kind === "gift" ||
      proposal.kind === "subsidy" ||
      !hasSharedBorder(state, fraction, proposal.from);
    applyAction(state, {
      type: peaceful ? "acceptExchange" : "rejectExchange",
      proposalId: proposal.id,
    });
  }

  // Diplomacy mode starts neutral, and neutral cannot be attacked. Declare war
  // on adjacent non-friend survivors before the normal greedy move/buy logic.
  const targets = borderingFractions(state, fraction);
  for (const target of targets) {
    if (getRelation(state, fraction, target) === "neutral") {
      applyAction(state, { type: "declareWar", target });
    }
  }
}

function borderingFractions(state: GameState, fraction: number): number[] {
  const seen = new Set<number>();
  for (const hex of state.hexes) {
    if (!hex.active || hex.fraction !== fraction) continue;
    for (const n of hex.neighbors) {
      const other = state.hexes[n].fraction;
      if (other !== fraction && other < NEUTRAL_FRACTION && state.alive[other]) seen.add(other);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function hasSharedBorder(state: GameState, a: number, b: number): boolean {
  for (const hex of state.hexes) {
    if (!hex.active || hex.fraction !== a) continue;
    for (const n of hex.neighbors) {
      if (state.hexes[n].fraction === b) return true;
    }
  }
  return false;
}

function runProvince(state: GameState, provinceId: number, budget: number): number {
  while (budget-- > 0) {
    const province = state.provinces.find((p) => p.id === provinceId);
    if (!province || province.fraction !== state.turn) break;
    if (moveOneUnit(state, province)) continue;
    if (buyOneUnit(state, province)) continue;
    if (buildSomething(state, province)) continue;
    break;
  }
  return budget;
}

/** Hexes of the province that touch land not owned by it. */
function borderHexes(state: GameState, province: Province): HexTile[] {
  const result: HexTile[] = [];
  for (const h of province.hexes) {
    const tile = state.hexes[h];
    for (const n of tile.neighbors) {
      const neighbor = state.hexes[n];
      if (neighbor.active && neighbor.fraction !== province.fraction) {
        result.push(tile);
        break;
      }
    }
  }
  return result;
}

function distanceTo(a: HexTile, b: HexTile): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Move the first ready unit: capture the best target in reach, or, if nothing
 * is capturable, march toward the front line. Returns true if it acted.
 */
function moveOneUnit(state: GameState, province: Province): boolean {
  const border = borderHexes(state, province);
  for (const h of province.hexes) {
    const tile = state.hexes[h];
    if (!tile.unit || !tile.unit.readyToMove) continue;
    const zone = getMoveZone(state, h);
    let best = -1;
    let bestValue = 0;
    for (const idx of zone) {
      const target = state.hexes[idx];
      if (target.fraction === province.fraction) continue; // only captures
      const value = captureValue(state, target);
      if (value > bestValue) {
        bestValue = value;
        best = idx;
      }
    }
    if (best >= 0) {
      const r = applyAction(state, { type: "moveUnit", from: h, to: best });
      if (r.ok) return true;
    }
    if (!tuning(state).repositioning) continue;
    // No capture available: harvest an own tree in reach (+3 gold, frees
    // the tile's income) before considering a march.
    let treeTarget = -1;
    for (const idx of zone) {
      const target = state.hexes[idx];
      if (target.fraction !== province.fraction || target.unit) continue;
      if (target.obj === "pine" || target.obj === "palm") {
        treeTarget = idx;
        break;
      }
    }
    if (treeTarget >= 0) {
      const r = applyAction(state, { type: "moveUnit", from: h, to: treeTarget });
      if (r.ok) return true;
    }
    // Otherwise reposition toward the nearest front line so the
    // unit is useful next turn instead of idling in the interior.
    const myDist = Math.min(...border.map((b) => distanceTo(tile, b)), Infinity);
    if (myDist > 1) {
      let march = -1;
      let marchDist = myDist;
      for (const idx of zone) {
        const target = state.hexes[idx];
        if (target.fraction !== province.fraction || target.unit) continue;
        const d = Math.min(...border.map((b) => distanceTo(target, b)), Infinity);
        if (d < marchDist) {
          marchDist = d;
          march = idx;
        }
      }
      if (march >= 0) {
        const r = applyAction(state, { type: "moveUnit", from: h, to: march });
        if (r.ok) return true;
      }
    }
  }
  return false;
}

/** Buy the cheapest unit that can capture something worthwhile. */
function buyOneUnit(state: GameState, province: Province): boolean {
  const profit = getProvinceProfit(state, province);
  for (let strength = 1; strength <= MAX_UNIT_STRENGTH; strength++) {
    const price = getUnitPrice(strength);
    if (province.money < price) break;
    // Don't bankrupt: after upkeep the province must stay solvent — unless
    // a cash pile can fund a wall-breaker for several turns of upkeep.
    const sustainable =
      profit - UNIT_TAX[strength] >= 0 ||
      province.money >= price + tuning(state).bufferTaxTurns * UNIT_TAX[strength];
    if (!sustainable) continue;
    const zone = getBuyZone(state, province, strength);
    let best = -1;
    let bestValue = 0;
    for (const idx of zone) {
      const target = state.hexes[idx];
      if (target.fraction === province.fraction) continue;
      // Prefer the cheapest sufficient unit: skip if a weaker unit could take it.
      if (strength > 1 && canUnitAttackHex(state, strength - 1, target)) continue;
      const value = captureValue(state, target);
      if (value > bestValue) {
        bestValue = value;
        best = idx;
      }
    }
    if (best >= 0) {
      const r = applyAction(state, { type: "buyUnit", provinceId: province.id, strength, target: best });
      if (r.ok) return true;
    }
  }
  return false;
}

/** Spend surplus on farms (economy) and the odd tower (defense). */
function buildSomething(state: GameState, province: Province): boolean {
  const allowTowers = tuning(state).buildsTowers;
  // Farms: strong long-term value, buy whenever comfortably affordable.
  const farmPrice = getFarmPrice(state, province);
  if (province.money >= farmPrice + 10) {
    const spots = getBuildZone(state, province, "farm");
    if (spots.length > 0) {
      const r = applyAction(state, {
        type: "build",
        kind: "farm",
        provinceId: province.id,
        target: spots[0],
      });
      if (r.ok) return true;
    }
  }
  // Tower: place where it covers the most undefended border tiles.
  if (allowTowers && province.money >= PRICE_TOWER + 20 && province.hexes.length >= 8) {
    const spots = getBuildZone(state, province, "tower");
    let best = -1;
    let bestCover = 2; // require covering at least 3 weak tiles to bother
    for (const idx of spots) {
      const tile = state.hexes[idx];
      let cover = 0;
      for (const n of tile.neighbors) {
        const neighbor = state.hexes[n];
        if (!neighbor.active || neighbor.fraction !== province.fraction) continue;
        if (getDefenseNumber(state, neighbor) < 2) cover++;
      }
      if (getDefenseNumber(state, tile) < 2) cover++;
      if (cover > bestCover) {
        bestCover = cover;
        best = idx;
      }
    }
    if (best >= 0) {
      const r = applyAction(state, {
        type: "build",
        kind: "tower",
        provinceId: province.id,
        target: best,
      });
      if (r.ok) return true;
    }
  }
  return false;
}
