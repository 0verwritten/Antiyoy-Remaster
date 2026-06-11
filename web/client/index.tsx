// Antiyoy Remaster — client UI entry. Fully client-side gameplay; no Lakebed
// queries/mutations needed. The app shell routes between screen modules in
// client/screens/.

import { useCallback, useRef, useState } from "preact/hooks";
import { createGame } from "./game/engine";
import type { GameConfig, GameState } from "./game/types";
import type { Screen } from "./screens/model";
import { StartScreen } from "./screens/start";
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
  const [screen, setScreen] = useState<Screen>({ kind: "start" });
  const stateRef = useRef<GameState | null>(null);
  const configRef = useRef<GameConfig | null>(null);
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump((n) => n + 1), []);

  const startGame = useCallback(
    (config: GameConfig) => {
      configRef.current = config;
      stateRef.current = createGame(config);
      setScreen({ kind: "game" });
      forceRender();
    },
    [forceRender]
  );

  if (screen.kind === "start") {
    return (
      <StartScreen
        onPlay={startGame}
        initial={configRef.current}
      />
    );
  }

  return (
    <GameScreen
      key={configRef.current?.seed}
      screen={screen}
      setScreen={setScreen}
      stateRef={stateRef}
      configRef={configRef}
      forceRender={forceRender}
      onMenu={() => setScreen({ kind: "start" })}
      onPlayAgain={() => {
        const cfg = configRef.current;
        if (cfg) startGame({ ...cfg, seed: Date.now() % 2 ** 31 });
      }}
    />
  );
}
