import { boolean, capsule, endpoint, mutation, query, string, table, text } from "lakebed/server";
import type {
  OnlineChatMessage,
  OnlineLobby,
  OnlineLobbyConfig,
  OnlineLobbySummary,
  OnlinePlayer,
  OnlineSnapshot,
} from "../shared/online";

type Row = Record<string, unknown> & { id: string; createdAt: string; updatedAt: string };
type StateHeader = { turn?: number; version?: number; winner?: number | null };

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
    }),
    chatMessages: table({
      lobbyId: string(),
      authorId: string(),
      authorName: string(),
      body: string(),
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
      ctx.db.lobbies.update(lobby.id, { status: "playing", stateJson0, stateJson1, stateJson2, stateVersion: "0" });
    }),

    publishOnlineState: mutation(
      (ctx, lobbyId: string, actor: number, previousVersion: number, stateJson0: string, stateJson1: string, stateJson2: string) => {
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
        ctx.db.lobbies.update(lobby.id, {
          stateJson0,
          stateJson1,
          stateJson2,
          stateVersion: String(previousVersion + 1),
          status: next.winner == null ? "playing" : "finished",
        });
      }
    ),

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
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("ok")),
  },
});
