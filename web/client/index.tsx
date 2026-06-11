// Antiyoy Remaster — client UI entry. Fully client-side gameplay; no Lakebed
// queries/mutations needed. Renders a canvas board with pan/zoom and a HUD.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  FRACTION_COLORS,
  NEUTRAL_FRACTION,
  PRICE_STRONG_TOWER,
  PRICE_TOWER,
} from "./game/constants";
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
import type { GameConfig, GameState, MapSize, Province } from "./game/types";
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
// Start screen
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

  // Keep humanCount <= playerCount.
  const clampedHumans = Math.min(humanCount, playerCount);

  function play() {
    onPlay({
      mapSize,
      playerCount,
      humanCount: Math.min(humanCount, playerCount),
      seed: Date.now() % 2 ** 31,
    });
  }

  return (
    <main className="min-h-screen w-full bg-gradient-to-b from-slate-900 to-slate-950 text-slate-100 flex items-center justify-center p-5">
      <div className="w-full max-w-md flex flex-col gap-7">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
            Antiyoy <span className="text-emerald-400">Remaster</span>
          </h1>
          <p className="mt-2 text-xs text-slate-400">
            Web remaster of Antiyoy by yiotro
          </p>
        </header>

        <section className="flex flex-col gap-5 rounded-2xl bg-slate-800/60 p-5 ring-1 ring-white/10">
          {/* Map size */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-300">
              Map size
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["small", "medium", "large"] as MapSize[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMapSize(m)}
                  className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-medium capitalize transition ${
                    mapSize === m
                      ? "bg-emerald-500 text-slate-900"
                      : "bg-slate-700/70 text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Players */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-300">
              Players: <span className="text-emerald-400">{playerCount}</span>
            </label>
            <div className="grid grid-cols-5 gap-2">
              {[2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setPlayerCount(n);
                    if (humanCount > n) setHumanCount(n);
                  }}
                  className={`min-h-[44px] rounded-lg text-sm font-bold transition ${
                    playerCount === n
                      ? "bg-emerald-500 text-slate-900"
                      : "bg-slate-700/70 text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Humans */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-300">
              Humans (hotseat):{" "}
              <span className="text-emerald-400">{clampedHumans}</span>
              <span className="ml-1 text-xs font-normal text-slate-500">
                {clampedHumans === 1 ? "vs AI" : "pass & play"}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: playerCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHumanCount(n)}
                  className={`min-h-[44px] min-w-[44px] rounded-lg px-3 text-sm font-bold transition ${
                    clampedHumans === n
                      ? "bg-emerald-500 text-slate-900"
                      : "bg-slate-700/70 text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={play}
            className="mt-1 min-h-[52px] rounded-xl bg-emerald-500 text-lg font-black text-slate-900 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.99]"
          >
            Play
          </button>
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

function GameScreen(props: GameScreenProps) {
  const { stateRef, forceRender, setScreen, screen } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<Camera>(makeCamera());
  const pendingRef = useRef<Pending>({ kind: "none" });
  const selectedHexRef = useRef<number>(-1);
  const highlightProvinceRef = useRef<number>(-1);
  const aiThinkingRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(true);

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
  }, [stateRef, screen.kind, clearSelection, doEndTurn, refreshUi]);

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
    <main className="relative h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
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
        <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-sm font-semibold ring-1 ring-white/10">
          <span className="inline-block animate-pulse">AI thinking…</span>
        </div>
      )}

      {/* Defeated notice */}
      {state.winner === null && defeatedHumans(state).length > 0 && (
        <DefeatedBadge state={state} />
      )}

      {/* HUD: province panel + buy toolbar */}
      {human && selectedProvince && (
        <ProvinceHud
          state={state}
          province={selectedProvince}
          pending={pendingRef.current}
          onBuyUnit={(strength) => {
            pendingRef.current = { kind: "buy", provinceId: selectedProvince.id, strength };
            selectedHexRef.current = -1;
            refreshUi();
          }}
          onBuild={(kind) => {
            pendingRef.current = { kind: "build", provinceId: selectedProvince.id, buildKind: kind };
            selectedHexRef.current = -1;
            refreshUi();
          }}
          onCancel={clearSelection}
        />
      )}

      {/* Cancel placement banner */}
      {human && (pendingRef.current.kind === "buy" || pendingRef.current.kind === "build") && (
        <div className="absolute left-1/2 top-20 -translate-x-1/2 flex items-center gap-3 rounded-full bg-slate-900/90 px-4 py-2 ring-1 ring-white/10">
          <span className="text-sm">Tap a highlighted tile to place</span>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-full bg-slate-700 px-3 py-1 text-xs font-semibold hover:bg-slate-600"
          >
            Cancel
          </button>
        </div>
      )}

      {/* End turn button */}
      {human && (
        <button
          type="button"
          onClick={doEndTurn}
          className="absolute bottom-4 right-4 min-h-[52px] rounded-2xl bg-emerald-500 px-6 text-base font-black text-slate-900 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-[0.98]"
        >
          End turn
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
  const color = f < NEUTRAL_FRACTION ? FRACTION_COLORS[f] : "#999";
  return (
    <div className="absolute left-0 right-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-slate-950/90 to-transparent px-3 py-2">
      <div className="flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-1.5 ring-1 ring-white/10">
        <span
          className="inline-block h-4 w-4 rounded-full ring-1 ring-white/30"
          style={{ background: color }}
        />
        <span className="text-sm font-bold">{fractionLabel(state, f)}</span>
        <span className="text-xs text-slate-400">Round {state.round + 1}</span>
      </div>
      <button
        type="button"
        onClick={onMenu}
        className="min-h-[40px] rounded-full bg-slate-900/80 px-4 text-sm font-semibold ring-1 ring-white/10 hover:bg-slate-800"
      >
        Menu
      </button>
    </div>
  );
}

function ProvinceHud({
  state,
  province,
  pending,
  onBuyUnit,
  onBuild,
  onCancel,
}: {
  state: GameState;
  province: Province;
  pending: Pending;
  onBuyUnit: (strength: number) => void;
  onBuild: (kind: "farm" | "tower" | "strongTower") => void;
  onCancel: () => void;
}) {
  const profit = getProvinceProfit(state, province);
  const farmPrice = getFarmPrice(state, province);
  const money = province.money;

  const unitDefs = [
    { s: 1, name: "Peasant", price: getUnitPrice(1) },
    { s: 2, name: "Spearman", price: getUnitPrice(2) },
    { s: 3, name: "Knight", price: getUnitPrice(3) },
    { s: 4, name: "Baron", price: getUnitPrice(4) },
  ];

  const isActive = (test: boolean) => (test ? "ring-2 ring-emerald-400" : "");

  return (
    <div className="absolute bottom-0 left-0 right-0 px-2 pb-2 sm:left-2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-72 sm:-translate-y-1/2 sm:px-0 sm:pb-0">
      <div className="rounded-2xl bg-slate-900/90 p-3 ring-1 ring-white/10 backdrop-blur">
        {/* Money / profit */}
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-300">{money}</span>
            <span className="text-xs text-slate-400">treasury</span>
          </div>
          <span
            className={`text-sm font-bold ${
              profit >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {profit >= 0 ? `+${profit}` : `${profit}`}/turn
          </span>
        </div>

        {/* Units */}
        <div className="grid grid-cols-4 gap-1.5">
          {unitDefs.map((u) => {
            const disabled = money < u.price;
            const sel = pending.kind === "buy" && pending.strength === u.s;
            return (
              <button
                key={u.s}
                type="button"
                disabled={disabled}
                onClick={() => onBuyUnit(u.s)}
                title={u.name}
                className={`flex min-h-[44px] flex-col items-center justify-center rounded-lg px-1 py-1 text-[11px] font-semibold transition ${isActive(
                  sel
                )} ${
                  disabled
                    ? "cursor-not-allowed bg-slate-800/60 text-slate-600"
                    : "bg-slate-700 text-slate-100 hover:bg-slate-600"
                }`}
              >
                <span className="text-sm leading-none">⚔ {u.s}</span>
                <span className="mt-0.5 text-amber-300/90">{u.price}</span>
              </button>
            );
          })}
        </div>

        {/* Buildings */}
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <BuildBtn
            label="Farm"
            price={farmPrice}
            disabled={money < farmPrice}
            active={pending.kind === "build" && pending.buildKind === "farm"}
            onClick={() => onBuild("farm")}
          />
          <BuildBtn
            label="Tower"
            price={PRICE_TOWER}
            disabled={money < PRICE_TOWER}
            active={pending.kind === "build" && pending.buildKind === "tower"}
            onClick={() => onBuild("tower")}
          />
          <BuildBtn
            label="S.Tower"
            price={PRICE_STRONG_TOWER}
            disabled={money < PRICE_STRONG_TOWER}
            active={pending.kind === "build" && pending.buildKind === "strongTower"}
            onClick={() => onBuild("strongTower")}
          />
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-2 w-full min-h-[40px] rounded-lg bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700"
        >
          Deselect
        </button>
      </div>
    </div>
  );
}

function BuildBtn({
  label,
  price,
  disabled,
  active,
  onClick,
}: {
  label: string;
  price: number;
  disabled: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[44px] flex-col items-center justify-center rounded-lg px-1 text-[11px] font-semibold transition ${
        active ? "ring-2 ring-emerald-400" : ""
      } ${
        disabled
          ? "cursor-not-allowed bg-slate-800/60 text-slate-600"
          : "bg-slate-700 text-slate-100 hover:bg-slate-600"
      }`}
    >
      <span>{label}</span>
      <span className="mt-0.5 text-amber-300/90">{price}</span>
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
  const color = FRACTION_COLORS[fraction] ?? "#999";
  return (
    <main
      className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-100"
      onClick={onContinue}
    >
      <div className="flex flex-col items-center gap-5 p-6 text-center">
        <span
          className="h-16 w-16 rounded-2xl ring-2 ring-white/20"
          style={{ background: color }}
        />
        <h2 className="text-3xl font-black">Player {fraction + 1}</h2>
        <p className="text-slate-400">Pass the device, then tap to start your turn.</p>
        <button
          type="button"
          className="min-h-[52px] rounded-2xl bg-emerald-500 px-8 text-lg font-black text-slate-900"
        >
          Tap to start
        </button>
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
  const color = FRACTION_COLORS[winner] ?? "#999";
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-5 rounded-3xl bg-slate-900 p-8 text-center ring-1 ring-white/10">
        <span
          className="h-16 w-16 rounded-2xl ring-2 ring-white/30"
          style={{ background: color }}
        />
        <h2 className="text-3xl font-black">Player {winner + 1} wins!</h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="min-h-[48px] rounded-xl bg-emerald-500 px-5 font-black text-slate-900 hover:bg-emerald-400"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={onMenu}
            className="min-h-[48px] rounded-xl bg-slate-700 px-5 font-bold hover:bg-slate-600"
          >
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}

function DefeatedBadge({ state }: { state: GameState }) {
  const dead = defeatedHumans(state);
  if (dead.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-red-900/80 px-4 py-1.5 text-xs font-semibold text-red-100 ring-1 ring-red-500/30">
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
