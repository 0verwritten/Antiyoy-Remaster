// Canvas renderer for the Antiyoy board, drawing the original game's sprites
// (assets/skins/ant field-element atlas) over flat hexes in the original palette.

import { NEUTRAL_FRACTION } from "./game/constants";
import type { GameState, HexObj, HexTile } from "./game/types";
import { type Camera, HEX_SIZE, worldToScreen } from "./camera";
import { hexCorners, hexToPixel } from "./hex";
import {
  ATLAS_URL,
  ORIGINAL_FRACTION_COLORS,
  ORIGINAL_NEUTRAL_COLOR,
  SPRITES,
  WATER_COLOR,
} from "./sprites";

export interface RenderState {
  /** Hex index of the currently selected hex (province pick, unit, or capital). */
  selectedHex: number;
  /** Province id whose tiles should be emphasized, or -1. */
  highlightProvince: number;
  /** Set of hex indices that are "active" interaction targets (move/buy/build zone). */
  zone: Set<number> | null;
  /** When true, non-zone tiles are dimmed. */
  dimNonZone: boolean;
  /** Time in ms for animations. */
  now: number;
}

// --- sprite atlas ------------------------------------------------------------

const atlas = new Image();
let atlasReady = false;
atlas.onload = () => {
  atlasReady = true;
};
atlas.src = ATLAS_URL;

function drawSprite(
  ctx: CanvasRenderingContext2D,
  name: string,
  cx: number,
  cy: number,
  size: number
) {
  const rect = SPRITES[name];
  if (!rect || !atlasReady) return;
  ctx.drawImage(atlas, rect.x, rect.y, rect.w, rect.h, cx - size / 2, cy - size / 2, size, size);
}

// --- color helpers -----------------------------------------------------------

function fractionColor(fraction: number): string {
  if (fraction >= NEUTRAL_FRACTION) return ORIGINAL_NEUTRAL_COLOR;
  return ORIGINAL_FRACTION_COLORS[fraction] ?? ORIGINAL_NEUTRAL_COLOR;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function shade(color: string, amount: number): string {
  // amount > 0 lightens, < 0 darkens.
  const [r, g, b] = hexToRgb(color);
  const f = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// --- main entry --------------------------------------------------------------

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  rs: RenderState,
  cssW: number,
  cssH: number
) {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = WATER_COLOR;
  ctx.fillRect(0, 0, cssW, cssH);

  // Pass 1: tiles.
  for (const hex of state.hexes) {
    if (!hex.active) continue;
    drawTile(ctx, hex, cam, rs);
  }
  // Pass 2: contents + units (so they sit above neighboring outlines).
  for (const hex of state.hexes) {
    if (!hex.active) continue;
    const dim = rs.dimNonZone && !(rs.zone && rs.zone.has(hex.index));
    drawContents(ctx, hex, cam, rs, dim);
  }
  // Pass 3: zone markers + selection.
  if (rs.zone && rs.dimNonZone) {
    for (const idx of rs.zone) {
      const hex = state.hexes[idx];
      if (!hex || !hex.active) continue;
      drawZoneMarker(ctx, hex, cam, rs.now);
    }
  }
  if (rs.selectedHex >= 0 && state.hexes[rs.selectedHex]?.active) {
    drawSelection(ctx, state.hexes[rs.selectedHex], cam, rs.now);
  }
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, screenSize: number) {
  const corners = hexCorners(screenSize);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const px = cx + corners[i].x;
    const py = cy + corners[i].y;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function tileScreen(hex: HexTile, cam: Camera) {
  const world = hexToPixel(hex.q, hex.r, HEX_SIZE);
  const screen = worldToScreen(cam, world);
  return { cx: screen.x, cy: screen.y, s: HEX_SIZE * cam.scale };
}

function drawTile(ctx: CanvasRenderingContext2D, hex: HexTile, cam: Camera, rs: RenderState) {
  const { cx, cy, s } = tileScreen(hex, cam);
  let fill = fractionColor(hex.fraction);
  const inZone = rs.zone && rs.zone.has(hex.index);
  const dim = rs.dimNonZone && !inZone;
  if (dim) fill = shade(fill, -0.45);

  // The original draws flat tiles with hairline borders a touch darker
  // than the tile itself.
  hexPath(ctx, cx, cy, s);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.strokeStyle = shade(fill, -0.25);
  ctx.stroke();
}

function drawZoneMarker(ctx: CanvasRenderingContext2D, hex: HexTile, cam: Camera, now: number) {
  const { cx, cy, s } = tileScreen(hex, cam);
  // Blinking white overlay like the original move-zone animation.
  const pulse = 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(now / 280));
  hexPath(ctx, cx, cy, s);
  ctx.fillStyle = `rgba(255,255,255,${pulse.toFixed(3)})`;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.stroke();
}

function drawSelection(ctx: CanvasRenderingContext2D, hex: HexTile, cam: Camera, now: number) {
  const { cx, cy, s } = tileScreen(hex, cam);
  const pulse = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(now / 240));
  hexPath(ctx, cx, cy, s * 0.93);
  ctx.lineWidth = Math.max(2, s * 0.1);
  ctx.strokeStyle = `rgba(255,255,255,${pulse.toFixed(3)})`;
  ctx.stroke();
}

// --- contents (original sprites) ---------------------------------------------

function drawContents(
  ctx: CanvasRenderingContext2D,
  hex: HexTile,
  cam: Camera,
  rs: RenderState,
  dim: boolean
) {
  const { cx, cy, s } = tileScreen(hex, cam);
  if (s < 5) return; // too small to bother
  ctx.save();
  if (dim) ctx.globalAlpha = 0.4;

  if (hex.obj !== "none") drawObject(ctx, hex, hex.obj, cx, cy, s);
  if (hex.unit) drawUnit(ctx, hex, cx, cy, s, rs);

  ctx.restore();
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  hex: HexTile,
  obj: HexObj,
  cx: number,
  cy: number,
  s: number
) {
  const size = s * 1.35; // sprites have padding baked into their 160px frame
  switch (obj) {
    case "pine":
      drawSprite(ctx, "pine", cx, cy, size);
      break;
    case "palm":
      drawSprite(ctx, "palm", cx, cy, size);
      break;
    case "town":
      drawSprite(ctx, "house", cx, cy, size);
      break;
    case "tower":
      drawSprite(ctx, "tower", cx, cy, size);
      break;
    case "strongTower":
      drawSprite(ctx, "strong_tower", cx, cy, size);
      break;
    case "farm":
      // The original ships three farm pictures; pick one stably per tile.
      drawSprite(ctx, "farm" + ((hex.index % 3) + 1), cx, cy, size);
      break;
    case "grave":
      drawSprite(ctx, "grave", cx, cy, size);
      break;
    default:
      break;
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  hex: HexTile,
  cx: number,
  cy: number,
  s: number,
  rs: RenderState
) {
  const unit = hex.unit!;
  // Original units jump in place while they can still move.
  let bob = 0;
  if (unit.readyToMove) {
    const t = (rs.now / 380 + hex.index * 0.7) % 1;
    bob = -Math.abs(Math.sin(t * Math.PI)) * s * 0.18;
  } else {
    ctx.globalAlpha *= 0.8; // spent units rest, slightly faded
  }
  drawSprite(ctx, "man" + (unit.strength - 1), cx, cy + bob, s * 1.35);
}
