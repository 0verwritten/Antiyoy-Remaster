// Canvas renderer for the Antiyoy board. Pure 2D vector drawing.

import { FRACTION_COLORS, NEUTRAL_COLOR, NEUTRAL_FRACTION } from "./game/constants";
import type { GameState, HexObj, HexTile } from "./game/types";
import { type Camera, HEX_SIZE, worldToScreen } from "./camera";
import { hexCorners, hexToPixel } from "./hex";

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

function fractionColor(fraction: number): string {
  if (fraction >= NEUTRAL_FRACTION) return NEUTRAL_COLOR;
  return FRACTION_COLORS[fraction] ?? NEUTRAL_COLOR;
}

// --- color helpers ---------------------------------------------------------

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

// --- main entry ------------------------------------------------------------

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  rs: RenderState,
  cssW: number,
  cssH: number
) {
  ctx.clearRect(0, 0, cssW, cssH);
  // Water background.
  ctx.fillStyle = "#1b2a3a";
  ctx.fillRect(0, 0, cssW, cssH);

  const provinceOfHex = buildProvinceLookup(state);
  const cur = state.turn;

  // Pass 1: tiles.
  for (const hex of state.hexes) {
    if (!hex.active) continue;
    drawTile(ctx, state, hex, cam, rs, provinceOfHex.get(hex.index) === cur);
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
      drawZoneMarker(ctx, hex, cam);
    }
  }
  if (rs.selectedHex >= 0 && state.hexes[rs.selectedHex]?.active) {
    drawSelection(ctx, state.hexes[rs.selectedHex], cam);
  }
}

function buildProvinceLookup(state: GameState): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of state.provinces) for (const h of p.hexes) m.set(h, p.fraction);
  return m;
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

function drawTile(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  hex: HexTile,
  cam: Camera,
  rs: RenderState,
  isCurrentPlayer: boolean
) {
  const { cx, cy, s } = tileScreen(hex, cam);
  let fill = fractionColor(hex.fraction);
  const inZone = rs.zone && rs.zone.has(hex.index);
  const dim = rs.dimNonZone && !inZone;

  if (isCurrentPlayer && hex.fraction < NEUTRAL_FRACTION) {
    fill = shade(fill, 0.12);
  }
  if (dim) fill = shade(fill, -0.45);

  // Slightly inset hexes to leave thin gaps -> crisp grid look.
  hexPath(ctx, cx, cy, s * 0.99);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = dim ? shade(fill, -0.2) : shade(fractionColor(hex.fraction), -0.4);
  ctx.stroke();
}

function drawZoneMarker(ctx: CanvasRenderingContext2D, hex: HexTile, cam: Camera) {
  const { cx, cy, s } = tileScreen(hex, cam);
  hexPath(ctx, cx, cy, s * 0.99);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.08);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
}

