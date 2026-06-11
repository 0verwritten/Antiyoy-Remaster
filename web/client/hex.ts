// Hex geometry helpers for pointy-top axial hexes.
// Axial-to-pixel per the spec:
//   x = size * sqrt(3) * (q + r/2)
//   y = size * 3/2 * r

import type { GameState, HexTile } from "./game/types";

export const SQRT3 = Math.sqrt(3);

export interface Point {
  x: number;
  y: number;
}

/** Center of a hex in world space for a given hex size (circumradius). */
export function hexToPixel(q: number, r: number, size: number): Point {
  return {
    x: size * SQRT3 * (q + r / 2),
    y: size * (3 / 2) * r,
  };
}

/** The six corner offsets (pointy-top) at a given size, relative to center. */
export function hexCorners(size: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++) {
    // Pointy-top: first corner points up. Angle = 60*i - 90 degrees.
    const angle = (Math.PI / 180) * (60 * i - 90);
    pts.push({ x: size * Math.cos(angle), y: size * Math.sin(angle) });
  }
  return pts;
}

/** World-space bounding box of all active hexes at the given size. */
export function islandBounds(state: GameState, size: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const hex of state.hexes) {
    if (!hex.active) continue;
    const c = hexToPixel(hex.q, hex.r, size);
    if (c.x - size < minX) minX = c.x - size;
    if (c.x + size > maxX) maxX = c.x + size;
    if (c.y - size < minY) minY = c.y - size;
    if (c.y + size > maxY) maxY = c.y + size;
  }
  if (!isFinite(minX)) {
    minX = -size;
    minY = -size;
    maxX = size;
    maxY = size;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Convert world coordinates to the nearest active hex index, or -1. */
export function pixelToHex(state: GameState, world: Point, size: number): number {
  // Inverse of the axial-to-pixel transform, then cube rounding.
  const r = (world.y * (2 / 3)) / size;
  const q = world.x / (size * SQRT3) - r / 2;
  const rounded = axialRound(q, r);
  // Find the active hex matching the rounded coordinates.
  for (const hex of state.hexes) {
    if (hex.active && hex.q === rounded.q && hex.r === rounded.r) return hex.index;
  }
  return -1;
}

function axialRound(q: number, r: number): { q: number; r: number } {
  let x = q;
  let z = r;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

export function hexCenter(hex: HexTile, size: number): Point {
  return hexToPixel(hex.q, hex.r, size);
}
