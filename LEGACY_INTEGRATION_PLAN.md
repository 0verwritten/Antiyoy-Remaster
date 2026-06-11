# Unified Legacy Integration Plan

Last updated: 2026-06-11.

This document merges `LEGACY_FEATURE_INTEGRATION_HANDOVER.md` and
`CAMPAIGN_DIPLOMACY_HANDOVER.md` into a single delivery roadmap and time plan
for porting the remaining legacy Java/libGDX features (`core/src/`, `assets/`)
into the TypeScript web remaster (`web/`). It supersedes both source documents
for sequencing decisions; their phase-level technical detail remains valid and
is referenced below. Read `HANDOVER.md` and `web/AGENTS.md` first for general
architecture, deployment constraints, and verification commands.

## Sequencing decisions made during the merge

The two source documents agreed on the big points and conflicted on a few.
Resolutions:

1. **Bundle reduction and UI restructuring come first.** Both documents make
   this a hard prerequisite. The deployed client bundle is close to Lakebed's
   1 MB artifact limit; nothing data-heavy (campaign packs, diplomacy icons,
   sound, skins) can land before this.
2. **Menus, skirmish, generator, settings, and saves come before campaign.**
   The legacy-features doc's stages 1-7 are smaller, independently shippable,
   and deliver the requested legacy menu/settings/mapgen experience without
   waiting on the much larger campaign and diplomacy systems. The campaign doc
   does not contradict this; it simply scopes only its own features.
3. **Saves and persistent replays land before campaign.** Campaign needs
   progress persistence and a versioned-storage discipline anyway; building
   the IndexedDB layer and schema-versioning habits first means campaign
   progress and scenario saves reuse them instead of inventing parallel ones.
4. **Campaign precedes diplomacy.** Both documents agree: campaign mostly
   needs scenario loading, progress, objectives, and menu flow, while
   diplomacy touches combat authorization, turn processing, economy, victory,
   AI, UI, undo, and replay contracts.
5. **Fog of war sits between full campaign and diplomacy.** The
   legacy-features doc explicitly orders fog before diplomacy because it has
   fewer cross-system dependencies; the campaign doc never mentions fog.
   Diplomatic campaign objectives stay disabled until the diplomacy engine is
   complete, so fog does not block any campaign content.
6. **Campaign precedes the editor.** The level packs provide the content and
   requirements for a reusable scenario/level schema, which the editor and
   user levels then reuse.
7. **Truth-in-UI rule applies throughout.** No dead buttons, no fake
   difficulty labels (Expert/Balancer/Master) until distinct AI behavior
   exists, no tutorial level 0 presented as a normal level until scripted
   tutorials work, no diplomatic objectives selectable until diplomacy ships.

## Time plan

Estimates are focused working days for one developer, including tests and the
standard verification pass for each stage. Each stage is independently
shippable; ship in order.

| Stage | Scope | Estimate | Cumulative |
|---|---|---|---|
| 0 | Bundle budget, UI split, schema versioning, commit replay work | 4–6 d | ~1 wk |
| 1 | Main menu hierarchy | 2–3 d | ~1.5 wk |
| 2 | Complete skirmish configuration | 3–4 d | ~2.5 wk |
| 3 | Map generator parity and tests | 4–6 d | ~3.5 wk |
| 4 | Settings parity (first batch) | 3–4 d | ~4.5 wk |
| 5 | Save/load, autosave, Resume, persistent replays | 5–7 d | ~6 wk |
| 6 | Scenario foundation and converter | 4–6 d | ~7 wk |
| 7 | Campaign MVP (levels 1–24) | 4–5 d | ~8 wk |
| 8 | Full campaign (non-diplomatic objectives) | 4–6 d | ~9 wk |
| 9 | Fog of war | 5–7 d | ~10.5 wk |
| 10 | Diplomacy state model and rules | 6–8 d | ~12 wk |
| 11 | Diplomacy UI and persistence | 5–7 d | ~13.5 wk |
| 12 | Diplomatic AI + diplomatic campaign levels | 5–7 d | ~15 wk |
| 13 | Editor and user levels | 8–10 d | ~17 wk |
| 14 | Polish: skins, localization, sound/music, city names, statistics | 6–8 d | ~18.5 wk |

