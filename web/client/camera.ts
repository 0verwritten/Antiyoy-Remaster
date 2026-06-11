// Pan/zoom camera. World units == hex-layout pixels (at HEX_SIZE).
// Screen = (world - offset) * scale, all in CSS pixels.

import type { GameState } from "./game/types";
import { islandBounds, type Point } from "./hex";

export const HEX_SIZE = 32; // world-space hex circumradius used for layout

export interface Camera {
  /** World point shown at the top-left of the viewport. */
  x: number;
  y: number;
  /** Screen pixels per world unit. */
  scale: number;
}

export function makeCamera(): Camera {
  return { x: 0, y: 0, scale: 1 };
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return { x: (p.x - cam.x) * cam.scale, y: (p.y - cam.y) * cam.scale };
}

export function screenToWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.scale + cam.x, y: p.y / cam.scale + cam.y };
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

export function clampScale(s: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

/** Zoom keeping the world point under `screenPivot` fixed. */
export function zoomAt(cam: Camera, screenPivot: Point, factor: number): Camera {
  const newScale = clampScale(cam.scale * factor);
  const worldBefore = screenToWorld(cam, screenPivot);
  const next: Camera = { ...cam, scale: newScale };
  const worldAfter = screenToWorld(next, screenPivot);
  next.x += worldBefore.x - worldAfter.x;
  next.y += worldBefore.y - worldAfter.y;
  return next;
}

/** Fit the whole island into the viewport with some padding. */
export function fitToIsland(
  state: GameState,
  viewW: number,
  viewH: number,
  size: number
): Camera {
  const b = islandBounds(state, size);
  const pad = 0.92;
  const scale = clampScale(
    Math.min((viewW / b.width) * pad, (viewH / b.height) * pad)
  );
  // Center the island.
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return {
    scale,
    x: cx - viewW / 2 / scale,
    y: cy - viewH / 2 / scale,
  };
}
