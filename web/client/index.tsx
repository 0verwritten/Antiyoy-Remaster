// Antiyoy Remaster — client UI entry. Fully client-side gameplay; no Lakebed
// queries/mutations needed. The app shell routes between screen modules in
// client/screens/.

import { useCallback, useRef, useState } from "preact/hooks";
import { createGame } from "./game/engine";
import type { GameConfig, GameState } from "./game/types";
import type { Screen } from "./screens/model";
import { MainMenuScreen } from "./screens/main";
import { SkirmishScreen } from "./screens/skirmish";
import { SettingsScreen } from "./screens/settings";
import { AboutScreen } from "./screens/about";
import { GameScreen } from "./screens/game";

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

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "main" });
  const stateRef = useRef<GameState | null>(null);
  const configRef = useRef<GameConfig | null>(null);
  // Bumped per started game so GameScreen remounts even when the config and
  // seed are identical (Restart).
  const gameIdRef = useRef(0);
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump((n) => n + 1), []);

  const startGame = useCallback(
    (config: GameConfig) => {
      configRef.current = config;
      stateRef.current = createGame(config);
      gameIdRef.current++;
      setScreen({ kind: "game" });
      forceRender();
    },
    [forceRender]
  );

  const resumeGame = useCallback(() => {
    const st = stateRef.current;
    if (!st || st.winner !== null) return;
    // Hotseat: never show a player's board before the pass screen.
    if (st.config.humanCount >= 2 && st.turn < st.config.humanCount) {
      setScreen({ kind: "pass", fraction: st.turn });
    } else {
      setScreen({ kind: "game" });
    }
  }, []);

  switch (screen.kind) {
    case "main":
      return (
        <MainMenuScreen
          canResume={stateRef.current !== null && stateRef.current.winner === null}
          onPlay={() => setScreen({ kind: "skirmish" })}
          onResume={resumeGame}
          onSettings={() => setScreen({ kind: "settings" })}
          onAbout={() => setScreen({ kind: "about" })}
        />
      );
    case "skirmish":
      return (
        <SkirmishScreen
          onPlay={startGame}
          onBack={() => setScreen({ kind: "main" })}
          initial={configRef.current}
        />
      );
    case "settings":
      return <SettingsScreen onBack={() => setScreen({ kind: "main" })} />;
    case "about":
      return <AboutScreen onBack={() => setScreen({ kind: "main" })} />;
    default:
      return (
        <GameScreen
          key={gameIdRef.current}
          screen={screen}
          setScreen={setScreen}
          stateRef={stateRef}
          configRef={configRef}
          forceRender={forceRender}
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
