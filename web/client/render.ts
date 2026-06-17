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
  if (night) return rgbStr(night.lightRgb(fraction));
  if (fraction >= NEUTRAL_FRACTION) return ORIGINAL_NEUTRAL_COLOR;
  return (
    ORIGINAL_FRACTION_COLORS[(fraction + paletteOffset) % ORIGINAL_FRACTION_COLORS.length] ??
    ORIGINAL_NEUTRAL_COLOR
  );
}

function paletteFractionColor(fraction: number): string {
  if (fraction >= NEUTRAL_FRACTION || fraction < 0) return ORIGINAL_NEUTRAL_COLOR;
  return (
    ORIGINAL_FRACTION_COLORS[(fraction + paletteOffset) % ORIGINAL_FRACTION_COLORS.length] ??
    ORIGINAL_NEUTRAL_COLOR
  );
}

// --- Night Battle lighting ----------------------------------------------------
// A dark, readable battlefield. Land keeps a flat, muted color so territories
// stay distinguishable and clearly separate from the darker void background:
// friendly (human) land is a dark warm amber, each enemy a dark white tinted by
// a 4000K–7000K color temperature, neutral land a dark slate. The ONLY light
// effect is a soft halo of light fog around lanterns (towers); houses, units and
// trees draw as plain sprites with no glow. Set per frame by renderBoard().

interface NightContext {
  /** Flat, muted land color for a fraction (kept dark for contrast). */
  tileRgb: (fraction: number) => [number, number, number];
  /** Emissive identity color (warm yellow for us, kelvin white per enemy). */
  lightRgb: (fraction: number) => [number, number, number];
}

let night: NightContext | null = null;

// Background void — clearly darker and a touch bluer than any land tile, so the
// island reads as a distinct shape against it.
const NIGHT_BACKGROUND = "#04060c";
/** Saturated warm yellow identity for the player's own side. */
const FRIENDLY_LIGHT: [number, number, number] = [255, 214, 74];
/** Neutral / unclaimed land: a dark slate that still reads as ground. */
const NIGHT_NEUTRAL_TILE: [number, number, number] = [34, 39, 50];

function rgbStr(c: [number, number, number]): string {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

/** Approximate sRGB for a black-body color temperature (Tanner Helland fit). */
function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  return [clamp(r), clamp(g), clamp(b)];
}

function buildNight(state: GameState): NightContext {
  const { humanCount, playerCount } = state.config;
  // "My" side: the human seats. Spectator games (no humans) treat seat 0 as ours.
  const isFriendly = (f: number) => (humanCount > 0 ? f < humanCount : f === 0);

  // Spread the enemy seats across the 4000K (warm) → 7000K (cool) white range.
  const enemies: number[] = [];
  for (let f = 0; f < playerCount; f++) if (!isFriendly(f)) enemies.push(f);
  const kelvinOf = new Map<number, number>();
  enemies.forEach((f, i) => {
    const k = enemies.length <= 1 ? 5500 : 4000 + (i / (enemies.length - 1)) * 3000;
    kelvinOf.set(f, k);
  });

  const lightCache = new Map<number, [number, number, number]>();
  const lightRgb = (fraction: number): [number, number, number] => {
    if (fraction >= NEUTRAL_FRACTION || fraction < 0) return [70, 78, 98];
    let c = lightCache.get(fraction);
    if (!c) {
      c = isFriendly(fraction) ? FRIENDLY_LIGHT : kelvinToRgb(kelvinOf.get(fraction) ?? 5500);
      lightCache.set(fraction, c);
    }
    return c;
  };

  // Land color = a dark, desaturated take on the identity color: keeps the hue
  // for orientation while leaving the map genuinely dark.
  const tileCache = new Map<number, [number, number, number]>();
  const tileRgb = (fraction: number): [number, number, number] => {
    if (fraction >= NEUTRAL_FRACTION || fraction < 0) return NIGHT_NEUTRAL_TILE;
    let c = tileCache.get(fraction);
    if (!c) {
      const L = lightRgb(fraction);
      c = [L[0] * 0.2 + 14, L[1] * 0.2 + 14, L[2] * 0.2 + 14];
      tileCache.set(fraction, c);
    }
    return c;
  };

  return { tileRgb, lightRgb };
}

