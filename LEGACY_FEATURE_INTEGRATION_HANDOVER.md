# Legacy Feature Integration Handover

Last updated: 2026-06-11.

This document tracks how the original Java/libGDX implementation under
`core/src/` should be integrated into the TypeScript web remaster under `web/`.
The main areas are the menu hierarchy, settings, and random-map generation.

## Current Web Coverage

| Area | Already implemented | Missing or incomplete |
|---|---|---|
| Main menu | Original-inspired palette, direct skirmish setup, Play | Legacy home screen, Play submenu, Campaign, Load Game, User Levels, Editor, Resume, About |
| Skirmish | AI-only spectator mode, single-player, hotseat, 2-6 factions, three map sizes, Antiyoy and Slay modes | Huge maps, legacy player limits, six AI difficulties, preferred color, tree density, starting-province count, fog, diplomacy, persisted setup |
| Settings | AI speed, border style, unit animations, end-turn confirmation | Dedicated settings hierarchy and most legacy options |
| Map generation | Island blobs, connecting roads, density/connectivity retry, isolated-hole filling, trees, Antiyoy and Slay territory setup | Configurable trees/provinces, Huge map, full Slay balancing, closer centering and bounds parity |
| Persistence | Settings stored in `localStorage` | Save/load games, autosave, Resume, persistent replays, campaign progress |
| Replays | In-memory action recording and viewer | Replay library, persistence, loading saved replays |
| Other systems | Core gameplay, AI, hotseat, spectator mode, undo | Campaign, editor, user levels, fog, diplomacy, skins, sound/music, localization, statistics |

The current replay implementation is present in uncommitted workspace changes.
Do not discard or overwrite those changes when restructuring the UI.

## Important Files

- `web/client/index.tsx`: current start screen, game UI, pause/menu actions,
  hotseat screen, victory overlay, and replay viewer.
- `web/client/settings.ts`: current versionless `localStorage` settings.
- `web/client/game/types.ts`: `GameConfig` and serializable `GameState`.
- `web/client/game/mapgen.ts`: TypeScript port of the legacy map generators.
- `web/client/game/engine.ts`: game creation, actions, province rebuilding, and
  replay action observation.
- `devtools/sim.ts`: engine, AI, and replay determinism checks.
- `core/src/yio/tro/antiyoy/menu/scenes/`: legacy menu and settings reference.
- `core/src/yio/tro/antiyoy/gameplay/MapGenerator.java`: legacy Slay generator.
- `core/src/yio/tro/antiyoy/gameplay/MapGeneratorGeneric.java`: legacy Antiyoy
  generator.

## Phase 0: Architecture and Bundle Capacity

1. Split `web/client/index.tsx` into screen modules and reusable menu controls.
2. Introduce an explicit UI screen model for at least `main`, `chooseMode`,
   `skirmish`, `skirmishAdvanced`, `settings`, `game`, `load`, and `replays`.
3. Add schema versions and migration functions for settings, saves, and replays.
4. Reduce bundle size before adding sound or skins. The embedded atlas in
   `web/client/sprites.ts` is the primary target. The Lakebed client artifact is
   already close to its 1 MB limit.
5. Stabilize and commit the current replay work before persistence depends on it.

## Phase 1: Main Menu Parity

Build the legacy navigation shell:

- Main screen: Play, Settings, optional Resume, and About.
- Play submenu: Skirmish, Campaign, User Levels, Load Game, and Editor.
- Initially expose only implemented destinations. Do not ship dead buttons.
- In-game pause menu: Resume, Save, Restart, Settings, and Main Menu.
- Preserve the active game when opening settings or the pause menu.

The native Exit action does not translate to the browser. Omit it or replace it
with About or install/PWA information.

## Phase 2: Complete Skirmish Configuration

Extend `GameConfig` with:

```ts
interface GameConfig {
  mapSize: "small" | "medium" | "large" | "huge";
  playerCount: number;
  humanCount: number;
  difficulty: Difficulty;
  mode: "antiyoy" | "slay";
  seed: number;
  treePercentage: number;
  startingProvinces: 0 | 1 | 2 | 3 | 4;
  colorOffset: number;
  fogOfWar: boolean;
  diplomacy: boolean;
}
```

Add the following UI and persistence:

- Huge map size.
- Last-used skirmish setup.
- Legacy tree-density values: 0, 5, 10, 15, 25, 33, 50, 66, 75, 90, 95,
  and 100 percent.