Total: roughly 68–94 working days (about 14–19 weeks of focused effort).
Stages 0–5 (~6 weeks) deliver the full legacy menu, settings, and map
generation experience. Stages 6–8 (~3 more weeks) deliver the campaign.
Stages 9–12 (~6 more weeks) deliver fog and diplomacy. Stages 13–14 are the
long tail.

## Stage 0: bundle budget and UI architecture (4–6 days)

Prerequisite for everything else.

- Split `web/client/index.tsx` into screen modules and reusable menu
  controls. Introduce an explicit UI screen model for at least `main`,
  `chooseMode`, `skirmish`, `skirmishAdvanced`, `settings`, `game`, `load`,
  and `replays`.
- Reduce the embedded atlas in `web/client/sprites.ts`: replace
  high-resolution frames with acceptable low-resolution assets, remove sprite
  entries the web client never references. Target **< 900 KB** before
  campaign data lands, leaving room for diplomacy code and icons.
- Add a build/deploy bundle-size check (gate, not just a report).
- Add schema versions and migration functions for settings, saves, and
  replays.
- Stabilize and commit the current in-workspace replay implementation before
  any persistence depends on it. Do not discard those uncommitted changes
  when restructuring the UI.

## Stage 1: main menu parity (2–3 days)

- Main screen: Play, Settings, optional Resume, About.
- Play submenu: Skirmish, Campaign, User Levels, Load Game, Editor — but
  expose only implemented destinations; no dead buttons.
- In-game pause menu: Resume, Save, Restart, Settings, Main Menu. Preserve
  the active game when opening settings or the pause menu.
- The native Exit action does not translate to the browser: omit it or
  replace it with About or install/PWA information.

## Stage 2: complete skirmish configuration (3–4 days)

Extend `GameConfig`:

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

UI and persistence:

- Huge map size; player limits based on map size.
- Persisted last-used skirmish setup.
- Legacy tree-density values: 0, 5, 10, 15, 25, 33, 50, 66, 75, 90, 95, 100%.
- Default or explicit starting-province count.
- Preferred player color.
- Seed input and a regenerate action.
- Six legacy difficulty labels — but only Easy, Normal, and Hard currently
  have distinct web AI behavior; do not present Expert, Balancer, and Master
  as implemented until their behavior exists.
- `fogOfWar` and `diplomacy` stay hidden/disabled until stages 9 and 10.

## Stage 3: map generator parity and tests (4–6 days)

Update `web/client/game/mapgen.ts` (legacy references:
`core/src/yio/tro/antiyoy/gameplay/MapGenerator.java` for Slay,
`MapGeneratorGeneric.java` for Antiyoy):

1. Replace the fixed tree chance with `config.treePercentage`.
2. Use `config.startingProvinces` in Antiyoy mode, with size defaults of
   1, 2, 3, and 4.
3. Add Huge grid dimensions and 35 island centers.
4. Port legacy land-centering and screen-bound trimming more closely.
5. Measure the 25% density requirement against usable bounded hexes rather
   than the complete rectangular grid.
6. Complete Slay balancing: small-province spawning, five-hex cutting,
   province-count redistribution, faction-order compensation.
7. Preserve intentional legacy quirks where compatibility matters — e.g.
   Generic mode's negative balance values are ineffective in the shipped
   Java implementation; the web port preserves advantages only.

Generator tests: determinism from seed+config, connected land, minimum land
density, a viable province per faction, tree-density tolerance, requested
starting-province counts, Slay province-count balance, every supported map
size and player count.

## Stage 4: settings parity (3–4 days)

Restore a dedicated settings screen and expand `web/client/settings.ts`
(now versioned, per stage 0).

Implement now: sound/music toggles, end-turn warning, camera sensitivity,
hold/long-press movement, left-handed HUD layout, resume-button visibility,
browser Fullscreen API, automatic province/unit selection transition,
existing border and animation settings, reset settings.

Deferred until their dependencies exist: autosave/Resume (stage 5), fast
construction (HUD design), water texture (renderer support), skins (bundle
restructuring, stage 14), city names (province naming), language selection
(string extraction from JSX, stage 14). The legacy native-keyboard toggle is
unnecessary on the web.

## Stage 5: saves and persistent replays (5–7 days)

