import { SignInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { GameConfig, GameState } from "../game/types";
import { createGame } from "../game/engine";
import { MENU_BACKGROUND_COLOR } from "../sprites";
import { Chip, MenuButton } from "../ui/controls";
import type { OnlineLobbyConfig, OnlineSnapshot } from "../../shared/online";
import { clearOnlineAuthReturn, markOnlineAuthReturn } from "../online-return";
import { GameScreen } from "./game";
import type { Screen } from "./model";

const EMPTY: OnlineSnapshot = { lobbies: [], lobby: null, messages: [] };

export function OnlineScreen({ onBack }: { onBack: () => void }) {
  const auth = useAuth();
  const snapshot = useQuery<OnlineSnapshot>("online") ?? EMPTY;
  const createLobby = useMutation<[config: OnlineLobbyConfig], string>("createLobby");
  const joinLobby = useMutation<[lobbyId: string], void>("joinLobby");
  const leaveLobby = useMutation<[], void>("leaveLobby");
  const startLobby = useMutation<[lobbyId: string, stateJson0: string, stateJson1: string, stateJson2: string], void>("startLobby");
  const publishState = useMutation<
    [lobbyId: string, actor: number, previousVersion: number, stateJson0: string, stateJson1: string, stateJson2: string],
    void
  >("publishOnlineState");
  const sendChat = useMutation<[body: string], void>("sendChat");
  const [error, setError] = useState("");
  const [setup, setSetup] = useState<OnlineLobbyConfig>({
    mode: "players",
    humanSlots: 2,
    botCount: 1,
    mapSize: "medium",
    difficulty: "normal",
    gameMode: "antiyoy",
    fogOfWar: false,
    seed: Date.now() % 2 ** 31,
  });

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Online request failed");
    }
  }, []);

  useEffect(() => {
    if (!auth.isLoading && !auth.isGuest) clearOnlineAuthReturn();
  }, [auth.isLoading, auth.isGuest]);

  if (auth.isLoading) return <OnlineShell><p className="text-center font-bold text-[#2e2e28]">Checking session...</p></OnlineShell>;

  if (auth.isGuest) {
    return (
      <OnlineShell>
        <h1 className="text-center text-4xl font-black text-[#f0eee3]">Online</h1>
        <div className="rounded-3xl bg-[#b3ae7e] p-5 text-center text-[#2e2e28] shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <p className="mb-4 font-semibold">Sign in to join persistent lobbies and play with other people.</p>
          <SignInWithGoogle
            returnTo="/?screen=online"
            onClick={() => markOnlineAuthReturn()}
            className="min-h-[52px] rounded-2xl bg-[#f0eee3] px-6 text-lg font-bold shadow"
          />
        </div>
        <MenuButton onClick={onBack}>Back</MenuButton>
      </OnlineShell>
    );
  }

  const lobby = snapshot.lobby;
  if (lobby?.status === "playing" || lobby?.status === "finished") {
    return (
      <OnlineGame
        snapshot={snapshot}
        userId={auth.userId}
        publishState={publishState}
        sendChat={sendChat}
        onMenu={() => {
          if (lobby.status === "finished") void run(async () => {
            await leaveLobby();
            onBack();
          });
          else onBack();
        }}
      />
    );
  }

  if (lobby) {
    const isHost = lobby.ownerId === auth.userId;
    const full = lobby.players.length === lobby.config.humanSlots;
    return (
      <OnlineShell wide>
        <Header name={auth.displayName} picture={auth.picture} />
        <section className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="rounded-3xl bg-[#b3ae7e] p-5 text-[#2e2e28] shadow-[0_4px_0_rgba(0,0,0,0.2)]">
            <h2 className="text-2xl font-black">Waiting lobby</h2>
            <p className="mt-1 text-sm opacity-70">
              {lobby.config.mode === "players" ? "Players only" : `Players + ${lobby.config.botCount} bot${lobby.config.botCount === 1 ? "" : "s"}`}
              {` · ${lobby.config.mapSize} map`}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {Array.from({ length: lobby.config.humanSlots }, (_, seat) => {
                const player = lobby.players.find((item) => item.seat === seat);
                return (
                  <div key={seat} className="flex min-h-[48px] items-center gap-3 rounded-xl bg-[#e2dfc8] px-3 font-bold">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3a3a33] text-xs text-[#f0eee3]">{seat + 1}</span>
                    {player ? player.name : "Waiting for player..."}
                  </div>
                );
              })}
              {Array.from({ length: lobby.config.botCount }, (_, index) => (
                <div key={`bot-${index}`} className="min-h-[48px] rounded-xl bg-[#a49f70] px-3 py-3 font-bold opacity-80">
                  Bot {index + 1} · {lobby.config.difficulty}
                </div>
              ))}
            </div>
            {error && <p className="mt-3 text-sm font-bold text-[#8c241f]">{error}</p>}
            <div className="mt-4 flex flex-col gap-2">
              {isHost && (
                <MenuButton
                  onClick={() => void run(async () => {
                    const state = createGame(toGameConfig(lobby.config));
                    const chunks = splitState(state);
                    await startLobby(lobby.id, chunks[0], chunks[1], chunks[2]);
                  })}
                  className={!full ? "opacity-50" : ""}
                >
                  {full ? "Start game" : `Waiting ${lobby.players.length}/${lobby.config.humanSlots}`}
                </MenuButton>
              )}
              <MenuButton onClick={() => void run(() => leaveLobby())}>{isHost ? "Close lobby" : "Leave lobby"}</MenuButton>
            </div>
          </div>
          <Chat messages={snapshot.messages} sendChat={sendChat} run={run} />
        </section>
      </OnlineShell>
    );
  }

  return (
    <OnlineShell wide>
      <Header name={auth.displayName} picture={auth.picture} />
      <section className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div className="rounded-3xl bg-[#b3ae7e] p-5 text-[#2e2e28] shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <h2 className="text-2xl font-black">Create lobby</h2>
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Chip selected={setup.mode === "players"} onClick={() => setSetup({ ...setup, mode: "players", botCount: 0 })}>Players only</Chip>
              <Chip selected={setup.mode === "mixed"} onClick={() => setSetup({ ...setup, mode: "mixed", botCount: Math.max(1, setup.botCount) })}>Players + bots</Chip>
            </div>
            <Range label={`Online players: ${setup.humanSlots}`} min={2} max={setup.mode === "mixed" ? 5 : 6} value={setup.humanSlots} onChange={(humanSlots) => setSetup({ ...setup, humanSlots, botCount: Math.min(setup.botCount, 6 - humanSlots) })} />
            {setup.mode === "mixed" && <Range label={`Bots: ${setup.botCount}`} min={1} max={6 - setup.humanSlots} value={setup.botCount} onChange={(botCount) => setSetup({ ...setup, botCount })} />}
            <label className="font-bold">Map size
              <select value={setup.mapSize} onChange={(event) => setSetup({ ...setup, mapSize: event.currentTarget.value as OnlineLobbyConfig["mapSize"] })} className="mt-2 min-h-[44px] w-full rounded-xl bg-[#e2dfc8] px-3">
                <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="huge">Huge</option>
              </select>
            </label>
            <MenuButton onClick={() => void run(() => createLobby({ ...setup, seed: Date.now() % 2 ** 31 }))}>Create lobby</MenuButton>
          </div>
          {error && <p className="mt-3 text-sm font-bold text-[#8c241f]">{error}</p>}
        </div>
        <div className="rounded-3xl bg-[#b3ae7e] p-5 text-[#2e2e28] shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <h2 className="text-2xl font-black">Open lobbies</h2>
          <div className="mt-4 flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
            {snapshot.lobbies.length === 0 && <p className="rounded-xl bg-[#e2dfc8] p-4 text-sm font-semibold opacity-70">No waiting lobbies yet.</p>}
            {snapshot.lobbies.map((item) => (
              <button key={item.id} type="button" onClick={() => void run(() => joinLobby(item.id))} className="rounded-xl bg-[#f0eee3] p-3 text-left shadow hover:brightness-95">
                <span className="block font-black">{item.ownerName}'s game</span>
                <span className="text-xs opacity-70">{item.joined}/{item.humanSlots} players · {item.mode === "mixed" ? `${item.botCount} bots` : "players only"} · {item.mapSize}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
      <MenuButton onClick={onBack}>Back</MenuButton>
    </OnlineShell>
  );
}

function OnlineGame({ snapshot, userId, publishState, sendChat, onMenu }: {
  snapshot: OnlineSnapshot;
  userId: string;
  publishState: (lobbyId: string, actor: number, previousVersion: number, stateJson0: string, stateJson1: string, stateJson2: string) => Promise<void>;
  sendChat: (body: string) => Promise<void>;
  onMenu: () => void;
}) {
  const lobby = snapshot.lobby!;
  const seat = lobby.players.find((player) => player.userId === userId)?.seat ?? -1;
  const stateRef = useRef<GameState>(JSON.parse(lobby.stateJson) as GameState);
  const configRef = useRef<GameConfig>(stateRef.current.config);
  const serverVersionRef = useRef(lobby.stateVersion);
  const pendingRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const [, render] = useState(0);
  const forceRender = useCallback(() => render((value) => value + 1), []);
  const [screen, setScreen] = useState<Screen>({ kind: "game" });
  const onlineStateRevisionRef = useRef(0);

  useEffect(() => {
    if (lobby.stateVersion <= serverVersionRef.current || pendingRef.current > 0) return;
    stateRef.current = JSON.parse(lobby.stateJson) as GameState;
    configRef.current = stateRef.current.config;
    serverVersionRef.current = lobby.stateVersion;
    onlineStateRevisionRef.current++;
    forceRender();
  }, [lobby.stateJson, lobby.stateVersion, forceRender]);

  const onAction = useCallback((actor: number, state: GameState) => {
    const chunks = splitState(state);
    const previousVersion = serverVersionRef.current + pendingRef.current;
    pendingRef.current++;
    queueRef.current = queueRef.current
      .then(() => publishState(lobby.id, actor, previousVersion, chunks[0], chunks[1], chunks[2]))
      .then(() => {
        serverVersionRef.current++;
        pendingRef.current--;
      })
      .catch(() => {
        pendingRef.current = 0;
      });
  }, [lobby.id, publishState]);

  return (
    <GameScreen
      screen={screen}
      setScreen={setScreen}
      stateRef={stateRef}
      configRef={configRef}
      forceRender={forceRender}
      onMenu={onMenu}
      onRestart={() => {}}
      onPlayAgain={() => {}}
      online={{
        seat,
        isHost: lobby.ownerId === userId,
        humanSlots: lobby.config.humanSlots,
        players: lobby.players.map((player) => player.name),
        messages: snapshot.messages,
        sendChat,
        onAction,
        stateRevision: onlineStateRevisionRef.current,
      }}
    />
  );
}

function Chat({ messages, sendChat, run }: { messages: OnlineSnapshot["messages"]; sendChat: (body: string) => Promise<void>; run: (operation: () => Promise<unknown>) => Promise<void> }) {
  return (
    <div className="flex min-h-[360px] flex-col rounded-3xl bg-[#b3ae7e] p-5 text-[#2e2e28] shadow-[0_4px_0_rgba(0,0,0,0.2)]">
      <h2 className="text-2xl font-black">Lobby chat</h2>
      <div className="my-3 flex-1 space-y-2 overflow-y-auto rounded-xl bg-[#e2dfc8] p-3">
        {messages.length === 0 && <p className="text-sm opacity-60">No messages yet.</p>}
        {messages.map((message) => <p key={message.id} className="text-sm"><strong>{message.authorName}:</strong> {message.body}</p>)}
      </div>
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const input = form.elements.namedItem("message") as HTMLInputElement;
        const body = input.value;
        input.value = "";
        void run(() => sendChat(body));
      }}>
        <input name="message" maxLength={300} placeholder="Message" className="min-h-[44px] min-w-0 flex-1 rounded-xl bg-[#f0eee3] px-3 outline-none" />
        <button type="submit" className="rounded-xl bg-[#3a3a33] px-4 font-bold text-[#f0eee3]">Send</button>
      </form>
    </div>
  );
}

