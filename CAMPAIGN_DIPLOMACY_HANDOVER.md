# Campaign and Diplomacy Integration Handover

Last updated: 2026-06-11.

This document describes how to port campaign and diplomacy from the legacy
Java/libGDX game in `core/` and `assets/` into the TypeScript web remaster in
`web/`. Read `HANDOVER.md` and `web/AGENTS.md` first for general architecture,
deployment constraints, and verification commands.

## Current status

- The legacy Java game contains substantial campaign and diplomacy systems.
- Neither feature is currently implemented in the web remaster.
- The web game is fully client-side and currently supports generated Antiyoy
  and Slay games only.
- The deployed client bundle is already close to Lakebed's 1 MB artifact limit.
  Bundle reduction is a prerequisite for importing large campaign datasets or
  diplomacy assets.

Important legacy locations:

- Campaign: `core/src/yio/tro/antiyoy/gameplay/campaign/`
- Campaign UI: `core/src/yio/tro/antiyoy/menu/LevelSelector.java` and campaign
  scenes under `core/src/yio/tro/antiyoy/menu/scenes/`
- Diplomacy: `core/src/yio/tro/antiyoy/gameplay/diplomacy/`
- Diplomacy UI: `core/src/yio/tro/antiyoy/menu/diplomacy_element/`
- Diplomacy assets: `assets/diplomacy/`

## Recommended implementation order

Implement campaign before diplomacy. Campaign primarily needs scenario loading,
progress, objectives, and menu flow. Diplomacy changes combat authorization,
turn processing, economy, victory rules, AI, UI, undo, and replay contracts.

The delivery order should be:

1. Reclaim bundle space and add a size gate.
2. Build a reusable scenario model and loader.
3. Ship campaign levels 1-24 as an MVP.
4. Import the remaining campaign and objective types.
5. Add the diplomacy state model and human/hotseat rules.
6. Add diplomacy UI and persistence.
7. Add diplomatic AI.
8. Enable campaign levels that depend on diplomacy objectives.

## Phase 0: bundle budget

The embedded atlas in `web/client/sprites.ts` is the main existing bundle cost.
Before adding feature data:

- Replace high-resolution frames with the available low-resolution assets where
  visual quality remains acceptable.
- Remove sprite entries that the web client never references.
- Add only diplomacy icons used by the new UI.
- Generate compact campaign data rather than copying Java source strings into
  handwritten modules.
- Add a build/deploy size check. Target less than 900 KB before campaign data is
  introduced, leaving room for later diplomacy code.

## Phase 1: scenario foundation

Create these modules:

- `web/client/game/scenario.ts`
- `web/client/game/scenario-loader.ts`
- `web/client/game/scenario-codec.ts`
- `web/client/game/__generated__/campaign-data.ts`

Add a serializable scenario contract containing:

- Scenario id and display metadata
- Game configuration and ruleset
- Active hexes, owners, objects, and units
- Province capitals, money, and optional names
- Initial diplomatic relations
- Objective and target fraction
- Introductory messages

Extend `GameState` with session metadata, for example:

```ts
interface GameSession {
  source: "generated" | "campaign";
  campaignLevel?: number;
  objective?: Objective;
}
```

Refactor `createGame()` in `web/client/game/engine.ts` into generated and
scenario entry points with shared finalization:

- `createGeneratedGame(config)`
- `createScenarioGame(scenario)`
- Shared neighbor, capital, province identity, income, alive-state, and first
  turn initialization

Do not make the engine depend directly on campaign modules. The engine should
consume generic scenarios so the same loader can later support an editor,
imports, saves, and replays.

Acceptance gate: a representative legacy fixture loads with the expected map,
owners, units, structures, province money, capitals, and starting turn.

## Phase 2: campaign MVP

Start with levels 1-24. Do not block the first campaign release on all legacy
levels or the scripted tutorial.

Add:

- `web/client/game/campaign.ts` for metadata, unlock rules, and difficulty tiers
- `web/client/campaign-storage.ts` for local progress
- Campaign menu and level selector components in the client UI
- Campaign victory overlay with retry, next level, and campaign menu actions
- A conversion script under `devtools/` that reads the Java level packs and
  emits compact deterministic TypeScript data

The converter must support both formats used by the legacy game:

- Legacy full-level strings
- Sectioned `antiyoy_level_code` strings

Store progress in `localStorage`. Use separate keys for Antiyoy and Slay
campaign rules. Track completed levels explicitly rather than relying only on a
single highest unlocked index.

Defer tutorial level 0 until scripted tutorial instructions are implemented.
Do not silently present it as a normal campaign level.

Acceptance gate: levels 1-24 load deterministically, locked levels cannot be
started, victories unlock the correct next level, and progress survives reload.

## Phase 3: full campaign

Import remaining level packs in batches and validate generated data during the
conversion step. Validation should reject:

