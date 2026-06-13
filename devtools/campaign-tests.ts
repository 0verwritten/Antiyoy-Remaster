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

const { campaignLevels, createCampaignLevelGame, CAMPAIGN_LEVEL_COUNT } = await import(
  "../web/client/game/campaign"
);
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

// --- every level builds, deterministically, with a valid start --------------
for (const info of levels) {
  const a = createCampaignLevelGame(info.level);
  assert(a.session?.campaignLevel === info.level, `level ${info.level}: session tags the level`);
  assert(a.turn === 0 && a.round === 0, `level ${info.level}: starts at turn 0`);
  assert(a.provinces.length >= 1, `level ${info.level}: has provinces`);
  assert(a.config.humanCount === 1, `level ${info.level}: single human`);
  const b = createCampaignLevelGame(info.level);
  assert(JSON.stringify(a) === JSON.stringify(b), `level ${info.level}: deterministic`);
}

// --- unlock + progress rules ------------------------------------------------
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
