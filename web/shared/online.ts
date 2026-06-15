export type OnlineMode = "players" | "mixed";

export interface OnlinePlayer {
  userId: string;
  name: string;
  picture?: string;
  seat: number;
}

export interface OnlineLobbyConfig {
  mode: OnlineMode;
  humanSlots: number;
  botCount: number;
  mapSize: "small" | "medium" | "large" | "huge";
  difficulty: "easy" | "normal" | "hard";
  gameMode: "antiyoy" | "slay";
  fogOfWar: boolean;
  seed: number;
}

export interface OnlineLobby {
  id: string;
  ownerId: string;
  ownerName: string;
  status: "waiting" | "playing" | "finished";
  config: OnlineLobbyConfig;
  players: OnlinePlayer[];
  stateJson: string;
  stateVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineLobbySummary {
  id: string;
  ownerName: string;
  mode: OnlineMode;
  joined: number;
  humanSlots: number;
  botCount: number;
  mapSize: OnlineLobbyConfig["mapSize"];
  createdAt: string;
}

export interface OnlineChatMessage {
  id: string;
  lobbyId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface OnlineSnapshot {
  lobbies: OnlineLobbySummary[];
  lobby: OnlineLobby | null;
  messages: OnlineChatMessage[];
}
