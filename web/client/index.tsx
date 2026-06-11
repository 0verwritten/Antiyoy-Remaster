// Antiyoy Remaster — client UI entry. Fully client-side gameplay; no Lakebed
// queries/mutations needed. Canvas board with pan/zoom and an original-style HUD.

import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { NEUTRAL_FRACTION, PRICE_STRONG_TOWER, PRICE_TOWER } from "./game/constants";
import {
  applyAction,
  createGame,
  getBuildZone,
  getBuyZone,
  getFarmPrice,
  getMoveZone,
  getProvinceByHex,
  getProvinceProfit,
  getUnitPrice,
  isHumanTurn,
} from "./game/engine";
import { aiTakeTurn } from "./game/ai";
import type { Difficulty, GameConfig, GameState, MapSize, Province } from "./game/types";
import {
  fitToIsland,
  HEX_SIZE,
  makeCamera,
  screenToWorld,
  zoomAt,
  type Camera,
} from "./camera";
import { pixelToHex, type Point } from "./hex";
import { renderBoard, type RenderState } from "./render";
import {
  ATLAS_URL,
  ICON_COIN_URL,
  ICON_ENDTURN_URL,
  ICON_UNDO_URL,
  MENU_BACKGROUND_COLOR,
  ORIGINAL_FRACTION_COLORS,
  SPRITES,
} from "./sprites";

const ATLAS_W = 1024;
const ATLAS_H = 604;

// Canonical domain: the capsule answers on several lakebed subdomains, but the
// game lives at antiyoy.lakebed.app only.
if (
  typeof location !== "undefined" &&
  location.hostname.endsWith(".lakebed.app") &&
  location.hostname !== "antiyoy.lakebed.app"
) {
  location.replace("https://antiyoy.lakebed.app" + location.pathname + location.search);
}

// ---------------------------------------------------------------------------
// Placement / selection model
// ---------------------------------------------------------------------------

type Pending =
  | { kind: "none" }
  | { kind: "unit"; from: number } // a unit is selected, show its move zone
  | { kind: "buy"; provinceId: number; strength: number }
  | { kind: "build"; provinceId: number; buildKind: "farm" | "tower" | "strongTower" };

type Screen =
  | { kind: "start" }
  | { kind: "game" }
  | { kind: "pass"; fraction: number }; // hotseat interstitial

// ---------------------------------------------------------------------------
// Original-look building blocks
// ---------------------------------------------------------------------------

/** A sprite from the original field-element atlas, rendered via CSS. */
function Sprite({ name, size }: { name: string; size: number }) {
  const r = SPRITES[name];
  if (!r) return null;
  const scale = size / r.w;
  return (
    <span
      aria-hidden="true"
      className="inline-block"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${ATLAS_URL})`,
        backgroundSize: `${ATLAS_W * scale}px ${ATLAS_H * scale}px`,
        backgroundPosition: `-${r.x * scale}px -${r.y * scale}px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "auto",
      }}
    />
  );
}

