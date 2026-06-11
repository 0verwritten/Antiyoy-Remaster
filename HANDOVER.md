# Antiyoy Remaster — Development Handover

Last updated: 2026-06-11. This file lets a fresh session (or developer) pick up
the project without re-deriving context. Read this first, then `web/AGENTS.md`.

## What this project is

A from-scratch **TypeScript web remaster** of the Android game Antiyoy, living
in `web/` inside the fork **github.com/0verwritten/Antiyoy-Remaster**
(parent: `yiotro/Antiyoy`). The original Java/libGDX source (`core/`, `assets/`)
is kept untouched and is used as the **reference implementation** — rules,
constants, sprites and the map generator were all ported from it.

- **Live:** https://antiyoy.lakebed.app (canonical; other capsule subdomains
  redirect to it client-side — see top of `web/client/index.tsx`)
- **Hosting:** [lakebed](https://www.npmjs.com/package/lakebed) capsule,
  deploy id `dep_TKkiPiwzh7CAkJC7`, CLI authed as `0verwritten`
- **Repo auth:** push via SSH (`~/.ssh/config` has the github.com entry for
  `~/.ssh/id_git`). The fine-grained PAT in `.github-token` (gitignored)
  authenticates the API but **cannot push** (no Contents:write).

## Architecture (everything under `web/`)

| Path | Role |
|---|---|
| `client/game/constants.ts` | Gameplay constants, **verbatim from** `core/src/yio/tro/antiyoy/gameplay/rules/GameRules.java` |
| `client/game/types.ts` | All shared types (`GameState`, `Action`, `GameConfig`…). `GameState` is plain JSON data — `structuredClone` works (undo relies on this) |
| `client/game/engine.ts` | Pure rules engine: grid, provinces (stable ids across captures!), economy, defense, move/buy/build zones, `applyAction`, turn flow, tree spread, bankruptcy, elimination |
| `client/game/mapgen.ts` | Port of the original `MapGenerator`/`MapGeneratorGeneric`: island blobs + roads, retry until connected & ≥25 % land, province spawn/cut/balance |
| `client/game/ai.ts` | Greedy AI with `easy/normal/hard` tunings (`aiTakeTurn` runs a whole turn incl. `endTurn`) |
| `client/index.tsx` | Preact app: start menu, settings screen, game screen, HUD, hotseat pass screen, victory overlay, undo stack, AI turn chains, pointer/keyboard input |
| `client/render.ts` | Canvas renderer: sprite atlas, original palette, **borders only between owners** (full grid on neutral land), province highlight |
| `client/camera.ts`, `client/hex.ts` | Pan/zoom camera, axial↔pixel math, tap hit-testing |
| `client/sprites.ts` | **Generated** — base64 atlas from `assets/skins/ant/field_elements/` + coin/end-turn/undo icons + sampled original palette. Regenerate with the python snippet in git history (commit "Restore original Antiyoy look") if assets change |
| `client/settings.ts` | localStorage settings (AI speed, outlines, animations, end-turn confirm) |
| `server/index.ts` | Near-empty capsule definition + `/api/status`. The game is 100 % client-side |

Game modes (`GameConfig.mode`): `"antiyoy"` (default — neutral island, 1/2/3
starting provinces per player by map size) and `"slay"` (all land divided).
`humanCount: 0` = spectator (AI vs AI), `1` = vs AI, `2+` = hotseat.

## Critical platform constraints (lakebed)

1. **No npm installs inside `web/`**; imports only from `lakebed/*`, `preact*`,
   or relative paths. Tailwind classes are built in.
2. **Anonymous server builds forbid `while` loops** — this is why all game
   code lives in `client/game/`, NOT `shared/`. Don't move it back.
3. **Artifact limit 1 MB** and the client bundle is **~995 KB — nearly full.**
   Before adding anything heavy, reclaim space (the embedded atlas/icons in
   `sprites.ts` are the bulk; options: downscale atlas to the 80px "_low"
   frames, strip unused sprite entries, or ask lakebed for asset hosting).
4. `npx lakebed deploy` from `web/` updates production directly. There is no
   staging. `domains remove` does not exist — extra domains are handled by the
   client-side canonical redirect.

## Dev & verification workflow

```sh
cd web && npx lakebed dev --port 3203        # local dev server
npx tsx devtools/sim.ts                      # headless engine/AI invariants + pacing (both modes)
node devtools/browser-check.mjs 3203         # real-browser smoke test (uses system Chrome via playwright-core)
cd web && npx lakebed deploy                 # ship
```

- `devtools/` needs `npm i playwright-core tsx` once, **outside** `web/`
  (devtools/package.json exists; `/tmp` installs from earlier sessions are gone).
- Verification culture so far: every engine change goes through the sim
  (it caught: attacker merging with defenders, province ids changing every
  capture, runaway tree spread, mapgen advantage cascade, slay <4p collapse);
  every UI change gets a headless-Chrome screenshot pass before deploy.

## Engine subtleties worth knowing

- Province **ids are preserved** across `rebuildAllProvinces` (component holding
  a donor's capital inherits id+money). The AI and HUD depend on this.
- Units' allegiance = tile fraction (no owner field on `Unit`).
- On capture the defender unit must die *before* `placeUnitOnHex` (never merge).
- Trees: a tree may only seed after standing one full round (`treeBorn`).
- The original's generic `decreaseProvince` with negative power is a no-op in
  shipped Antiyoy; mapgen replicates "advantages only".
- Slay mode skips province cutting for <4 players (original does the same).

## Backlog / next-phase candidates (user-driven so far)

Not yet ported from the original: **campaign levels** (level data is in the
Java source; loader would be the natural next big feature), **map editor**,
**diplomacy mode**, **fog of war**, **replays**, **skins** (other atlases in
`assets/skins/*`), save/load games, sound. Small items: favicon (404 in
console), PWA manifest for mobile install, online multiplayer via lakebed
db/mutations (server currently unused).

## History of user requirements (style guardrails)

The user wants the remaster to **match the original closely**: original
sprites/palette/menu style, separate picture buttons per unit tier + farm +
towers, whole-territory selection highlight, borders only at territory edges
(full grid on neutral land), original map generator, modes named
Antiyoy/Slay, settings screen like the original. Keep that bar for new UI.
Single domain: antiyoy.lakebed.app only.