- Default or explicit starting-province count.
- Preferred player color.
- Player limits based on map size.
- Seed input and a regenerate action.
- Six legacy difficulty labels.

Only Easy, Normal, and Hard currently have distinct web AI behavior. Do not
present Expert, Balancer, and Master as implemented until their behavior exists.

## Phase 3: Map Generator Parity

Update `web/client/game/mapgen.ts`:

1. Replace the fixed tree chance with `config.treePercentage`.
2. Use `config.startingProvinces` in Antiyoy mode, with size defaults of 1, 2,
   3, and 4.
3. Add Huge grid dimensions and 35 island centers.
4. Port the legacy land-centering and screen-bound trimming behavior more
   closely.
5. Measure the 25 percent density requirement against usable bounded hexes,
   rather than the complete rectangular grid.
6. Complete Slay balancing: small-province spawning, five-hex cutting,
   province-count redistribution, and faction-order compensation.
7. Preserve intentional legacy quirks where compatibility matters. In
   particular, Generic mode's negative balance values are ineffective in the
   shipped Java implementation; the current web port preserves advantages only.

Add generator tests for:

- Determinism from seed and configuration.
- Connected land.
- Minimum land density.
- A viable province for every faction.
- Tree-density tolerance.
- Requested starting-province counts.
- Slay province-count balance.
- Every supported map size and player count.

## Phase 4: Settings Parity

Restore a dedicated settings screen and expand `web/client/settings.ts`.

Implement first:

- Sound and music toggles.
- End-turn warning.
- Camera sensitivity.
- Hold/long-press movement.
- Left-handed HUD layout.
- Resume-button visibility.
- Browser Fullscreen API support.
- Automatic province/unit selection transition.
- Existing border and animation settings.
- Reset settings.

Implement after their dependencies:

- Autosave and Resume after save/load exists.
- Fast construction after its HUD is designed.
- Water texture after renderer support exists.
- Skins after bundle restructuring.
- City names after province naming is implemented.
- Language selection after visible strings are extracted from JSX.

The legacy native-keyboard toggle is unnecessary on the web because browser
inputs already use the platform keyboard.

## Phase 5: Saves and Persistent Replays

Use IndexedDB rather than `localStorage` for game states and replay histories.
Persist versioned records containing:

- `GameState`.
- `GameConfig`.
- Recorded actions.
- Save metadata and timestamps.
- Schema version.

Add manual save slots, end-of-human-turn autosave, Resume latest save, a load
screen, a replay library, rename/delete operations, and JSON import/export.

## Phase 6: Fog and Diplomacy

These require engine changes and should not be treated as simple menu toggles.

Fog of war needs per-player visibility, recalculation after actions, renderer
masking, AI information rules, and save/replay serialization.

Diplomacy needs relations and war state, contracts/messages, exchanges, AI
decisions, victory-rule changes, serialization, and dedicated UI. Implement fog
before diplomacy because it has fewer cross-system dependencies.

## Phase 7: Campaign

Campaign should precede the editor because the legacy level packs already
provide content and requirements for a reusable level format.

1. Convert campaign packs to compact TypeScript or JSON data.
2. Implement level loading, goals, and scripted messages.
3. Persist completion and unlock progress.
4. Add the campaign menu and reset-progress confirmation.
5. Build tutorials as scripted levels.
6. Reuse the resulting level schema for user levels and the editor.

## Phase 8: Editor and User Levels

Define a shared level schema for active land, factions, provinces, units,
buildings, starting money, rules, fog, diplomacy, goals, and messages. Then add
editor tools, local level storage, import/export, and a user-level browser.

## Recommended Delivery Order

1. Bundle reduction and UI split.
2. Main menu hierarchy.
3. Complete skirmish options.
4. Generator parity and tests.
5. Settings parity.
6. Save/load, autosave, and Resume.
7. Persistent replays.
8. Campaign.
9. Fog of war.
10. Diplomacy.
11. Skins, localization, city names, sound, music, and statistics.
12. Editor and user levels.

The first five stages deliver the requested legacy menu, settings, and map
generation experience without waiting for the substantially larger campaign,
diplomacy, and editor systems.

## Verification

Run after engine or map-generator changes:

```sh
npx tsx devtools/sim.ts
```

Run the capsule and browser smoke test after UI changes:

```sh
cd web
npx lakebed dev --port 3203
node ../devtools/browser-check.mjs 3203
```

Also verify mobile layout, touch controls, hotseat transitions, AI-only games,
save migration, replay determinism, and bundle size before deployment.