Use IndexedDB rather than `localStorage` for game states and replay
histories. Persist versioned records containing `GameState`, `GameConfig`,
recorded actions, save metadata and timestamps, and schema version. Avoid
saving derived caches that can be reconstructed.

Add manual save slots, end-of-human-turn autosave, Resume latest save, a
load screen, a replay library, rename/delete operations, and JSON
import/export. Keep everything client-side; do not introduce Lakebed
database usage for these features.

## Stage 6: scenario foundation (4–6 days)

This is the first campaign milestone and should be its own narrow PR:
bundle headroom verified, scenario types and loader, a conversion script,
two representative campaign fixtures, and tests proving they load. Do not
combine it with campaign UI or the diplomacy engine.

Create:

- `web/client/game/scenario.ts`
- `web/client/game/scenario-loader.ts`
- `web/client/game/scenario-codec.ts`
- `web/client/game/__generated__/campaign-data.ts`
- A conversion script under `devtools/` that reads the Java level packs
  (legacy source: `core/src/yio/tro/antiyoy/gameplay/campaign/`) and emits
  compact deterministic TypeScript data. It must support both legacy
  full-level strings and sectioned `antiyoy_level_code` strings.

The serializable scenario contract contains: scenario id and display
metadata; game configuration and ruleset; active hexes, owners, objects,
and units; province capitals, money, and optional names; initial diplomatic
relations; objective and target fraction; introductory messages.

Extend `GameState` with session metadata:

```ts
interface GameSession {
  source: "generated" | "campaign";
  campaignLevel?: number;
  objective?: Objective;
}
```

Refactor `createGame()` in `web/client/game/engine.ts` into
`createGeneratedGame(config)` and `createScenarioGame(scenario)` with shared
neighbor, capital, province identity, income, alive-state, and first-turn
initialization. The engine must not depend on campaign modules — it consumes
generic scenarios so the same loader later supports the editor, user levels,
imports, saves, and replays (stage 13 depends on this).

Acceptance gate: a representative legacy fixture loads with the expected
map, owners, units, structures, province money, capitals, and starting turn.

## Stage 7: campaign MVP, levels 1–24 (4–5 days)

- `web/client/game/campaign.ts`: metadata, unlock rules, difficulty tiers.
- `web/client/campaign-storage.ts`: local progress in `localStorage`, with
  separate keys for Antiyoy and Slay campaign rules, tracking completed
  levels explicitly (not just a highest-unlocked index):

```ts
interface StoredCampaignProgress {
  version: 1;
  rules: "antiyoy" | "slay";
  completed: number[];
}
```

- Campaign menu and level selector (legacy UI reference:
  `core/src/yio/tro/antiyoy/menu/LevelSelector.java` and campaign scenes
  under `core/src/yio/tro/antiyoy/menu/scenes/`), plus reset-progress
  confirmation.
- Campaign victory overlay with retry, next level, and campaign menu actions.
- Defer tutorial level 0 until scripted tutorial instructions are
  implemented; do not silently present it as a normal campaign level.

Acceptance gate: levels 1–24 load deterministically, locked levels cannot be
started, victories unlock the correct next level, progress survives reload,
and Normal and Slay campaign progress remain independent.

## Stage 8: full campaign (4–6 days)

Import remaining level packs in batches. The converter validates generated
data and rejects: invalid coordinates or fraction ids; missing or duplicate
capitals; unsupported objects or unit strengths; objectives targeting
nonexistent fractions; relations referencing nonexistent players; provinces
that cannot be reconstructed as expected.

Implement objective types as engine-level data and evaluation functions:
destroy everyone, destroy a target kingdom, ensure a target kingdom wins,
diplomatic victory. Diplomatic objectives stay unavailable until stage 12.
Introductory messages and special starting money land with the relevant
level batches. Build tutorials as scripted levels (can trail this stage).

## Stage 9: fog of war (5–7 days)

Not a menu toggle — an engine feature: per-player visibility state,
recalculation after actions, renderer masking, AI information rules, and
save/replay serialization. Once stable, enable the `fogOfWar` skirmish
option from stage 2.

## Stage 10: diplomacy state model and rules (6–8 days)

Create `web/client/game/diplomacy.ts` and add serializable diplomacy state
to `GameState`: pairwise relations (war/neutral/friend), relation cooldowns,
black marks, contracts with expiration rounds, pending proposals, a
diplomatic message log, and per-player attitude/reputation state for AI.
Add a `diplomacyEnabled` rule to the game configuration or session rules.