function drawSelection(ctx: CanvasRenderingContext2D, hex: HexTile, cam: Camera) {
  const { cx, cy, s } = tileScreen(hex, cam);
  hexPath(ctx, cx, cy, s * 0.95);
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

// --- contents (vector art) -------------------------------------------------

function drawContents(
  ctx: CanvasRenderingContext2D,
  hex: HexTile,
  cam: Camera,
  rs: RenderState,
  dim: boolean
) {
  const { cx, cy, s } = tileScreen(hex, cam);
  if (s < 6) return; // too small to bother
  ctx.save();
  if (dim) ctx.globalAlpha = 0.4;

  if (hex.obj !== "none") drawObject(ctx, hex.obj, cx, cy, s);
  if (hex.unit) drawUnit(ctx, hex, cx, cy, s, rs);

  ctx.restore();
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: HexObj,
  cx: number,
  cy: number,
  s: number
) {
  switch (obj) {
    case "pine":
      drawPine(ctx, cx, cy, s);
      break;
    case "palm":
      drawPalm(ctx, cx, cy, s);
      break;
    case "town":
      drawHouse(ctx, cx, cy, s);
      break;
    case "tower":
      drawTower(ctx, cx, cy, s, false);
      break;
    case "strongTower":
      drawTower(ctx, cx, cy, s, true);
      break;
    case "farm":
      drawFarm(ctx, cx, cy, s);
      break;
    case "grave":
      drawGrave(ctx, cx, cy, s);
      break;
    default:
      break;
  }
}

function drawPine(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const u = s * 0.5;
  // trunk
  ctx.fillStyle = "#5b3a1e";
  ctx.fillRect(cx - u * 0.08, cy + u * 0.25, u * 0.16, u * 0.4);
  // tiered triangle tree
  ctx.fillStyle = "#1f6b2e";
  const tiers = [
    [0.55, 0.05],
    [0.42, -0.2],
    [0.3, -0.42],
  ];
  for (const [w, top] of tiers) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + top * u - u * 0.35);
    ctx.lineTo(cx - w * u, cy + top * u + u * 0.18);
    ctx.lineTo(cx + w * u, cy + top * u + u * 0.18);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPalm(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const u = s * 0.5;
  // curved trunk
  ctx.strokeStyle = "#7a5128";
  ctx.lineWidth = Math.max(1, u * 0.14);
  ctx.beginPath();
  ctx.moveTo(cx - u * 0.05, cy + u * 0.55);
  ctx.quadraticCurveTo(cx + u * 0.18, cy, cx, cy - u * 0.45);
  ctx.stroke();
  // fronds
  ctx.strokeStyle = "#2f9e44";
  ctx.lineWidth = Math.max(1, u * 0.12);
  const top = { x: cx, y: cy - u * 0.45 };
  const fronds = [-0.8, -0.35, 0.1, 0.5, 0.85];
  for (const a of fronds) {
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.quadraticCurveTo(
      top.x + Math.sin(a) * u * 0.5,
      top.y - u * 0.25,
      top.x + Math.sin(a) * u * 0.85,
      top.y + Math.cos(a) * u * 0.1
    );
    ctx.stroke();
  }
}

function drawHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const u = s * 0.5;
  const w = u * 0.8;
  const h = u * 0.55;
  // body
  ctx.fillStyle = "#f2e9d8";
  ctx.fillRect(cx - w / 2, cy - h * 0.1, w, h);
  // roof
  ctx.fillStyle = "#9c3b2e";
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.62, cy - h * 0.1);
  ctx.lineTo(cx, cy - h * 0.7);
  ctx.lineTo(cx + w * 0.62, cy - h * 0.1);
  ctx.closePath();
  ctx.fill();
  // door
  ctx.fillStyle = "#6b4a2b";
  ctx.fillRect(cx - w * 0.12, cy + h * 0.12, w * 0.24, h * 0.37);
}

function drawTower(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  strong: boolean
) {
  const u = s * 0.5;
  const w = strong ? u * 0.7 : u * 0.55;
  const h = strong ? u * 0.95 : u * 0.75;
  ctx.fillStyle = strong ? "#9aa0a6" : "#aeb4ba";
  ctx.fillRect(cx - w / 2, cy - h * 0.5, w, h);
  // crenellations
  ctx.fillStyle = strong ? "#7e848a" : "#8d9398";
  const merlons = 3;
  const mw = w / (merlons * 2 - 1);
  for (let i = 0; i < merlons; i++) {
    ctx.fillRect(cx - w / 2 + i * 2 * mw, cy - h * 0.5 - mw * 0.8, mw, mw * 0.8);
  }
  // shading
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(cx, cy - h * 0.5, w / 2, h);
  if (strong) {
    // crown on top
    ctx.fillStyle = "#f2c14e";
    ctx.beginPath();
    const cw = w * 0.7;
    const cyTop = cy - h * 0.5 - mw * 0.8;
    ctx.moveTo(cx - cw / 2, cyTop);
    ctx.lineTo(cx - cw / 2, cyTop - u * 0.28);
    ctx.lineTo(cx - cw / 4, cyTop - u * 0.12);
    ctx.lineTo(cx, cyTop - u * 0.3);
    ctx.lineTo(cx + cw / 4, cyTop - u * 0.12);
    ctx.lineTo(cx + cw / 2, cyTop - u * 0.28);
    ctx.lineTo(cx + cw / 2, cyTop);
    ctx.closePath();
    ctx.fill();
  }
}

