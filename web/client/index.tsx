// Antiyoy Remaster — client UI entry. Fully client-side gameplay; no Lakebed
// queries/mutations needed. The app shell routes between screen modules in
// client/screens/.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createGame, isGameOver } from "./game/engine";
import type { GameConfig, GameState, ReplayStep } from "./game/types";
import { settings } from "./settings";
import { latestSave, type SaveRecord } from "./game-storage";
import type { Screen } from "./screens/model";
import { MainMenuScreen } from "./screens/main";
import { ChooseModeScreen } from "./screens/choose-mode";
import { SkirmishScreen } from "./screens/skirmish";
import { CampaignScreen } from "./screens/campaign";
import { SettingsScreen } from "./screens/settings";
import { AboutScreen } from "./screens/about";
import { LoadScreen } from "./screens/load";
import { ReplaysScreen } from "./screens/replays";
import { OnlineScreen } from "./screens/online";
import { GameScreen } from "./screens/game";
import { createCampaignLevelGame, ensureCampaignData, evaluateCampaign, levelNeedsData } from "./game/campaign";
import { setupPwa } from "./pwa";
import { clearOnlineDeepLink, shouldReturnToOnline } from "./online-return";

if (typeof window !== "undefined") setupPwa();

// Canonical domain: the capsule answers on several lakebed subdomains, but the
// game lives at antiyoy.lakebed.app only.
if (
  typeof location !== "undefined" &&
  location.hostname.endsWith(".lakebed.app") &&
  location.hostname !== "antiyoy.lakebed.app"
) {
  location.replace("https://antiyoy.lakebed.app" + location.pathname + location.search);
}

// Inline favicon (green hex): avoids the 404 for /favicon.ico — the capsule
// cannot serve static files.
if (typeof document !== "undefined" && !document.querySelector("link[rel='icon']")) {
  const link = document.createElement("link");
  link.rel = "icon";
  link.href =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<polygon points="50,3 93,26 93,74 50,97 7,74 7,26" fill="#60b55c" stroke="#3a3a33" stroke-width="6"/></svg>'
    );
  document.head.appendChild(link);
}

function isResumableState(state: GameState | null): state is GameState {
  if (!state || isGameOver(state)) return false;
  if (state.session?.source === "campaign") return evaluateCampaign(state) === "ongoing";
  return true;
}