/**
 * The light a lantern casts is drawn separately as a glow over the surrounding
 * hex cells (see drawLanternGlow); this only draws the fixture itself: a thin
 * post and a small glowing hex bulb.
 */
function drawLantern(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  rgb: [number, number, number],
  strong: boolean
) {
  const col = rgbStr(rgb);

  const u = s * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  // Post.
  ctx.strokeStyle = "rgba(18,20,26,0.9)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.2, u * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, u * 0.95);
  ctx.lineTo(0, u * 0.12);
  ctx.stroke();
  if (strong) {
    // Strong lanterns keep the same shape language, but get a reinforced frame.
    ctx.lineWidth = Math.max(1, u * 0.08);
    ctx.beginPath();
    ctx.moveTo(-u * 0.22, u * 0.88);
    ctx.lineTo(-u * 0.22, -u * 0.05);
    ctx.moveTo(u * 0.22, u * 0.88);
    ctx.lineTo(u * 0.22, -u * 0.05);
    ctx.stroke();
  }
  // Glowing hex bulb.
  const bw = u * (strong ? 0.62 : 0.5);
  const bh = u * (strong ? 0.82 : 0.72);
  ctx.beginPath();
  ctx.moveTo(0, -bh * 0.95);
  ctx.lineTo(bw, -bh * 0.32);
  ctx.lineTo(bw, bh * 0.32);
  ctx.lineTo(0, bh * 0.55);
  ctx.lineTo(-bw, bh * 0.32);
  ctx.lineTo(-bw, -bh * 0.32);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = s * 0.5;
  ctx.fill();
  ctx.shadowBlur = 0;
  if (strong) {
    ctx.strokeStyle = "rgba(14,15,20,0.7)";
    ctx.lineWidth = Math.max(1, u * 0.08);
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-bw * 0.7, -bh * 0.62);
    ctx.lineTo(bw * 0.7, -bh * 0.62);
    ctx.moveTo(-bw * 0.68, bh * 0.34);
    ctx.lineTo(bw * 0.68, bh * 0.34);
    ctx.stroke();
  }
  // Bright core.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(0, -bh * 0.05, bw * 0.42, bh * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  if (strong) {
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = s * 0.28;
    ctx.beginPath();
    ctx.ellipse(0, bh * 0.68, bw * 0.26, bh * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  // Minimal dark frame.
  ctx.strokeStyle = "rgba(14,15,20,0.5)";
  ctx.lineWidth = Math.max(1, u * 0.07);
  ctx.beginPath();
  ctx.moveTo(0, -bh * 0.95);
  ctx.lineTo(0, bh * 0.55);
  ctx.stroke();
  ctx.restore();
}

/**
 * A dead, broken lantern — stands in for trees in Night Battle. A leaning post
 * topped by a shattered glass shade (jagged crown, cracks, a falling shard). It
 * casts no light: the glass is dark and cold.
 */
