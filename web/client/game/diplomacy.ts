// Diplomacy model and rules — a clean reimplementation of the original
// DiplomacyManager's essentials (relations, contracts, proposals, transfers,
// victory) that fixes the known legacy defects rather than reproducing them:
//   * attacks on isolated single hexes still obey relations (no exemption),
//   * money transfers conserve the integer treasury exactly, even when the
//     recipient currently has zero money,
//   * subsidies are capped by the payer's income and available funds,
//   * eliminated players are scrubbed from relations, contracts and proposals.
//
// All operations mutate GameState in place and are driven through Action
// variants in the engine, so undo/replay/save observe them like any move.

import { NEUTRAL_FRACTION } from "./constants";
import { getProvincesOf, getProvinceProfit } from "./engine";
import type {
  DiplomacyState,
  DiploContract,
  Fraction,
  GameState,
  Relation,
} from "./types";

// Contract durations (original DiplomaticContract).
const DURATION_FRIEND = 12;
const DURATION_PEACE = 9;
const DURATION_BLACK_MARK = 20;
const STOP_WAR_COOLDOWN = 5;

export function initDiplomacy(playerCount: number): DiplomacyState {
  const relations: Relation[][] = [];
  const stopWarCooldown: number[][] = [];
  for (let a = 0; a < playerCount; a++) {
    relations.push(new Array(playerCount).fill("neutral"));
    stopWarCooldown.push(new Array(playerCount).fill(0));
  }
  return {
    relations,
    stopWarCooldown,
    blackMarks: [],
    contracts: [],
    proposals: [],
    log: [],
    nextProposalId: 1,
    reputation: new Array(playerCount).fill(0),
  };
}

function dip(state: GameState): DiplomacyState | null {
  return state.config.diplomacy ? state.diplomacy ?? null : null;
}

export function getRelation(state: GameState, a: Fraction, b: Fraction): Relation {
  const d = state.diplomacy;
  if (!d || a === b) return a === b ? "friend" : "neutral";
  return d.relations[a]?.[b] ?? "neutral";
}

function setRelation(d: DiplomacyState, a: Fraction, b: Fraction, rel: Relation) {
  if (a === b) return;
  d.relations[a][b] = rel;
  d.relations[b][a] = rel;
}

function log(d: DiplomacyState, round: number, from: Fraction, to: Fraction, text: string) {
  d.log.push({ round, from, to, text });
  if (d.log.length > 200) d.log.shift();
}

/**
 * May `attacker` capture a hex owned by `defenderFraction`? Neutral land is
 * always attackable; otherwise only fractions you are at war with. No
 * isolated-hex exemption (legacy defect fixed).
 */
export function canAttackFraction(state: GameState, attacker: Fraction, defenderFraction: Fraction): boolean {
  if (defenderFraction >= NEUTRAL_FRACTION) return true; // neutral land
  if (attacker === defenderFraction) return true;
  const d = dip(state);
  if (!d) return true;
  return getRelation(state, attacker, defenderFraction) === "war";
}

// --- treasury transfer (integer-exact, zero-money-safe) ----------------------

function fullMoney(state: GameState, fraction: Fraction): number {
  return getProvincesOf(state, fraction).reduce((sum, p) => sum + p.money, 0);
}

function fractionIncome(state: GameState, fraction: Fraction): number {
  return getProvincesOf(state, fraction).reduce((sum, p) => sum + Math.max(0, getProvinceProfit(state, p)), 0);
}

/**
 * Move up to `value` integer coins from `sender` to `recipient`, conserving
 * the total exactly. Deducts largest-province-first; credits the recipient's
 * capital province (or its first), which works even at zero money.
 */
export function transferMoney(state: GameState, sender: Fraction, recipient: Fraction, value: number): number {
  const available = fullMoney(state, sender);
  let amount = Math.min(Math.max(0, Math.floor(value)), available);
  if (amount <= 0) return 0;
  const moved = amount;

  const senderProvinces = getProvincesOf(state, sender).sort((a, b) => b.money - a.money);
  for (const p of senderProvinces) {
    if (amount <= 0) break;
    const take = Math.min(p.money, amount);
    p.money -= take;
    amount -= take;
  }

  const recvProvinces = getProvincesOf(state, recipient);
  if (recvProvinces.length > 0) {
    const capital = recvProvinces.find((p) => p.capital >= 0) ?? recvProvinces[0];
    capital.money += moved;
  }
  return moved;
}

// --- player actions ----------------------------------------------------------

export function declareWar(state: GameState, by: Fraction, target: Fraction): boolean {
  const d = dip(state);
  if (!d || by === target || target >= NEUTRAL_FRACTION) return false;
  const wasFriend = getRelation(state, by, target) === "friend";
  setRelation(d, by, target, "war");
  // Breaking a friendship to attack is treachery — reputation penalty.
  if (wasFriend) d.reputation[by] -= 3;
  d.reputation[by] -= 1;
  // Cancel any friendship/peace/subsidy contracts between the two.
  d.contracts = d.contracts.filter((c) => !involves(c, by, target));
  d.stopWarCooldown[by][target] = STOP_WAR_COOLDOWN;
  d.stopWarCooldown[target][by] = STOP_WAR_COOLDOWN;
  log(d, state.round, by, target, wasFriend ? "betrayed and declared war" : "declared war");
  return true;
}

export function setBlackMark(state: GameState, by: Fraction, target: Fraction): boolean {
  const d = dip(state);
  if (!d || by === target || target >= NEUTRAL_FRACTION) return false;
  declareWar(state, by, target);
  if (!d.blackMarks.includes(target)) d.blackMarks.push(target);
  d.reputation[target] -= 5; // marked as an outlaw
  d.contracts.push({ type: "blackMark", a: by, b: target, expires: state.round + DURATION_BLACK_MARK });
  log(d, state.round, by, target, "placed a black mark");
  return true;
}