export function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    return shouldReturnToOnline() ? { kind: "online" } : { kind: "main" };
  });
  const stateRef = useRef<GameState | null>(null);
  const configRef = useRef<GameConfig | null>(null);
  // Replay history restored from a loaded save (null for fresh games).
  const loadedReplayRef = useRef<{ initial: GameState; steps: ReplayStep[] } | null>(null);
  // Bumped per started game so GameScreen remounts even when the config and
  // seed are identical (Restart).
  const gameIdRef = useRef(0);
  const [hasSavedGame, setHasSavedGame] = useState(false);
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump((n) => n + 1), []);

  // The Resume button also covers the latest save when nothing is running.
  useEffect(() => {
    if (screen.kind === "main") {
      latestSave().then((r) => setHasSavedGame(!!r), () => setHasSavedGame(false));
    }
  }, [screen.kind]);

  const startGame = useCallback(
    (config: GameConfig) => {
      configRef.current = config;
      stateRef.current = createGame(config);
      loadedReplayRef.current = null;
      gameIdRef.current++;
      setScreen({ kind: "game" });
      forceRender();
    },
    [forceRender]
  );

  const startCampaignLevel = useCallback(
    (level: number) => {
      const launch = () => {
        const state = createCampaignLevelGame(level);
        configRef.current = state.config;
        stateRef.current = state;
        loadedReplayRef.current = null;
        gameIdRef.current++;
        setScreen({ kind: "game" });
        forceRender();
      };
      // Fixed levels need the hosted data; wait for it (then build the exact
      // map), but never block forever — fall back to a generated map on error.
      if (levelNeedsData(level)) {
        ensureCampaignData().then(launch, launch);
      } else {
        launch();
      }
    },
    [forceRender]
  );

  const enterGameScreen = useCallback((state: GameState) => {
    // Hotseat: never show a player's board before the pass screen.
    if (state.config.humanCount >= 2 && state.turn < state.config.humanCount) {
      setScreen({ kind: "pass", fraction: state.turn });
    } else {
      setScreen({ kind: "game" });
    }
  }, []);

  const loadSavedGame = useCallback(
    (record: SaveRecord) => {
      configRef.current = structuredClone(record.config);
      stateRef.current = structuredClone(record.state);
      loadedReplayRef.current = {
        initial: structuredClone(record.replayInitial),
        steps: structuredClone(record.replaySteps),
      };
      gameIdRef.current++;
      enterGameScreen(stateRef.current);
      forceRender();
    },
    [enterGameScreen, forceRender]
  );

  const resumeGame = useCallback(() => {
    const st = stateRef.current;
    if (isResumableState(st)) {
      enterGameScreen(st);
      return;
    }
    latestSave().then((record) => {
      if (record) loadSavedGame(record);
    });
  }, [enterGameScreen, loadSavedGame]);

  switch (screen.kind) {
    case "main":
      return (
        <MainMenuScreen
          canResume={
            settings.showResumeButton &&
            (isResumableState(stateRef.current) || hasSavedGame)
          }
          onPlay={() => setScreen({ kind: "chooseMode" })}
          onResume={resumeGame}
          onLoad={() => setScreen({ kind: "load" })}
          onReplays={() => setScreen({ kind: "replays" })}
          onSettings={() => setScreen({ kind: "settings" })}
          onAbout={() => setScreen({ kind: "about" })}
        />
      );
    case "chooseMode":
      return (
        <ChooseModeScreen
          onSkirmish={() => setScreen({ kind: "skirmish" })}
          onCampaign={() => setScreen({ kind: "campaign" })}
          onOnline={() => setScreen({ kind: "online" })}
          onBack={() => setScreen({ kind: "main" })}
        />
      );
    case "skirmish":
      return (
        <SkirmishScreen
          onPlay={startGame}
          onBack={() => setScreen({ kind: "chooseMode" })}
        />
      );
    case "campaign":
      return (
        <CampaignScreen
          onBack={() => setScreen({ kind: "chooseMode" })}
          onPlayLevel={startCampaignLevel}
        />
      );
    case "online":
      return <OnlineScreen onBack={() => {
        clearOnlineDeepLink();
        setScreen({ kind: "chooseMode" });
      }} />;
    case "settings":
      return <SettingsScreen onBack={() => setScreen({ kind: "main" })} />;
    case "about":
      return <AboutScreen onBack={() => setScreen({ kind: "main" })} />;
    case "load":
      return <LoadScreen onBack={() => setScreen({ kind: "main" })} onLoad={loadSavedGame} />;
    case "replays":
      return <ReplaysScreen onBack={() => setScreen({ kind: "main" })} />;
    default:
      return (
        <GameScreen
          key={gameIdRef.current}
          screen={screen}
          setScreen={setScreen}
          stateRef={stateRef}
          configRef={configRef}
          forceRender={forceRender}
          initialReplay={loadedReplayRef.current}
          onCampaignCompleted={() => setHasSavedGame(false)}
          onCampaignExit={() => setScreen({ kind: "campaign" })}
          onCampaignPlayLevel={startCampaignLevel}
          onMenu={() => setScreen({ kind: "main" })}
          onRestart={() => {
            const cfg = configRef.current;
            if (cfg) startGame({ ...cfg });
          }}
          onPlayAgain={() => {
            const cfg = configRef.current;
            if (cfg) startGame({ ...cfg, seed: Date.now() % 2 ** 31 });
          }}
        />
      );
  }
}
