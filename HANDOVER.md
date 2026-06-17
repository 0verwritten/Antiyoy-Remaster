# Antiyoy Remaster — Handover and Backlog

Last updated: 2026-06-17.

This is the single authoritative handover for the TypeScript web remaster. It
supersedes the older split roadmap files:

- `STAGE10_HANDOVER.md`
- `CAMPAIGN_DIPLOMACY_HANDOVER.md`
- `LEGACY_FEATURE_INTEGRATION_HANDOVER.md`
- `LEGACY_INTEGRATION_PLAN.md`

Read this file first, then `web/AGENTS.md` for repo-specific coding rules.

## Project

A from-scratch TypeScript web remaster of Antiyoy, inside `web/`. The original
Java/libGDX game under `core/` and `assets/` is kept as the reference
implementation for rules, constants, sprites, menus, campaign data, diplomacy,
and generator behavior.

- Live site: `https://antiyoy.lakebed.app`
- Hosting: Lakebed capsule. `npx lakebed deploy` from `web/` deploys
  production directly.
- Canonical domain redirect is in `web/client/index.tsx`.
- Do not install npm packages in `web/`. Dev tools live outside `web/` under
  `devtools/`.

## Architecture

Important web files:

| Path | Role |
|---|---|
| `web/client/index.tsx` | App shell, canonical redirect, screen routing |
| `web/client/game/types.ts` | Serializable shared types, `GameState`, `Action`, `GameConfig` |
| `web/client/game/engine.ts` | Pure game rules, actions, turn flow, province rebuilds, fog visibility, diplomacy hooks |
| `web/client/game/mapgen.ts` | Antiyoy/Slay generated-map logic |
| `web/client/game/ai.ts` | Greedy AI and basic diplomacy behavior |
| `web/client/game/diplomacy.ts` | Diplomacy relations, contracts, proposals, transfers, victory |
| `web/client/game/scenario*.ts` | Scenario codec/loader for campaign and future editor/user levels |
| `web/client/game/campaign*.ts` | Campaign metadata, hosted data access, level creation/objective evaluation |
| `web/client/screens/` | UI screens: main, play submenu, skirmish, campaign, load, replays, online, game, pass, victory |
| `web/client/ui/` | Reusable controls and pointer handling |
| `web/client/render.ts` | Canvas renderer, sprites, fog/night rendering |
| `web/client/settings.ts` | Versioned localStorage settings |
| `web/client/skirmish-setup.ts` | Versioned persisted skirmish setup |
| `web/client/game-storage.ts` | IndexedDB saves and replay library |
| `web/server/index.ts` | Online lobby/chat/snapshot server |

Game modes:

- `mode: "antiyoy"`: neutral island, generated starting provinces.
- `mode: "slay"`: all land divided between players.
- `humanCount: 0`: AI spectator.
- `humanCount: 1`: human vs AI.
- `humanCount >= 2`: hotseat/pass-and-play.

## Platform Constraints

- Keep imports in `web/` limited to Lakebed/Preact/relative modules.
- Lakebed anonymous server builds forbid `while` loops in server/shared code.
  Game rules intentionally live in `web/client/game/`.
- Keep the client bundle small. The sprite atlas and icon PNGs are CDN-hosted
  via jsDelivr from `assets/web/` and `assets/`.
- `devtools/check-bundle.mjs` reports bundle size; pass a byte budget argument
  when a hard local gate is needed.
- There is no staging environment. Deploys update production.

## Current Implemented Status

Implemented:

- Main menu and play submenu.
- Skirmish setup with huge maps, player limits, player color, seed, tree
  density, starting provinces, fog, night battle, diplomacy, and persisted
  last-used setup.
- Six visible AI difficulties: easy, normal, hard, expert, balancer, master.
  They map to distinct AI tunings.
- Generated Antiyoy and Slay games.
- Original-style canvas board/HUD, unit/build actions, undo, hotseat pass
  screen, victory overlays.
