// Game screen: canvas board, HUD, undo stack, AI turn chains, replay
// recording, hotseat pass screen and victory overlay.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { PRICE_STRONG_TOWER, PRICE_TOWER } from "../game/constants";
import {
  applyAction,
  findNextReadyUnit,
  getBuildZone,
  getBuyZone,
  getFarmPrice,
  getMoveZone,
  getProvinceByHex,
  getProvinceProfit,
  getUnitPrice,
  isHumanTurn,
  marchUnitsToHex,
  setActionObserver,
  type ActionEvent,
} from "../game/engine";
import { aiTakeTurn } from "../game/ai";
import type { GameConfig, GameState, Province } from "../game/types";
import { fitToIsland, HEX_SIZE, makeCamera, screenToWorld, type Camera } from "../camera";
import { pixelToHex, type Point } from "../hex";
import { renderBoard, type RenderState } from "../render";
import { aiDelayMs, settings } from "../settings";
import { ICON_COIN_URL, ICON_ENDTURN_URL, ICON_UNDO_URL } from "../sprites";
import { displayFractionColor } from "../colors";
import type { Pending, Screen } from "./model";
import { usePointerControls } from "../ui/pointer";
import { MenuButton } from "../ui/controls";
import { SettingsPanel } from "../ui/settings-panel";
import { PassScreen } from "./pass";
import { VictoryOverlay } from "./victory";
import { ReplayViewer, type ReplayStep } from "./replay";

export interface GameScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  stateRef: { current: GameState | null };
  configRef: { current: GameConfig | null };
  forceRender: () => void;
  onMenu: () => void;
  onRestart: () => void;
  onPlayAgain: () => void;
}

const UNDO_STACK_LIMIT = 50;

interface UndoEntry {
  state: GameState;
  replayLength: number;
}

