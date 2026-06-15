// Game screen: canvas board, HUD, undo stack, AI turn chains, replay
// recording, hotseat pass screen and victory overlay.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { PRICE_STRONG_TOWER, PRICE_TOWER } from "../game/constants";
import {
  applyAction,
  computeVisibility,
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
import type { OnlineChatMessage } from "../../shared/online";
import { clampToIsland, fitToIsland, HEX_SIZE, makeCamera, screenToWorld, zoomAt, type Camera } from "../camera";
import { pixelToHex, type Point } from "../hex";
import { renderBoard, type RenderState } from "../render";
import { aiDelayMs, settings } from "../settings";
import { ICON_COIN_URL, ICON_ENDTURN_URL, ICON_UNDO_URL } from "../sprites";
import { displayFractionColor } from "../colors";
import {
  AUTOSAVE_ID,
  newRecordId,
  putReplay,
  putSave,
  RECORD_VERSION,
  type SaveRecord,
} from "../game-storage";
import type { Pending, Screen } from "./model";
import { usePointerControls } from "../ui/pointer";
import { MenuButton } from "../ui/controls";
import { SettingsPanel } from "../ui/settings-panel";
import { PassScreen } from "./pass";
import { VictoryOverlay, CampaignOverlay } from "./victory";
import { evaluateCampaign, CAMPAIGN_LEVEL_COUNT } from "../game/campaign";
import { markLevelCompleted } from "../campaign-storage";
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
  /** Restored replay history when this game came from a saved record. */
  initialReplay?: { initial: GameState; steps: ReplayStep[] } | null;
  /** Campaign hooks (present only for campaign games). */
  onCampaignExit?: () => void;
  onCampaignPlayLevel?: (level: number) => void;
  online?: {
    seat: number;
    isHost: boolean;
    humanSlots: number;
    players: string[];
    messages: OnlineChatMessage[];
    sendChat: (body: string) => Promise<void>;
    onAction: (actor: number, state: GameState) => void;
    stateRevision: number;
  };
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
  const protectionSourceRef = useRef<number>(-1);
  const highlightProvinceRef = useRef<number>(-1);
  const aiThinkingRef = useRef<boolean>(false);
  const dirtyRef = useRef<boolean>(true);
  const undoRef = useRef<UndoEntry[]>([]);
  const aliveRef = useRef(true);
  const replayInitialRef = useRef<GameState>(
    props.initialReplay ? props.initialReplay.initial : structuredClone(state)
  );
  const replayStepsRef = useRef<ReplayStep[]>(
    props.initialReplay ? [...props.initialReplay.steps] : []
  );
  const replayPersistedRef = useRef(false);
  const [showReplay, setShowReplay] = useState(false);
  // Pause menu overlays the board so the game is never unmounted.
  const [paused, setPaused] = useState<"none" | "menu" | "settings">("none");
  const [justSaved, setJustSaved] = useState(false);
  const [showOnlineChat, setShowOnlineChat] = useState(false);

  const [, setUi] = useState(0);
  const refreshUi = useCallback(() => setUi((n) => n + 1), []);

  const recordAction = useCallback((event: ActionEvent) => {
    replayStepsRef.current.push({
      action: event.action,
      actor: event.actor,
      moneyDelta: event.moneyAfter.map((money, fraction) => money - event.moneyBefore[fraction]),
    });
    props.online?.onAction(event.actor, stateRef.current!);
  }, [props.online, stateRef]);

  const canControlTurn = useCallback((st: GameState) => {
    return props.online ? st.turn === props.online.seat : isHumanTurn(st);
  }, [props.online]);

  useEffect(() => {
    const live = stateRef.current;
    if (!live) return;
    setActionObserver(live, recordAction);
    return () => setActionObserver(live, null);
  }, [stateRef, recordAction, props.online?.stateRevision]);

  // --- camera fit on first mount ---
  const fittedRef = useRef(false);
  // Fog visibility cache (recomputed only when the state version or viewer changes).
  const fogCacheRef = useRef<{ version: number; viewer: number; set: Set<number> } | null>(null);

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
        if (fittedRef.current) {
          camRef.current = clampToIsland(st, camRef.current, cssW, cssH, HEX_SIZE);
        }
        dirtyRef.current = true;
      }
      if (!fittedRef.current && cssW > 0 && cssH > 0) {
        camRef.current = fitToIsland(st, cssW, cssH, HEX_SIZE);
        fittedRef.current = true;
        dirtyRef.current = true;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const pending = pendingRef.current;
      const rs: RenderState = buildRenderState(
        st,
        pending,
        selectedHexRef.current,
        highlightProvinceRef.current,
        protectionSourceRef.current
      );
      rs.fog = computeFog(st, fogCacheRef);
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
    protectionSourceRef.current = -1;
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
    if (!st || props.online || aiThinkingRef.current || st.winner !== null || !isHumanTurn(st)) return;
    const entry = undoRef.current.pop();
    if (!entry) return;
    setActionObserver(st, null);
    stateRef.current = entry.state;
    replayStepsRef.current.length = entry.replayLength;
    setActionObserver(entry.state, recordAction);
    pendingRef.current = { kind: "none" };
    selectedHexRef.current = -1;
    protectionSourceRef.current = -1;
    highlightProvinceRef.current = -1;
    forceRender();
    refreshUi();
  }, [stateRef, forceRender, refreshUi, recordAction]);

  const constrainCamera = useCallback((camera: Camera) => {
    const canvas = canvasRef.current;
    const st = stateRef.current;
    if (!canvas || !st) return camera;
    return clampToIsland(st, camera, canvas.clientWidth, canvas.clientHeight, HEX_SIZE);
  }, [stateRef]);

  const zoomCamera = useCallback((factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    camRef.current = constrainCamera(zoomAt(
      camRef.current,
      { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
      factor
    ));
    dirtyRef.current = true;
  }, [constrainCamera]);

  const fitCamera = useCallback(() => {
    const canvas = canvasRef.current;
    const st = stateRef.current;
    if (!canvas || !st) return;
    camRef.current = fitToIsland(st, canvas.clientWidth, canvas.clientHeight, HEX_SIZE);
    dirtyRef.current = true;
  }, [stateRef]);

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
      if (!props.online && st.config.humanCount >= 2) {
        setScreen({ kind: "pass", fraction: st.turn });
      }
      refreshUi();
      return;
    }
    // AI turn(s): chain with delays so progress is visible.
    if (props.online && !props.online.isHost) return;
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
      // Campaign defeat: the human is gone, so stop rather than watching the
      // AIs play out the rest.
      const campaignDefeat = s.session?.source === "campaign" && !s.alive[0];
      if (s.winner !== null || isHumanTurn(s) || campaignDefeat) {
        aiThinkingRef.current = false;
        if (!props.online && s.winner === null && !campaignDefeat && s.config.humanCount >= 2 && isHumanTurn(s)) {
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
  }, [stateRef, forceRender, refreshUi, setScreen, props.online]);

  // Spectator games (humanCount 0) and AI-first setups need the chain to
  // start on its own; re-arm whenever a new game begins.
  useEffect(() => {
    if (state && state.winner === null && !isHumanTurn(state)) runAiIfNeeded();
  }, [state, runAiIfNeeded]);

  /** Snapshot of the running game as a persistable save record. */
  const buildSaveRecord = useCallback(
    (id: string, name: string): SaveRecord | null => {
      const st = stateRef.current;
      const cfg = props.configRef.current;
      if (!st || !cfg) return null;
      const now = Date.now();
      return {
        version: RECORD_VERSION,
        id,
        name,
        createdAt: now,
        updatedAt: now,
        config: structuredClone(cfg),
        state: structuredClone(st),
        replayInitial: structuredClone(replayInitialRef.current),
        replaySteps: structuredClone(replayStepsRef.current),
      };
    },
    [stateRef, props.configRef]
  );

  const doEndTurn = useCallback(() => {
    const st = stateRef.current;
    if (!st || aiThinkingRef.current || st.winner !== null) return;
    if (!canControlTurn(st)) return;
    if (settings.confirmEndTurn && !confirm("End turn?")) return;
    clearSelection();
    undoRef.current = []; // turns are final once ended
    applyAction(st, { type: "endTurn" });
    // End-of-human-turn autosave (turns are final, so this never races undo).
    if (!props.online && st.config.humanCount > 0 && st.winner === null) {
      const record = buildSaveRecord(AUTOSAVE_ID, "Autosave");
      if (record) void putSave(record).catch(() => {});
    }
    forceRender();
    runAiIfNeeded();
  }, [stateRef, clearSelection, forceRender, runAiIfNeeded, buildSaveRecord, canControlTurn, props.online]);

  // Persist a replay record once when the game ends.
  useEffect(() => {
    const st = stateRef.current;
    const cfg = props.configRef.current;
    if (!st || !cfg || st.winner === null || replayPersistedRef.current) return;
    replayPersistedRef.current = true;
    const mode = (cfg.mode ?? "antiyoy") === "slay" ? "Slay" : "Normal";
    void putReplay({
      version: RECORD_VERSION,
      id: newRecordId(),
      name: `${mode} ${cfg.mapSize} ${cfg.playerCount}p`,
      createdAt: Date.now(),
      config: structuredClone(cfg),
      initial: structuredClone(replayInitialRef.current),
      steps: structuredClone(replayStepsRef.current),
      winner: st.winner,
      rounds: st.round,
    }).catch(() => {});
  }, [state.winner, stateRef, props.configRef]);

  // ---- pointer interaction (pan/zoom/tap/long-press march) ----
  usePointerControls(
    canvasRef,
    camRef,
    constrainCamera,
    () => {
      dirtyRef.current = true;
    },
    (screenPt) => onTap(screenPt),
    () => screen.kind !== "game" || paused !== "none",
    (screenPt) => onLongPress(screenPt)
  );

  /** Hold-to-march (original long_tap_to_move): selected province's units walk to the held tile. */
  function onLongPress(screenPt: Point) {
    if (!settings.holdToMarch) return;
    const st = stateRef.current;
    if (!st || aiThinkingRef.current || st.winner !== null || !canControlTurn(st)) return;
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
    if (!canControlTurn(st)) return;
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
    if (hex.fraction === me && isDefensiveBuilding(hex.obj)) {
      const prov = getProvinceByHex(st, idx);
      pendingRef.current = { kind: "none" };
      selectedHexRef.current = idx;
      protectionSourceRef.current = idx;
      highlightProvinceRef.current = prov ? prov.id : -1;
      refreshUi();
      return;
    }
    if (hex.fraction === me) {
      const prov = getProvinceByHex(st, idx);
      if (prov) {
        pendingRef.current = { kind: "none" };
        selectedHexRef.current = -1; // the whole territory is highlighted instead
        protectionSourceRef.current = -1;
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
    protectionSourceRef.current = -1;
    const prov = getProvinceByHex(st, idx);
    highlightProvinceRef.current = prov ? prov.id : -1;
    dirtyRef.current = true;
    refreshUi();
  }

  function afterAction(st: GameState, provinceId: number) {
    pendingRef.current = { kind: "none" };
    selectedHexRef.current = -1;
    protectionSourceRef.current = -1;
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
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomCamera(1.2);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomCamera(1 / 1.2);
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        fitCamera();
        return;
      }
      if (aiThinkingRef.current || st.winner !== null || !canControlTurn(st)) return;
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
  }, [stateRef, screen.kind, paused, clearSelection, doEndTurn, doUndo, refreshUi, zoomCamera, fitCamera, canControlTurn]);

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

  // Campaign objective state. A campaign level can end before a single
  // winner emerges (the human dies but the AIs fight on), so we evaluate the
  // objective directly rather than waiting for state.winner.
  const campaignLevel =
    state.session?.source === "campaign" ? state.session.campaignLevel ?? null : null;
  const campaignStatus = campaignLevel != null ? evaluateCampaign(state) : "ongoing";
  const campaignDoneRef = useRef(false);
  useEffect(() => {
    if (campaignLevel != null && campaignStatus === "won" && !campaignDoneRef.current) {
      campaignDoneRef.current = true;
      markLevelCompleted(campaignLevel);
    }
  }, [campaignLevel, campaignStatus]);

  const human = canControlTurn(state) && !aiThinkingRef.current && state.winner === null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#2a628f] text-slate-100 select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
      />

      {/* Top bar */}
      <TopBar state={state} onMenu={() => setPaused("menu")} playerNames={props.online?.players} />

      {props.online && (
        <button
          type="button"
          onClick={() => setShowOnlineChat((value) => !value)}
          className="absolute right-24 top-2 min-h-[40px] rounded-full bg-[#f0eee3] px-4 text-sm font-bold text-[#3a3a33] shadow"
        >
          Chat{props.online.messages.length ? ` (${props.online.messages.length})` : ""}
        </button>
      )}

      <ZoomControls
        onZoomIn={() => zoomCamera(1.2)}
        onZoomOut={() => zoomCamera(1 / 1.2)}
        onFit={fitCamera}
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
          onBuyUnit={(strength) => {
            pendingRef.current = { kind: "buy", provinceId: selectedProvince.id, strength };
            selectedHexRef.current = -1;
            protectionSourceRef.current = -1;
            refreshUi();
          }}
          onBuild={(kind) => {
            pendingRef.current = { kind: "build", provinceId: selectedProvince.id, buildKind: kind };
            selectedHexRef.current = -1;
            protectionSourceRef.current = -1;
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
      {human && !props.online && (
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

      {props.online && showOnlineChat && (
        <OnlineChatPanel
          messages={props.online.messages}
          sendChat={props.online.sendChat}
          onClose={() => setShowOnlineChat(false)}
        />
      )}

      {/* Pause menu: the game stays mounted underneath */}
      {paused !== "none" && state.winner === null && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          {paused === "menu" ? (
            <div className="flex w-full max-w-xs flex-col gap-3 rounded-3xl bg-[#b3ae7e] p-6 shadow-[0_4px_0_rgba(0,0,0,0.25)]">
              <h2 className="mb-1 text-center text-2xl font-black text-[#2e2e28]">Paused</h2>
              <MenuButton onClick={() => setPaused("none")}>Resume</MenuButton>
              {!props.online && <MenuButton
                onClick={() => {
                  const cfg = props.configRef.current;
                  const mode = (cfg?.mode ?? "antiyoy") === "slay" ? "Slay" : "Normal";
                  const name = prompt(
                    "Save name:",
                    `${mode} ${cfg?.mapSize ?? ""} · round ${state.round + 1}`
                  );
                  if (!name) return;
                  const record = buildSaveRecord(newRecordId(), name);
                  if (!record) return;
                  void putSave(record)
                    .then(() => {
                      setJustSaved(true);
                      setTimeout(() => setJustSaved(false), 1500);
                    })
                    .catch(() => alert("Saving failed — storage may be unavailable."));
                }}
              >
                {justSaved ? "Saved ✓" : "Save"}
              </MenuButton>}
              {!props.online && <MenuButton
                onClick={() => {
                  if (!confirm("Restart this game from the beginning?")) return;
                  if (campaignLevel != null) props.onCampaignPlayLevel?.(campaignLevel);
                  else props.onRestart();
                }}
              >
                Restart
              </MenuButton>}
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

      {/* Campaign end overlay (win/lose), takes priority for campaign games */}
      {campaignLevel != null && campaignStatus !== "ongoing" && (
        <CampaignOverlay
          level={campaignLevel}
          won={campaignStatus === "won"}
          hasNext={campaignLevel < CAMPAIGN_LEVEL_COUNT}
          onRetry={() => props.onCampaignPlayLevel?.(campaignLevel)}
          onNext={() => props.onCampaignPlayLevel?.(campaignLevel + 1)}
          onReplay={() => setShowReplay(true)}
          onMenu={() => props.onCampaignExit?.()}
        />
      )}

      {/* Skirmish victory overlay */}
      {campaignLevel == null && state.winner !== null && (
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
  playerNames,
}: {
  state: GameState;
  onMenu: () => void;
  playerNames?: string[];
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
        <span className="text-sm font-bold">{playerNames?.[f] ?? fractionLabel(state, f)}</span>
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

function OnlineChatPanel({ messages, sendChat, onClose }: {
  messages: OnlineChatMessage[];
  sendChat: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-4 right-4 z-10 flex h-[360px] w-[min(22rem,calc(100vw-2rem))] flex-col rounded-2xl bg-[#b3ae7e] p-3 text-[#2e2e28] shadow-xl">
      <div className="flex items-center justify-between"><strong>Game chat</strong><button type="button" onClick={onClose} className="px-2 font-black">X</button></div>
      <div className="my-2 flex-1 space-y-2 overflow-y-auto rounded-xl bg-[#e2dfc8] p-3">
        {messages.map((message) => <p key={message.id} className="text-sm"><strong>{message.authorName}:</strong> {message.body}</p>)}
      </div>
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const input = form.elements.namedItem("message") as HTMLInputElement;
        const body = input.value.trim();
        if (!body) return;
        input.value = "";
        void sendChat(body);
      }}>
        <input name="message" maxLength={300} className="min-w-0 flex-1 rounded-xl bg-[#f0eee3] px-3" placeholder="Message" />
        <button type="submit" className="rounded-xl bg-[#3a3a33] px-3 font-bold text-[#f0eee3]">Send</button>
      </form>
    </div>
  );
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const buttonClass =
    "flex min-h-[44px] min-w-[44px] items-center justify-center bg-[#f0eee3] px-3 font-black text-[#3a3a33] shadow hover:brightness-95 active:bg-[#dedbc8]";
  return (
    <div className="absolute right-3 top-16 flex flex-col overflow-hidden rounded-xl" aria-label="Map zoom controls">
      <button type="button" onClick={onZoomIn} title="Zoom in (+)" aria-label="Zoom in" className={`${buttonClass} hidden text-2xl md:flex`}>
        +
      </button>
      <button type="button" onClick={onFit} title="Fit map (0)" className={`${buttonClass} text-xs md:border-y md:border-black/10`}>
        Fit
      </button>
      <button type="button" onClick={onZoomOut} title="Zoom out (-)" aria-label="Zoom out" className={`${buttonClass} hidden text-2xl md:flex`}>
        -
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

/**
 * Visible-hex set for fog of war, memoized by state version + viewer. The
 * viewer is the player whose turn it is when human; during AI turns in a
 * single-player game, the human (fraction 0) keeps seeing their own fog.
 * Spectator games (no humans) and fog-off games see everything (null).
 */
function computeFog(
  state: GameState,
  cache: { current: { version: number; viewer: number; set: Set<number> } | null }
): Set<number> | null {
  if (!state.config.fogOfWar || state.config.humanCount === 0) return null;
  const viewer = isHumanTurn(state)
    ? state.turn
    : state.config.humanCount === 1
      ? 0
      : state.turn;
  const c = cache.current;
  if (c && c.version === state.version && c.viewer === viewer) return c.set;
  const set = computeVisibility(state, viewer);
  cache.current = { version: state.version, viewer, set };
  return set;
}

function buildRenderState(
  state: GameState,
  pending: Pending,
  selectedHex: number,
  highlightProvince: number,
  protectionSource: number
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
    protectionSource,
    highlightProvince,
    zone,
    dimNonZone: dim,
    now: performance.now(),
  };
}

function isDefensiveBuilding(obj: GameState["hexes"][number]["obj"]): boolean {
  return obj === "town" || obj === "tower" || obj === "strongTower";
}
