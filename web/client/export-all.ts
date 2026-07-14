// One-file backup of everything the player owns: settings, campaign progress
// and skirmish setup from localStorage, saves and replays from IndexedDB
// (raw records, tombstones included, so a restore can merge cleanly), plus
// the account library when signed in.

import { listAllGameRecords, type GameLibraryRecord } from "./game-storage";

export const FULL_EXPORT_VERSION = 1;

export interface FullExport {
  type: "antiyoy-full-export";
  version: typeof FULL_EXPORT_VERSION;
  exportedAt: number;
  /** Raw values of every `antiyoy.*` localStorage key. */
  localStorage: Record<string, string>;
  saves: GameLibraryRecord[];
  replays: GameLibraryRecord[];
  /** /api/account-games.json payload; null when signed out or the fetch fails. */
  account: unknown | null;
}

export async function buildFullExport(includeAccount: boolean): Promise<FullExport> {
  const local: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("antiyoy.")) continue;
    const value = localStorage.getItem(key);
    if (value !== null) local[key] = value;
  }

  const records = await listAllGameRecords().catch(() => []);

  let account: unknown | null = null;
  if (includeAccount) {
    try {
      const response = await fetch("/api/account-games.json");
      if (response.ok) account = await response.json();
    } catch {
      // Local data still exports when the account fetch fails.
    }
  }

  return {
    type: "antiyoy-full-export",
    version: FULL_EXPORT_VERSION,
    exportedAt: Date.now(),
    localStorage: local,
    saves: records.filter((r) => r.kind === "save").map((r) => r.record),
    replays: records.filter((r) => r.kind === "replay").map((r) => r.record),
    account,
  };
}
