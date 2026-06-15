// Canvas renderer for the Antiyoy board, drawing the original game's sprites
// (assets/skins/ant field-element atlas) over flat hexes in the original palette.
// Hex outlines are drawn on territory borders only, like the original.

import { NEUTRAL_FRACTION } from "./game/constants";
import type { Fraction, GameState, HexObj, HexTile } from "./game/types";
import { type Camera, HEX_SIZE, worldToScreen } from "./camera";
import { hexCorners, hexToPixel } from "./hex";
import { settings } from "./settings";
import {
  ATLAS_URL,
  ORIGINAL_FRACTION_COLORS,
  ORIGINAL_NEUTRAL_COLOR,
  ICON_DEFENSE_URL,
  SPRITES,
  WATER_COLOR,
} from "./sprites";

export interface RenderState {
  /** Hex index of the currently selected unit or building, or -1. */
  selectedHex: number;
  /** Hex index of a selected defensive building whose coverage is shown, or -1. */
  protectionSource: number;
  /** Province id whose whole territory should be highlighted, or -1. */
  highlightProvince: number;
  /** Set of hex indices that are "active" interaction targets (move/buy/build zone). */
  zone: Set<number> | null;
  /** When true, non-zone tiles are dimmed. */
  dimNonZone: boolean;
  /** Time in ms for animations. */
  now: number;
  /** Fraction whose turn it is; only its units animate (jump). */
  activeFraction: Fraction;
  /** Fog of war: indices the viewer can see. null = no fog (see everything). */
  fog?: Set<number> | null;
}

// --- sprite atlas ------------------------------------------------------------

const atlas = new Image();
let atlasReady = false;
atlas.onload = () => {
  atlasReady = true;
};
// The atlas is served cross-origin (CDN). Request it with CORS so drawing it
// onto the board canvas does not taint the canvas (the smoke test reads back
// pixels). jsDelivr sends Access-Control-Allow-Origin: *.
atlas.crossOrigin = "anonymous";
atlas.src = ATLAS_URL;

const defenseIcon = new Image();
let defenseIconReady = false;
defenseIcon.onload = () => {
  defenseIconReady = true;
};
defenseIcon.crossOrigin = "anonymous";
defenseIcon.src = ICON_DEFENSE_URL;

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

// Preferred-color rotation for the current frame (set by renderBoard).
let paletteOffset = 0;

function fractionColor(fraction: number): string {
  if (fraction >= NEUTRAL_FRACTION) return ORIGINAL_NEUTRAL_COLOR;
  return (
    ORIGINAL_FRACTION_COLORS[(fraction + paletteOffset) % ORIGINAL_FRACTION_COLORS.length] ??
    ORIGINAL_NEUTRAL_COLOR
  );
}

function colorToRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const h = color.slice(1);
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const match = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (!match) throw new Error(`Unsupported color format: ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function shade(color: string, amount: number): string {
  // amount > 0 lightens, < 0 darkens.
  const [r, g, b] = colorToRgb(color);
  const f = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// --- neighbor-by-direction lookup ---------------------------------------------

/** Must match the engine's neighbor order. */
const AXIAL_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

const coordCache = new WeakMap<GameState, Map<string, number>>();

function coordIndex(state: GameState): Map<string, number> {
  let m = coordCache.get(state);
  if (!m) {
    m = new Map();
    for (const hex of state.hexes) m.set(hex.q + "," + hex.r, hex.index);
    coordCache.set(state, m);
  }
  return m;
}

/** Neighbor tile in direction d, or null at the map edge. */
function neighborAt(state: GameState, hex: HexTile, d: number): HexTile | null {
  const idx = coordIndex(state).get(hex.q + AXIAL_DIRS[d][0] + "," + (hex.r + AXIAL_DIRS[d][1]));
  return idx === undefined ? null : state.hexes[idx];
}

/**
 * Edge index (into hexCorners) facing direction d, for pointy-top hexes:
 * the edge between corners k and k+1, where k = (7 - d) % 6.
 */
function edgeCorner(d: number): number {
  return (7 - d) % 6;
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
  paletteOffset = state.config.colorOffset ?? 0;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = WATER_COLOR;
  ctx.fillRect(0, 0, cssW, cssH);

  // Whole-territory highlight for the selected province.
  let highlight: Set<number> | null = null;
  if (rs.highlightProvince >= 0) {
    const prov = state.provinces.find((p) => p.id === rs.highlightProvince);
    if (prov) highlight = new Set(prov.hexes);
  }

  // Pass 1: tile fills.
  for (const hex of state.hexes) {
    if (!hex.active) continue;
    drawTileFill(ctx, hex, cam, rs, highlight);
  }
  // Pass 2: territory borders (edges between different owners / water only).
  drawBorders(ctx, state, cam, rs, highlight);
  // Pass 3: contents + units (hidden on fogged tiles).
  for (const hex of state.hexes) {
    if (!hex.active) continue;
    if (rs.fog && !rs.fog.has(hex.index)) continue;
    const dim = rs.dimNonZone && !(rs.zone && rs.zone.has(hex.index));
    drawContents(ctx, hex, cam, rs, dim);
  }
  // Fog overlay: darken active tiles the viewer cannot see.
  if (rs.fog) {
    ctx.fillStyle = "rgba(20,26,38,0.62)";
    for (const hex of state.hexes) {
      if (!hex.active || rs.fog.has(hex.index)) continue;
      const { cx, cy, s } = tileScreen(hex, cam);
      hexPath(ctx, cx, cy, s * 1.02);
      ctx.fill();
    }
  }
  // Defensive buildings protect their own tile and adjacent friendly land.
  if (rs.protectionSource >= 0) {
    drawProtection(ctx, state, cam, rs);
  }
  // Pass 4: zone markers + selected-hex ring.
  if (rs.zone && rs.dimNonZone) {
    for (const idx of rs.zone) {
      const hex = state.hexes[idx];
      if (!hex || !hex.active) continue;
      drawZoneMarker(ctx, hex, cam, rs.now);
    }
  }
  if (rs.protectionSource < 0 && rs.selectedHex >= 0 && state.hexes[rs.selectedHex]?.active) {
    drawSelection(ctx, state.hexes[rs.selectedHex], cam, rs.now);
  }
}

function drawProtection(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  rs: RenderState
) {
  const source = state.hexes[rs.protectionSource];
  if (!source?.active || !isDefensiveBuilding(source.obj)) return;
  const province = state.provinces.find((candidate) => candidate.id === rs.highlightProvince);
  if (!province) return;

  const defensiveBuildings = province.hexes
    .map((index) => state.hexes[index])
    .filter((hex) => hex?.active && isDefensiveBuilding(hex.obj));
  const protectedIndices = new Set<number>();
  for (const building of defensiveBuildings) {
    protectedIndices.add(building.index);
    for (const index of building.neighbors) {
      const neighbor = state.hexes[index];
      if (neighbor?.active && neighbor.fraction === source.fraction) protectedIndices.add(index);
    }
  }

  for (const index of protectedIndices) {
    const hex = state.hexes[index];
    if (rs.fog && !rs.fog.has(hex.index)) continue;
    const { cx, cy, s } = tileScreen(hex, cam);
    const size = Math.max(18, s * 1.05);
    const x = cx - size / 2;
    const y = cy - size / 2;
    ctx.save();
    ctx.globalAlpha = 0.72;
    if (defenseIconReady) {
      ctx.drawImage(defenseIcon, x, y, size, size);
    } else {
      drawShieldFallback(ctx, x, y, size);
    }
    ctx.restore();
  }

  for (const building of defensiveBuildings) {
    if (rs.fog && !rs.fog.has(building.index)) continue;
    drawSelection(ctx, building, cam, rs.now);
  }
}

function isDefensiveBuilding(obj: HexObj): boolean {
  return obj === "town" || obj === "tower" || obj === "strongTower";
}

function drawShieldFallback(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.fillStyle = "rgba(20,20,20,0.9)";
  ctx.beginPath();
  ctx.moveTo(x + size * 0.5, y + size * 0.08);
  ctx.lineTo(x + size * 0.82, y + size * 0.22);
  ctx.lineTo(x + size * 0.76, y + size * 0.62);
  ctx.quadraticCurveTo(x + size * 0.68, y + size * 0.82, x + size * 0.5, y + size * 0.92);
  ctx.quadraticCurveTo(x + size * 0.32, y + size * 0.82, x + size * 0.24, y + size * 0.62);
  ctx.lineTo(x + size * 0.18, y + size * 0.22);
  ctx.closePath();
  ctx.fill();
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

function tileFillColor(hex: HexTile, rs: RenderState, highlight: Set<number> | null): string {
  let fill = fractionColor(hex.fraction);
  const inZone = rs.zone && rs.zone.has(hex.index);
  const dim = rs.dimNonZone && !inZone;
  if (highlight && highlight.has(hex.index)) {
    // The selected territory breathes a little, like the original.
    const pulse = 0.1 + 0.06 * (0.5 + 0.5 * Math.sin(rs.now / 320));
    fill = shade(fill, pulse);
  }
  if (dim) fill = shade(fill, -0.45);
  return fill;
}

function drawTileFill(
  ctx: CanvasRenderingContext2D,
  hex: HexTile,
  cam: Camera,
  rs: RenderState,
  highlight: Set<number> | null
) {
  const { cx, cy, s } = tileScreen(hex, cam);
  // Tiny overdraw hides seams between adjacent same-color tiles.
  hexPath(ctx, cx, cy, s * 1.02);
  ctx.fillStyle = tileFillColor(hex, rs, highlight);
  ctx.fill();
}

function drawBorders(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  rs: RenderState,
  highlight: Set<number> | null
) {
  ctx.lineCap = "round";
  for (const hex of state.hexes) {
    if (!hex.active) continue;
    const { cx, cy, s } = tileScreen(hex, cam);
    const corners = hexCorners(s);
    const fill = tileFillColor(hex, rs, highlight);

    if (settings.showAllBorders) {
      hexPath(ctx, cx, cy, s);
      ctx.lineWidth = Math.max(1, s * 0.045);
      ctx.strokeStyle = shade(fractionColor(hex.fraction), -0.25);
      ctx.stroke();
      continue;
    }

    const isNeutral = hex.fraction >= NEUTRAL_FRACTION;
    for (let d = 0; d < 6; d++) {
      const n = neighborAt(state, hex, d);
      const ownershipEdge = !n || !n.active || n.fraction !== hex.fraction;
      // Unclaimed land always shows its hex grid (like the original's gray
      // tiles); owned territory is solid inside, outlined only at its border.
      if (!ownershipEdge && !isNeutral) continue;
      const innerNeutral = isNeutral && !ownershipEdge;
      const k = edgeCorner(d);
      const a = corners[k];
      const b = corners[(k + 1) % 6];
      ctx.beginPath();
      ctx.moveTo(cx + a.x, cy + a.y);
      ctx.lineTo(cx + b.x, cy + b.y);
      ctx.lineWidth = innerNeutral ? Math.max(1, s * 0.05) : Math.max(1.2, s * 0.09);
      ctx.strokeStyle = shade(fill, innerNeutral ? -0.18 : -0.35);
      ctx.stroke();
    }
  }

  // White pulsing outline around the selected territory.
  if (highlight) {
    const pulse = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(rs.now / 280));
    ctx.strokeStyle = `rgba(255,255,255,${pulse.toFixed(3)})`;
    for (const idx of highlight) {
      const hex = state.hexes[idx];
      if (!hex?.active) continue;
      const { cx, cy, s } = tileScreen(hex, cam);
      const corners = hexCorners(s);
      for (let d = 0; d < 6; d++) {
        const n = neighborAt(state, hex, d);
        if (n && n.active && highlight.has(n.index)) continue;
        const k = edgeCorner(d);
        const a = corners[k];
        const b = corners[(k + 1) % 6];
        ctx.beginPath();
        ctx.moveTo(cx + a.x, cy + a.y);
        ctx.lineTo(cx + b.x, cy + b.y);
        ctx.lineWidth = Math.max(2, s * 0.11);
        ctx.stroke();
      }
    }
  }
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
      // Province capital / main base — distinct castle sprite, not a house.
      drawSprite(ctx, "castle", cx, cy, size);
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
  // Original units jump in place while they can still move — but only the
  // player whose turn it is. Enemy/idle units stay put off-turn.
  let bob = 0;
  if (unit.readyToMove && hex.fraction === rs.activeFraction && settings.unitAnimations) {
    const t = (rs.now / 380 + hex.index * 0.7) % 1;
    bob = -Math.abs(Math.sin(t * Math.PI)) * s * 0.18;
  }
  if (!unit.readyToMove) {
    ctx.globalAlpha *= 0.8; // spent units rest, slightly faded
  }
  drawSprite(ctx, "man" + (unit.strength - 1), cx, cy + bob, s * 1.35);
}
