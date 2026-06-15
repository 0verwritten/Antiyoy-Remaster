// Campaign MVP tests: level construction (fixed + generated), determinism,
// and the unlock/progress rules. Run from repo root:
//   npx tsx devtools/campaign-tests.ts

// Minimal localStorage shim so campaign-storage works under node.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

const { campaignLevels, createCampaignLevelGame, CAMPAIGN_LEVEL_COUNT, evaluateCampaign } =
  await import("../web/client/game/campaign");
const storage = await import("../web/client/campaign-storage");

let checks = 0;
function assert(cond: boolean, message: string) {
  checks++;
  if (!cond) throw new Error("FAIL: " + message);
}

// --- level list -------------------------------------------------------------
const levels = campaignLevels();
assert(levels.length === CAMPAIGN_LEVEL_COUNT, `campaign exposes ${CAMPAIGN_LEVEL_COUNT} levels`);
assert(levels[0].level === 1, "first level is 1");
assert(
  levels.some((l) => l.kind === "fixed") && levels.some((l) => l.kind === "generated"),
  "campaign mixes fixed and generated levels"
);

// --- every level builds with a valid start (generated fallback under node,
// since the hosted fixed-level data isn't fetched here) ----------------------
for (const info of levels) {
  const a = createCampaignLevelGame(info.level);
  assert(a.session?.campaignLevel === info.level, `level ${info.level}: session tags the level`);
  assert(a.turn === 0 && a.round === 0, `level ${info.level}: starts at turn 0`);
  assert(a.provinces.length >= 1, `level ${info.level}: has provinces`);
  assert(a.config.humanCount === 1, `level ${info.level}: single human`);
}
// Determinism on a sample (full build x2 of 155 maps would be slow).
for (const level of [1, 9, 24, 50, 100, 155]) {
  const a = JSON.stringify(createCampaignLevelGame(level));
  const b = JSON.stringify(createCampaignLevelGame(level));
  assert(a === b, `level ${level}: deterministic`);
}

// --- objective evaluation ----------------------------------------------------
function fakeState(opts: { alive: boolean[]; winner: number | null; objective?: unknown; victoryPending?: boolean }) {
  return {
    alive: opts.alive,
    winner: opts.winner,
    victoryPending: opts.victoryPending,
    session: { source: "campaign", objective: opts.objective ?? { type: "destroyEveryone" } },
  } as unknown as Parameters<typeof evaluateCampaign>[0];
}
assert(evaluateCampaign(fakeState({ alive: [true, true], winner: null })) === "ongoing", "destroyEveryone ongoing");
assert(evaluateCampaign(fakeState({ alive: [true, false], winner: 0 })) === "won", "destroyEveryone won");
assert(evaluateCampaign(fakeState({ alive: [false, true], winner: null })) === "lost", "human dead = lost");
assert(
  evaluateCampaign(fakeState({ alive: [true, true, true], winner: null, objective: { type: "destroyKingdom", target: 2 } })) === "ongoing",
  "destroyKingdom ongoing while target alive"
);
assert(
  evaluateCampaign(fakeState({ alive: [true, true, false], winner: null, objective: { type: "destroyKingdom", target: 2 } })) === "won",
  "destroyKingdom won when target dead"
);
assert(
  evaluateCampaign(fakeState({ alive: [true, true, false], winner: null, objective: { type: "destroyKingdom", target: 2 }, victoryPending: true })) === "ongoing",
  "destroyKingdom waits for end turn while victory is pending"
);
assert(
  evaluateCampaign(fakeState({ alive: [true, true], winner: 1, objective: { type: "ensureKingdomWins", target: 1 } })) === "won",
  "ensureKingdomWins won when target wins"
);
assert(
  evaluateCampaign(fakeState({ alive: [true, true], winner: 0, objective: { type: "ensureKingdomWins", target: 1 } })) === "lost",
  "ensureKingdomWins lost when someone else wins"
);

// --- unlock + progress rules (use a high level to prove the chain scales) ---
storage.resetCampaign();
assert(storage.isLevelUnlocked(1), "level 1 starts unlocked");
assert(!storage.isLevelUnlocked(2), "level 2 starts locked");
assert(storage.completedLevels().length === 0, "no levels completed initially");

storage.markLevelCompleted(1);
assert(storage.isLevelCompleted(1), "level 1 recorded completed");
assert(storage.isLevelUnlocked(2), "completing 1 unlocks 2");
assert(!storage.isLevelUnlocked(3), "level 3 still locked");

// Idempotent + survives a "reload" (campaign-storage reads localStorage fresh
// on every call, so a new read reflects persisted state).
storage.markLevelCompleted(1);
assert(storage.completedLevels().length === 1, "completing twice does not duplicate");
assert(storage.completedLevels().includes(1), "progress persists across reload");

// Antiyoy and Slay progress are independent.
assert(storage.completedLevels("slay").length === 0, "slay progress independent of antiyoy");

storage.resetCampaign();
assert(storage.completedLevels().length === 0, "reset clears progress");

console.log(`CAMPAIGN TESTS PASSED (${checks} assertions, ${levels.length} levels built)`);
