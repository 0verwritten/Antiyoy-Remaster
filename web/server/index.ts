import { boolean, capsule, endpoint, json, mutation, query, string, table, text, type ServerContext } from "lakebed/server";
import type {
  OnlineChatMessage,
  OnlineLobby,
  OnlineLobbyConfig,
  OnlineLobbySummary,
  OnlinePlayer,
  OnlineSnapshot,
} from "../shared/online";
import {
  TRAINING_CHUNK_SIZE,
  TRAINING_RECORD_VERSION,
  type TrainingBattleExport,
  type TrainingBattleMetadata,
} from "../shared/training";
import {
  GAME_SYNC_CHUNK_SIZE,
  GAME_SYNC_RECORD_VERSION,
  type GameSyncRecord,
} from "../shared/sync";
import type { GameState, ReplayStep } from "../client/game/types";

type Row = Record<string, unknown> & { id: string; createdAt: string; updatedAt: string };
type StateHeader = {
  config?: { humanCount?: number };
  round?: number;
  turn?: number;
  version?: number;
  winner?: number | null;
  endReason?: "draw" | "resignation";
  resigned?: number[];
};

type BattleRow = Row & {
  uploaderId: string;
  source: string;
  configJson: string;
  winner: string;
  outcome: string;
  rounds: string;
  humanCount: string;
  initialChunkCount: string;
  stepChunkCount: string;
  complete: boolean;
};

type BattleChunkRow = Row & { battleId: string; kind: string; sequence: string; content: string };
type GameSyncRow = Row & {
  userId: string;
  kind: string;
  clientId: string;
  name: string;
  createdMs: string;
  updatedMs: string;
  deletedMs: string;
  chunkCount: string;
};
type GameSyncChunkRow = Row & { recordId: string; sequence: string; content: string };

const APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#f0eee3"/>
  <polygon points="256,48 432,144 432,368 256,464 80,368 80,144" fill="#60b55c" stroke="#3a3a33" stroke-width="32"/>
  <path d="M184 324V188h144v136h-40v-48h-64v48z" fill="#f0eee3" stroke="#3a3a33" stroke-width="20" stroke-linejoin="round"/>