export function GameScreen(props: GameScreenProps) {
  const { stateRef, forceRender, setScreen, screen } = props;
  const state = stateRef.current!;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<Camera>(makeCamera());
  const pendingRef = useRef<Pending>({ kind: "none" });
  const selectedHexRef = useRef<number>(-1);
  const highlightProvinceRef = useRef<number>(-1);
  const aiThinkingRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(true);
  const undoRef = useRef<UndoEntry[]>([]);
  const aliveRef = useRef(true);
  const replayInitialRef = useRef<GameState>(structuredClone(state));
  const replayStepsRef = useRef<ReplayStep[]>([]);
  const [showReplay, setShowReplay] = useState(false);
  // Pause menu overlays the board so the game is never unmounted.
  const [paused, setPaused] = useState<"none" | "menu" | "settings">("none");

  const [, setUi] = useState(0);
  const refreshUi = useCallback(() => setUi((n) => n + 1), []);

  const recordAction = useCallback((event: ActionEvent) => {
    replayStepsRef.current.push({
      action: event.action,
      actor: event.actor,
      moneyDelta: event.moneyAfter.map((money, fraction) => money - event.moneyBefore[fraction]),
    });
  }, []);

  useEffect(() => {
    const live = stateRef.current;
    if (!live) return;
    setActionObserver(live, recordAction);
    return () => setActionObserver(live, null);
  }, [stateRef, recordAction]);

  // --- camera fit on first mount ---
  const fittedRef = useRef(false);

  // Track unmount so a pending AI chain stops with the screen.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

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
    undoRef.current.push({
      state: structuredClone(st),
      replayLength: replayStepsRef.current.length,
    });
    if (undoRef.current.length > UNDO_STACK_LIMIT) undoRef.current.shift();
  }, [stateRef]);

  const doUndo = useCallback(() => {
    const st = stateRef.current;
    if (!st || aiThinkingRef.current || st.winner !== null || !isHumanTurn(st)) return;
    const entry = undoRef.current.pop();
    if (!entry) return;
    setActionObserver(st, null);
    stateRef.current = entry.state;
    replayStepsRef.current.length = entry.replayLength;
    setActionObserver(entry.state, recordAction);
    pendingRef.current = { kind: "none" };
    selectedHexRef.current = -1;
    highlightProvinceRef.current = -1;
    forceRender();
    refreshUi();
  }, [stateRef, forceRender, refreshUi, recordAction]);

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
    if (aiThinkingRef.current) return; // a chain is already running
    aiThinkingRef.current = true;
    const chainState = st;
    refreshUi();
    const step = () => {
      const s = stateRef.current;
      if (!s || s !== chainState || !aliveRef.current) {
        aiThinkingRef.current = false;
        return;
      }
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
      setTimeout(step, aiDelayMs());
    };
    setTimeout(step, aiDelayMs());
  }, [stateRef, forceRender, refreshUi, setScreen]);

  // Spectator games (humanCount 0) and AI-first setups need the chain to
  // start on its own; re-arm whenever a new game begins.
  useEffect(() => {
    if (state && state.winner === null && !isHumanTurn(state)) runAiIfNeeded();
  }, [state, runAiIfNeeded]);

  const doEndTurn = useCallback(() => {
    const st = stateRef.current;
    if (!st || aiThinkingRef.current || st.winner !== null) return;
    if (!isHumanTurn(st)) return;
    if (settings.confirmEndTurn && !confirm("End turn?")) return;
    clearSelection();
    undoRef.current = []; // turns are final once ended
    applyAction(st, { type: "endTurn" });
    forceRender();
    runAiIfNeeded();
  }, [stateRef, clearSelection, forceRender, runAiIfNeeded]);

  // ---- pointer interaction (pan/zoom/tap/long-press march) ----
  usePointerControls(
    canvasRef,
    camRef,
    () => {
      dirtyRef.current = true;
    },
    (screenPt) => onTap(screenPt),
    () => aiThinkingRef.current || screen.kind !== "game" || paused !== "none",
    (screenPt) => onLongPress(screenPt)
  );

  /** Hold-to-march (original long_tap_to_move): selected province's units walk to the held tile. */
  function onLongPress(screenPt: Point) {
    if (!settings.holdToMarch) return;
    const st = stateRef.current;
    if (!st || aiThinkingRef.current || st.winner !== null || !isHumanTurn(st)) return;
    const world = screenToWorld(camRef.current, screenPt);
    const idx = pixelToHex(st, world, HEX_SIZE);
    if (idx < 0) return;
    const prov = st.provinces.find(
      (p) => p.id === highlightProvinceRef.current && p.fraction === st.turn
    );
    if (!prov || !prov.hexes.includes(idx)) return;
    if (!prov.hexes.some((h) => st.hexes[h].unit?.readyToMove)) return;
    pushUndo();
    const moves = marchUnitsToHex(st, prov, idx);
    if (moves === 0) undoRef.current.pop();
    afterAction(st, prov.id);
  }

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
        // Original "automatic transition": jump to the next useful ready unit.
        if (settings.autoTransition) {
          const next = findNextReadyUnit(st, prov ? prov.id : -1);
          if (next >= 0) selectUnit(st, next);
        }
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
        selectedHexRef.current = -1; // the whole territory is highlighted instead
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
    forceRender();
    refreshUi();
  }

  // ---- keyboard shortcuts (desktop) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = stateRef.current;
      if (!st || screen.kind !== "game") return;
      if (paused !== "none") {
        if (e.key === "Escape") setPaused("none");
        return;
      }
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
  }, [stateRef, screen.kind, paused, clearSelection, doEndTurn, doUndo, refreshUi]);

  // Selected province for the HUD.
  const selectedProvince = currentSelectedProvince(state, highlightProvinceRef.current);

  // ---- hotseat pass screen ----
  if (screen.kind === "pass") {
    const f = screen.fraction;
    return (
      <PassScreen
        fraction={f}
        color={displayFractionColor(state.config, f)}
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
      <TopBar state={state} onMenu={() => setPaused("menu")} />

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

      {/* Undo and end-turn buttons (original icons); corners swap in left-handed mode */}
      {human && (
        <button
          type="button"
          onClick={doUndo}
          disabled={undoRef.current.length === 0}
          title="Undo (U)"
          className={`absolute bottom-4 ${settings.leftHanded ? "right-4" : "left-4"} flex h-14 w-14 items-center justify-center rounded-full bg-[#f0eee3] shadow-[0_3px_0_rgba(0,0,0,0.3)] transition active:translate-y-[2px] active:shadow-none ${
            undoRef.current.length === 0 ? "opacity-40" : ""
          }`}
        >
          <img src={ICON_UNDO_URL} alt="Undo" className="h-8 w-8" />
        </button>
      )}

      {human && (
        <button
          type="button"
          onClick={doEndTurn}
          title="End turn (E)"
          className={`absolute bottom-4 ${settings.leftHanded ? "left-4" : "right-4"} flex h-16 w-16 items-center justify-center rounded-full bg-[#f0eee3] shadow-[0_3px_0_rgba(0,0,0,0.3)] transition active:translate-y-[2px] active:shadow-none`}
        >
          <img src={ICON_ENDTURN_URL} alt="End turn" className="h-10 w-10" />
        </button>
      )}

      {/* Pause menu: the game stays mounted underneath */}
      {paused !== "none" && state.winner === null && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          {paused === "menu" ? (
            <div className="flex w-full max-w-xs flex-col gap-3 rounded-3xl bg-[#b3ae7e] p-6 shadow-[0_4px_0_rgba(0,0,0,0.25)]">
              <h2 className="mb-1 text-center text-2xl font-black text-[#2e2e28]">Paused</h2>
              <MenuButton onClick={() => setPaused("none")}>Resume</MenuButton>
              <MenuButton
                onClick={() => {
                  if (confirm("Restart this game from the beginning?")) props.onRestart();
                }}
              >
                Restart
              </MenuButton>
              <MenuButton onClick={() => setPaused("settings")}>Settings</MenuButton>
              <MenuButton onClick={props.onMenu}>Main menu</MenuButton>
            </div>
          ) : (
            <div className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-3xl bg-[#b3ae7e] p-6 shadow-[0_4px_0_rgba(0,0,0,0.25)]">
              <h2 className="text-center text-2xl font-black text-[#2e2e28]">Settings</h2>
              <SettingsPanel />
              <MenuButton onClick={() => setPaused("menu")}>Back</MenuButton>
            </div>
          )}
        </div>
      )}

      {/* Victory overlay */}
      {state.winner !== null && (
        <VictoryOverlay
          label={fractionLabel(state, state.winner)}
          color={displayFractionColor(state.config, state.winner)}
          onReplay={() => setShowReplay(true)}
          onPlayAgain={props.onPlayAgain}
          onMenu={props.onMenu}
        />
      )}

      {showReplay && (
        <ReplayViewer
          initialState={replayInitialRef.current}
          steps={replayStepsRef.current}
          onClose={() => setShowReplay(false)}
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
  const color = displayFractionColor(state.config, f);
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

/** Compact bottom purchase panel with native mobile-friendly selectors. */
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
  onBuyUnit: (strength: number) => void;
  onBuild: (kind: "farm" | "tower" | "strongTower") => void;
}) {
  const profit = getProvinceProfit(state, province);
  const farmPrice = getFarmPrice(state, province);
  const money = province.money;

  return (
    <div className="absolute bottom-20 left-1/2 w-[calc(100%-1rem)] max-w-md -translate-x-1/2 sm:bottom-4">
      <div className="rounded-2xl bg-[#f0eee3] p-2 text-[#3a3a33] shadow-[0_3px_0_rgba(0,0,0,0.3)] sm:flex sm:items-center sm:gap-2 sm:px-3">
        {/* Money */}
        <div className="mb-1 flex items-center justify-center gap-2 px-1 sm:mb-0 sm:mr-1 sm:flex-col sm:gap-0">
          <span className="flex items-center gap-1.5">
            <img src={ICON_COIN_URL} alt="" className="h-5 w-5 sm:h-6 sm:w-6" />
            <span className="text-lg font-black leading-none sm:text-xl">{money}</span>
          </span>
          <span className={`text-xs font-bold ${profit >= 0 ? "text-[#2c7a2c]" : "text-[#a3322a]"}`}>
            {profit >= 0 ? `+${profit}` : `${profit}`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex-1">
          <label className="min-w-0">
            <span className="sr-only">Select warrior</span>
            <select
              aria-label="Select warrior"
              value={pending.kind === "buy" ? String(pending.strength) : ""}
              onChange={(event) => {
                const strength = Number(event.currentTarget.value);
                if (strength) onBuyUnit(strength);
              }}
              className="min-h-[48px] w-full rounded-xl bg-[#e2dfc8] px-3 text-sm font-bold text-[#3a3a33] outline-none ring-[#3a3a33] focus:ring-2"
            >
              <option value="">Warriors</option>
              {[1, 2, 3, 4].map((strength) => {
                const price = getUnitPrice(strength);
                return (
                  <option key={strength} value={strength} disabled={money < price}>
                    Warrior {strength} - {price}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="min-w-0">
            <span className="sr-only">Select building</span>
            <select
              aria-label="Select building"
              value={pending.kind === "build" ? pending.buildKind : ""}
              onChange={(event) => {
                const kind = event.currentTarget.value;
                if (kind === "farm" || kind === "tower" || kind === "strongTower") onBuild(kind);
              }}
              className="min-h-[48px] w-full rounded-xl bg-[#e2dfc8] px-3 text-sm font-bold text-[#3a3a33] outline-none ring-[#3a3a33] focus:ring-2"
            >
              <option value="">Buildings</option>
              <option value="farm" disabled={money < farmPrice}>Farm - {farmPrice}</option>
              <option value="tower" disabled={money < PRICE_TOWER}>Tower - {PRICE_TOWER}</option>
              <option value="strongTower" disabled={money < PRICE_STRONG_TOWER}>
                Strong tower - {PRICE_STRONG_TOWER}
              </option>
            </select>
          </label>
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
