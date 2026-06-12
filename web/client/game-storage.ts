// IndexedDB persistence for game saves and finished-game replays.
// Records are versioned; bump RECORD_VERSION and extend the validators when
// shapes change. localStorage is reserved for small settings — game states
// and action histories live here.

import type { GameConfig, GameState, ReplayStep } from "./game/types";

const DB_NAME = "antiyoy";
const DB_VERSION = 1;
export const RECORD_VERSION = 1;

export const AUTOSAVE_ID = "autosave";
const REPLAY_LIMIT = 20;

export interface SaveRecord {
  version: typeof RECORD_VERSION;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: GameConfig;
  state: GameState;
  /** Snapshot at game start plus recorded steps, so replays survive save/load. */
  replayInitial: GameState;
  replaySteps: ReplayStep[];
}

export interface ReplayRecord {
  version: typeof RECORD_VERSION;
  id: string;
  name: string;
  createdAt: number;
  config: GameConfig;
  initial: GameState;
  steps: ReplayStep[];
  winner: number | null;
  rounds: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves", { keyPath: "id" });
        if (!db.objectStoreNames.contains("replays")) db.createObjectStore("replays", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

type StoreName = "saves" | "replays";

async function tx<T>(store: StoreName, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = run(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function newRecordId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function looksLikeGameState(state: unknown): state is GameState {
  return (
    typeof state === "object" &&
    state !== null &&
    Array.isArray((state as GameState).hexes) &&
    Array.isArray((state as GameState).provinces) &&
    typeof (state as GameState).turn === "number"
  );
}

export function validateSaveRecord(raw: unknown): SaveRecord | null {
  const r = raw as Partial<SaveRecord>;
  if (!r || r.version !== RECORD_VERSION || typeof r.id !== "string") return null;
  if (!looksLikeGameState(r.state) || !looksLikeGameState(r.replayInitial)) return null;
  if (!Array.isArray(r.replaySteps) || typeof r.name !== "string") return null;
  return r as SaveRecord;
}

export function validateReplayRecord(raw: unknown): ReplayRecord | null {
  const r = raw as Partial<ReplayRecord>;
  if (!r || r.version !== RECORD_VERSION || typeof r.id !== "string") return null;
  if (!looksLikeGameState(r.initial) || !Array.isArray(r.steps)) return null;
  if (typeof r.name !== "string") return null;
  return r as ReplayRecord;
}

// --- saves ---------------------------------------------------------------

export async function listSaves(): Promise<SaveRecord[]> {
  const all = await tx<SaveRecord[]>("saves", "readonly", (s) => s.getAll() as IDBRequest<SaveRecord[]>);
  return all.filter((r) => validateSaveRecord(r)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putSave(record: SaveRecord): Promise<void> {
  await tx("saves", "readwrite", (s) => s.put(record));
}

export async function deleteSave(id: string): Promise<void> {
  await tx("saves", "readwrite", (s) => s.delete(id));
}

export async function latestSave(): Promise<SaveRecord | null> {
  const all = await listSaves();
  return all[0] ?? null;
}

// --- replays --------------------------------------------------------------

export async function listReplays(): Promise<ReplayRecord[]> {
  const all = await tx<ReplayRecord[]>("replays", "readonly", (s) => s.getAll() as IDBRequest<ReplayRecord[]>);
  return all.filter((r) => validateReplayRecord(r)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function putReplay(record: ReplayRecord): Promise<void> {
  await tx("replays", "readwrite", (s) => s.put(record));
  // Keep the library bounded; drop the oldest entries beyond the limit.
  const all = await listReplays();
  for (const old of all.slice(REPLAY_LIMIT)) {
    await deleteReplay(old.id);
  }
}

export async function deleteReplay(id: string): Promise<void> {
  await tx("replays", "readwrite", (s) => s.delete(id));
}

// --- JSON import/export -----------------------------------------------------

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file
        .text()
        .then((text) => resolve(JSON.parse(text)))
        .catch(() => resolve(null));
    };
    input.click();
  });
}