</svg>`;

const SERVICE_WORKER = `const CACHE = "antiyoy-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("antiyoy-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});`;

function requireAccount(ctx: { auth: { isGuest: boolean } }) {
  if (ctx.auth.isGuest) throw new Error("Sign in with Google to play online");
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function lobbyFromRow(row: Row): OnlineLobby {
  return {
    id: row.id,
    ownerId: String(row.ownerId),
    ownerName: String(row.ownerName),
    status: String(row.status) as OnlineLobby["status"],
    config: parseJson<OnlineLobbyConfig>(row.configJson, {} as OnlineLobbyConfig),
    players: parseJson<OnlinePlayer[]>(row.playersJson, []),
    stateJson: String(row.stateJson0 ?? "") + String(row.stateJson1 ?? "") + String(row.stateJson2 ?? ""),
    stateVersion: Number(row.stateVersion ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function memberLobby(rows: Row[], userId: string): OnlineLobby | null {
  for (const row of rows) {
    const lobby = lobbyFromRow(row);
    if (lobby.players.some((player) => player.userId === userId)) return lobby;
  }
  return null;
}

function cleanConfig(config: OnlineLobbyConfig): OnlineLobbyConfig {
  const mode = config.mode === "mixed" ? "mixed" : "players";
  const mapSize = ["small", "medium", "large", "huge"].includes(config.mapSize) ? config.mapSize : "medium";
  const playerLimit = mapSize === "small" ? 5 : 6;
  const humanLimit = mode === "mixed" ? playerLimit - 1 : playerLimit;
  const humanSlots = Math.max(2, Math.min(humanLimit, Math.round(config.humanSlots || 2)));
  const maxBots = playerLimit - humanSlots;
  return {
    mode,
    humanSlots,
    botCount: mode === "mixed" ? Math.max(1, Math.min(maxBots, Math.round(config.botCount || 1))) : 0,
    mapSize,
    difficulty: ["easy", "normal", "hard"].includes(config.difficulty) ? config.difficulty : "normal",
    gameMode: config.gameMode === "slay" ? "slay" : "antiyoy",
    fogOfWar: Boolean(config.fogOfWar),
    seed: Math.abs(Math.floor(Number(config.seed))) % 2 ** 31,
  };
}

function validTrainingMetadata(value: TrainingBattleMetadata): boolean {
  const outcomes: TrainingBattleMetadata["outcome"][] = ["victory", "draw", "resignation", "campaign-won", "campaign-lost"];
  return value.version === TRAINING_RECORD_VERSION &&
    (value.source === "local" || value.source === "online") &&
    typeof value.config === "object" && value.config !== null &&
    value.config.humanCount === value.humanCount &&
    outcomes.includes(value.outcome) &&
    (value.winner === null || (Number.isInteger(value.winner) && value.winner >= 0 && value.winner < value.config.playerCount)) &&
    Number.isInteger(value.humanCount) && value.humanCount > 0 && value.humanCount <= 6 &&
    Number.isInteger(value.rounds) && value.rounds >= 0 &&
    Number.isInteger(value.initialChunkCount) && value.initialChunkCount > 0 && value.initialChunkCount <= 20 &&
    Number.isInteger(value.stepChunkCount) && value.stepChunkCount >= 0 && value.stepChunkCount <= 1000;
}

function insertBattle(ctx: ServerContext, uploaderId: string, metadata: TrainingBattleMetadata): string {
  if (!validTrainingMetadata(metadata)) throw new Error("Invalid battle metadata");
  return ctx.db.trainingBattles.insert({
    uploaderId,
    source: metadata.source,
    configJson: JSON.stringify(metadata.config),
    winner: metadata.winner == null ? "" : String(metadata.winner),
    outcome: metadata.outcome,
    rounds: String(metadata.rounds),
    humanCount: String(metadata.humanCount),
    initialChunkCount: String(metadata.initialChunkCount),
    stepChunkCount: String(metadata.stepChunkCount),
    complete: false,
  }).id;
}

function insertBattleChunk(ctx: ServerContext, battleId: string, kind: "initial" | "steps", sequence: number, content: string) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence >= 1000) throw new Error("Invalid chunk sequence");
  if (typeof content !== "string" || content.length > TRAINING_CHUNK_SIZE) throw new Error("Battle chunk is too large");
  ctx.db.trainingBattleChunks.insert({ battleId, kind, sequence: String(sequence), content });
}

function chunksFor(ctx: ServerContext, battleId: string, kind: "initial" | "steps"): BattleChunkRow[] {
  return (ctx.db.trainingBattleChunks.where("battleId", battleId).where("kind", kind).limit(1000).all() as BattleChunkRow[])
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
}

function validateCompletedBattle(ctx: ServerContext, battle: BattleRow): { initial: GameState; steps: ReplayStep[] } {
  const initialChunks = chunksFor(ctx, battle.id, "initial");
  const stepChunks = chunksFor(ctx, battle.id, "steps");
  if (initialChunks.length !== Number(battle.initialChunkCount) || stepChunks.length !== Number(battle.stepChunkCount)) {
    throw new Error("Battle upload is incomplete");
  }
  const initial = parseJson<GameState | null>(initialChunks.map((chunk) => chunk.content).join(""), null);
  if (!initial || !Array.isArray(initial.hexes) || !Array.isArray(initial.provinces) || initial.config?.humanCount < 1 ||
      initial.config.humanCount !== Number(battle.humanCount)) {
    throw new Error("Invalid initial game state");
  }
  const steps: ReplayStep[] = [];
  for (const chunk of stepChunks) {
    const batch = parseJson<ReplayStep[]>(chunk.content, []);
    if (!Array.isArray(batch)) throw new Error("Invalid battle steps");
    for (const step of batch) {
      if (!step || typeof step.actor !== "number" || !step.action || typeof step.action.type !== "string") {
        throw new Error("Invalid battle step");
      }
      steps.push(step);
    }
  }
  return { initial, steps };
}

function finishOnlineBattle(ctx: ServerContext, battleId: string, state: StateHeader) {
  const row = ctx.db.trainingBattles.get(battleId) as BattleRow | null;
  if (!row) return;
  ctx.db.trainingBattles.update(battleId, {
    winner: state.winner == null ? "" : String(state.winner),
    outcome: state.endReason === "draw" ? "draw" : state.endReason === "resignation" ? "resignation" : "victory",
    rounds: String(state.round ?? 0),
    uploaderId: "",
    complete: true,
  });
}

function validSyncRecord(record: GameSyncRecord): boolean {
  return record.version === GAME_SYNC_RECORD_VERSION &&
    (record.kind === "save" || record.kind === "replay") &&
    typeof record.id === "string" && record.id.length > 0 && record.id.length <= 120 &&
    typeof record.name === "string" && record.name.length <= 200 &&
    Number.isFinite(record.createdAt) && record.createdAt >= 0 &&
    Number.isFinite(record.updatedAt) && record.updatedAt >= 0 &&
    (record.deletedAt === null || (Number.isFinite(record.deletedAt) && record.deletedAt >= 0)) &&
    Array.isArray(record.chunks) && record.chunks.length <= 1000 &&
    record.chunks.every((chunk) => typeof chunk === "string" && chunk.length <= GAME_SYNC_CHUNK_SIZE);
}

function gameSyncChunksFor(ctx: ServerContext, recordId: string): GameSyncChunkRow[] {
  return (ctx.db.gameSyncChunks.where("recordId", recordId).limit(1000).all() as GameSyncChunkRow[])
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
}

function listGameSyncRecords(ctx: ServerContext, userId: string): GameSyncRecord[] {
  const rows = ctx.db.gameSyncRecords.where("userId", userId).limit(1000).all() as GameSyncRow[];
  return rows
    .sort((a, b) => Number(b.updatedMs) - Number(a.updatedMs))
    .map((row): GameSyncRecord => ({
      version: GAME_SYNC_RECORD_VERSION,
      kind: row.kind === "save" ? "save" : "replay",
      id: row.clientId,
      name: row.name,
      createdAt: Number(row.createdMs),
      updatedAt: Number(row.updatedMs),
      deletedAt: row.deletedMs ? Number(row.deletedMs) : null,
      chunks: gameSyncChunksFor(ctx, row.id).map((chunk) => chunk.content),
    }));
}

function findGameSyncRow(ctx: ServerContext, userId: string, kind: string, clientId: string): GameSyncRow | null {
  const rows = ctx.db.gameSyncRecords
    .where("userId", userId)
    .where("kind", kind)
    .where("clientId", clientId)
    .limit(1)
    .all() as GameSyncRow[];
  return rows[0] ?? null;
}

function replaceGameSyncChunks(ctx: ServerContext, recordId: string, chunks: string[]) {
  for (const chunk of gameSyncChunksFor(ctx, recordId)) ctx.db.gameSyncChunks.delete(chunk.id);
  chunks.forEach((content, sequence) => {
    ctx.db.gameSyncChunks.insert({ recordId, sequence: String(sequence), content });
  });
}

function upsertGameSyncRecord(ctx: ServerContext, userId: string, record: GameSyncRecord): boolean {
  if (!validSyncRecord(record)) throw new Error("Invalid sync record");
  const existing = findGameSyncRow(ctx, userId, record.kind, record.id);
  if (existing && Number(existing.updatedMs) >= record.updatedAt) return false;
  const values = {
    userId,
    kind: record.kind,
    clientId: record.id,
    name: record.name,
    createdMs: String(record.createdAt),
    updatedMs: String(record.updatedAt),
    deletedMs: record.deletedAt == null ? "" : String(record.deletedAt),
    chunkCount: String(record.chunks.length),
  };
  const rowId = existing ? existing.id : ctx.db.gameSyncRecords.insert(values).id;
  if (existing) ctx.db.gameSyncRecords.update(existing.id, values);
  replaceGameSyncChunks(ctx, rowId, record.chunks);
  return true;
}

export default capsule({
  name: "antiyoy-remaster",

  schema: {
    lobbies: table({
      ownerId: string(),
      ownerName: string(),
      status: string(),
      configJson: string(),
      playersJson: string(),
      stateJson0: string().default(""),
      stateJson1: string().default(""),
      stateJson2: string().default(""),
      stateVersion: string().default("0"),
      closed: boolean().default(false),
      trainingBattleId: string().default(""),
    }),
    chatMessages: table({
      lobbyId: string(),
      authorId: string(),
      authorName: string(),
      body: string(),
    }),
    trainingBattles: table({
      uploaderId: string(),
      source: string(),
      configJson: string(),
      winner: string().default(""),
      outcome: string().default(""),
      rounds: string().default("0"),
      humanCount: string(),
      initialChunkCount: string(),
      stepChunkCount: string().default("0"),
      complete: boolean().default(false),
    }),
    trainingBattleChunks: table({
      battleId: string(),
      kind: string(),
      sequence: string(),
      content: string(),
    }),
    gameSyncRecords: table({
      userId: string(),
      kind: string(),
      clientId: string(),
      name: string(),
      createdMs: string(),
      updatedMs: string(),
      deletedMs: string().default(""),
      chunkCount: string().default("0"),
    }),
    gameSyncChunks: table({
      recordId: string(),
      sequence: string(),
      content: string(),
    }),
  },

  queries: {
    online: query((ctx): OnlineSnapshot => {
      if (ctx.auth.isGuest) return { lobbies: [], lobby: null, messages: [] };
      const rows = ctx.db.lobbies.orderBy("createdAt", "desc").limit(100).all() as Row[];
      const lobby = memberLobby(rows, ctx.auth.userId);
      const lobbies: OnlineLobbySummary[] = [];
      for (const row of rows) {
        const item = lobbyFromRow(row);
        if (item.status !== "waiting") continue;
        lobbies.push({
          id: item.id,
          ownerName: item.ownerName,
          mode: item.config.mode,
          joined: item.players.length,
          humanSlots: item.config.humanSlots,
          botCount: item.config.botCount,
          mapSize: item.config.mapSize,
          createdAt: item.createdAt,
        });
      }
      const messages = lobby
        ? (ctx.db.chatMessages.where("lobbyId", lobby.id).orderBy("createdAt", "asc").limit(100).all() as Row[]).map(
            (row): OnlineChatMessage => ({
              id: row.id,
              lobbyId: String(row.lobbyId),
              authorId: String(row.authorId),
              authorName: String(row.authorName),
              body: String(row.body),
              createdAt: row.createdAt,
            })
          )
        : [];
      return { lobbies, lobby, messages };
    }),

    gameSyncLibrary: query((ctx): GameSyncRecord[] => {
      if (ctx.auth.isGuest) return [];
      return listGameSyncRecords(ctx, ctx.auth.userId);
    }),
  },

  mutations: {
    createLobby: mutation((ctx, requested: OnlineLobbyConfig) => {
      requireAccount(ctx);
      const existing = memberLobby(ctx.db.lobbies.limit(100).all() as Row[], ctx.auth.userId);
      if (existing) throw new Error("Leave your current lobby first");
      const config = cleanConfig(requested);
      const player: OnlinePlayer = {
        userId: ctx.auth.userId,
        name: ctx.auth.displayName,
        picture: ctx.auth.picture,
        seat: 0,
      };
      return ctx.db.lobbies.insert({
        ownerId: ctx.auth.userId,
        ownerName: ctx.auth.displayName,
        status: "waiting",
        configJson: JSON.stringify(config),
        playersJson: JSON.stringify([player]),
        stateJson0: "",
        stateJson1: "",
        stateJson2: "",
        stateVersion: "0",
        closed: false,
      }).id;
    }),

    joinLobby: mutation((ctx, lobbyId: string) => {
      requireAccount(ctx);
      const existing = memberLobby(ctx.db.lobbies.limit(100).all() as Row[], ctx.auth.userId);
      if (existing) throw new Error("Leave your current lobby first");
      const row = ctx.db.lobbies.get(lobbyId) as Row | null;
      if (!row) throw new Error("Lobby not found");
      const lobby = lobbyFromRow(row);
      if (lobby.status !== "waiting") throw new Error("Game already started");
      if (lobby.players.length >= lobby.config.humanSlots) throw new Error("Lobby is full");
      lobby.players.push({
        userId: ctx.auth.userId,
        name: ctx.auth.displayName,
        picture: ctx.auth.picture,
        seat: lobby.players.length,
      });
      ctx.db.lobbies.update(lobbyId, { playersJson: JSON.stringify(lobby.players) });
    }),

    leaveLobby: mutation((ctx) => {
      requireAccount(ctx);
      const rows = ctx.db.lobbies.limit(100).all() as Row[];
      const lobby = memberLobby(rows, ctx.auth.userId);
      if (!lobby) return;
      const row = ctx.db.lobbies.get(lobby.id) as Row | null;
      if (!row) return;
      if (lobby.ownerId === ctx.auth.userId) {
        ctx.db.lobbies.delete(lobby.id);
        return;
      }
      if (lobby.status === "playing") throw new Error("A running game cannot be left");
      const players = lobby.players
        .filter((player) => player.userId !== ctx.auth.userId)
        .map((player, seat) => ({ ...player, seat }));
      ctx.db.lobbies.update(lobby.id, { playersJson: JSON.stringify(players) });
    }),

    startLobby: mutation((ctx, lobbyId: string, stateJson0: string, stateJson1: string, stateJson2: string) => {
      requireAccount(ctx);
      const row = ctx.db.lobbies.get(lobbyId) as Row | null;
      if (!row) throw new Error("Lobby not found");
      const lobby = lobbyFromRow(row);
      if (lobby.ownerId !== ctx.auth.userId) throw new Error("Only the host can start");
      if (lobby.status !== "waiting") throw new Error("Game already started");
      if (lobby.players.length < lobby.config.humanSlots) throw new Error("Waiting for more players");
      const initialJson = stateJson0 + stateJson1 + stateJson2;
      const initial = parseJson<GameState | null>(initialJson, null);
      if (!initial || initial.config?.humanCount < 1) throw new Error("Invalid initial game state");
      const battleId = insertBattle(ctx, ctx.auth.userId, {
        version: TRAINING_RECORD_VERSION,
        source: "online",
        config: initial.config,
        winner: null,
        outcome: "victory",
        rounds: 0,
        humanCount: initial.config.humanCount,
        initialChunkCount: 3,
        stepChunkCount: 0,
      });
      insertBattleChunk(ctx, battleId, "initial", 0, stateJson0);
      insertBattleChunk(ctx, battleId, "initial", 1, stateJson1);
      insertBattleChunk(ctx, battleId, "initial", 2, stateJson2);
      ctx.db.lobbies.update(lobby.id, {
        status: "playing", stateJson0, stateJson1, stateJson2, stateVersion: "0", trainingBattleId: battleId,
      });
    }),

    publishOnlineState: mutation(
      (ctx, lobbyId: string, actor: number, previousVersion: number, stepJson: string, stateJson0: string, stateJson1: string, stateJson2: string) => {
        requireAccount(ctx);
        const row = ctx.db.lobbies.get(lobbyId) as Row | null;
        if (!row) throw new Error("Lobby not found");
        const lobby = lobbyFromRow(row);
        if (lobby.status !== "playing") throw new Error("Game is not running");
        const player = lobby.players.find((item) => item.seat === actor);
        const botActor = actor >= lobby.config.humanSlots && lobby.ownerId === ctx.auth.userId;
        if ((!player || player.userId !== ctx.auth.userId) && !botActor) throw new Error("Not your turn");
        if (lobby.stateVersion !== previousVersion) throw new Error("State is out of date");
        const previous = parseJson<StateHeader>(lobby.stateJson, {});
        const nextJson = stateJson0 + stateJson1 + stateJson2;
        const next = parseJson<StateHeader>(nextJson, {});
        if (previous.turn !== actor) throw new Error("Not your turn");
        if (typeof previous.version !== "number" || next.version !== previous.version + 1) {
          throw new Error("Invalid state version");
        }
        if (next.endReason !== previous.endReason || JSON.stringify(next.resigned ?? []) !== JSON.stringify(previous.resigned ?? [])) {
          throw new Error("Use the game exit action");
        }
        const steps = parseJson<ReplayStep[]>(stepJson, []);
        if (steps.length !== 1 || steps[0].actor !== actor) throw new Error("Invalid replay step");
        const battleId = String(row.trainingBattleId ?? "");
        if (battleId) {
          insertBattleChunk(ctx, battleId, "steps", previousVersion, stepJson);
          ctx.db.trainingBattles.update(battleId, { stepChunkCount: String(previousVersion + 1) });
        }
        ctx.db.lobbies.update(lobby.id, {
          stateJson0,
          stateJson1,
          stateJson2,
          stateVersion: String(previousVersion + 1),
          status: next.winner == null && next.endReason !== "draw" ? "playing" : "finished",
        });
        if (battleId && (next.winner != null || next.endReason === "draw")) finishOnlineBattle(ctx, battleId, next);
      }
    ),

    publishOnlineExit: mutation(
      (ctx, lobbyId: string, kind: "draw" | "resign", previousVersion: number, stepJson: string, stateJson0: string, stateJson1: string, stateJson2: string) => {
        requireAccount(ctx);
        const row = ctx.db.lobbies.get(lobbyId) as Row | null;
        if (!row) throw new Error("Lobby not found");
        const lobby = lobbyFromRow(row);
        if (lobby.status !== "playing") throw new Error("Game is not running");
        const player = lobby.players.find((item) => item.userId === ctx.auth.userId);
        if (!player) throw new Error("Not a player in this game");
        if (lobby.stateVersion !== previousVersion) throw new Error("State is out of date");
        const previous = parseJson<StateHeader>(lobby.stateJson, {});
        const nextJson = stateJson0 + stateJson1 + stateJson2;
        const next = parseJson<StateHeader>(nextJson, {});
        if (typeof previous.version !== "number" || next.version !== previous.version + 1) {
          throw new Error("Invalid state version");
        }
        if (kind === "draw") {
          if (next.endReason !== "draw" || next.winner != null) throw new Error("Invalid draw state");
        } else {
          const before = previous.resigned ?? [];
          const after = next.resigned ?? [];
          if (before.includes(player.seat) || !after.includes(player.seat) || after.length !== before.length + 1) {
            throw new Error("You can only resign yourself");
          }
        }
        const finished = next.winner != null || next.endReason === "draw";
        const steps = parseJson<ReplayStep[]>(stepJson, []);
        if (steps.length !== 1 || steps[0].actor !== player.seat) throw new Error("Invalid replay step");
        const battleId = String(row.trainingBattleId ?? "");
        if (battleId) {
          insertBattleChunk(ctx, battleId, "steps", previousVersion, stepJson);
          ctx.db.trainingBattles.update(battleId, { stepChunkCount: String(previousVersion + 1) });
        }
        ctx.db.lobbies.update(lobby.id, {
          stateJson0,
          stateJson1,
          stateJson2,
          stateVersion: String(previousVersion + 1),
          status: finished ? "finished" : "playing",
        });
        if (battleId && finished) finishOnlineBattle(ctx, battleId, next);
      }
    ),

    createTrainingBattle: mutation((ctx, metadata: TrainingBattleMetadata) => {
      if (metadata.source !== "local") throw new Error("Invalid battle source");
      return insertBattle(ctx, ctx.auth.userId, metadata);
    }),

    appendTrainingChunk: mutation((ctx, battleId: string, kind: "initial" | "steps", sequence: number, content: string) => {
      const battle = ctx.db.trainingBattles.get(battleId) as BattleRow | null;
      if (!battle || battle.uploaderId !== ctx.auth.userId || battle.complete) throw new Error("Battle upload not found");
      if (kind !== "initial" && kind !== "steps") throw new Error("Invalid chunk kind");
      const duplicate = (ctx.db.trainingBattleChunks.where("battleId", battleId).limit(1000).all() as BattleChunkRow[])
        .some((chunk) => chunk.kind === kind && Number(chunk.sequence) === sequence);
      if (duplicate) throw new Error("Battle chunk already uploaded");
      insertBattleChunk(ctx, battleId, kind, sequence, content);
    }),

    finishTrainingBattle: mutation((ctx, battleId: string) => {
      const battle = ctx.db.trainingBattles.get(battleId) as BattleRow | null;
      if (!battle || battle.uploaderId !== ctx.auth.userId || battle.complete) throw new Error("Battle upload not found");
      validateCompletedBattle(ctx, battle);
      ctx.db.trainingBattles.update(battleId, { uploaderId: "", complete: true });
    }),

    sendChat: mutation((ctx, body: string) => {
      requireAccount(ctx);
      const clean = body.trim().replace(/\s+/g, " ").slice(0, 300);
      if (!clean) return;
      const lobby = memberLobby(ctx.db.lobbies.limit(100).all() as Row[], ctx.auth.userId);
      if (!lobby) throw new Error("Join a lobby first");
      ctx.db.chatMessages.insert({
        lobbyId: lobby.id,
        authorId: ctx.auth.userId,
        authorName: ctx.auth.displayName,
        body: clean,
      });
    }),

    syncGameLibrary: mutation((ctx, records: GameSyncRecord[]) => {
      requireAccount(ctx);
      if (!Array.isArray(records) || records.length > 1000) throw new Error("Too many sync records");
      for (const record of records) upsertGameSyncRecord(ctx, ctx.auth.userId, record);
      return listGameSyncRecords(ctx, ctx.auth.userId);
    }),
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("ok")),
    trainingBattles: endpoint({ method: "GET", path: "/api/training-battles.json" }, (ctx, req) => {
      const exportKey = ctx.env.TRAINING_EXPORT_KEY;
      const suppliedKey = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.query.get("key");
      if (!exportKey || suppliedKey !== exportKey) return json({ error: "Unauthorized" }, { status: 401 });
      const requestedLimit = Number(req.query.get("limit") ?? 10);
      const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10));
      const rows = ctx.db.trainingBattles.where("complete", true).orderBy("createdAt", "desc").limit(limit).all() as BattleRow[];
      const battles: TrainingBattleExport[] = [];
      for (const row of rows) {
        const data = validateCompletedBattle(ctx, row);
        battles.push({
          version: TRAINING_RECORD_VERSION,
          id: row.id,
          createdAt: row.createdAt,
          source: row.source === "online" ? "online" : "local",
          config: parseJson(row.configJson, data.initial.config),
          winner: row.winner === "" ? null : Number(row.winner),
          outcome: row.outcome as TrainingBattleMetadata["outcome"],
          rounds: Number(row.rounds),
          humanCount: Number(row.humanCount),
          initialChunkCount: Number(row.initialChunkCount),
          stepChunkCount: Number(row.stepChunkCount),
          initial: data.initial,
          steps: data.steps,
        });
      }
      return json({ version: TRAINING_RECORD_VERSION, battles }, {
        headers: { "Content-Disposition": "attachment; filename=antiyoy-training-battles.json", "Cache-Control": "no-store" },
      });
    }),
    accountGames: endpoint({ method: "GET", path: "/api/account-games.json" }, (ctx) => {
      if (ctx.auth.isGuest) return json({ error: "Unauthorized" }, { status: 401 });
      return json(
        { version: GAME_SYNC_RECORD_VERSION, games: listGameSyncRecords(ctx, ctx.auth.userId) },
        {
          headers: {
            "Content-Disposition": "attachment; filename=antiyoy-account-games.json",
            "Cache-Control": "no-store",
          },
        }
      );
    }),
    manifest: endpoint({ method: "GET", path: "/api/manifest.webmanifest" }, () =>
      json(
        {
          id: "/",
          name: "Antiyoy Remaster",
          short_name: "Antiyoy",
          description: "A browser remaster of the turn-based strategy game Antiyoy.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "any",
          background_color: "#f0eee3",
          theme_color: "#3a3a33",
          icons: [
            {
              src: "/api/app-icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }
      )
    ),
    appIcon: endpoint({ method: "GET", path: "/api/app-icon.svg" }, () =>
      text(APP_ICON, {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
        },
      })
    ),
    serviceWorker: endpoint({ method: "GET", path: "/api/sw.js" }, () =>
      text(SERVICE_WORKER, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
          "Service-Worker-Allowed": "/",
        },
      })
    ),
  },
});
