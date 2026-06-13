// Campaign progress in localStorage. Antiyoy and Slay rules keep independent
// progress (only Antiyoy ships today). Completed levels are tracked
// explicitly rather than as a single highest-unlocked index, so the unlock
// rule can evolve without losing history.

export type CampaignRules = "antiyoy" | "slay";

export interface StoredCampaignProgress {
  version: 1;
  rules: CampaignRules;
  completed: number[];
}

const STORAGE_VERSION = 1;
const keyFor = (rules: CampaignRules) => `antiyoy.campaign.${rules}`;

function load(rules: CampaignRules): StoredCampaignProgress {
  const empty: StoredCampaignProgress = { version: STORAGE_VERSION, rules, completed: [] };
  try {
    const raw = localStorage.getItem(keyFor(rules));
    if (!raw) return empty;
    const data = JSON.parse(raw) as Partial<StoredCampaignProgress>;
    if (!Array.isArray(data.completed)) return empty;
    const completed = [...new Set(data.completed.filter((n) => Number.isInteger(n) && n > 0))];
    return { version: STORAGE_VERSION, rules, completed };
  } catch {
    return empty;
  }
}

function save(progress: StoredCampaignProgress) {
  try {
    localStorage.setItem(keyFor(progress.rules), JSON.stringify(progress));
  } catch {
    /* private browsing — progress just won't persist */
  }
}

export function completedLevels(rules: CampaignRules = "antiyoy"): number[] {
  return load(rules).completed;
}

export function isLevelCompleted(level: number, rules: CampaignRules = "antiyoy"): boolean {
  return load(rules).completed.includes(level);
}

/** Level 1 is always unlocked; level N>1 unlocks once N-1 is completed. */
export function isLevelUnlocked(level: number, rules: CampaignRules = "antiyoy"): boolean {
  if (level <= 1) return true;
  return load(rules).completed.includes(level - 1);
}

export function markLevelCompleted(level: number, rules: CampaignRules = "antiyoy") {
  const progress = load(rules);
  if (!progress.completed.includes(level)) {
    progress.completed.push(level);
    progress.completed.sort((a, b) => a - b);
    save(progress);
  }
}

export function resetCampaign(rules: CampaignRules = "antiyoy") {
  save({ version: STORAGE_VERSION, rules, completed: [] });
}