- Save/load, autosave, Resume, JSON import/export.
- Persistent replay library and replay viewer.
- Campaign menu, progress storage, level construction, fixed hosted campaign
  data where supported, generated fallback levels, basic objective evaluation.
- Scenario codec/loader foundation.
- Fog of war rendering and visibility calculation.
- Night battle visual mode.
- Diplomacy rules: neutral/friend/war relations, contracts, proposals,
  black marks, money transfers, subsidies, diplomatic victory, elimination
  cleanup.
- Diplomacy UI: in-game Flags panel with relations, war, friendship/peace,
  gift/subsidy proposals, black marks, inbox, and log.
- Basic deterministic diplomatic AI: resolves incoming offers and declares war
  on adjacent neutral enemies so diplomacy games do not stall.
- Online lobby/game/chat path.
- PWA/install helper and favicon injection.

Recently added:

- `devtools/diplomacy-tests.ts`
- Skirmish diplomacy toggle.
- In-game diplomacy panel.
- Basic diplomacy AI.
- Six legacy AI difficulty labels with distinct tunings.
- Updated stale `GameConfig.fogOfWar` / `GameConfig.diplomacy` comments.

## Verification

Common commands from repo root:

```sh
npx tsx devtools/sim.ts
npx tsx devtools/mapgen-tests.ts
npx tsx devtools/scenario-tests.ts
npx tsx devtools/campaign-tests.ts
npx tsx devtools/diplomacy-tests.ts
node devtools/check-bundle.mjs
cd web && npx lakebed dev --port 3203
node devtools/browser-check.mjs 3203
```

Known verification state as of 2026-06-17:

- Passing:
  - `npx tsx devtools/sim.ts`
  - `npx tsx devtools/diplomacy-tests.ts`
  - `node devtools/check-bundle.mjs`
  - `node devtools/browser-check.mjs 3203`
  - focused browser check for skirmish diplomacy toggle and Flags panel
- Known failing before the latest diplomacy work:
  - `npx tsx devtools/mapgen-tests.ts`: generated map determinism failure.
  - `npx tsx devtools/scenario-tests.ts`: campaign scenario determinism failure.
  - `npx tsx devtools/campaign-tests.ts`: campaign level determinism failure.

Treat the determinism failures as the next correctness repair before major
feature expansion.

## Engine Notes

- `GameState` is plain serializable data. Undo/save/replay rely on
  `structuredClone`.
- Province ids are preserved across `rebuildAllProvinces`; the component
  holding a donor capital inherits id and money.
- Units have no owner field. Allegiance is the tile fraction.
- On capture, defender unit removal must happen before `placeUnitOnHex`.
  Never merge attacker and defender.
- Trees may seed only after standing one full round (`treeBorn`).
- Slay mode skips province cutting for fewer than four players, matching the
  original.
- Diplomacy mode starts all pairs as neutral. Neutral cannot attack; war must
  be declared first.
- Diplomacy operations are `Action` variants so undo, replay, saves, and
  online sync observe them like ordinary gameplay actions.

## Backlog

### 1. Repair Determinism

Priority: high.

- Fix map generation determinism for same seed + config.
- Fix scenario/campaign deterministic rebuilds.
- Re-enable confidence in:
  - `devtools/mapgen-tests.ts`
  - `devtools/scenario-tests.ts`
  - `devtools/campaign-tests.ts`

Likely areas to inspect:

- Calls to `Date.now()` or `Math.random()` leaking into generated states.
- Turn timing fields included in JSON equality tests.
- Province id allocation or scenario finalization order.
- Campaign fixed-data fallback behavior under Node tests.

### 2. Diplomacy Parity

Priority: medium-high.

Current diplomacy is functional but not legacy-complete.

Remaining:

- Improve AI from basic war/offer handling toward legacy-style diplomatic
  reasoning:
  - military threat
  - shared borders
  - economic value and ability to pay
  - cooldowns
  - black marks
  - progress toward diplomatic victory
  - difficulty-specific risk