- Invalid coordinates or fraction ids
- Missing or duplicate capitals
- Unsupported objects or unit strengths
- Objectives targeting nonexistent fractions
- Relations referencing nonexistent players
- Provinces that cannot be reconstructed as expected

Implement objective types as engine-level data and evaluation functions:

- Destroy everyone
- Destroy a target kingdom
- Ensure a target kingdom wins
- Diplomatic victory

Diplomatic objectives should remain unavailable until the diplomacy engine is
complete. Introductory messages and special starting money can be added with
the relevant level batches.

## Phase 4: diplomacy state model

Create `web/client/game/diplomacy.ts` and add serializable diplomacy state to
`GameState`:

- Pairwise relation: war, neutral, or friend
- Relation cooldowns
- Black marks
- Contracts and expiration rounds
- Pending proposals
- Diplomatic message log
- Per-player attitude/reputation state required by AI

Add a `diplomacyEnabled` rule to the game configuration or session rules.

Expose functions instead of allowing UI and AI code to mutate relation arrays:

```ts
getRelation(state, a, b)
canAttackFraction(state, attacker, defender)
proposeExchange(state, proposal)
acceptExchange(state, proposalId)
rejectExchange(state, proposalId)
declareWar(state, target)
setBlackMark(state, target)
```

Represent diplomacy operations as `Action` variants. This keeps undo,
observation, replay recording, and future save/load behavior consistent with
ordinary gameplay actions.

## Phase 5: diplomacy rules

Integrate diplomacy at explicit engine boundaries:

- Attack validation for bought and moved units
- Isolated single-hex attacks
- Beginning/end-of-turn contract processing
- Player elimination cleanup
- Victory evaluation
- Economy and province money transfers

Correct these known legacy defects instead of reproducing them:

- Attacks on isolated hexes must obey diplomatic relations.
- Money transfers must conserve integer treasury exactly, including recipients
  that currently have zero money.
- Subsidies must be capped against the payer's income and available funds.
- Eliminated players must be removed from pending exchanges and contracts.
- Normal and Slay campaign progress must remain independent.
- Campaign level 0, once supported, must preserve campaign status across saves.

Acceptance gate: relation symmetry, treasury conservation, attack restrictions,
contract expiry, elimination cleanup, and diplomatic victory all have automated
tests.

## Phase 6: diplomacy UI

Add an original-style flag control to the game HUD. Keep diplomacy panels in
DOM UI rather than drawing them into the canvas unless board interaction
requires it.

Required screens and dialogs:

- Country list and relation indicators
- Country details
- Declare war and friendship actions
- Black mark action
- Exchange/proposal builder
- Proposal inbox and diplomatic log
- Contract and treasury preview before acceptance
- Diplomacy victory status

Hotseat mode must not reveal another human player's private pending proposals
before the pass screen has been acknowledged.

## Phase 7: diplomatic AI

Port AI only after human-to-human hotseat diplomacy is stable.

AI decisions should account for:

- Military threat and shared borders
- Economic value and ability to pay
- Current relation and cooldowns
- Existing contracts and black marks
- Progress toward diplomatic victory
- Difficulty-specific willingness to accept risk

Use `GameState.rngState` for any randomized choice so simulations and replays
remain deterministic. Add proposal cooldowns and per-turn budgets to prevent
browser hangs and exchange loops.

## Persistence and compatibility

Initially, keep campaign progress in local storage and game state entirely
client-side. Do not introduce Lakebed database usage solely for these features.

Version all persisted structures:

```ts
interface StoredCampaignProgress {
  version: 1;
  rules: "antiyoy" | "slay";
  completed: number[];
}
```

When full game saves are implemented, save the complete serializable
`GameState`, session metadata, scenario id, and schema version. Avoid saving
derived caches that can be reconstructed.

## Verification

Extend `devtools/sim.ts` with:

- Scenario parsing and loading fixtures
- Campaign completion and unlock progression
- Objective evaluation
- Campaign storage migration and round trips
- Relation symmetry and attack authorization
- Money conservation for transfers and subsidies
- Contract expiry and eliminated-player cleanup
- AI diplomacy simulations with action budgets
- Deterministic replay of campaign and diplomacy actions

Run the standard checks after each vertical slice:

```sh
npx tsx devtools/sim.ts
cd web && npx lakebed dev --port 3203
node devtools/browser-check.mjs 3203
```

Browser coverage should include campaign selection, locked levels, victory
progression, diplomacy dialogs, proposal acceptance/rejection, hotseat privacy,
mobile layout, and return-to-menu behavior.

## First implementation milestone

The first useful pull request should contain only:

1. Bundle-size reduction and a size check.
2. Scenario types and loader.
3. A conversion script plus two representative campaign fixtures.
4. Tests proving those fixtures load correctly.

Do not combine the initial scenario foundation with the complete campaign UI or
diplomacy engine. Keeping the first milestone narrow makes the data conversion
and engine boundary reviewable before many levels depend on it.
