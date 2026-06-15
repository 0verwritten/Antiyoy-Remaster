import { boolean, capsule, endpoint, json, mutation, query, string, table, text } from "lakebed/server";
import type {
  OnlineChatMessage,
  OnlineLobby,
  OnlineLobbyConfig,
  OnlineLobbySummary,
  OnlinePlayer,
  OnlineSnapshot,
} from "../shared/online";

type Row = Record<string, unknown> & { id: string; createdAt: string; updatedAt: string };
type StateHeader = {
  turn?: number;
  version?: number;
  winner?: number | null;
  endReason?: "draw" | "resignation";
  resigned?: number[];
};

const APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#f0eee3"/>
  <polygon points="256,48 432,144 432,368 256,464 80,368 80,144" fill="#60b55c" stroke="#3a3a33" stroke-width="32"/>
  <path d="M184 324V188h144v136h-40v-48h-64v48z" fill="#f0eee3" stroke="#3a3a33" stroke-width="20" stroke-linejoin="round"/>
</svg>`;

const SERVICE_WORKER = `const CACHE = "antiyoy-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
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
        if (next.endReason !== previous.endReason || JSON.stringify(next.resigned ?? []) !== JSON.stringify(previous.resigned ?? [])) {
          throw new Error("Use the game exit action");
        }
        ctx.db.lobbies.update(lobby.id, {
          stateJson0,
          stateJson1,
          stateJson2,
          stateVersion: String(previousVersion + 1),
          status: next.winner == null && next.endReason !== "draw" ? "playing" : "finished",
        });
      }
    ),

    publishOnlineExit: mutation(
      (ctx, lobbyId: string, kind: "draw" | "resign", previousVersion: number, stateJson0: string, stateJson1: string, stateJson2: string) => {
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
        ctx.db.lobbies.update(lobby.id, {
          stateJson0,
          stateJson1,
          stateJson2,
          stateVersion: String(previousVersion + 1),
          status: finished ? "finished" : "playing",
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