Expose functions instead of letting UI/AI mutate relation arrays:

```ts
getRelation(state, a, b)
canAttackFraction(state, attacker, defender)
proposeExchange(state, proposal)
acceptExchange(state, proposalId)
rejectExchange(state, proposalId)
declareWar(state, target)
setBlackMark(state, target)
```

Represent diplomacy operations as `Action` variants so undo, observation,
replay recording, and save/load stay consistent with ordinary gameplay.

Integrate at explicit engine boundaries: attack validation for bought and
moved units; isolated single-hex attacks; beginning/end-of-turn contract
processing; player elimination cleanup; victory evaluation; economy and
province money transfers.

Correct these known legacy defects instead of reproducing them:

- Attacks on isolated hexes must obey diplomatic relations.
- Money transfers must conserve integer treasury exactly, including
  recipients that currently have zero money.
- Subsidies must be capped against the payer's income and available funds.
- Eliminated players must be removed from pending exchanges and contracts.
- Campaign level 0, once supported, must preserve campaign status across
  saves.

Acceptance gate: automated tests for relation symmetry, treasury
conservation, attack restrictions, contract expiry, elimination cleanup,
and diplomatic victory.

## Stage 11: diplomacy UI and persistence (5–7 days)

Legacy references: `core/src/yio/tro/antiyoy/menu/diplomacy_element/` and
`assets/diplomacy/` (import only the icons the new UI actually uses).

Add an original-style flag control to the game HUD. Keep diplomacy panels in
DOM UI rather than the canvas unless board interaction requires it.

Required screens and dialogs: country list with relation indicators; country
details; declare war and friendship actions; black mark action;
exchange/proposal builder; proposal inbox and diplomatic log; contract and
treasury preview before acceptance; diplomacy victory status.

Hotseat mode must not reveal another human player's private pending
proposals before the pass screen has been acknowledged.

## Stage 12: diplomatic AI and diplomatic campaign levels (5–7 days)

Port AI only after human-to-human hotseat diplomacy is stable.

AI decisions account for: military threat and shared borders; economic value
and ability to pay; current relation and cooldowns; existing contracts and
black marks; progress toward diplomatic victory; difficulty-specific risk
tolerance. Use `GameState.rngState` for randomized choices so simulations
and replays stay deterministic. Add proposal cooldowns and per-turn budgets
to prevent browser hangs and exchange loops.

Then enable the campaign levels that depend on diplomacy objectives, and the
`diplomacy` skirmish option from stage 2.

## Stage 13: editor and user levels (8–10 days)

Reuses the stage 6 scenario schema. Define the shared level schema covering
active land, factions, provinces, units, buildings, starting money, rules,
fog, diplomacy, goals, and messages. Add editor tools, local level storage,
import/export, and a user-level browser.

## Stage 14: polish (6–8 days)

Skins (after the stage 0 bundle restructuring proves there is room),
localization (extract visible strings from JSX, then language selection),
city names (after province naming), sound and music, statistics. Each item
unblocks its deferred setting from stage 4.

## Persistence and compatibility rules (all stages)

- Everything stays client-side; do not introduce Lakebed database usage for
  these features.
- Version every persisted structure and provide migrations.
- Full game saves persist the complete serializable `GameState`, session
  metadata, scenario id, and schema version — never derived caches.

## Verification (every stage)

```sh
npx tsx devtools/sim.ts
cd web && npx lakebed dev --port 3203
node devtools/browser-check.mjs 3203
```

Extend `devtools/sim.ts` as features land: scenario parsing/loading
fixtures; campaign completion and unlock progression; objective evaluation;
campaign storage migration and round trips; relation symmetry and attack
authorization; money conservation for transfers and subsidies; contract
expiry and eliminated-player cleanup; AI diplomacy simulations with action
budgets; deterministic replay of campaign and diplomacy actions; generator
determinism and balance tests.

Browser coverage should grow to include: campaign selection, locked levels,
victory progression, diplomacy dialogs, proposal acceptance/rejection,
hotseat privacy, mobile layout and touch controls, hotseat transitions,
AI-only games, save migration, replay determinism, return-to-menu behavior,
and the bundle-size gate before every deployment.