- Add proposal cooldowns/per-turn budgets if richer AI starts generating
  proposals.
- Enable/import diplomatic campaign levels once objective behavior is reliable.
- Add richer proposal preview text and treasury impact in the UI.

### 3. Editor and User Levels

Priority: medium.

Use the existing scenario foundation. The editor should produce the same
generic `Scenario` shape consumed by `createScenarioGame`.

Needed:

- Shared level schema for:
  - active land
  - factions
  - provinces/capitals
  - units/buildings/trees
  - starting money
  - rules: fog, diplomacy, mode
  - objectives and messages
- Editor tools for terrain, owner, units, buildings, money, objectives.
- Local user-level storage in IndexedDB.
- User-level browser.
- JSON import/export.
- Validation before play/import.

Do not add dead menu buttons for Editor/User Levels until at least a minimal
usable flow exists.

### 4. Skins

Priority: medium-low.

Legacy assets exist under `assets/skins/*`. Keep heavy skin atlases out of the
client bundle, like the main atlas.

Needed:

- Skin atlas generation/hosting flow.
- Renderer skin selection.
- Settings UI for skin selection.
- Persistence in settings.
- Browser visual smoke for at least default + one alternate skin.

### 5. Sound and Music

Priority: medium-low.

Legacy sound files exist under `assets/sound/`.

Needed:

- Small audio manager with user-gesture-safe unlock.
- Settings for sound and music.
- Event hooks for:
  - menu click
  - select unit
  - move/attack
  - build
  - coin/income
  - end turn
- Avoid bundling large audio directly if it threatens Lakebed limits.

### 6. Localization

Priority: low.

Needed:

- Extract visible strings from JSX/screens into message keys.
- Add language selector in settings.
- Persist selected language.
- Start with English plus any target language from the original assets/source.
- Keep fallback behavior simple and deterministic.

### 7. City / Province Names

Priority: low.

Needed:

- Province naming data and assignment.
- Persisted names in `Province` or derived session metadata.
- Display in HUD and saves/replays where useful.
- Migration for older saves.

### 8. Statistics

Priority: low.

Current state tracks turn timing and replay money deltas. A full statistics
feature is not implemented.

Needed:

- End-game statistics screen:
  - turns/rounds
  - captures
  - units bought/lost
  - money earned/spent
  - buildings built
  - time per player
- Optional campaign/stat history if storage budget allows.
- Replay/save compatibility.

### 9. Campaign Completeness

Priority: medium.

Current campaign support is present but not complete.

Needed:

- Fix determinism first.
- Expand/fix converted campaign level coverage where unsupported levels still
  fall back to generated maps.
- Add unsupported objective behavior as needed.
- Add scripted tutorial level 0 only when tutorial instructions/status can be
  preserved correctly. Do not present tutorial 0 as a normal level.
- Enable diplomatic campaign levels only after richer diplomacy behavior is
  verified.

### 10. Polish / Compatibility

Priority: ongoing.

- Keep UI close to original Antiyoy: palette, sprites, menu style, picture
  buttons, whole-territory selection highlight, territory-edge borders.
- Preserve canonical domain: `antiyoy.lakebed.app`.
- Maintain no-dead-button rule.
- Keep persisted formats versioned and migrated.
- Keep dev dependencies outside `web/`.

## User Style Guardrails

The remaster should match the original closely:

- original sprites/palette/menu style
- separate picture buttons per unit tier, farm, and towers
- whole-territory selection highlight
- borders only at territory edges, with full grid on neutral land
- original map-generator behavior where practical
- modes named Antiyoy/Slay in code, Normal/Slay where the current UI uses
  player-facing wording
- settings and menus should feel like the original, not a generic web app

For new features, prefer narrow, verifiable slices:

1. Add/adjust serializable state and actions.
2. Add focused tests.
3. Add minimal UI only after rules are stable.
4. Run sim + relevant tests + browser smoke.