function drawBrokenLantern(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  const u = s * 0.5;
  const glass = "rgba(66,70,82,0.6)";
  const edge = "rgba(158,164,176,0.9)";
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.07); // leans, derelict
  // Post.
  ctx.strokeStyle = "rgba(18,20,26,0.9)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.2, u * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, u * 0.95);
  ctx.lineTo(0, u * 0.05);
  ctx.stroke();

  // Shattered shade: hex body with a jagged broken crown along the top.
  const bw = u * 0.52;
  const bh = u * 0.72;
  ctx.lineJoin = "round";
  ctx.fillStyle = glass;
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, u * 0.09);
  ctx.beginPath();
  ctx.moveTo(-bw, bh * 0.3);
  ctx.lineTo(-bw, -bh * 0.12);
  // Jagged "broken glass" crown, left → right.
  ctx.lineTo(-bw * 0.6, -bh * 0.58);
  ctx.lineTo(-bw * 0.28, -bh * 0.18);
  ctx.lineTo(-bw * 0.02, -bh * 0.66);
  ctx.lineTo(bw * 0.3, -bh * 0.14);
  ctx.lineTo(bw * 0.58, -bh * 0.5);
  ctx.lineTo(bw, -bh * 0.06);
  ctx.lineTo(bw, bh * 0.3);
  ctx.lineTo(0, bh * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cracks across the remaining glass.
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.strokeStyle = "rgba(158,164,176,0.7)";
  ctx.beginPath();
  ctx.moveTo(-bw * 0.45, bh * 0.28);
  ctx.lineTo(-bw * 0.05, -bh * 0.05);
  ctx.lineTo(bw * 0.4, bh * 0.18);
  ctx.moveTo(-bw * 0.05, -bh * 0.05);
  ctx.lineTo(bw * 0.05, bh * 0.45);
  ctx.stroke();

  // A shard that broke off, floating just above the gap.
  ctx.fillStyle = "rgba(158,164,176,0.85)";
  ctx.beginPath();
  ctx.moveTo(bw * 0.2, -bh * 0.95);
  ctx.lineTo(bw * 0.5, -bh * 0.78);
  ctx.lineTo(bw * 0.22, -bh * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Light cast by every lantern, shaped to the hex grid: each lantern lights its
 * own cell and the surrounding ring of hexes (strong lanterns reach a second
 * ring), fading out by cell. Drawn additively over the tiles so overlapping
 * lanterns reinforce each other — a hex "flower" of light, not a round halo.
 */
function drawLanternGlow(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  rs: RenderState
) {
  if (!night) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const hex of state.hexes) {
    if (!hex.active || (hex.obj !== "tower" && hex.obj !== "strongTower")) continue;
    if (rs.fog && !rs.fog.has(hex.index)) continue;
    const strong = hex.obj === "strongTower";
    const [r, g, b] = night.lightRgb(hex.fraction);
    const paint = (idx: number, alpha: number) => {
      const tile = state.hexes[idx];
      if (!tile?.active) return;
      // Light falls only on the lantern owner's own (friendly) cells.
      if (tile.fraction !== hex.fraction) return;
      if (rs.fog && !rs.fog.has(idx)) return;
      const { cx, cy, s } = tileScreen(tile, cam);
      hexPath(ctx, cx, cy, s);
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
      ctx.fill();
    };
    paint(hex.index, strong ? 0.36 : 0.3); // the lit cell itself
    for (const ni of hex.neighbors) paint(ni, strong ? 0.18 : 0.15); // first ring
    if (strong) {
      const seen = new Set<number>([hex.index, ...hex.neighbors]);
      for (const ni of hex.neighbors) {
        const ring1 = state.hexes[ni];
        if (!ring1?.active) continue;
        for (const nj of ring1.neighbors) {
          if (seen.has(nj)) continue;
          seen.add(nj);
          paint(nj, 0.08); // second ring
        }
      }
    }
  }
  ctx.restore();
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
  night = state.config.nightBattle ? buildNight(state) : null;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = night ? NIGHT_BACKGROUND : WATER_COLOR;
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
  // Night Battle: lantern light, shaped to the surrounding hex cells.
  if (night) drawLanternGlow(ctx, state, cam, rs);
  // Pass 3: contents + units (hidden on fogged tiles).
  for (const hex of state.hexes) {
    if (!hex.active) continue;
    if (rs.fog && !rs.fog.has(hex.index)) continue;
    const dim = rs.dimNonZone && !(rs.zone && rs.zone.has(hex.index));
    drawContents(ctx, state, hex, cam, rs, dim);
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
  let fill = night ? rgbStr(night.tileRgb(hex.fraction)) : fractionColor(hex.fraction);
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
      // Night mode keeps the darkness clean — only territory edges are drawn.
      if (night && innerNeutral) continue;
      const k = edgeCorner(d);
      const a = corners[k];
      const b = corners[(k + 1) % 6];
      ctx.beginPath();
      ctx.moveTo(cx + a.x, cy + a.y);
      ctx.lineTo(cx + b.x, cy + b.y);
      if (night) {
        // Coastline (edge against the void) gets a faint moonlit rim so the
        // island reads against the background; territory edges glow in the
        // owner's identity color.
        const coast = !n || !n.active;
        ctx.lineWidth = coast ? Math.max(1, s * 0.06) : Math.max(1.2, s * 0.09);
        ctx.strokeStyle = coast
          ? "rgba(120,140,170,0.35)"
          : shade(fractionColor(hex.fraction), -0.05);
        ctx.stroke();
        continue;
      }
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
  state: GameState,
  hex: HexTile,
  cam: Camera,
  rs: RenderState,
  dim: boolean
) {
  const { cx, cy, s } = tileScreen(hex, cam);
  if (s < 5) return; // too small to bother
  ctx.save();
  if (dim) ctx.globalAlpha = 0.4;

  if (hex.obj !== "none") drawObject(ctx, state, hex, hex.obj, cx, cy, s);
  if (hex.unit) drawUnit(ctx, hex, cx, cy, s, rs);

  ctx.restore();
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  hex: HexTile,
  obj: HexObj,
  cx: number,
  cy: number,
  s: number
) {
  const size = s * 1.35; // sprites have padding baked into their 160px frame
  switch (obj) {
    case "pine":
      if (night) drawBrokenLantern(ctx, cx, cy, s);
      else drawSprite(ctx, "pine", cx, cy, size);
      break;
    case "palm":
      if (night) drawBrokenLantern(ctx, cx, cy, s);
      else drawSprite(ctx, "palm", cx, cy, size);
      break;
    case "town":
      drawSprite(ctx, state.config.mode === "slay" ? "house" : "castle", cx, cy, size);
      break;
    case "tower":
      if (night) drawLantern(ctx, cx, cy, s, night.lightRgb(hex.fraction), false);
      else drawSprite(ctx, "tower", cx, cy, size);
      break;
    case "strongTower":
      if (night) drawLantern(ctx, cx, cy, s, night.lightRgb(hex.fraction), true);
      else drawSprite(ctx, "strong_tower", cx, cy, size);
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
  const y = cy + bob;
  const sprite = "man" + (unit.strength - 1);
  if (!atlasReady || !SPRITES[sprite]) return;
  drawSprite(ctx, sprite, cx, y, s * 1.35);
  drawUnitFactionMarker(ctx, hex.fraction, cx, y, s);
}

function drawUnitFactionMarker(
  ctx: CanvasRenderingContext2D,
  fraction: number,
  cx: number,
  cy: number,
  s: number
) {
  const r = Math.max(2.6, s * 0.12);
  const x = cx + s * 0.16;
  const y = cy - s * 0.05;
  const fill = paletteFractionColor(fraction);

  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = "round";

  if (night) {
    ctx.shadowColor = rgbStr(night.lightRgb(fraction));
    ctx.shadowBlur = Math.max(3, s * 0.12);
  }

  ctx.beginPath();
  unitMarkerPath(ctx, r);
  ctx.fillStyle = "rgba(8,10,14,0.86)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, s * 0.032);
  ctx.strokeStyle = night ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.72)";
  ctx.stroke();

  ctx.beginPath();
  unitMarkerPath(ctx, r * 0.66);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(0.8, s * 0.018);
  ctx.strokeStyle = shade(fill, -0.42);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-r * 0.18, -r * 0.22, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
  ctx.restore();
}

function unitMarkerPath(ctx: CanvasRenderingContext2D, r: number) {
  ctx.moveTo(0, -r * 1.05);
  ctx.lineTo(r * 0.9, -r * 0.58);
  ctx.lineTo(r * 0.72, r * 0.42);
  ctx.quadraticCurveTo(r * 0.58, r * 0.86, 0, r * 1.1);
  ctx.quadraticCurveTo(-r * 0.58, r * 0.86, -r * 0.72, r * 0.42);
  ctx.lineTo(-r * 0.9, -r * 0.58);
  ctx.closePath();
}