export function proposeExchange(
  state: GameState,
  from: Fraction,
  to: Fraction,
  kind: "friendship" | "stopWar" | "subsidy" | "gift",
  amount?: number
): number {
  const d = dip(state);
  if (!d || from === to || to >= NEUTRAL_FRACTION) return -1;
  const id = d.nextProposalId++;
  d.proposals.push({ id, from, to, kind, amount: amount && amount > 0 ? Math.floor(amount) : undefined });
  log(d, state.round, from, to, `proposed ${kind}`);
  return id;
}

export function rejectExchange(state: GameState, proposalId: number): boolean {
  const d = dip(state);
  if (!d) return false;
  const before = d.proposals.length;
  d.proposals = d.proposals.filter((p) => p.id !== proposalId);
  return d.proposals.length < before;
}

export function acceptExchange(state: GameState, proposalId: number): boolean {
  const d = dip(state);
  if (!d) return false;
  const proposal = d.proposals.find((p) => p.id === proposalId);
  if (!proposal) return false;
  d.proposals = d.proposals.filter((p) => p.id !== proposalId);
  const { from, to, kind, amount } = proposal;

  switch (kind) {
    case "friendship":
      setRelation(d, from, to, "friend");
      d.contracts.push({ type: "friendship", a: from, b: to, expires: state.round + DURATION_FRIEND });
      d.reputation[from] += 1;
      d.reputation[to] += 1;
      log(d, state.round, to, from, "accepted friendship");
      break;
    case "stopWar":
      if (getRelation(state, from, to) === "war" && d.stopWarCooldown[from][to] === 0) {
        setRelation(d, from, to, "neutral");
        d.contracts.push({ type: "peace", a: from, b: to, expires: state.round + DURATION_PEACE });
        log(d, state.round, to, from, "agreed to peace");
      }
      break;
    case "subsidy":
      if (amount && amount > 0) {
        d.contracts.push({ type: "subsidy", a: from, b: to, subsidy: amount, expires: state.round + DURATION_FRIEND });
        log(d, state.round, from, to, `pledged ${amount}/turn subsidy`);
      }
      break;
    case "gift":
      if (amount && amount > 0) {
        const moved = transferMoney(state, from, to, amount);
        log(d, state.round, from, to, `gave ${moved} coins`);
      }
      break;
  }
  return true;
}

function involves(c: DiploContract, a: Fraction, b: Fraction): boolean {
  return (c.a === a && c.b === b) || (c.a === b && c.b === a);
}

// --- per-round processing ----------------------------------------------------

/**
 * Advance diplomacy by one round (called when the round counter ticks): pay
 * subsidies (capped by income + funds), expire contracts, decrement war
 * cooldowns. Runs before the new round's turns.
 */
export function processDiplomacyRound(state: GameState) {
  const d = dip(state);
  if (!d) return;

  // Pay subsidies first, capped by the payer's income and available funds.
  for (const c of d.contracts) {
    if (c.type !== "subsidy" || !c.subsidy) continue;
    if (!state.alive[c.a] || !state.alive[c.b]) continue;
    const cap = Math.min(c.subsidy, fractionIncome(state, c.a), fullMoney(state, c.a));
    if (cap > 0) transferMoney(state, c.a, c.b, cap);
  }

  // Expire contracts; lapsed friendships/peace return the pair to neutral.
  const kept: DiploContract[] = [];
  for (const c of d.contracts) {
    if (state.round < c.expires) {
      kept.push(c);
      continue;
    }
    if (c.type === "friendship" && getRelation(state, c.a, c.b) === "friend") {
      setRelation(d, c.a, c.b, "neutral");
      log(d, state.round, c.a, c.b, "friendship expired");
    }
    if (c.type === "blackMark") {
      d.blackMarks = d.blackMarks.filter((f) => f !== c.b);
    }
  }
  d.contracts = kept;

  // Cool down war-stop timers.
  for (let a = 0; a < d.stopWarCooldown.length; a++) {
    for (let b = 0; b < d.stopWarCooldown.length; b++) {
      if (d.stopWarCooldown[a][b] > 0) d.stopWarCooldown[a][b]--;
    }
  }
}

/** Remove an eliminated fraction from all relations, contracts and proposals. */
export function onFractionEliminated(state: GameState, fraction: Fraction) {
  const d = dip(state);
  if (!d) return;
  for (let other = 0; other < d.relations.length; other++) {
    setRelation(d, fraction, other, "neutral");
    d.stopWarCooldown[fraction][other] = 0;
    d.stopWarCooldown[other][fraction] = 0;
  }
  d.contracts = d.contracts.filter((c) => c.a !== fraction && c.b !== fraction);
  d.proposals = d.proposals.filter((p) => p.from !== fraction && p.to !== fraction);
  d.blackMarks = d.blackMarks.filter((f) => f !== fraction);
}

/**
 * Diplomatic victory: when every surviving fraction is a mutual friend (a
 * single peace bloc owns the map), they win together. Returns the bloc's
 * lowest fraction, or null if no such bloc / only one survivor.
 */
export function diplomaticVictor(state: GameState): Fraction | null {
  const d = dip(state);
  if (!d) return null;
  const survivors: Fraction[] = [];
  for (let p = 0; p < state.config.playerCount; p++) if (state.alive[p]) survivors.push(p);
  if (survivors.length < 2) return null;
  for (let i = 0; i < survivors.length; i++) {
    for (let j = i + 1; j < survivors.length; j++) {
      if (getRelation(state, survivors[i], survivors[j]) !== "friend") return null;
    }
  }
  return survivors[0];
}