function drawFarm(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const u = s * 0.5;
  const w = u * 0.95;
  const h = u * 0.7;
  // field rows
  ctx.fillStyle = "#c9a227";
  ctx.fillRect(cx - w / 2, cy - h * 0.15, w, h * 0.8);
  ctx.strokeStyle = "#9c7d18";
  ctx.lineWidth = Math.max(0.5, u * 0.06);
  for (let i = 1; i < 4; i++) {
    const ry = cy - h * 0.15 + (h * 0.8 * i) / 4;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, ry);
    ctx.lineTo(cx + w / 2, ry);
    ctx.stroke();
  }
  // small barn
  ctx.fillStyle = "#b5462f";
  ctx.fillRect(cx - w * 0.5, cy - h * 0.55, w * 0.32, h * 0.42);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.52, cy - h * 0.55);
  ctx.lineTo(cx - w * 0.34, cy - h * 0.78);
  ctx.lineTo(cx - w * 0.16, cy - h * 0.55);
  ctx.closePath();
  ctx.fill();
}

function drawGrave(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const u = s * 0.5;
  ctx.fillStyle = "#8a8f94";
  const w = u * 0.5;
  const h = u * 0.7;
  // rounded headstone
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy + h * 0.4);
  ctx.lineTo(cx - w / 2, cy - h * 0.1);
  ctx.arc(cx, cy - h * 0.1, w / 2, Math.PI, 0);
  ctx.lineTo(cx + w / 2, cy + h * 0.4);
  ctx.closePath();
  ctx.fill();
  // cross
  ctx.strokeStyle = "#5f6469";
  ctx.lineWidth = Math.max(1, u * 0.1);
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.25);
  ctx.lineTo(cx, cy + h * 0.2);
  ctx.moveTo(cx - w * 0.3, cy - h * 0.05);
  ctx.lineTo(cx + w * 0.3, cy - h * 0.05);
  ctx.stroke();
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
  const u = s * 0.5;
  const strength = unit.strength;
  // Radius grows with strength.
  const radius = u * (0.34 + strength * 0.07);
  // Bob animation when ready to move.
  let bob = 0;
  if (unit.readyToMove) {
    bob = Math.sin(rs.now / 220 + hex.index) * u * 0.08;
  }
  const uy = cy + bob;

  // Body color darkens with strength; desaturate spent units.
  const bodyShades = ["#e7ecf2", "#c6d0db", "#9aa7b6", "#6f7e90"];
  let body = bodyShades[Math.min(3, strength - 1)];
  if (!unit.readyToMove) body = "#8a8f96"; // spent -> grey

  // ready-to-move white outline
  if (unit.readyToMove) {
    ctx.beginPath();
    ctx.arc(cx, uy, radius + Math.max(1.5, u * 0.1), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
  }

  // body circle
  ctx.beginPath();
  ctx.arc(cx, uy, radius, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(1, u * 0.08);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.stroke();

  // little head to read as a figure
  ctx.beginPath();
  ctx.arc(cx, uy - radius * 0.55, radius * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = shade(body, -0.15);
  ctx.fill();

  // strength number
  if (s > 16) {
    ctx.fillStyle = "#10151c";
    ctx.font = `bold ${Math.round(radius * 1.0)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(strength), cx, uy + radius * 0.2);
  } else {
    // pips
    ctx.fillStyle = "#10151c";
    for (let i = 0; i < strength; i++) {
      ctx.beginPath();
      ctx.arc(cx - (strength - 1) * 1.5 + i * 3, uy + radius * 0.5, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