function Header({ name, picture }: { name: string; picture?: string }) {
  return <header className="flex items-center justify-between gap-3"><h1 className="text-4xl font-black text-[#f0eee3]">Online</h1><button type="button" onClick={() => signOut()} className="flex items-center gap-2 rounded-full bg-[#f0eee3] px-3 py-2 text-sm font-bold text-[#3a3a33]">{picture && <img src={picture} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" />}{name} · Sign out</button></header>;
}

function OnlineShell({ children, wide = false }: { children: ComponentChildren; wide?: boolean }) {
  return <main className="min-h-screen w-full p-5" style={{ background: MENU_BACKGROUND_COLOR }}><div className={`mx-auto flex w-full ${wide ? "max-w-4xl" : "max-w-md"} flex-col gap-5 py-4`}>{children}</div></main>;
}

function Range({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (value: number) => void }) {
  return <label className="font-bold">{label}<input type="range" min={min} max={max} value={value} onInput={(event) => onChange(Number(event.currentTarget.value))} className="mt-2 w-full accent-[#3a3a33]" /></label>;
}

function toGameConfig(config: OnlineLobbyConfig): GameConfig {
  return {
    mapSize: config.mapSize,
    playerCount: config.humanSlots + config.botCount,
    humanCount: config.humanSlots,
    seed: config.seed,
    difficulty: config.difficulty,
    mode: config.gameMode,
    treePercentage: 10,
    startingProvinces: 0,
    colorOffset: 0,
    fogOfWar: config.fogOfWar,
  };
}

function splitState(state: GameState): [string, string, string] {
  const json = JSON.stringify(state);
  const size = 60_000;
  if (json.length > size * 3) throw new Error("Game state is too large to synchronize");
  return [json.slice(0, size), json.slice(size, size * 2), json.slice(size * 2)];
}
