import {
  listAllGameRecords,
  mergeGameRecord,
  type GameLibraryKind,
  type GameLibraryRecord,
} from "./game-storage";
import {
  GAME_SYNC_CHUNK_SIZE,
  GAME_SYNC_RECORD_VERSION,
  type GameSyncRecord,
  type GameSyncSummary,
} from "../shared/sync";

function splitJson(record: GameLibraryRecord): string[] {
  const json = JSON.stringify(record);
  const chunks: string[] = [];
  for (let offset = 0; offset < json.length; offset += GAME_SYNC_CHUNK_SIZE) {
    chunks.push(json.slice(offset, offset + GAME_SYNC_CHUNK_SIZE));
  }
  return chunks.length ? chunks : [""];
}

function timestamp(record: GameLibraryRecord) {
  return Math.max(record.updatedAt ?? 0, record.createdAt ?? 0, record.deletedAt ?? 0);
}

function pack(kind: GameLibraryKind, record: GameLibraryRecord): GameSyncRecord | null {
  if (typeof record.id !== "string") return null;
  const createdAt = Number(record.createdAt ?? timestamp(record) ?? Date.now());
  const updatedAt = Number(record.updatedAt ?? createdAt);
  return {
    version: GAME_SYNC_RECORD_VERSION,
    kind,
    id: record.id,
    name: String(record.name ?? (kind === "save" ? "Saved game" : "Replay")),
    createdAt,
    updatedAt: Math.max(updatedAt, Number(record.deletedAt ?? 0)),
    deletedAt: typeof record.deletedAt === "number" ? record.deletedAt : null,
    chunks: splitJson(record),
  };
}

function unpack(remote: GameSyncRecord): { kind: GameLibraryKind; record: GameLibraryRecord } | null {
  if (remote.version !== GAME_SYNC_RECORD_VERSION) return null;
  if (remote.kind !== "save" && remote.kind !== "replay") return null;
  if (remote.deletedAt !== null) {
    if (remote.chunks.length > 0) {
      try {
        const record = JSON.parse(remote.chunks.join("")) as GameLibraryRecord;
        if (typeof record.id === "string" && record.id === remote.id) {
          return {
            kind: remote.kind,
            record: {
              ...record,
              name: record.name ?? remote.name,
              createdAt: record.createdAt ?? remote.createdAt,
              updatedAt: Math.max(record.updatedAt ?? 0, remote.updatedAt),
              deletedAt: remote.deletedAt,
            },
          };
        }
      } catch {
        // Fall back to a tombstone when only deletion metadata is usable.
      }
    }
    return {
      kind: remote.kind,
      record: {
        version: 1,
        id: remote.id,
        name: remote.name,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
        deletedAt: remote.deletedAt,
      },
    };
  }
  try {
    const record = JSON.parse(remote.chunks.join("")) as GameLibraryRecord;
    if (typeof record.id !== "string" || record.id !== remote.id) return null;
    return {
      kind: remote.kind,
      record: {
        ...record,
        name: record.name ?? remote.name,
        createdAt: record.createdAt ?? remote.createdAt,
        updatedAt: Math.max(record.updatedAt ?? 0, remote.updatedAt),
      },
    };
  } catch {
    return null;
  }
}

export async function collectSyncRecords(): Promise<GameSyncRecord[]> {
  const local = await listAllGameRecords();
  return local.map(({ kind, record }) => pack(kind, record)).filter((record): record is GameSyncRecord => !!record);
}

export async function applySyncRecords(records: GameSyncRecord[]): Promise<number> {
  let applied = 0;
  for (const remote of records) {
    const item = unpack(remote);
    if (!item) continue;
    if (await mergeGameRecord(item.kind, item.record)) applied++;
  }
  return applied;
}

export async function syncGameLibrary(
  upload: (records: GameSyncRecord[]) => Promise<GameSyncRecord[]>
): Promise<GameSyncSummary> {
  const local = await collectSyncRecords();
  const remote = await upload(local);
  const downloaded = await applySyncRecords(remote);
  return { uploaded: local.length, downloaded, total: remote.length };
}
