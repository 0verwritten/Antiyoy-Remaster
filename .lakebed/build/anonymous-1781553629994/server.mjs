// ../../../AppData/Local/npm-cache/_npx/3eb8d3eaaf4ef1b4/node_modules/lakebed/dist/server.js
function capsule(definition) {
  return definition;
}
function query(handler) {
  return handler;
}
function mutation(handler) {
  return handler;
}
function endpoint(route, handler) {
  return {
    handler,
    kind: "endpoint",
    method: String(route?.method ?? "").toUpperCase(),
    path: String(route?.path ?? "")
  };
}
function response(body, { headers = {}, status = 200 } = {}) {
  return {
    body,
    headers,
    kind: "response",
    status
  };
}
function json(value, options = {}) {
  return response(JSON.stringify(value ?? null), {
    ...options,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...options.headers ?? {}
    }
  });
}
function text(value, options = {}) {
  return response(String(value ?? ""), {
    ...options,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...options.headers ?? {}
    }
  });
}
function field(kind) {
  return {
    kind,
    defaultValue: void 0,
    default(value) {
      return {
        ...this,
        defaultValue: value
      };
    }
  };
}
function table(fields) {
  return {
    kind: "table",
    fields
  };
}
function string() {
  return field("string");
}
function boolean() {
  return field("boolean");
}

// lakebed-source:server/index.ts
var APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#f0eee3"/>
  <polygon points="256,48 432,144 432,368 256,464 80,368 80,144" fill="#60b55c" stroke="#3a3a33" stroke-width="32"/>
  <path d="M184 324V188h144v136h-40v-48h-64v48z" fill="#f0eee3" stroke="#3a3a33" stroke-width="20" stroke-linejoin="round"/>
