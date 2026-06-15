// Replay viewer: steps through the recorded actions of a finished game on its
// own canvas, with a per-step money delta readout.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { applyAction } from "../game/engine";
import type { Action, GameState, ReplayStep } from "../game/types";
import { fitToIsland, HEX_SIZE, makeCamera, type Camera } from "../camera";
import { renderBoard } from "../render";
import { displayFractionColor } from "../colors";

export type { ReplayStep };

export function ReplayViewer({
  initialState,
  steps,
  onClose,
}: {
  initialState: GameState;
  steps: ReplayStep[];
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(structuredClone(initialState));
  const cameraRef = useRef<Camera>(makeCamera());
  const fittedRef = useRef(false);
  const stepRef = useRef(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const goTo = useCallback((target: number) => {
    const clamped = Math.max(0, Math.min(steps.length, target));
    if (clamped === stepRef.current) return;
    if (clamped === stepRef.current + 1) {
      applyAction(stateRef.current, steps[clamped - 1].action);
    } else {
      const replayState = structuredClone(initialState);
      for (let i = 0; i < clamped; i++) applyAction(replayState, steps[i].action);
      stateRef.current = replayState;
    }
    stepRef.current = clamped;
    setStep(clamped);
  }, [initialState, steps]);

  useEffect(() => {
    if (!playing) return;
    if (step >= steps.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => goTo(step + 1), 650);
    return () => window.clearTimeout(timer);
  }, [playing, step, steps.length, goTo]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
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
        fittedRef.current = false;
      }
      if (!fittedRef.current && cssW > 0 && cssH > 0) {
        cameraRef.current = fitToIsland(stateRef.current, cssW, cssH, HEX_SIZE);
        fittedRef.current = true;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderBoard(ctx, stateRef.current, cameraRef.current, {
        selectedHex: -1,
        protectionSource: -1,
        highlightProvince: -1,
        zone: null,
        dimNonZone: false,
        now: performance.now(),
      }, cssW, cssH);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const current = step > 0 ? steps[step - 1] : null;
  const replayState = stateRef.current;

  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-[#2a628f] text-[#3a3a33]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute left-2 right-2 top-2 flex items-start justify-between gap-2">
        <div className="max-w-[calc(100%-76px)] rounded-2xl bg-[#f0eee3] px-3 py-2 shadow">
          <div className="text-sm font-black">
            Step {step} / {steps.length}
          </div>
          <div className="truncate text-xs font-semibold opacity-70">
            {current ? `Player ${current.actor + 1}: ${replayActionLabel(current.action)}` : "Game start"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-full bg-[#f0eee3] px-4 text-sm font-bold shadow"
        >
          Close
        </button>
      </div>

      <div className="absolute bottom-24 left-2 right-2 rounded-2xl bg-[#f0eee3] p-3 shadow-[0_3px_0_rgba(0,0,0,0.3)] sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(560px,calc(100%-2rem))] sm:-translate-x-1/2">
        <div className="mb-2 text-xs font-black uppercase tracking-wide opacity-70">Money earned / spent this step</div>
        <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {Array.from({ length: initialState.config.playerCount }, (_, fraction) => {
            const delta = current?.moneyDelta[fraction] ?? 0;
            return (
              <div key={fraction} className="flex items-center justify-between rounded-lg bg-[#e2dfc8] px-2 py-1 text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-3 w-3 rounded-full ring-1 ring-black/20"
                    style={{ background: displayFractionColor(initialState.config, fraction) }}
                  />
                  P{fraction + 1}
                </span>
                <span className={delta > 0 ? "text-[#2c7a2c]" : delta < 0 ? "text-[#a3322a]" : "opacity-50"}>
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              </div>
            );
          })}
        </div>

        <input
          type="range"
          min="0"
          max={steps.length}
          value={step}
          aria-label="Replay step"
          onInput={(event) => {
            setPlaying(false);
            goTo(Number(event.currentTarget.value));
          }}
          className="mb-3 w-full cursor-pointer accent-[#3a3a33]"
        />
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => { setPlaying(false); goTo(step - 1); }}
            className="min-h-[44px] rounded-xl bg-[#e2dfc8] text-sm font-bold disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={steps.length === 0}
            onClick={() => {
              if (step >= steps.length) goTo(0);
              setPlaying((value) => !value);
            }}
            className="min-h-[44px] rounded-xl bg-[#3a3a33] text-sm font-bold text-[#f0eee3] disabled:opacity-40"
          >
            {playing ? "Pause" : step >= steps.length ? "Restart" : "Play"}
          </button>
          <button
            type="button"
            disabled={step >= steps.length}
            onClick={() => { setPlaying(false); goTo(step + 1); }}
            className="min-h-[44px] rounded-xl bg-[#e2dfc8] text-sm font-bold disabled:opacity-40"
          >
            Next
          </button>
        </div>
        <div className="mt-2 text-center text-[11px] font-semibold opacity-60">
          {replayState.endReason === "draw"
            ? "Game ended in a draw"
            : replayState.winner === null
              ? `Round ${replayState.round + 1}, Player ${replayState.turn + 1}'s turn`
            : `Player ${replayState.winner + 1} won`}
        </div>
      </div>
    </div>
  );
}

function replayActionLabel(action: Action): string {
  if (action.type === "endTurn") return "ended turn";
  if (action.type === "draw") return "declared a draw";
  if (action.type === "resign") return `resigned Player ${action.fraction + 1}`;
  if (action.type === "moveUnit") return "moved a warrior";
  if (action.type === "buyUnit") return `bought warrior ${action.strength}`;
  return `built ${action.kind === "strongTower" ? "strong tower" : action.kind}`;
}
