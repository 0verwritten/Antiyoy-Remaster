export const GAME_SYNC_CHUNK_SIZE = 60_000;
export const GAME_SYNC_RECORD_VERSION = 1;

export type GameSyncKind = "save" | "replay";

export interface GameSyncRecord {
  version: typeof GAME_SYNC_RECORD_VERSION;
  kind: GameSyncKind;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  chunks: string[];
}

export interface GameSyncSummary {
  uploaded: number;
  downloaded: number;
  total: number;
}