</svg>`;
var SERVICE_WORKER = `const CACHE = "antiyoy-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("antiyoy-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});`;
function requireAccount(ctx) {
  if (ctx.auth.isGuest) throw new Error("Sign in with Google to play online");
}
function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
function lobbyFromRow(row) {
  return {
    id: row.id,
    ownerId: String(row.ownerId),
    ownerName: String(row.ownerName),
    status: String(row.status),
    config: parseJson(row.configJson, {}),
    players: parseJson(row.playersJson, []),
    stateJson: String(row.stateJson0 ?? "") + String(row.stateJson1 ?? "") + String(row.stateJson2 ?? ""),
    stateVersion: Number(row.stateVersion ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
function memberLobby(rows, userId) {
  for (const row of rows) {
    const lobby = lobbyFromRow(row);
    if (lobby.players.some((player) => player.userId === userId)) return lobby;
  }
  return null;
}
function cleanConfig(config) {
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
    seed: Math.abs(Math.floor(Number(config.seed))) % 2 ** 31
  };
}
var server_default = capsule({
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
      closed: boolean().default(false)
    }),
    chatMessages: table({
      lobbyId: string(),
      authorId: string(),
      authorName: string(),
      body: string()
    })
  },
  queries: {
    online: query((ctx) => {
      if (ctx.auth.isGuest) return { lobbies: [], lobby: null, messages: [] };
      const rows = ctx.db.lobbies.orderBy("createdAt", "desc").limit(100).all();
      const lobby = memberLobby(rows, ctx.auth.userId);
      const lobbies = [];
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
          createdAt: item.createdAt
        });
      }
      const messages = lobby ? ctx.db.chatMessages.where("lobbyId", lobby.id).orderBy("createdAt", "asc").limit(100).all().map(
        (row) => ({
          id: row.id,
          lobbyId: String(row.lobbyId),
          authorId: String(row.authorId),
          authorName: String(row.authorName),
          body: String(row.body),
          createdAt: row.createdAt
        })
      ) : [];
      return { lobbies, lobby, messages };
    })
  },
  mutations: {
    createLobby: mutation((ctx, requested) => {
      requireAccount(ctx);
      const existing = memberLobby(ctx.db.lobbies.limit(100).all(), ctx.auth.userId);
      if (existing) throw new Error("Leave your current lobby first");
      const config = cleanConfig(requested);
      const player = {
        userId: ctx.auth.userId,
        name: ctx.auth.displayName,
        picture: ctx.auth.picture,
        seat: 0
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
        closed: false
      }).id;
    }),
    joinLobby: mutation((ctx, lobbyId) => {
      requireAccount(ctx);
      const existing = memberLobby(ctx.db.lobbies.limit(100).all(), ctx.auth.userId);
      if (existing) throw new Error("Leave your current lobby first");
      const row = ctx.db.lobbies.get(lobbyId);
      if (!row) throw new Error("Lobby not found");
      const lobby = lobbyFromRow(row);
      if (lobby.status !== "waiting") throw new Error("Game already started");
      if (lobby.players.length >= lobby.config.humanSlots) throw new Error("Lobby is full");
      lobby.players.push({
        userId: ctx.auth.userId,
        name: ctx.auth.displayName,
        picture: ctx.auth.picture,
        seat: lobby.players.length
      });
      ctx.db.lobbies.update(lobbyId, { playersJson: JSON.stringify(lobby.players) });
    }),
    leaveLobby: mutation((ctx) => {
      requireAccount(ctx);
      const rows = ctx.db.lobbies.limit(100).all();
      const lobby = memberLobby(rows, ctx.auth.userId);
      if (!lobby) return;
      const row = ctx.db.lobbies.get(lobby.id);
      if (!row) return;
      if (lobby.ownerId === ctx.auth.userId) {
        ctx.db.lobbies.delete(lobby.id);
        return;
      }
      if (lobby.status === "playing") throw new Error("A running game cannot be left");
      const players = lobby.players.filter((player) => player.userId !== ctx.auth.userId).map((player, seat) => ({ ...player, seat }));
      ctx.db.lobbies.update(lobby.id, { playersJson: JSON.stringify(players) });
    }),
    startLobby: mutation((ctx, lobbyId, stateJson0, stateJson1, stateJson2) => {
      requireAccount(ctx);
      const row = ctx.db.lobbies.get(lobbyId);
      if (!row) throw new Error("Lobby not found");
      const lobby = lobbyFromRow(row);
      if (lobby.ownerId !== ctx.auth.userId) throw new Error("Only the host can start");
      if (lobby.status !== "waiting") throw new Error("Game already started");
      if (lobby.players.length < lobby.config.humanSlots) throw new Error("Waiting for more players");
      ctx.db.lobbies.update(lobby.id, { status: "playing", stateJson0, stateJson1, stateJson2, stateVersion: "0" });
    }),
    publishOnlineState: mutation(
      (ctx, lobbyId, actor, previousVersion, stateJson0, stateJson1, stateJson2) => {
        requireAccount(ctx);
        const row = ctx.db.lobbies.get(lobbyId);
        if (!row) throw new Error("Lobby not found");
        const lobby = lobbyFromRow(row);
        if (lobby.status !== "playing") throw new Error("Game is not running");
        const player = lobby.players.find((item) => item.seat === actor);
        const botActor = actor >= lobby.config.humanSlots && lobby.ownerId === ctx.auth.userId;
        if ((!player || player.userId !== ctx.auth.userId) && !botActor) throw new Error("Not your turn");
        if (lobby.stateVersion !== previousVersion) throw new Error("State is out of date");
        const previous = parseJson(lobby.stateJson, {});
        const nextJson = stateJson0 + stateJson1 + stateJson2;
        const next = parseJson(nextJson, {});
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
          status: next.winner == null && next.endReason !== "draw" ? "playing" : "finished"
        });
      }
    ),
    publishOnlineExit: mutation(
      (ctx, lobbyId, kind, previousVersion, stateJson0, stateJson1, stateJson2) => {
        requireAccount(ctx);
        const row = ctx.db.lobbies.get(lobbyId);
        if (!row) throw new Error("Lobby not found");
        const lobby = lobbyFromRow(row);
        if (lobby.status !== "playing") throw new Error("Game is not running");
        const player = lobby.players.find((item) => item.userId === ctx.auth.userId);
        if (!player) throw new Error("Not a player in this game");
        if (lobby.stateVersion !== previousVersion) throw new Error("State is out of date");
        const previous = parseJson(lobby.stateJson, {});
        const nextJson = stateJson0 + stateJson1 + stateJson2;
        const next = parseJson(nextJson, {});
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
          status: finished ? "finished" : "playing"
        });
      }
    ),
    sendChat: mutation((ctx, body) => {
      requireAccount(ctx);
      const clean = body.trim().replace(/\s+/g, " ").slice(0, 300);
      if (!clean) return;
      const lobby = memberLobby(ctx.db.lobbies.limit(100).all(), ctx.auth.userId);
      if (!lobby) throw new Error("Join a lobby first");
      ctx.db.chatMessages.insert({
        lobbyId: lobby.id,
        authorId: ctx.auth.userId,
        authorName: ctx.auth.displayName,
        body: clean
      });
    })
  },
  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("ok")),
    manifest: endpoint(
      { method: "GET", path: "/api/manifest.webmanifest" },
      () => json(
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
              purpose: "any maskable"
            }
          ]
        },
        {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=3600"
          }
        }
      )
    ),
    appIcon: endpoint(
      { method: "GET", path: "/api/app-icon.svg" },
      () => text(APP_ICON, {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=86400"
        }
      })
    ),
    serviceWorker: endpoint(
      { method: "GET", path: "/api/sw.js" },
      () => text(SERVICE_WORKER, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
          "Service-Worker-Allowed": "/"
        }
      })
    )
  }
});
export {
  server_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vLi4vQXBwRGF0YS9Mb2NhbC9ucG0tY2FjaGUvX25weC8zZWI4ZDNlYWFmNGVmMWI0L25vZGVfbW9kdWxlcy9sYWtlYmVkL3NyYy9zZXJ2ZXIudHMiLCAibGFrZWJlZC1zb3VyY2U6c2VydmVyL2luZGV4LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogW251bGwsICJpbXBvcnQgeyBib29sZWFuLCBjYXBzdWxlLCBlbmRwb2ludCwganNvbiwgbXV0YXRpb24sIHF1ZXJ5LCBzdHJpbmcsIHRhYmxlLCB0ZXh0IH0gZnJvbSBcImxha2ViZWQvc2VydmVyXCI7XHJcbmltcG9ydCB0eXBlIHtcclxuICBPbmxpbmVDaGF0TWVzc2FnZSxcclxuICBPbmxpbmVMb2JieSxcclxuICBPbmxpbmVMb2JieUNvbmZpZyxcclxuICBPbmxpbmVMb2JieVN1bW1hcnksXHJcbiAgT25saW5lUGxheWVyLFxyXG4gIE9ubGluZVNuYXBzaG90LFxyXG59IGZyb20gXCIuLi9zaGFyZWQvb25saW5lXCI7XHJcblxyXG50eXBlIFJvdyA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+ICYgeyBpZDogc3RyaW5nOyBjcmVhdGVkQXQ6IHN0cmluZzsgdXBkYXRlZEF0OiBzdHJpbmcgfTtcclxudHlwZSBTdGF0ZUhlYWRlciA9IHtcclxuICB0dXJuPzogbnVtYmVyO1xyXG4gIHZlcnNpb24/OiBudW1iZXI7XHJcbiAgd2lubmVyPzogbnVtYmVyIHwgbnVsbDtcclxuICBlbmRSZWFzb24/OiBcImRyYXdcIiB8IFwicmVzaWduYXRpb25cIjtcclxuICByZXNpZ25lZD86IG51bWJlcltdO1xyXG59O1xyXG5cclxuY29uc3QgQVBQX0lDT04gPSBgPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgdmlld0JveD1cIjAgMCA1MTIgNTEyXCI+XHJcbiAgPHJlY3Qgd2lkdGg9XCI1MTJcIiBoZWlnaHQ9XCI1MTJcIiByeD1cIjk2XCIgZmlsbD1cIiNmMGVlZTNcIi8+XHJcbiAgPHBvbHlnb24gcG9pbnRzPVwiMjU2LDQ4IDQzMiwxNDQgNDMyLDM2OCAyNTYsNDY0IDgwLDM2OCA4MCwxNDRcIiBmaWxsPVwiIzYwYjU1Y1wiIHN0cm9rZT1cIiMzYTNhMzNcIiBzdHJva2Utd2lkdGg9XCIzMlwiLz5cclxuICA8cGF0aCBkPVwiTTE4NCAzMjRWMTg4aDE0NHYxMzZoLTQwdi00OGgtNjR2NDh6XCIgZmlsbD1cIiNmMGVlZTNcIiBzdHJva2U9XCIjM2EzYTMzXCIgc3Ryb2tlLXdpZHRoPVwiMjBcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiLz5cclxuPC9zdmc+YDtcclxuXHJcbmNvbnN0IFNFUlZJQ0VfV09SS0VSID0gYGNvbnN0IENBQ0hFID0gXCJhbnRpeW95LXNoZWxsLXYxXCI7XHJcbnNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImluc3RhbGxcIiwgKCkgPT4gc2VsZi5za2lwV2FpdGluZygpKTtcclxuc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiYWN0aXZhdGVcIiwgKGV2ZW50KSA9PiB7XHJcbiAgZXZlbnQud2FpdFVudGlsKFxyXG4gICAgY2FjaGVzLmtleXMoKVxyXG4gICAgICAudGhlbigoa2V5cykgPT4gUHJvbWlzZS5hbGwoa2V5cy5maWx0ZXIoKGtleSkgPT4ga2V5LnN0YXJ0c1dpdGgoXCJhbnRpeW95LXNoZWxsLVwiKSAmJiBrZXkgIT09IENBQ0hFKS5tYXAoKGtleSkgPT4gY2FjaGVzLmRlbGV0ZShrZXkpKSkpXHJcbiAgICAgIC50aGVuKCgpID0+IHNlbGYuY2xpZW50cy5jbGFpbSgpKVxyXG4gICk7XHJcbn0pO2A7XHJcblxyXG5mdW5jdGlvbiByZXF1aXJlQWNjb3VudChjdHg6IHsgYXV0aDogeyBpc0d1ZXN0OiBib29sZWFuIH0gfSkge1xyXG4gIGlmIChjdHguYXV0aC5pc0d1ZXN0KSB0aHJvdyBuZXcgRXJyb3IoXCJTaWduIGluIHdpdGggR29vZ2xlIHRvIHBsYXkgb25saW5lXCIpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBwYXJzZUpzb248VD4odmFsdWU6IHVua25vd24sIGZhbGxiYWNrOiBUKTogVCB7XHJcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIGZhbGxiYWNrO1xyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gSlNPTi5wYXJzZSh2YWx1ZSkgYXMgVDtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBmYWxsYmFjaztcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGxvYmJ5RnJvbVJvdyhyb3c6IFJvdyk6IE9ubGluZUxvYmJ5IHtcclxuICByZXR1cm4ge1xyXG4gICAgaWQ6IHJvdy5pZCxcclxuICAgIG93bmVySWQ6IFN0cmluZyhyb3cub3duZXJJZCksXHJcbiAgICBvd25lck5hbWU6IFN0cmluZyhyb3cub3duZXJOYW1lKSxcclxuICAgIHN0YXR1czogU3RyaW5nKHJvdy5zdGF0dXMpIGFzIE9ubGluZUxvYmJ5W1wic3RhdHVzXCJdLFxyXG4gICAgY29uZmlnOiBwYXJzZUpzb248T25saW5lTG9iYnlDb25maWc+KHJvdy5jb25maWdKc29uLCB7fSBhcyBPbmxpbmVMb2JieUNvbmZpZyksXHJcbiAgICBwbGF5ZXJzOiBwYXJzZUpzb248T25saW5lUGxheWVyW10+KHJvdy5wbGF5ZXJzSnNvbiwgW10pLFxyXG4gICAgc3RhdGVKc29uOiBTdHJpbmcocm93LnN0YXRlSnNvbjAgPz8gXCJcIikgKyBTdHJpbmcocm93LnN0YXRlSnNvbjEgPz8gXCJcIikgKyBTdHJpbmcocm93LnN0YXRlSnNvbjIgPz8gXCJcIiksXHJcbiAgICBzdGF0ZVZlcnNpb246IE51bWJlcihyb3cuc3RhdGVWZXJzaW9uID8/IDApLFxyXG4gICAgY3JlYXRlZEF0OiByb3cuY3JlYXRlZEF0LFxyXG4gICAgdXBkYXRlZEF0OiByb3cudXBkYXRlZEF0LFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG1lbWJlckxvYmJ5KHJvd3M6IFJvd1tdLCB1c2VySWQ6IHN0cmluZyk6IE9ubGluZUxvYmJ5IHwgbnVsbCB7XHJcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xyXG4gICAgY29uc3QgbG9iYnkgPSBsb2JieUZyb21Sb3cocm93KTtcclxuICAgIGlmIChsb2JieS5wbGF5ZXJzLnNvbWUoKHBsYXllcikgPT4gcGxheWVyLnVzZXJJZCA9PT0gdXNlcklkKSkgcmV0dXJuIGxvYmJ5O1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gY2xlYW5Db25maWcoY29uZmlnOiBPbmxpbmVMb2JieUNvbmZpZyk6IE9ubGluZUxvYmJ5Q29uZmlnIHtcclxuICBjb25zdCBtb2RlID0gY29uZmlnLm1vZGUgPT09IFwibWl4ZWRcIiA/IFwibWl4ZWRcIiA6IFwicGxheWVyc1wiO1xyXG4gIGNvbnN0IG1hcFNpemUgPSBbXCJzbWFsbFwiLCBcIm1lZGl1bVwiLCBcImxhcmdlXCIsIFwiaHVnZVwiXS5pbmNsdWRlcyhjb25maWcubWFwU2l6ZSkgPyBjb25maWcubWFwU2l6ZSA6IFwibWVkaXVtXCI7XHJcbiAgY29uc3QgcGxheWVyTGltaXQgPSBtYXBTaXplID09PSBcInNtYWxsXCIgPyA1IDogNjtcclxuICBjb25zdCBodW1hbkxpbWl0ID0gbW9kZSA9PT0gXCJtaXhlZFwiID8gcGxheWVyTGltaXQgLSAxIDogcGxheWVyTGltaXQ7XHJcbiAgY29uc3QgaHVtYW5TbG90cyA9IE1hdGgubWF4KDIsIE1hdGgubWluKGh1bWFuTGltaXQsIE1hdGgucm91bmQoY29uZmlnLmh1bWFuU2xvdHMgfHwgMikpKTtcclxuICBjb25zdCBtYXhCb3RzID0gcGxheWVyTGltaXQgLSBodW1hblNsb3RzO1xyXG4gIHJldHVybiB7XHJcbiAgICBtb2RlLFxyXG4gICAgaHVtYW5TbG90cyxcclxuICAgIGJvdENvdW50OiBtb2RlID09PSBcIm1peGVkXCIgPyBNYXRoLm1heCgxLCBNYXRoLm1pbihtYXhCb3RzLCBNYXRoLnJvdW5kKGNvbmZpZy5ib3RDb3VudCB8fCAxKSkpIDogMCxcclxuICAgIG1hcFNpemUsXHJcbiAgICBkaWZmaWN1bHR5OiBbXCJlYXN5XCIsIFwibm9ybWFsXCIsIFwiaGFyZFwiXS5pbmNsdWRlcyhjb25maWcuZGlmZmljdWx0eSkgPyBjb25maWcuZGlmZmljdWx0eSA6IFwibm9ybWFsXCIsXHJcbiAgICBnYW1lTW9kZTogY29uZmlnLmdhbWVNb2RlID09PSBcInNsYXlcIiA/IFwic2xheVwiIDogXCJhbnRpeW95XCIsXHJcbiAgICBmb2dPZldhcjogQm9vbGVhbihjb25maWcuZm9nT2ZXYXIpLFxyXG4gICAgc2VlZDogTWF0aC5hYnMoTWF0aC5mbG9vcihOdW1iZXIoY29uZmlnLnNlZWQpKSkgJSAyICoqIDMxLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGNhcHN1bGUoe1xyXG4gIG5hbWU6IFwiYW50aXlveS1yZW1hc3RlclwiLFxyXG5cclxuICBzY2hlbWE6IHtcclxuICAgIGxvYmJpZXM6IHRhYmxlKHtcclxuICAgICAgb3duZXJJZDogc3RyaW5nKCksXHJcbiAgICAgIG93bmVyTmFtZTogc3RyaW5nKCksXHJcbiAgICAgIHN0YXR1czogc3RyaW5nKCksXHJcbiAgICAgIGNvbmZpZ0pzb246IHN0cmluZygpLFxyXG4gICAgICBwbGF5ZXJzSnNvbjogc3RyaW5nKCksXHJcbiAgICAgIHN0YXRlSnNvbjA6IHN0cmluZygpLmRlZmF1bHQoXCJcIiksXHJcbiAgICAgIHN0YXRlSnNvbjE6IHN0cmluZygpLmRlZmF1bHQoXCJcIiksXHJcbiAgICAgIHN0YXRlSnNvbjI6IHN0cmluZygpLmRlZmF1bHQoXCJcIiksXHJcbiAgICAgIHN0YXRlVmVyc2lvbjogc3RyaW5nKCkuZGVmYXVsdChcIjBcIiksXHJcbiAgICAgIGNsb3NlZDogYm9vbGVhbigpLmRlZmF1bHQoZmFsc2UpLFxyXG4gICAgfSksXHJcbiAgICBjaGF0TWVzc2FnZXM6IHRhYmxlKHtcclxuICAgICAgbG9iYnlJZDogc3RyaW5nKCksXHJcbiAgICAgIGF1dGhvcklkOiBzdHJpbmcoKSxcclxuICAgICAgYXV0aG9yTmFtZTogc3RyaW5nKCksXHJcbiAgICAgIGJvZHk6IHN0cmluZygpLFxyXG4gICAgfSksXHJcbiAgfSxcclxuXHJcbiAgcXVlcmllczoge1xyXG4gICAgb25saW5lOiBxdWVyeSgoY3R4KTogT25saW5lU25hcHNob3QgPT4ge1xyXG4gICAgICBpZiAoY3R4LmF1dGguaXNHdWVzdCkgcmV0dXJuIHsgbG9iYmllczogW10sIGxvYmJ5OiBudWxsLCBtZXNzYWdlczogW10gfTtcclxuICAgICAgY29uc3Qgcm93cyA9IGN0eC5kYi5sb2JiaWVzLm9yZGVyQnkoXCJjcmVhdGVkQXRcIiwgXCJkZXNjXCIpLmxpbWl0KDEwMCkuYWxsKCkgYXMgUm93W107XHJcbiAgICAgIGNvbnN0IGxvYmJ5ID0gbWVtYmVyTG9iYnkocm93cywgY3R4LmF1dGgudXNlcklkKTtcclxuICAgICAgY29uc3QgbG9iYmllczogT25saW5lTG9iYnlTdW1tYXJ5W10gPSBbXTtcclxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xyXG4gICAgICAgIGNvbnN0IGl0ZW0gPSBsb2JieUZyb21Sb3cocm93KTtcclxuICAgICAgICBpZiAoaXRlbS5zdGF0dXMgIT09IFwid2FpdGluZ1wiKSBjb250aW51ZTtcclxuICAgICAgICBsb2JiaWVzLnB1c2goe1xyXG4gICAgICAgICAgaWQ6IGl0ZW0uaWQsXHJcbiAgICAgICAgICBvd25lck5hbWU6IGl0ZW0ub3duZXJOYW1lLFxyXG4gICAgICAgICAgbW9kZTogaXRlbS5jb25maWcubW9kZSxcclxuICAgICAgICAgIGpvaW5lZDogaXRlbS5wbGF5ZXJzLmxlbmd0aCxcclxuICAgICAgICAgIGh1bWFuU2xvdHM6IGl0ZW0uY29uZmlnLmh1bWFuU2xvdHMsXHJcbiAgICAgICAgICBib3RDb3VudDogaXRlbS5jb25maWcuYm90Q291bnQsXHJcbiAgICAgICAgICBtYXBTaXplOiBpdGVtLmNvbmZpZy5tYXBTaXplLFxyXG4gICAgICAgICAgY3JlYXRlZEF0OiBpdGVtLmNyZWF0ZWRBdCxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCBtZXNzYWdlcyA9IGxvYmJ5XHJcbiAgICAgICAgPyAoY3R4LmRiLmNoYXRNZXNzYWdlcy53aGVyZShcImxvYmJ5SWRcIiwgbG9iYnkuaWQpLm9yZGVyQnkoXCJjcmVhdGVkQXRcIiwgXCJhc2NcIikubGltaXQoMTAwKS5hbGwoKSBhcyBSb3dbXSkubWFwKFxyXG4gICAgICAgICAgICAocm93KTogT25saW5lQ2hhdE1lc3NhZ2UgPT4gKHtcclxuICAgICAgICAgICAgICBpZDogcm93LmlkLFxyXG4gICAgICAgICAgICAgIGxvYmJ5SWQ6IFN0cmluZyhyb3cubG9iYnlJZCksXHJcbiAgICAgICAgICAgICAgYXV0aG9ySWQ6IFN0cmluZyhyb3cuYXV0aG9ySWQpLFxyXG4gICAgICAgICAgICAgIGF1dGhvck5hbWU6IFN0cmluZyhyb3cuYXV0aG9yTmFtZSksXHJcbiAgICAgICAgICAgICAgYm9keTogU3RyaW5nKHJvdy5ib2R5KSxcclxuICAgICAgICAgICAgICBjcmVhdGVkQXQ6IHJvdy5jcmVhdGVkQXQsXHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICApXHJcbiAgICAgICAgOiBbXTtcclxuICAgICAgcmV0dXJuIHsgbG9iYmllcywgbG9iYnksIG1lc3NhZ2VzIH07XHJcbiAgICB9KSxcclxuICB9LFxyXG5cclxuICBtdXRhdGlvbnM6IHtcclxuICAgIGNyZWF0ZUxvYmJ5OiBtdXRhdGlvbigoY3R4LCByZXF1ZXN0ZWQ6IE9ubGluZUxvYmJ5Q29uZmlnKSA9PiB7XHJcbiAgICAgIHJlcXVpcmVBY2NvdW50KGN0eCk7XHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gbWVtYmVyTG9iYnkoY3R4LmRiLmxvYmJpZXMubGltaXQoMTAwKS5hbGwoKSBhcyBSb3dbXSwgY3R4LmF1dGgudXNlcklkKTtcclxuICAgICAgaWYgKGV4aXN0aW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJMZWF2ZSB5b3VyIGN1cnJlbnQgbG9iYnkgZmlyc3RcIik7XHJcbiAgICAgIGNvbnN0IGNvbmZpZyA9IGNsZWFuQ29uZmlnKHJlcXVlc3RlZCk7XHJcbiAgICAgIGNvbnN0IHBsYXllcjogT25saW5lUGxheWVyID0ge1xyXG4gICAgICAgIHVzZXJJZDogY3R4LmF1dGgudXNlcklkLFxyXG4gICAgICAgIG5hbWU6IGN0eC5hdXRoLmRpc3BsYXlOYW1lLFxyXG4gICAgICAgIHBpY3R1cmU6IGN0eC5hdXRoLnBpY3R1cmUsXHJcbiAgICAgICAgc2VhdDogMCxcclxuICAgICAgfTtcclxuICAgICAgcmV0dXJuIGN0eC5kYi5sb2JiaWVzLmluc2VydCh7XHJcbiAgICAgICAgb3duZXJJZDogY3R4LmF1dGgudXNlcklkLFxyXG4gICAgICAgIG93bmVyTmFtZTogY3R4LmF1dGguZGlzcGxheU5hbWUsXHJcbiAgICAgICAgc3RhdHVzOiBcIndhaXRpbmdcIixcclxuICAgICAgICBjb25maWdKc29uOiBKU09OLnN0cmluZ2lmeShjb25maWcpLFxyXG4gICAgICAgIHBsYXllcnNKc29uOiBKU09OLnN0cmluZ2lmeShbcGxheWVyXSksXHJcbiAgICAgICAgc3RhdGVKc29uMDogXCJcIixcclxuICAgICAgICBzdGF0ZUpzb24xOiBcIlwiLFxyXG4gICAgICAgIHN0YXRlSnNvbjI6IFwiXCIsXHJcbiAgICAgICAgc3RhdGVWZXJzaW9uOiBcIjBcIixcclxuICAgICAgICBjbG9zZWQ6IGZhbHNlLFxyXG4gICAgICB9KS5pZDtcclxuICAgIH0pLFxyXG5cclxuICAgIGpvaW5Mb2JieTogbXV0YXRpb24oKGN0eCwgbG9iYnlJZDogc3RyaW5nKSA9PiB7XHJcbiAgICAgIHJlcXVpcmVBY2NvdW50KGN0eCk7XHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gbWVtYmVyTG9iYnkoY3R4LmRiLmxvYmJpZXMubGltaXQoMTAwKS5hbGwoKSBhcyBSb3dbXSwgY3R4LmF1dGgudXNlcklkKTtcclxuICAgICAgaWYgKGV4aXN0aW5nKSB0aHJvdyBuZXcgRXJyb3IoXCJMZWF2ZSB5b3VyIGN1cnJlbnQgbG9iYnkgZmlyc3RcIik7XHJcbiAgICAgIGNvbnN0IHJvdyA9IGN0eC5kYi5sb2JiaWVzLmdldChsb2JieUlkKSBhcyBSb3cgfCBudWxsO1xyXG4gICAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEVycm9yKFwiTG9iYnkgbm90IGZvdW5kXCIpO1xyXG4gICAgICBjb25zdCBsb2JieSA9IGxvYmJ5RnJvbVJvdyhyb3cpO1xyXG4gICAgICBpZiAobG9iYnkuc3RhdHVzICE9PSBcIndhaXRpbmdcIikgdGhyb3cgbmV3IEVycm9yKFwiR2FtZSBhbHJlYWR5IHN0YXJ0ZWRcIik7XHJcbiAgICAgIGlmIChsb2JieS5wbGF5ZXJzLmxlbmd0aCA+PSBsb2JieS5jb25maWcuaHVtYW5TbG90cykgdGhyb3cgbmV3IEVycm9yKFwiTG9iYnkgaXMgZnVsbFwiKTtcclxuICAgICAgbG9iYnkucGxheWVycy5wdXNoKHtcclxuICAgICAgICB1c2VySWQ6IGN0eC5hdXRoLnVzZXJJZCxcclxuICAgICAgICBuYW1lOiBjdHguYXV0aC5kaXNwbGF5TmFtZSxcclxuICAgICAgICBwaWN0dXJlOiBjdHguYXV0aC5waWN0dXJlLFxyXG4gICAgICAgIHNlYXQ6IGxvYmJ5LnBsYXllcnMubGVuZ3RoLFxyXG4gICAgICB9KTtcclxuICAgICAgY3R4LmRiLmxvYmJpZXMudXBkYXRlKGxvYmJ5SWQsIHsgcGxheWVyc0pzb246IEpTT04uc3RyaW5naWZ5KGxvYmJ5LnBsYXllcnMpIH0pO1xyXG4gICAgfSksXHJcblxyXG4gICAgbGVhdmVMb2JieTogbXV0YXRpb24oKGN0eCkgPT4ge1xyXG4gICAgICByZXF1aXJlQWNjb3VudChjdHgpO1xyXG4gICAgICBjb25zdCByb3dzID0gY3R4LmRiLmxvYmJpZXMubGltaXQoMTAwKS5hbGwoKSBhcyBSb3dbXTtcclxuICAgICAgY29uc3QgbG9iYnkgPSBtZW1iZXJMb2JieShyb3dzLCBjdHguYXV0aC51c2VySWQpO1xyXG4gICAgICBpZiAoIWxvYmJ5KSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHJvdyA9IGN0eC5kYi5sb2JiaWVzLmdldChsb2JieS5pZCkgYXMgUm93IHwgbnVsbDtcclxuICAgICAgaWYgKCFyb3cpIHJldHVybjtcclxuICAgICAgaWYgKGxvYmJ5Lm93bmVySWQgPT09IGN0eC5hdXRoLnVzZXJJZCkge1xyXG4gICAgICAgIGN0eC5kYi5sb2JiaWVzLmRlbGV0ZShsb2JieS5pZCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChsb2JieS5zdGF0dXMgPT09IFwicGxheWluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoXCJBIHJ1bm5pbmcgZ2FtZSBjYW5ub3QgYmUgbGVmdFwiKTtcclxuICAgICAgY29uc3QgcGxheWVycyA9IGxvYmJ5LnBsYXllcnNcclxuICAgICAgICAuZmlsdGVyKChwbGF5ZXIpID0+IHBsYXllci51c2VySWQgIT09IGN0eC5hdXRoLnVzZXJJZClcclxuICAgICAgICAubWFwKChwbGF5ZXIsIHNlYXQpID0+ICh7IC4uLnBsYXllciwgc2VhdCB9KSk7XHJcbiAgICAgIGN0eC5kYi5sb2JiaWVzLnVwZGF0ZShsb2JieS5pZCwgeyBwbGF5ZXJzSnNvbjogSlNPTi5zdHJpbmdpZnkocGxheWVycykgfSk7XHJcbiAgICB9KSxcclxuXHJcbiAgICBzdGFydExvYmJ5OiBtdXRhdGlvbigoY3R4LCBsb2JieUlkOiBzdHJpbmcsIHN0YXRlSnNvbjA6IHN0cmluZywgc3RhdGVKc29uMTogc3RyaW5nLCBzdGF0ZUpzb24yOiBzdHJpbmcpID0+IHtcclxuICAgICAgcmVxdWlyZUFjY291bnQoY3R4KTtcclxuICAgICAgY29uc3Qgcm93ID0gY3R4LmRiLmxvYmJpZXMuZ2V0KGxvYmJ5SWQpIGFzIFJvdyB8IG51bGw7XHJcbiAgICAgIGlmICghcm93KSB0aHJvdyBuZXcgRXJyb3IoXCJMb2JieSBub3QgZm91bmRcIik7XHJcbiAgICAgIGNvbnN0IGxvYmJ5ID0gbG9iYnlGcm9tUm93KHJvdyk7XHJcbiAgICAgIGlmIChsb2JieS5vd25lcklkICE9PSBjdHguYXV0aC51c2VySWQpIHRocm93IG5ldyBFcnJvcihcIk9ubHkgdGhlIGhvc3QgY2FuIHN0YXJ0XCIpO1xyXG4gICAgICBpZiAobG9iYnkuc3RhdHVzICE9PSBcIndhaXRpbmdcIikgdGhyb3cgbmV3IEVycm9yKFwiR2FtZSBhbHJlYWR5IHN0YXJ0ZWRcIik7XHJcbiAgICAgIGlmIChsb2JieS5wbGF5ZXJzLmxlbmd0aCA8IGxvYmJ5LmNvbmZpZy5odW1hblNsb3RzKSB0aHJvdyBuZXcgRXJyb3IoXCJXYWl0aW5nIGZvciBtb3JlIHBsYXllcnNcIik7XHJcbiAgICAgIGN0eC5kYi5sb2JiaWVzLnVwZGF0ZShsb2JieS5pZCwgeyBzdGF0dXM6IFwicGxheWluZ1wiLCBzdGF0ZUpzb24wLCBzdGF0ZUpzb24xLCBzdGF0ZUpzb24yLCBzdGF0ZVZlcnNpb246IFwiMFwiIH0pO1xyXG4gICAgfSksXHJcblxyXG4gICAgcHVibGlzaE9ubGluZVN0YXRlOiBtdXRhdGlvbihcclxuICAgICAgKGN0eCwgbG9iYnlJZDogc3RyaW5nLCBhY3RvcjogbnVtYmVyLCBwcmV2aW91c1ZlcnNpb246IG51bWJlciwgc3RhdGVKc29uMDogc3RyaW5nLCBzdGF0ZUpzb24xOiBzdHJpbmcsIHN0YXRlSnNvbjI6IHN0cmluZykgPT4ge1xyXG4gICAgICAgIHJlcXVpcmVBY2NvdW50KGN0eCk7XHJcbiAgICAgICAgY29uc3Qgcm93ID0gY3R4LmRiLmxvYmJpZXMuZ2V0KGxvYmJ5SWQpIGFzIFJvdyB8IG51bGw7XHJcbiAgICAgICAgaWYgKCFyb3cpIHRocm93IG5ldyBFcnJvcihcIkxvYmJ5IG5vdCBmb3VuZFwiKTtcclxuICAgICAgICBjb25zdCBsb2JieSA9IGxvYmJ5RnJvbVJvdyhyb3cpO1xyXG4gICAgICAgIGlmIChsb2JieS5zdGF0dXMgIT09IFwicGxheWluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoXCJHYW1lIGlzIG5vdCBydW5uaW5nXCIpO1xyXG4gICAgICAgIGNvbnN0IHBsYXllciA9IGxvYmJ5LnBsYXllcnMuZmluZCgoaXRlbSkgPT4gaXRlbS5zZWF0ID09PSBhY3Rvcik7XHJcbiAgICAgICAgY29uc3QgYm90QWN0b3IgPSBhY3RvciA+PSBsb2JieS5jb25maWcuaHVtYW5TbG90cyAmJiBsb2JieS5vd25lcklkID09PSBjdHguYXV0aC51c2VySWQ7XHJcbiAgICAgICAgaWYgKCghcGxheWVyIHx8IHBsYXllci51c2VySWQgIT09IGN0eC5hdXRoLnVzZXJJZCkgJiYgIWJvdEFjdG9yKSB0aHJvdyBuZXcgRXJyb3IoXCJOb3QgeW91ciB0dXJuXCIpO1xyXG4gICAgICAgIGlmIChsb2JieS5zdGF0ZVZlcnNpb24gIT09IHByZXZpb3VzVmVyc2lvbikgdGhyb3cgbmV3IEVycm9yKFwiU3RhdGUgaXMgb3V0IG9mIGRhdGVcIik7XHJcbiAgICAgICAgY29uc3QgcHJldmlvdXMgPSBwYXJzZUpzb248U3RhdGVIZWFkZXI+KGxvYmJ5LnN0YXRlSnNvbiwge30pO1xyXG4gICAgICAgIGNvbnN0IG5leHRKc29uID0gc3RhdGVKc29uMCArIHN0YXRlSnNvbjEgKyBzdGF0ZUpzb24yO1xyXG4gICAgICAgIGNvbnN0IG5leHQgPSBwYXJzZUpzb248U3RhdGVIZWFkZXI+KG5leHRKc29uLCB7fSk7XHJcbiAgICAgICAgaWYgKHByZXZpb3VzLnR1cm4gIT09IGFjdG9yKSB0aHJvdyBuZXcgRXJyb3IoXCJOb3QgeW91ciB0dXJuXCIpO1xyXG4gICAgICAgIGlmICh0eXBlb2YgcHJldmlvdXMudmVyc2lvbiAhPT0gXCJudW1iZXJcIiB8fCBuZXh0LnZlcnNpb24gIT09IHByZXZpb3VzLnZlcnNpb24gKyAxKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIHN0YXRlIHZlcnNpb25cIik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChuZXh0LmVuZFJlYXNvbiAhPT0gcHJldmlvdXMuZW5kUmVhc29uIHx8IEpTT04uc3RyaW5naWZ5KG5leHQucmVzaWduZWQgPz8gW10pICE9PSBKU09OLnN0cmluZ2lmeShwcmV2aW91cy5yZXNpZ25lZCA/PyBbXSkpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlVzZSB0aGUgZ2FtZSBleGl0IGFjdGlvblwiKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY3R4LmRiLmxvYmJpZXMudXBkYXRlKGxvYmJ5LmlkLCB7XHJcbiAgICAgICAgICBzdGF0ZUpzb24wLFxyXG4gICAgICAgICAgc3RhdGVKc29uMSxcclxuICAgICAgICAgIHN0YXRlSnNvbjIsXHJcbiAgICAgICAgICBzdGF0ZVZlcnNpb246IFN0cmluZyhwcmV2aW91c1ZlcnNpb24gKyAxKSxcclxuICAgICAgICAgIHN0YXR1czogbmV4dC53aW5uZXIgPT0gbnVsbCAmJiBuZXh0LmVuZFJlYXNvbiAhPT0gXCJkcmF3XCIgPyBcInBsYXlpbmdcIiA6IFwiZmluaXNoZWRcIixcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgKSxcclxuXHJcbiAgICBwdWJsaXNoT25saW5lRXhpdDogbXV0YXRpb24oXHJcbiAgICAgIChjdHgsIGxvYmJ5SWQ6IHN0cmluZywga2luZDogXCJkcmF3XCIgfCBcInJlc2lnblwiLCBwcmV2aW91c1ZlcnNpb246IG51bWJlciwgc3RhdGVKc29uMDogc3RyaW5nLCBzdGF0ZUpzb24xOiBzdHJpbmcsIHN0YXRlSnNvbjI6IHN0cmluZykgPT4ge1xyXG4gICAgICAgIHJlcXVpcmVBY2NvdW50KGN0eCk7XHJcbiAgICAgICAgY29uc3Qgcm93ID0gY3R4LmRiLmxvYmJpZXMuZ2V0KGxvYmJ5SWQpIGFzIFJvdyB8IG51bGw7XHJcbiAgICAgICAgaWYgKCFyb3cpIHRocm93IG5ldyBFcnJvcihcIkxvYmJ5IG5vdCBmb3VuZFwiKTtcclxuICAgICAgICBjb25zdCBsb2JieSA9IGxvYmJ5RnJvbVJvdyhyb3cpO1xyXG4gICAgICAgIGlmIChsb2JieS5zdGF0dXMgIT09IFwicGxheWluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoXCJHYW1lIGlzIG5vdCBydW5uaW5nXCIpO1xyXG4gICAgICAgIGNvbnN0IHBsYXllciA9IGxvYmJ5LnBsYXllcnMuZmluZCgoaXRlbSkgPT4gaXRlbS51c2VySWQgPT09IGN0eC5hdXRoLnVzZXJJZCk7XHJcbiAgICAgICAgaWYgKCFwbGF5ZXIpIHRocm93IG5ldyBFcnJvcihcIk5vdCBhIHBsYXllciBpbiB0aGlzIGdhbWVcIik7XHJcbiAgICAgICAgaWYgKGxvYmJ5LnN0YXRlVmVyc2lvbiAhPT0gcHJldmlvdXNWZXJzaW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJTdGF0ZSBpcyBvdXQgb2YgZGF0ZVwiKTtcclxuICAgICAgICBjb25zdCBwcmV2aW91cyA9IHBhcnNlSnNvbjxTdGF0ZUhlYWRlcj4obG9iYnkuc3RhdGVKc29uLCB7fSk7XHJcbiAgICAgICAgY29uc3QgbmV4dEpzb24gPSBzdGF0ZUpzb24wICsgc3RhdGVKc29uMSArIHN0YXRlSnNvbjI7XHJcbiAgICAgICAgY29uc3QgbmV4dCA9IHBhcnNlSnNvbjxTdGF0ZUhlYWRlcj4obmV4dEpzb24sIHt9KTtcclxuICAgICAgICBpZiAodHlwZW9mIHByZXZpb3VzLnZlcnNpb24gIT09IFwibnVtYmVyXCIgfHwgbmV4dC52ZXJzaW9uICE9PSBwcmV2aW91cy52ZXJzaW9uICsgMSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBzdGF0ZSB2ZXJzaW9uXCIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoa2luZCA9PT0gXCJkcmF3XCIpIHtcclxuICAgICAgICAgIGlmIChuZXh0LmVuZFJlYXNvbiAhPT0gXCJkcmF3XCIgfHwgbmV4dC53aW5uZXIgIT0gbnVsbCkgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBkcmF3IHN0YXRlXCIpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBjb25zdCBiZWZvcmUgPSBwcmV2aW91cy5yZXNpZ25lZCA/PyBbXTtcclxuICAgICAgICAgIGNvbnN0IGFmdGVyID0gbmV4dC5yZXNpZ25lZCA/PyBbXTtcclxuICAgICAgICAgIGlmIChiZWZvcmUuaW5jbHVkZXMocGxheWVyLnNlYXQpIHx8ICFhZnRlci5pbmNsdWRlcyhwbGF5ZXIuc2VhdCkgfHwgYWZ0ZXIubGVuZ3RoICE9PSBiZWZvcmUubGVuZ3RoICsgMSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJZb3UgY2FuIG9ubHkgcmVzaWduIHlvdXJzZWxmXCIpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBmaW5pc2hlZCA9IG5leHQud2lubmVyICE9IG51bGwgfHwgbmV4dC5lbmRSZWFzb24gPT09IFwiZHJhd1wiO1xyXG4gICAgICAgIGN0eC5kYi5sb2JiaWVzLnVwZGF0ZShsb2JieS5pZCwge1xyXG4gICAgICAgICAgc3RhdGVKc29uMCxcclxuICAgICAgICAgIHN0YXRlSnNvbjEsXHJcbiAgICAgICAgICBzdGF0ZUpzb24yLFxyXG4gICAgICAgICAgc3RhdGVWZXJzaW9uOiBTdHJpbmcocHJldmlvdXNWZXJzaW9uICsgMSksXHJcbiAgICAgICAgICBzdGF0dXM6IGZpbmlzaGVkID8gXCJmaW5pc2hlZFwiIDogXCJwbGF5aW5nXCIsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgICksXHJcblxyXG4gICAgc2VuZENoYXQ6IG11dGF0aW9uKChjdHgsIGJvZHk6IHN0cmluZykgPT4ge1xyXG4gICAgICByZXF1aXJlQWNjb3VudChjdHgpO1xyXG4gICAgICBjb25zdCBjbGVhbiA9IGJvZHkudHJpbSgpLnJlcGxhY2UoL1xccysvZywgXCIgXCIpLnNsaWNlKDAsIDMwMCk7XHJcbiAgICAgIGlmICghY2xlYW4pIHJldHVybjtcclxuICAgICAgY29uc3QgbG9iYnkgPSBtZW1iZXJMb2JieShjdHguZGIubG9iYmllcy5saW1pdCgxMDApLmFsbCgpIGFzIFJvd1tdLCBjdHguYXV0aC51c2VySWQpO1xyXG4gICAgICBpZiAoIWxvYmJ5KSB0aHJvdyBuZXcgRXJyb3IoXCJKb2luIGEgbG9iYnkgZmlyc3RcIik7XHJcbiAgICAgIGN0eC5kYi5jaGF0TWVzc2FnZXMuaW5zZXJ0KHtcclxuICAgICAgICBsb2JieUlkOiBsb2JieS5pZCxcclxuICAgICAgICBhdXRob3JJZDogY3R4LmF1dGgudXNlcklkLFxyXG4gICAgICAgIGF1dGhvck5hbWU6IGN0eC5hdXRoLmRpc3BsYXlOYW1lLFxyXG4gICAgICAgIGJvZHk6IGNsZWFuLFxyXG4gICAgICB9KTtcclxuICAgIH0pLFxyXG4gIH0sXHJcblxyXG4gIGVuZHBvaW50czoge1xyXG4gICAgc3RhdHVzOiBlbmRwb2ludCh7IG1ldGhvZDogXCJHRVRcIiwgcGF0aDogXCIvYXBpL3N0YXR1c1wiIH0sICgpID0+IHRleHQoXCJva1wiKSksXHJcbiAgICBtYW5pZmVzdDogZW5kcG9pbnQoeyBtZXRob2Q6IFwiR0VUXCIsIHBhdGg6IFwiL2FwaS9tYW5pZmVzdC53ZWJtYW5pZmVzdFwiIH0sICgpID0+XHJcbiAgICAgIGpzb24oXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgaWQ6IFwiL1wiLFxyXG4gICAgICAgICAgbmFtZTogXCJBbnRpeW95IFJlbWFzdGVyXCIsXHJcbiAgICAgICAgICBzaG9ydF9uYW1lOiBcIkFudGl5b3lcIixcclxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgYnJvd3NlciByZW1hc3RlciBvZiB0aGUgdHVybi1iYXNlZCBzdHJhdGVneSBnYW1lIEFudGl5b3kuXCIsXHJcbiAgICAgICAgICBzdGFydF91cmw6IFwiL1wiLFxyXG4gICAgICAgICAgc2NvcGU6IFwiL1wiLFxyXG4gICAgICAgICAgZGlzcGxheTogXCJzdGFuZGFsb25lXCIsXHJcbiAgICAgICAgICBvcmllbnRhdGlvbjogXCJhbnlcIixcclxuICAgICAgICAgIGJhY2tncm91bmRfY29sb3I6IFwiI2YwZWVlM1wiLFxyXG4gICAgICAgICAgdGhlbWVfY29sb3I6IFwiIzNhM2EzM1wiLFxyXG4gICAgICAgICAgaWNvbnM6IFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIHNyYzogXCIvYXBpL2FwcC1pY29uLnN2Z1wiLFxyXG4gICAgICAgICAgICAgIHNpemVzOiBcImFueVwiLFxyXG4gICAgICAgICAgICAgIHR5cGU6IFwiaW1hZ2Uvc3ZnK3htbFwiLFxyXG4gICAgICAgICAgICAgIHB1cnBvc2U6IFwiYW55IG1hc2thYmxlXCIsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL21hbmlmZXN0K2pzb247IGNoYXJzZXQ9dXRmLThcIixcclxuICAgICAgICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwicHVibGljLCBtYXgtYWdlPTM2MDBcIixcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfVxyXG4gICAgICApXHJcbiAgICApLFxyXG4gICAgYXBwSWNvbjogZW5kcG9pbnQoeyBtZXRob2Q6IFwiR0VUXCIsIHBhdGg6IFwiL2FwaS9hcHAtaWNvbi5zdmdcIiB9LCAoKSA9PlxyXG4gICAgICB0ZXh0KEFQUF9JQ09OLCB7XHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJpbWFnZS9zdmcreG1sOyBjaGFyc2V0PXV0Zi04XCIsXHJcbiAgICAgICAgICBcIkNhY2hlLUNvbnRyb2xcIjogXCJwdWJsaWMsIG1heC1hZ2U9ODY0MDBcIixcclxuICAgICAgICB9LFxyXG4gICAgICB9KVxyXG4gICAgKSxcclxuICAgIHNlcnZpY2VXb3JrZXI6IGVuZHBvaW50KHsgbWV0aG9kOiBcIkdFVFwiLCBwYXRoOiBcIi9hcGkvc3cuanNcIiB9LCAoKSA9PlxyXG4gICAgICB0ZXh0KFNFUlZJQ0VfV09SS0VSLCB7XHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qYXZhc2NyaXB0OyBjaGFyc2V0PXV0Zi04XCIsXHJcbiAgICAgICAgICBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiLFxyXG4gICAgICAgICAgXCJTZXJ2aWNlLVdvcmtlci1BbGxvd2VkXCI6IFwiL1wiLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pXHJcbiAgICApLFxyXG4gIH0sXHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEZNLFNBQVUsUUFBVyxZQUFhO0FBQ3RDLFNBQU87QUFDVDtBQUVNLFNBQVUsTUFBZSxTQUF3QztBQUNyRSxTQUFPO0FBQ1Q7QUFFTSxTQUFVLFNBQ2QsU0FBd0Q7QUFFeEQsU0FBTztBQUNUO0FBRU0sU0FBVSxTQUNkLE9BQ0EsU0FBaUY7QUFFakYsU0FBTztJQUNMO0lBQ0EsTUFBTTtJQUNOLFFBQVEsT0FBTyxPQUFPLFVBQVUsRUFBRSxFQUFFLFlBQVc7SUFDL0MsTUFBTSxPQUFPLE9BQU8sUUFBUSxFQUFFOztBQUVsQztBQUVBLFNBQVMsU0FBUyxNQUFjLEVBQUUsVUFBVSxDQUFBLEdBQUksU0FBUyxJQUFHLElBQThCLENBQUEsR0FBRTtBQUMxRixTQUFPO0lBQ0w7SUFDQTtJQUNBLE1BQU07SUFDTjs7QUFFSjtBQUVNLFNBQVUsS0FBSyxPQUFnQixVQUFtQyxDQUFBLEdBQUU7QUFDeEUsU0FBTyxTQUFTLEtBQUssVUFBVSxTQUFTLElBQUksR0FBRztJQUM3QyxHQUFHO0lBQ0gsU0FBUztNQUNQLGdCQUFnQjtNQUNoQixHQUFJLFFBQVEsV0FBVyxDQUFBOztHQUUxQjtBQUNIO0FBRU0sU0FBVSxLQUFLLE9BQWdCLFVBQW1DLENBQUEsR0FBRTtBQUN4RSxTQUFPLFNBQVMsT0FBTyxTQUFTLEVBQUUsR0FBRztJQUNuQyxHQUFHO0lBQ0gsU0FBUztNQUNQLGdCQUFnQjtNQUNoQixHQUFJLFFBQVEsV0FBVyxDQUFBOztHQUUxQjtBQUNIO0FBaUJBLFNBQVMsTUFBUyxNQUFZO0FBQzVCLFNBQU87SUFDTDtJQUNBLGNBQWM7SUFDZCxRQUFRLE9BQVE7QUFDZCxhQUFPO1FBQ0wsR0FBRztRQUNILGNBQWM7O0lBRWxCOztBQUVKO0FBRU0sU0FBVSxNQUFNLFFBQWtDO0FBQ3RELFNBQU87SUFDTCxNQUFNO0lBQ047O0FBRUo7QUFFTSxTQUFVLFNBQU07QUFDcEIsU0FBTyxNQUFNLFFBQVE7QUFDdkI7QUFFTSxTQUFVLFVBQU87QUFDckIsU0FBTyxNQUFNLFNBQVM7QUFDeEI7OztBQ3pLQSxJQUFNLFdBQVc7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQU1qQixJQUFNLGlCQUFpQjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFVdkIsU0FBUyxlQUFlLEtBQXFDO0FBQzNELE1BQUksSUFBSSxLQUFLLFFBQVMsT0FBTSxJQUFJLE1BQU0sb0NBQW9DO0FBQzVFO0FBRUEsU0FBUyxVQUFhLE9BQWdCLFVBQWdCO0FBQ3BELE1BQUksT0FBTyxVQUFVLFNBQVUsUUFBTztBQUN0QyxNQUFJO0FBQ0YsV0FBTyxLQUFLLE1BQU0sS0FBSztBQUFBLEVBQ3pCLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBRUEsU0FBUyxhQUFhLEtBQXVCO0FBQzNDLFNBQU87QUFBQSxJQUNMLElBQUksSUFBSTtBQUFBLElBQ1IsU0FBUyxPQUFPLElBQUksT0FBTztBQUFBLElBQzNCLFdBQVcsT0FBTyxJQUFJLFNBQVM7QUFBQSxJQUMvQixRQUFRLE9BQU8sSUFBSSxNQUFNO0FBQUEsSUFDekIsUUFBUSxVQUE2QixJQUFJLFlBQVksQ0FBQyxDQUFzQjtBQUFBLElBQzVFLFNBQVMsVUFBMEIsSUFBSSxhQUFhLENBQUMsQ0FBQztBQUFBLElBQ3RELFdBQVcsT0FBTyxJQUFJLGNBQWMsRUFBRSxJQUFJLE9BQU8sSUFBSSxjQUFjLEVBQUUsSUFBSSxPQUFPLElBQUksY0FBYyxFQUFFO0FBQUEsSUFDcEcsY0FBYyxPQUFPLElBQUksZ0JBQWdCLENBQUM7QUFBQSxJQUMxQyxXQUFXLElBQUk7QUFBQSxJQUNmLFdBQVcsSUFBSTtBQUFBLEVBQ2pCO0FBQ0Y7QUFFQSxTQUFTLFlBQVksTUFBYSxRQUFvQztBQUNwRSxhQUFXLE9BQU8sTUFBTTtBQUN0QixVQUFNLFFBQVEsYUFBYSxHQUFHO0FBQzlCLFFBQUksTUFBTSxRQUFRLEtBQUssQ0FBQyxXQUFXLE9BQU8sV0FBVyxNQUFNLEVBQUcsUUFBTztBQUFBLEVBQ3ZFO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxZQUFZLFFBQThDO0FBQ2pFLFFBQU0sT0FBTyxPQUFPLFNBQVMsVUFBVSxVQUFVO0FBQ2pELFFBQU0sVUFBVSxDQUFDLFNBQVMsVUFBVSxTQUFTLE1BQU0sRUFBRSxTQUFTLE9BQU8sT0FBTyxJQUFJLE9BQU8sVUFBVTtBQUNqRyxRQUFNLGNBQWMsWUFBWSxVQUFVLElBQUk7QUFDOUMsUUFBTSxhQUFhLFNBQVMsVUFBVSxjQUFjLElBQUk7QUFDeEQsUUFBTSxhQUFhLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxZQUFZLEtBQUssTUFBTSxPQUFPLGNBQWMsQ0FBQyxDQUFDLENBQUM7QUFDdkYsUUFBTSxVQUFVLGNBQWM7QUFDOUIsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBO0FBQUEsSUFDQSxVQUFVLFNBQVMsVUFBVSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksU0FBUyxLQUFLLE1BQU0sT0FBTyxZQUFZLENBQUMsQ0FBQyxDQUFDLElBQUk7QUFBQSxJQUNoRztBQUFBLElBQ0EsWUFBWSxDQUFDLFFBQVEsVUFBVSxNQUFNLEVBQUUsU0FBUyxPQUFPLFVBQVUsSUFBSSxPQUFPLGFBQWE7QUFBQSxJQUN6RixVQUFVLE9BQU8sYUFBYSxTQUFTLFNBQVM7QUFBQSxJQUNoRCxVQUFVLFFBQVEsT0FBTyxRQUFRO0FBQUEsSUFDakMsTUFBTSxLQUFLLElBQUksS0FBSyxNQUFNLE9BQU8sT0FBTyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUs7QUFBQSxFQUN6RDtBQUNGO0FBRUEsSUFBTyxpQkFBUSxRQUFRO0FBQUEsRUFDckIsTUFBTTtBQUFBLEVBRU4sUUFBUTtBQUFBLElBQ04sU0FBUyxNQUFNO0FBQUEsTUFDYixTQUFTLE9BQU87QUFBQSxNQUNoQixXQUFXLE9BQU87QUFBQSxNQUNsQixRQUFRLE9BQU87QUFBQSxNQUNmLFlBQVksT0FBTztBQUFBLE1BQ25CLGFBQWEsT0FBTztBQUFBLE1BQ3BCLFlBQVksT0FBTyxFQUFFLFFBQVEsRUFBRTtBQUFBLE1BQy9CLFlBQVksT0FBTyxFQUFFLFFBQVEsRUFBRTtBQUFBLE1BQy9CLFlBQVksT0FBTyxFQUFFLFFBQVEsRUFBRTtBQUFBLE1BQy9CLGNBQWMsT0FBTyxFQUFFLFFBQVEsR0FBRztBQUFBLE1BQ2xDLFFBQVEsUUFBUSxFQUFFLFFBQVEsS0FBSztBQUFBLElBQ2pDLENBQUM7QUFBQSxJQUNELGNBQWMsTUFBTTtBQUFBLE1BQ2xCLFNBQVMsT0FBTztBQUFBLE1BQ2hCLFVBQVUsT0FBTztBQUFBLE1BQ2pCLFlBQVksT0FBTztBQUFBLE1BQ25CLE1BQU0sT0FBTztBQUFBLElBQ2YsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLFNBQVM7QUFBQSxJQUNQLFFBQVEsTUFBTSxDQUFDLFFBQXdCO0FBQ3JDLFVBQUksSUFBSSxLQUFLLFFBQVMsUUFBTyxFQUFFLFNBQVMsQ0FBQyxHQUFHLE9BQU8sTUFBTSxVQUFVLENBQUMsRUFBRTtBQUN0RSxZQUFNLE9BQU8sSUFBSSxHQUFHLFFBQVEsUUFBUSxhQUFhLE1BQU0sRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJO0FBQ3hFLFlBQU0sUUFBUSxZQUFZLE1BQU0sSUFBSSxLQUFLLE1BQU07QUFDL0MsWUFBTSxVQUFnQyxDQUFDO0FBQ3ZDLGlCQUFXLE9BQU8sTUFBTTtBQUN0QixjQUFNLE9BQU8sYUFBYSxHQUFHO0FBQzdCLFlBQUksS0FBSyxXQUFXLFVBQVc7QUFDL0IsZ0JBQVEsS0FBSztBQUFBLFVBQ1gsSUFBSSxLQUFLO0FBQUEsVUFDVCxXQUFXLEtBQUs7QUFBQSxVQUNoQixNQUFNLEtBQUssT0FBTztBQUFBLFVBQ2xCLFFBQVEsS0FBSyxRQUFRO0FBQUEsVUFDckIsWUFBWSxLQUFLLE9BQU87QUFBQSxVQUN4QixVQUFVLEtBQUssT0FBTztBQUFBLFVBQ3RCLFNBQVMsS0FBSyxPQUFPO0FBQUEsVUFDckIsV0FBVyxLQUFLO0FBQUEsUUFDbEIsQ0FBQztBQUFBLE1BQ0g7QUFDQSxZQUFNLFdBQVcsUUFDWixJQUFJLEdBQUcsYUFBYSxNQUFNLFdBQVcsTUFBTSxFQUFFLEVBQUUsUUFBUSxhQUFhLEtBQUssRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJLEVBQVk7QUFBQSxRQUNyRyxDQUFDLFNBQTRCO0FBQUEsVUFDM0IsSUFBSSxJQUFJO0FBQUEsVUFDUixTQUFTLE9BQU8sSUFBSSxPQUFPO0FBQUEsVUFDM0IsVUFBVSxPQUFPLElBQUksUUFBUTtBQUFBLFVBQzdCLFlBQVksT0FBTyxJQUFJLFVBQVU7QUFBQSxVQUNqQyxNQUFNLE9BQU8sSUFBSSxJQUFJO0FBQUEsVUFDckIsV0FBVyxJQUFJO0FBQUEsUUFDakI7QUFBQSxNQUNGLElBQ0EsQ0FBQztBQUNMLGFBQU8sRUFBRSxTQUFTLE9BQU8sU0FBUztBQUFBLElBQ3BDLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxXQUFXO0FBQUEsSUFDVCxhQUFhLFNBQVMsQ0FBQyxLQUFLLGNBQWlDO0FBQzNELHFCQUFlLEdBQUc7QUFDbEIsWUFBTSxXQUFXLFlBQVksSUFBSSxHQUFHLFFBQVEsTUFBTSxHQUFHLEVBQUUsSUFBSSxHQUFZLElBQUksS0FBSyxNQUFNO0FBQ3RGLFVBQUksU0FBVSxPQUFNLElBQUksTUFBTSxnQ0FBZ0M7QUFDOUQsWUFBTSxTQUFTLFlBQVksU0FBUztBQUNwQyxZQUFNLFNBQXVCO0FBQUEsUUFDM0IsUUFBUSxJQUFJLEtBQUs7QUFBQSxRQUNqQixNQUFNLElBQUksS0FBSztBQUFBLFFBQ2YsU0FBUyxJQUFJLEtBQUs7QUFBQSxRQUNsQixNQUFNO0FBQUEsTUFDUjtBQUNBLGFBQU8sSUFBSSxHQUFHLFFBQVEsT0FBTztBQUFBLFFBQzNCLFNBQVMsSUFBSSxLQUFLO0FBQUEsUUFDbEIsV0FBVyxJQUFJLEtBQUs7QUFBQSxRQUNwQixRQUFRO0FBQUEsUUFDUixZQUFZLEtBQUssVUFBVSxNQUFNO0FBQUEsUUFDakMsYUFBYSxLQUFLLFVBQVUsQ0FBQyxNQUFNLENBQUM7QUFBQSxRQUNwQyxZQUFZO0FBQUEsUUFDWixZQUFZO0FBQUEsUUFDWixZQUFZO0FBQUEsUUFDWixjQUFjO0FBQUEsUUFDZCxRQUFRO0FBQUEsTUFDVixDQUFDLEVBQUU7QUFBQSxJQUNMLENBQUM7QUFBQSxJQUVELFdBQVcsU0FBUyxDQUFDLEtBQUssWUFBb0I7QUFDNUMscUJBQWUsR0FBRztBQUNsQixZQUFNLFdBQVcsWUFBWSxJQUFJLEdBQUcsUUFBUSxNQUFNLEdBQUcsRUFBRSxJQUFJLEdBQVksSUFBSSxLQUFLLE1BQU07QUFDdEYsVUFBSSxTQUFVLE9BQU0sSUFBSSxNQUFNLGdDQUFnQztBQUM5RCxZQUFNLE1BQU0sSUFBSSxHQUFHLFFBQVEsSUFBSSxPQUFPO0FBQ3RDLFVBQUksQ0FBQyxJQUFLLE9BQU0sSUFBSSxNQUFNLGlCQUFpQjtBQUMzQyxZQUFNLFFBQVEsYUFBYSxHQUFHO0FBQzlCLFVBQUksTUFBTSxXQUFXLFVBQVcsT0FBTSxJQUFJLE1BQU0sc0JBQXNCO0FBQ3RFLFVBQUksTUFBTSxRQUFRLFVBQVUsTUFBTSxPQUFPLFdBQVksT0FBTSxJQUFJLE1BQU0sZUFBZTtBQUNwRixZQUFNLFFBQVEsS0FBSztBQUFBLFFBQ2pCLFFBQVEsSUFBSSxLQUFLO0FBQUEsUUFDakIsTUFBTSxJQUFJLEtBQUs7QUFBQSxRQUNmLFNBQVMsSUFBSSxLQUFLO0FBQUEsUUFDbEIsTUFBTSxNQUFNLFFBQVE7QUFBQSxNQUN0QixDQUFDO0FBQ0QsVUFBSSxHQUFHLFFBQVEsT0FBTyxTQUFTLEVBQUUsYUFBYSxLQUFLLFVBQVUsTUFBTSxPQUFPLEVBQUUsQ0FBQztBQUFBLElBQy9FLENBQUM7QUFBQSxJQUVELFlBQVksU0FBUyxDQUFDLFFBQVE7QUFDNUIscUJBQWUsR0FBRztBQUNsQixZQUFNLE9BQU8sSUFBSSxHQUFHLFFBQVEsTUFBTSxHQUFHLEVBQUUsSUFBSTtBQUMzQyxZQUFNLFFBQVEsWUFBWSxNQUFNLElBQUksS0FBSyxNQUFNO0FBQy9DLFVBQUksQ0FBQyxNQUFPO0FBQ1osWUFBTSxNQUFNLElBQUksR0FBRyxRQUFRLElBQUksTUFBTSxFQUFFO0FBQ3ZDLFVBQUksQ0FBQyxJQUFLO0FBQ1YsVUFBSSxNQUFNLFlBQVksSUFBSSxLQUFLLFFBQVE7QUFDckMsWUFBSSxHQUFHLFFBQVEsT0FBTyxNQUFNLEVBQUU7QUFDOUI7QUFBQSxNQUNGO0FBQ0EsVUFBSSxNQUFNLFdBQVcsVUFBVyxPQUFNLElBQUksTUFBTSwrQkFBK0I7QUFDL0UsWUFBTSxVQUFVLE1BQU0sUUFDbkIsT0FBTyxDQUFDLFdBQVcsT0FBTyxXQUFXLElBQUksS0FBSyxNQUFNLEVBQ3BELElBQUksQ0FBQyxRQUFRLFVBQVUsRUFBRSxHQUFHLFFBQVEsS0FBSyxFQUFFO0FBQzlDLFVBQUksR0FBRyxRQUFRLE9BQU8sTUFBTSxJQUFJLEVBQUUsYUFBYSxLQUFLLFVBQVUsT0FBTyxFQUFFLENBQUM7QUFBQSxJQUMxRSxDQUFDO0FBQUEsSUFFRCxZQUFZLFNBQVMsQ0FBQyxLQUFLLFNBQWlCLFlBQW9CLFlBQW9CLGVBQXVCO0FBQ3pHLHFCQUFlLEdBQUc7QUFDbEIsWUFBTSxNQUFNLElBQUksR0FBRyxRQUFRLElBQUksT0FBTztBQUN0QyxVQUFJLENBQUMsSUFBSyxPQUFNLElBQUksTUFBTSxpQkFBaUI7QUFDM0MsWUFBTSxRQUFRLGFBQWEsR0FBRztBQUM5QixVQUFJLE1BQU0sWUFBWSxJQUFJLEtBQUssT0FBUSxPQUFNLElBQUksTUFBTSx5QkFBeUI7QUFDaEYsVUFBSSxNQUFNLFdBQVcsVUFBVyxPQUFNLElBQUksTUFBTSxzQkFBc0I7QUFDdEUsVUFBSSxNQUFNLFFBQVEsU0FBUyxNQUFNLE9BQU8sV0FBWSxPQUFNLElBQUksTUFBTSwwQkFBMEI7QUFDOUYsVUFBSSxHQUFHLFFBQVEsT0FBTyxNQUFNLElBQUksRUFBRSxRQUFRLFdBQVcsWUFBWSxZQUFZLFlBQVksY0FBYyxJQUFJLENBQUM7QUFBQSxJQUM5RyxDQUFDO0FBQUEsSUFFRCxvQkFBb0I7QUFBQSxNQUNsQixDQUFDLEtBQUssU0FBaUIsT0FBZSxpQkFBeUIsWUFBb0IsWUFBb0IsZUFBdUI7QUFDNUgsdUJBQWUsR0FBRztBQUNsQixjQUFNLE1BQU0sSUFBSSxHQUFHLFFBQVEsSUFBSSxPQUFPO0FBQ3RDLFlBQUksQ0FBQyxJQUFLLE9BQU0sSUFBSSxNQUFNLGlCQUFpQjtBQUMzQyxjQUFNLFFBQVEsYUFBYSxHQUFHO0FBQzlCLFlBQUksTUFBTSxXQUFXLFVBQVcsT0FBTSxJQUFJLE1BQU0scUJBQXFCO0FBQ3JFLGNBQU0sU0FBUyxNQUFNLFFBQVEsS0FBSyxDQUFDLFNBQVMsS0FBSyxTQUFTLEtBQUs7QUFDL0QsY0FBTSxXQUFXLFNBQVMsTUFBTSxPQUFPLGNBQWMsTUFBTSxZQUFZLElBQUksS0FBSztBQUNoRixhQUFLLENBQUMsVUFBVSxPQUFPLFdBQVcsSUFBSSxLQUFLLFdBQVcsQ0FBQyxTQUFVLE9BQU0sSUFBSSxNQUFNLGVBQWU7QUFDaEcsWUFBSSxNQUFNLGlCQUFpQixnQkFBaUIsT0FBTSxJQUFJLE1BQU0sc0JBQXNCO0FBQ2xGLGNBQU0sV0FBVyxVQUF1QixNQUFNLFdBQVcsQ0FBQyxDQUFDO0FBQzNELGNBQU0sV0FBVyxhQUFhLGFBQWE7QUFDM0MsY0FBTSxPQUFPLFVBQXVCLFVBQVUsQ0FBQyxDQUFDO0FBQ2hELFlBQUksU0FBUyxTQUFTLE1BQU8sT0FBTSxJQUFJLE1BQU0sZUFBZTtBQUM1RCxZQUFJLE9BQU8sU0FBUyxZQUFZLFlBQVksS0FBSyxZQUFZLFNBQVMsVUFBVSxHQUFHO0FBQ2pGLGdCQUFNLElBQUksTUFBTSx1QkFBdUI7QUFBQSxRQUN6QztBQUNBLFlBQUksS0FBSyxjQUFjLFNBQVMsYUFBYSxLQUFLLFVBQVUsS0FBSyxZQUFZLENBQUMsQ0FBQyxNQUFNLEtBQUssVUFBVSxTQUFTLFlBQVksQ0FBQyxDQUFDLEdBQUc7QUFDNUgsZ0JBQU0sSUFBSSxNQUFNLDBCQUEwQjtBQUFBLFFBQzVDO0FBQ0EsWUFBSSxHQUFHLFFBQVEsT0FBTyxNQUFNLElBQUk7QUFBQSxVQUM5QjtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQSxjQUFjLE9BQU8sa0JBQWtCLENBQUM7QUFBQSxVQUN4QyxRQUFRLEtBQUssVUFBVSxRQUFRLEtBQUssY0FBYyxTQUFTLFlBQVk7QUFBQSxRQUN6RSxDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0Y7QUFBQSxJQUVBLG1CQUFtQjtBQUFBLE1BQ2pCLENBQUMsS0FBSyxTQUFpQixNQUF5QixpQkFBeUIsWUFBb0IsWUFBb0IsZUFBdUI7QUFDdEksdUJBQWUsR0FBRztBQUNsQixjQUFNLE1BQU0sSUFBSSxHQUFHLFFBQVEsSUFBSSxPQUFPO0FBQ3RDLFlBQUksQ0FBQyxJQUFLLE9BQU0sSUFBSSxNQUFNLGlCQUFpQjtBQUMzQyxjQUFNLFFBQVEsYUFBYSxHQUFHO0FBQzlCLFlBQUksTUFBTSxXQUFXLFVBQVcsT0FBTSxJQUFJLE1BQU0scUJBQXFCO0FBQ3JFLGNBQU0sU0FBUyxNQUFNLFFBQVEsS0FBSyxDQUFDLFNBQVMsS0FBSyxXQUFXLElBQUksS0FBSyxNQUFNO0FBQzNFLFlBQUksQ0FBQyxPQUFRLE9BQU0sSUFBSSxNQUFNLDJCQUEyQjtBQUN4RCxZQUFJLE1BQU0saUJBQWlCLGdCQUFpQixPQUFNLElBQUksTUFBTSxzQkFBc0I7QUFDbEYsY0FBTSxXQUFXLFVBQXVCLE1BQU0sV0FBVyxDQUFDLENBQUM7QUFDM0QsY0FBTSxXQUFXLGFBQWEsYUFBYTtBQUMzQyxjQUFNLE9BQU8sVUFBdUIsVUFBVSxDQUFDLENBQUM7QUFDaEQsWUFBSSxPQUFPLFNBQVMsWUFBWSxZQUFZLEtBQUssWUFBWSxTQUFTLFVBQVUsR0FBRztBQUNqRixnQkFBTSxJQUFJLE1BQU0sdUJBQXVCO0FBQUEsUUFDekM7QUFDQSxZQUFJLFNBQVMsUUFBUTtBQUNuQixjQUFJLEtBQUssY0FBYyxVQUFVLEtBQUssVUFBVSxLQUFNLE9BQU0sSUFBSSxNQUFNLG9CQUFvQjtBQUFBLFFBQzVGLE9BQU87QUFDTCxnQkFBTSxTQUFTLFNBQVMsWUFBWSxDQUFDO0FBQ3JDLGdCQUFNLFFBQVEsS0FBSyxZQUFZLENBQUM7QUFDaEMsY0FBSSxPQUFPLFNBQVMsT0FBTyxJQUFJLEtBQUssQ0FBQyxNQUFNLFNBQVMsT0FBTyxJQUFJLEtBQUssTUFBTSxXQUFXLE9BQU8sU0FBUyxHQUFHO0FBQ3RHLGtCQUFNLElBQUksTUFBTSw4QkFBOEI7QUFBQSxVQUNoRDtBQUFBLFFBQ0Y7QUFDQSxjQUFNLFdBQVcsS0FBSyxVQUFVLFFBQVEsS0FBSyxjQUFjO0FBQzNELFlBQUksR0FBRyxRQUFRLE9BQU8sTUFBTSxJQUFJO0FBQUEsVUFDOUI7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0EsY0FBYyxPQUFPLGtCQUFrQixDQUFDO0FBQUEsVUFDeEMsUUFBUSxXQUFXLGFBQWE7QUFBQSxRQUNsQyxDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0Y7QUFBQSxJQUVBLFVBQVUsU0FBUyxDQUFDLEtBQUssU0FBaUI7QUFDeEMscUJBQWUsR0FBRztBQUNsQixZQUFNLFFBQVEsS0FBSyxLQUFLLEVBQUUsUUFBUSxRQUFRLEdBQUcsRUFBRSxNQUFNLEdBQUcsR0FBRztBQUMzRCxVQUFJLENBQUMsTUFBTztBQUNaLFlBQU0sUUFBUSxZQUFZLElBQUksR0FBRyxRQUFRLE1BQU0sR0FBRyxFQUFFLElBQUksR0FBWSxJQUFJLEtBQUssTUFBTTtBQUNuRixVQUFJLENBQUMsTUFBTyxPQUFNLElBQUksTUFBTSxvQkFBb0I7QUFDaEQsVUFBSSxHQUFHLGFBQWEsT0FBTztBQUFBLFFBQ3pCLFNBQVMsTUFBTTtBQUFBLFFBQ2YsVUFBVSxJQUFJLEtBQUs7QUFBQSxRQUNuQixZQUFZLElBQUksS0FBSztBQUFBLFFBQ3JCLE1BQU07QUFBQSxNQUNSLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxXQUFXO0FBQUEsSUFDVCxRQUFRLFNBQVMsRUFBRSxRQUFRLE9BQU8sTUFBTSxjQUFjLEdBQUcsTUFBTSxLQUFLLElBQUksQ0FBQztBQUFBLElBQ3pFLFVBQVU7QUFBQSxNQUFTLEVBQUUsUUFBUSxPQUFPLE1BQU0sNEJBQTRCO0FBQUEsTUFBRyxNQUN2RTtBQUFBLFFBQ0U7QUFBQSxVQUNFLElBQUk7QUFBQSxVQUNKLE1BQU07QUFBQSxVQUNOLFlBQVk7QUFBQSxVQUNaLGFBQWE7QUFBQSxVQUNiLFdBQVc7QUFBQSxVQUNYLE9BQU87QUFBQSxVQUNQLFNBQVM7QUFBQSxVQUNULGFBQWE7QUFBQSxVQUNiLGtCQUFrQjtBQUFBLFVBQ2xCLGFBQWE7QUFBQSxVQUNiLE9BQU87QUFBQSxZQUNMO0FBQUEsY0FDRSxLQUFLO0FBQUEsY0FDTCxPQUFPO0FBQUEsY0FDUCxNQUFNO0FBQUEsY0FDTixTQUFTO0FBQUEsWUFDWDtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsUUFDQTtBQUFBLFVBQ0UsU0FBUztBQUFBLFlBQ1AsZ0JBQWdCO0FBQUEsWUFDaEIsaUJBQWlCO0FBQUEsVUFDbkI7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUFTLEVBQUUsUUFBUSxPQUFPLE1BQU0sb0JBQW9CO0FBQUEsTUFBRyxNQUM5RCxLQUFLLFVBQVU7QUFBQSxRQUNiLFNBQVM7QUFBQSxVQUNQLGdCQUFnQjtBQUFBLFVBQ2hCLGlCQUFpQjtBQUFBLFFBQ25CO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUFBLElBQ0EsZUFBZTtBQUFBLE1BQVMsRUFBRSxRQUFRLE9BQU8sTUFBTSxhQUFhO0FBQUEsTUFBRyxNQUM3RCxLQUFLLGdCQUFnQjtBQUFBLFFBQ25CLFNBQVM7QUFBQSxVQUNQLGdCQUFnQjtBQUFBLFVBQ2hCLGlCQUFpQjtBQUFBLFVBQ2pCLDBCQUEwQjtBQUFBLFFBQzVCO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