/** Big cream rounded button like the original menus. */
function MenuButton({
  children,
  onClick,
  className = "",
}: {
  children: ComponentChildren;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[56px] rounded-2xl bg-[#f0eee3] px-6 text-lg font-bold text-[#3a3a33] shadow-[0_3px_0_rgba(0,0,0,0.25)] transition active:translate-y-[2px] active:shadow-none ${className}`}
    >
      {children}
    </button>
  );
}

/** Small option chip in the original cream/olive style. */
function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[44px] min-w-[44px] rounded-xl px-3 text-sm font-bold capitalize transition shadow-[0_2px_0_rgba(0,0,0,0.2)] active:translate-y-[1px] active:shadow-none ${
        selected ? "bg-[#3a3a33] text-[#f0eee3]" : "bg-[#f0eee3] text-[#3a3a33]"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

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
    return <StartScreen onPlay={startGame} initial={configRef.current} />;
  }

  return (
    <GameScreen
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

// ---------------------------------------------------------------------------
// Start screen (original olive menu look)
// ---------------------------------------------------------------------------

function StartScreen({
  onPlay,
  initial,
}: {
  onPlay: (config: GameConfig) => void;
  initial: GameConfig | null;
}) {
  const [mapSize, setMapSize] = useState<MapSize>(initial?.mapSize ?? "medium");
  const [playerCount, setPlayerCount] = useState(initial?.playerCount ?? 2);
  const [humanCount, setHumanCount] = useState(initial?.humanCount ?? 1);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? "normal");

  const clampedHumans = Math.min(humanCount, playerCount);

  function play() {
    onPlay({
      mapSize,
      playerCount,
      humanCount: clampedHumans,
      seed: Date.now() % 2 ** 31,
      difficulty,
    });
  }

  const labelCls = "mb-2 block text-sm font-bold text-[#2e2e28]";

  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-md flex flex-col gap-6">
        <header className="text-center">
          <h1 className="text-5xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Antiyoy
          </h1>
          <p className="mt-1 text-xs font-semibold text-[#2e2e28]/70">
            Web remaster of Antiyoy by yiotro
          </p>
        </header>

        <section className="flex flex-col gap-5 rounded-3xl bg-[#b3ae7e] p-5 shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <div>
            <label className={labelCls}>Map size</label>
            <div className="grid grid-cols-3 gap-2">
              {(["small", "medium", "large"] as MapSize[]).map((m) => (
                <Chip key={m} selected={mapSize === m} onClick={() => setMapSize(m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Players: {playerCount}</label>
            <div className="grid grid-cols-5 gap-2">
              {[2, 3, 4, 5, 6].map((n) => (
                <Chip
                  key={n}
                  selected={playerCount === n}
                  onClick={() => {
                    setPlayerCount(n);
                    if (humanCount > n) setHumanCount(n);
                  }}
                >
                  {n}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Humans: {clampedHumans}{" "}
              <span className="font-normal opacity-60">
                {clampedHumans === 1 ? "(vs AI)" : "(pass & play)"}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: playerCount }, (_, i) => i + 1).map((n) => (
                <Chip key={n} selected={clampedHumans === n} onClick={() => setHumanCount(n)}>
                  {n}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Difficulty</label>
            <div className="grid grid-cols-3 gap-2">
              {(["easy", "normal", "hard"] as Difficulty[]).map((d) => (
                <Chip key={d} selected={difficulty === d} onClick={() => setDifficulty(d)}>
                  {d}
                </Chip>
              ))}
            </div>
          </div>

          <MenuButton onClick={play} className="mt-1 text-xl">
            Play
          </MenuButton>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Game screen
// ---------------------------------------------------------------------------

interface GameScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  stateRef: { current: GameState | null };
  configRef: { current: GameConfig | null };
  forceRender: () => void;
  onMenu: () => void;
  onPlayAgain: () => void;
}

const UNDO_STACK_LIMIT = 50;

function GameScreen(props: GameScreenProps) {
  const { stateRef, forceRender, setScreen, screen } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<Camera>(makeCamera());
  const pendingRef = useRef<Pending>({ kind: "none" });
  const selectedHexRef = useRef<number>(-1);
  const highlightProvinceRef = useRef<number>(-1);
  const aiThinkingRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(true);
  const undoRef = useRef<GameState[]>([]);

  const [, setUi] = useState(0);
  const refreshUi = useCallback(() => setUi((n) => n + 1), []);

  const state = stateRef.current!;

  // --- camera fit on first mount ---
  const fittedRef = useRef(false);

  // --- rAF render loop ---
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const st = stateRef.current;
      if (!canvas || !st) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const wantW = Math.round(cssW * dpr);
      const wantH = Math.round(cssH * dpr);
      if (canvas.width !== wantW || canvas.height !== wantH) {
        canvas.width = wantW;
        canvas.height = wantH;
        dirtyRef.current = true;
      }
      if (!fittedRef.current && cssW > 0 && cssH > 0) {
        camRef.current = fitToIsland(st, cssW, cssH, HEX_SIZE);
        fittedRef.current = true;
        dirtyRef.current = true;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const pending = pendingRef.current;
      const rs: RenderState = buildRenderState(st, pending, selectedHexRef.current, highlightProvinceRef.current);
      // Always redraw (animations + simplicity).
      renderBoard(ctx, st, camRef.current, rs, cssW, cssH);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [stateRef]);

  // --- resize handling: just mark dirty (loop re-measures) ---
  useEffect(() => {
    const onResize = () => {
      dirtyRef.current = true;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ---- helpers ----
  const clearSelection = useCallback(() => {
    pendingRef.current = { kind: "none" };
    selectedHexRef.current = -1;
    highlightProvinceRef.current = -1;
    refreshUi();
  }, [refreshUi]);

  /** Snapshot the state so the move can be undone (current turn only). */
  const pushUndo = useCallback(() => {
    const st = stateRef.current;
    if (!st) return;
    undoRef.current.push(structuredClone(st));
    if (undoRef.current.length > UNDO_STACK_LIMIT) undoRef.current.shift();
  }, [stateRef]);

  const doUndo = useCallback(() => {
    const st = stateRef.current;
    if (!st || aiThinkingRef.current || st.winner !== null || !isHumanTurn(st)) return;
    const prev = undoRef.current.pop();
    if (!prev) return;
    stateRef.current = prev;
    pendingRef.current = { kind: "none" };
    selectedHexRef.current = -1;
    highlightProvinceRef.current = -1;
    forceRender();
    refreshUi();
  }, [stateRef, forceRender, refreshUi]);

  const runAiIfNeeded = useCallback(() => {
    const st = stateRef.current;
    if (!st) return;
    if (st.winner !== null) {
      forceRender();
      refreshUi();
      return;
    }
    if (isHumanTurn(st)) {
      // Human's turn. If hotseat (humanCount>=2) show pass screen.
      if (st.config.humanCount >= 2) {
        setScreen({ kind: "pass", fraction: st.turn });
      }
      refreshUi();
      return;
    }
    // AI turn(s): chain with delays so progress is visible.
    aiThinkingRef.current = true;
    refreshUi();
    const step = () => {
      const s = stateRef.current;
      if (!s) return;
      if (s.winner !== null || isHumanTurn(s)) {
        aiThinkingRef.current = false;
        if (s.winner === null && s.config.humanCount >= 2 && isHumanTurn(s)) {
          setScreen({ kind: "pass", fraction: s.turn });
        }
        forceRender();
        refreshUi();
        return;
      }
      aiTakeTurn(s);
      forceRender();
      refreshUi();
      setTimeout(step, 400);
    };
    setTimeout(step, 400);
  }, [stateRef, forceRender, refreshUi, setScreen]);

  const doEndTurn = useCallback(() => {
    const st = stateRef.current;
    if (!st || aiThinkingRef.current || st.winner !== null) return;
    if (!isHumanTurn(st)) return;
    clearSelection();
    undoRef.current = []; // turns are final once ended
    applyAction(st, { type: "endTurn" });
    forceRender();
    runAiIfNeeded();
  }, [stateRef, clearSelection, forceRender, runAiIfNeeded]);

  // ---- pointer interaction (pan/zoom/tap) ----
  usePointerControls(canvasRef, camRef, () => {
    dirtyRef.current = true;
  }, (screenPt) => onTap(screenPt), () => aiThinkingRef.current || screen.kind !== "game");

  function onTap(screenPt: Point) {
    const st = stateRef.current;
    if (!st || aiThinkingRef.current || st.winner !== null) return;
    if (!isHumanTurn(st)) return;
    const world = screenToWorld(camRef.current, screenPt);
    const idx = pixelToHex(st, world, HEX_SIZE);
    if (idx < 0) {
      clearSelection();
      return;
    }
    handleHexTap(st, idx);
  }

  function handleHexTap(st: GameState, idx: number) {
    const hex = st.hexes[idx];
    const pending = pendingRef.current;
    const me = st.turn;

    // Placement modes -------------------------------------------------------
    if (pending.kind === "buy") {
      const province = st.provinces.find((p) => p.id === pending.provinceId);
      if (province) {
        const zone = getBuyZone(st, province, pending.strength);
        if (zone.includes(idx)) {
          pushUndo();
          applyAction(st, {
            type: "buyUnit",
            provinceId: province.id,
            strength: pending.strength,
            target: idx,
          });
          afterAction(st, province.id);
          return;
        }
      }
      clearSelection();
      return;
    }
    if (pending.kind === "build") {
      const province = st.provinces.find((p) => p.id === pending.provinceId);
      if (province) {
        const zone = getBuildZone(st, province, pending.buildKind);
        if (zone.includes(idx)) {
          pushUndo();
          applyAction(st, {
            type: "build",
            kind: pending.buildKind,
            provinceId: province.id,
            target: idx,
          });
          afterAction(st, province.id);
          return;
        }
      }
      clearSelection();
      return;
    }
    if (pending.kind === "unit") {
      const zone = getMoveZone(st, pending.from);
      if (zone.includes(idx)) {
        pushUndo();
        applyAction(st, { type: "moveUnit", from: pending.from, to: idx });
        // Movement may rebuild provinces; recompute highlight by hex.
        const prov = getProvinceByHex(st, idx);
        afterAction(st, prov ? prov.id : -1);
        return;
      }
      // Tap own ready unit -> reselect it.
      if (hex.fraction === me && hex.unit && hex.unit.readyToMove) {
        selectUnit(st, idx);
        return;
      }
      clearSelection();
      return;
    }

    // Idle: select unit or province ----------------------------------------
    if (hex.fraction === me && hex.unit && hex.unit.readyToMove) {
      selectUnit(st, idx);
      return;
    }
    if (hex.fraction === me) {
      const prov = getProvinceByHex(st, idx);
      if (prov) {
        pendingRef.current = { kind: "none" };
        selectedHexRef.current = idx;
        highlightProvinceRef.current = prov.id;
        refreshUi();
        return;
      }
    }
    clearSelection();
  }

  function selectUnit(st: GameState, idx: number) {
    pendingRef.current = { kind: "unit", from: idx };
    selectedHexRef.current = idx;
    const prov = getProvinceByHex(st, idx);
    highlightProvinceRef.current = prov ? prov.id : -1;
    dirtyRef.current = true;
    refreshUi();
  }

  function afterAction(st: GameState, provinceId: number) {
    pendingRef.current = { kind: "none" };
    selectedHexRef.current = -1;
    // Re-select the province (if it still exists) so the HUD stays open.
    const prov = st.provinces.find((p) => p.id === provinceId);
    highlightProvinceRef.current = prov ? prov.id : -1;
    if (prov && prov.capital >= 0) selectedHexRef.current = prov.capital;
    forceRender();
    refreshUi();
  }

  // ---- keyboard shortcuts (desktop) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = stateRef.current;
      if (!st || screen.kind !== "game") return;
      if (aiThinkingRef.current || st.winner !== null || !isHumanTurn(st)) return;
      if (e.key === "Escape") {
        clearSelection();
      } else if (e.key === "e" || e.key === "E" || e.key === "Enter") {
        doEndTurn();
      } else if (e.key === "u" || e.key === "U" || e.key === "z" || e.key === "Z") {
        doUndo();
      } else if (e.key >= "1" && e.key <= "4") {
        const prov = currentSelectedProvince(st, highlightProvinceRef.current);
        if (prov) {
          const strength = Number(e.key);
          if (prov.money >= getUnitPrice(strength)) {
            pendingRef.current = { kind: "buy", provinceId: prov.id, strength };
            refreshUi();
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stateRef, screen.kind, clearSelection, doEndTurn, doUndo, refreshUi]);

  // Selected province for the HUD.
  const selectedProvince = currentSelectedProvince(state, highlightProvinceRef.current);

  // ---- hotseat pass screen ----
  if (screen.kind === "pass") {
    const f = screen.fraction;
    return (
      <PassScreen
        fraction={f}
        onContinue={() => {
          setScreen({ kind: "game" });
          refreshUi();
        }}
      />
    );
  }

  const human = isHumanTurn(state) && !aiThinkingRef.current && state.winner === null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#2a628f] text-slate-100 select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none" }}
      />

      {/* Top bar */}
      <TopBar
        state={state}
        onMenu={() => {
          if (state.winner !== null || confirm("Return to menu? Current game will be lost.")) {
            props.onMenu();
          }
        }}
      />

      {/* AI thinking indicator */}
      {aiThinkingRef.current && (
        <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-[#f0eee3] px-4 py-2 text-sm font-bold text-[#3a3a33] shadow">
          <span className="inline-block animate-pulse">AI thinking…</span>
        </div>
      )}

      {/* Defeated notice */}
      {state.winner === null && defeatedHumans(state).length > 0 && (
        <DefeatedBadge state={state} />
      )}

      {/* HUD: original-style bottom panel */}
      {human && selectedProvince && (
        <ProvinceHud
          state={state}
          province={selectedProvince}
          pending={pendingRef.current}
          onBuyUnit={() => {
            pendingRef.current = { kind: "buy", provinceId: selectedProvince.id, strength: 1 };
            selectedHexRef.current = -1;
            refreshUi();
          }}
          onBuild={(kind) => {
            pendingRef.current = { kind: "build", provinceId: selectedProvince.id, buildKind: kind };
            selectedHexRef.current = -1;
            refreshUi();
          }}
        />
      )}

      {/* Cancel placement banner */}
      {human && (pendingRef.current.kind === "buy" || pendingRef.current.kind === "build") && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 flex items-center gap-3 rounded-full bg-[#f0eee3] px-4 py-2 text-[#3a3a33] shadow">
          <span className="text-sm font-semibold">Tap a highlighted tile</span>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-full bg-[#3a3a33] px-3 py-1 text-xs font-bold text-[#f0eee3]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Undo button (original icon), bottom-left */}
      {human && (
        <button
          type="button"
          onClick={doUndo}
          disabled={undoRef.current.length === 0}
          title="Undo (U)"
          className={`absolute bottom-4 left-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f0eee3] shadow-[0_3px_0_rgba(0,0,0,0.3)] transition active:translate-y-[2px] active:shadow-none ${
            undoRef.current.length === 0 ? "opacity-40" : ""
          }`}
        >
          <img src={ICON_UNDO_URL} alt="Undo" className="h-8 w-8" />
        </button>
      )}

      {/* End turn button (original icon), bottom-right */}
      {human && (
        <button
          type="button"
          onClick={doEndTurn}
          title="End turn (E)"
          className="absolute bottom-4 right-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f0eee3] shadow-[0_3px_0_rgba(0,0,0,0.3)] transition active:translate-y-[2px] active:shadow-none"
        >
          <img src={ICON_ENDTURN_URL} alt="End turn" className="h-10 w-10" />
        </button>
      )}

      {/* Victory overlay */}
      {state.winner !== null && (
        <VictoryOverlay
          winner={state.winner}
          onPlayAgain={props.onPlayAgain}
          onMenu={props.onMenu}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function fractionLabel(state: GameState, f: number): string {
  if (f >= state.config.humanCount) return `AI ${f + 1}`;
  return `Player ${f + 1}`;
}

function TopBar({
  state,
  onMenu,
}: {
  state: GameState;
  onMenu: () => void;
}) {
  const f = state.turn;
  const color = f < NEUTRAL_FRACTION ? ORIGINAL_FRACTION_COLORS[f] : "#999";
  return (
    <div className="absolute left-0 right-0 top-0 flex items-center justify-between gap-2 px-3 py-2">
      <div className="flex items-center gap-2 rounded-full bg-[#f0eee3] px-3 py-1.5 text-[#3a3a33] shadow">
        <span
          className="inline-block h-4 w-4 rounded-full ring-1 ring-black/30"
          style={{ background: color }}
        />
        <span className="text-sm font-bold">{fractionLabel(state, f)}</span>
        <span className="text-xs opacity-60">Round {state.round + 1}</span>
      </div>
      <button
        type="button"
        onClick={onMenu}
        className="min-h-[40px] rounded-full bg-[#f0eee3] px-4 text-sm font-bold text-[#3a3a33] shadow hover:brightness-95"
      >
        Menu
      </button>
    </div>
  );
}

/** Original-style bottom strip: coin + money, then picture buttons. */
function ProvinceHud({
  state,
  province,
  pending,
  onBuyUnit,
  onBuild,
}: {
  state: GameState;
  province: Province;
  pending: Pending;
  onBuyUnit: () => void;
  onBuild: (kind: "farm" | "tower" | "strongTower") => void;
}) {
  const profit = getProvinceProfit(state, province);
  const farmPrice = getFarmPrice(state, province);
  const money = province.money;
  const unitPrice = getUnitPrice(1);

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 sm:bottom-4">
      <div className="flex items-center gap-2 rounded-2xl bg-[#f0eee3] px-3 py-2 text-[#3a3a33] shadow-[0_3px_0_rgba(0,0,0,0.3)]">
        {/* Money */}
        <div className="mr-1 flex flex-col items-center px-1">
          <span className="flex items-center gap-1.5">
            <img src={ICON_COIN_URL} alt="" className="h-6 w-6" />
            <span className="text-xl font-black leading-none">{money}</span>
          </span>
          <span className={`text-xs font-bold ${profit >= 0 ? "text-[#2c7a2c]" : "text-[#a3322a]"}`}>
            {profit >= 0 ? `+${profit}` : `${profit}`}
          </span>
        </div>

        <SpriteButton
          sprite="man0"
          price={unitPrice}
          disabled={money < unitPrice}
          active={pending.kind === "buy"}
          onClick={onBuyUnit}
          title="Buy unit (stack units to merge)"
        />
        <SpriteButton
          sprite="tower"
          price={PRICE_TOWER}
          disabled={money < PRICE_TOWER}
          active={pending.kind === "build" && pending.buildKind === "tower"}
          onClick={() => onBuild("tower")}
          title="Build tower"
        />
        <SpriteButton
          sprite="strong_tower"
          price={PRICE_STRONG_TOWER}
          disabled={money < PRICE_STRONG_TOWER}
          active={pending.kind === "build" && pending.buildKind === "strongTower"}
          onClick={() => onBuild("strongTower")}
          title="Build strong tower"
        />
        <SpriteButton
          sprite="farm1"
          price={farmPrice}
          disabled={money < farmPrice}
          active={pending.kind === "build" && pending.buildKind === "farm"}
          onClick={() => onBuild("farm")}
          title="Build farm"
        />
      </div>
    </div>
  );
}

function SpriteButton({
  sprite,
  price,
  disabled,
  active,
  onClick,
  title,
}: {
  sprite: string;
  price: number;
  disabled: boolean;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`flex min-h-[56px] min-w-[52px] flex-col items-center justify-center rounded-xl px-1 py-1 transition ${
        active ? "bg-[#3a3a33]" : "bg-[#e2dfc8]"
      } ${disabled ? "opacity-40" : "hover:brightness-95 active:translate-y-[1px]"}`}
    >
      <Sprite name={sprite} size={34} />
      <span
        className={`mt-0.5 flex items-center gap-0.5 text-[11px] font-bold ${
          active ? "text-[#f0eee3]" : "text-[#3a3a33]"
        }`}
      >
        <img src={ICON_COIN_URL} alt="" className="h-3 w-3" />
        {price}
      </span>
    </button>
  );
}

function PassScreen({
  fraction,
  onContinue,
}: {
  fraction: number;
  onContinue: () => void;
}) {
  const color = ORIGINAL_FRACTION_COLORS[fraction] ?? "#999";
  return (
    <main
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: MENU_BACKGROUND_COLOR }}
      onClick={onContinue}
    >
      <div className="flex flex-col items-center gap-5 p-6 text-center">
        <span
          className="h-16 w-16 rounded-2xl ring-2 ring-black/20"
          style={{ background: color }}
        />
        <h2 className="text-3xl font-black text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
          Player {fraction + 1}
        </h2>
        <p className="font-semibold text-[#2e2e28]/80">Pass the device, then tap to start your turn.</p>
        <MenuButton onClick={onContinue}>Tap to start</MenuButton>
      </div>
    </main>
  );
}

function VictoryOverlay({
  winner,
  onPlayAgain,
  onMenu,
}: {
  winner: number;
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  const color = ORIGINAL_FRACTION_COLORS[winner] ?? "#999";
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-5 rounded-3xl bg-[#b3ae7e] p-8 text-center shadow-[0_4px_0_rgba(0,0,0,0.25)]">
        <span
          className="h-16 w-16 rounded-2xl ring-2 ring-black/20"
          style={{ background: color }}
        />
        <h2 className="text-3xl font-black text-[#2e2e28]">Player {winner + 1} wins!</h2>
        <div className="flex gap-3">
          <MenuButton onClick={onPlayAgain}>Play again</MenuButton>
          <MenuButton onClick={onMenu}>Menu</MenuButton>
        </div>
      </div>
    </div>
  );
}

function DefeatedBadge({ state }: { state: GameState }) {
  const dead = defeatedHumans(state);
  if (dead.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-[#a3322a]/90 px-4 py-1.5 text-xs font-bold text-white shadow">
      {dead.map((f) => `Player ${f + 1}`).join(", ")} defeated
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defeatedHumans(state: GameState): number[] {
  const out: number[] = [];
  for (let f = 0; f < state.config.humanCount; f++) {
    if (!state.alive[f]) out.push(f);
  }
  return out;
}

function currentSelectedProvince(state: GameState, id: number): Province | null {
  if (id < 0) return null;
  const p = state.provinces.find((pp) => pp.id === id);
  if (!p) return null;
  if (p.fraction !== state.turn) return null;
  return p;
}

function buildRenderState(
  state: GameState,
  pending: Pending,
  selectedHex: number,
  highlightProvince: number
): RenderState {
  let zone: Set<number> | null = null;
  let dim = false;
  if (pending.kind === "unit") {
    zone = new Set(getMoveZone(state, pending.from));
    dim = true;
  } else if (pending.kind === "buy") {
    const prov = state.provinces.find((p) => p.id === pending.provinceId);
    if (prov) {
      zone = new Set(getBuyZone(state, prov, pending.strength));
      dim = true;
    }
  } else if (pending.kind === "build") {
    const prov = state.provinces.find((p) => p.id === pending.provinceId);
    if (prov) {
      zone = new Set(getBuildZone(state, prov, pending.buildKind));
      dim = true;
    }
  }
  return {
    selectedHex,
    highlightProvince,
    zone,
    dimNonZone: dim,
    now: performance.now(),
  };
}

// ---------------------------------------------------------------------------
// Pointer controls (unified mouse/touch via Pointer Events)
// ---------------------------------------------------------------------------

function usePointerControls(
  canvasRef: { current: HTMLCanvasElement | null },
  camRef: { current: Camera },
  onChange: () => void,
  onTap: (screenPt: Point) => void,
  blocked: () => boolean
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pointers = new Map<number, Point>();
    let lastSingle: Point | null = null;
    let startSingle: Point | null = null;
    let movedDist = 0;
    let pinchDist = 0;

    const local = (e: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        lastSingle = p;
        startSingle = p;
        movedDist = 0;
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchDist = dist(pts[0], pts[1]);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      const p = local(e);
      pointers.set(e.pointerId, p);

      if (pointers.size === 1 && lastSingle) {
        const dx = p.x - lastSingle.x;
        const dy = p.y - lastSingle.y;
        movedDist += Math.hypot(dx, dy);
        if (!blocked()) {
          camRef.current = {
            ...camRef.current,
            x: camRef.current.x - dx / camRef.current.scale,
            y: camRef.current.y - dy / camRef.current.scale,
          };
          onChange();
        }
        lastSingle = p;
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = dist(pts[0], pts[1]);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (pinchDist > 0 && !blocked()) {
          camRef.current = zoomAt(camRef.current, mid, d / pinchDist);
          onChange();
        }
        pinchDist = d;
        movedDist += 999; // a pinch is never a tap
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (wasSingle && startSingle && movedDist < 6) {
        onTap(startSingle);
      }
      if (pointers.size === 0) {
        lastSingle = null;
        startSingle = null;
      } else if (pointers.size === 1) {
        lastSingle = [...pointers.values()][0];
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (blocked()) return;
      const rect = canvas.getBoundingClientRect();
      const pivot = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      camRef.current = zoomAt(camRef.current, pivot, factor);
      onChange();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvasRef, camRef, onChange, onTap, blocked]);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
