# Stage 10 (Diplomacy) — In-Progress Handover

Last updated: 2026-06-13. Written mid-Stage-10 at user request.

Read `HANDOVER.md`, `LEGACY_INTEGRATION_PLAN.md`, and the memory file
`legacy-integration-progress.md` first for the overall roadmap and deploy flow.

## Where the project stands

Stages 0–9 are **shipped and deployed** (production: https://antiyoy.lakebed.app).
Last committed/deployed: `75da0de Stage 9: fog of war`. CI auto-deploys on any
push touching `web/` (`.github/workflows/deploy.yml`, secret `LAKEBED_TOKEN`).

**Stages remaining:** 10 (in progress), 11 (diplomacy UI), 12 (diplomatic AI +
diplomatic campaign levels), 13 (editor/user levels), 14 (polish: skins,
localization, sound, city names, statistics).

## Stage 10 status: code written, NOT yet tested/committed

Uncommitted working tree (the only changes since `75da0de`):

- `web/client/game/diplomacy.ts` — **new**, the whole diplomacy model + rules.
- `web/client/game/types.ts` — **modified**: added `Relation`, `DiploContract`,
  `DiploProposal`, `DiploLogEntry`, `DiplomacyState`; `GameState.diplomacy?`;
  5 new `Action` variants (`declareWar`, `setBlackMark`, `proposeExchange`,
  `acceptExchange`, `rejectExchange`).
- `web/client/game/engine.ts` — **modified**: imports + re-exports the
  diplomacy surface; inits `state.diplomacy` in `createGame` and
  `createScenarioGame` when `config.diplomacy`; gates attacks by relation in
  `getMoveZone`/`getBuyZone` via `canAttackFraction` (this is the
  isolated-hex defect fix); handles the 5 diplomacy actions in `applyAction`;
  calls `processDiplomacyRound` on the round tick in `doEndTurn`; calls
  `onFractionEliminated` + `diplomaticVictor` in `checkElimination`.

### What is DONE in code
- Relations (neutral/friend/war), symmetric matrix, cooldowns, black marks,
  contracts (friendship/peace/blackMark/subsidy) with expiry, pending
  proposals, message log, per-fraction reputation (for the Stage-12 AI).
- Functions: `getRelation`, `canAttackFraction`, `declareWar`, `setBlackMark`,
  `proposeExchange`, `acceptExchange`, `rejectExchange`, `transferMoney`,
  `processDiplomacyRound`, `onFractionEliminated`, `diplomaticVictor`,
  `initDiplomacy`. All exposed via the engine re-export.
- Legacy-defect fixes implemented: isolated hexes obey relations; integer-exact
  zero-safe transfers; subsidies capped by income + funds; eliminated players
  scrubbed from relations/contracts/proposals.

### KEY DESIGN FACT (don't "fix" this)
Relations start **neutral**, and **neutral means you CANNOT attack** — exactly
like the original. In diplomacy mode you must **declare war before attacking**.
So a vs-AI diplomacy skirmish will have passive AIs until Stage 12 gives the AI
war/peace behavior; hotseat diplomacy (2+ humans) is fully playable now. This
is intended, not a bug.

### NOT yet done for Stage 10 (do these next)
1. **Write `devtools/diplomacy-tests.ts`** (was about to start). Cover:
   relation symmetry; attack authorization (neutral blocks, war allows,
   isolated hex obeys relations); treasury conservation (exact total, recipient
   with 0 money still receives); subsidy capped by income+funds; contract
   expiry returns pair to neutral; eliminated-player cleanup; diplomatic victory
   when all survivors are mutual friends. Build controlled states with
   `createGame({...,diplomacy:true})` and `createScenarioGame`.
2. **Verify**: `npx tsx devtools/diplomacy-tests.ts`, then the existing
   `sim.ts`, `mapgen-tests.ts`, `scenario-tests.ts`, `campaign-tests.ts` (make
   sure diplomacy-off games are unchanged — diplomacy must be inert unless
   `config.diplomacy`), then `node devtools/check-bundle.mjs`.
3. **Add the `diplomacy` skirmish toggle** in `screens/skirmish.tsx` +
   `skirmish-setup.ts` (mirror how `fogOfWar` was added in Stage 9). Persist it.
   NOTE: do not present diplomacy as fun-vs-AI until Stage 12 — consider gating
   it to hotseat (humanCount ≥ 2) for now, or label it clearly.
4. **Commit + push** (CI deploys), then `node devtools/browser-check.mjs
   https://antiyoy.lakebed.app` and confirm no regression. Update memory
   `legacy-integration-progress.md`.

### Watch-outs
- `diplomacy.ts` imports `getProvincesOf`/`getProvinceProfit` from `engine.ts`
  while `engine.ts` imports from `diplomacy.ts` — a cyclic import. It's fine
  because nothing is called at module-eval time, but keep it that way.
- `diplomaticVictor` returns a winner only when ALL survivors are pairwise
  friends; with the neutral default this never false-fires at game start.
- The engine change has **not been typechecked/built yet** — run
  `node devtools/check-bundle.mjs` (it builds) to catch any TS errors before
  trusting it.

## Reference: legacy diplomacy source
`core/src/yio/tro/antiyoy/gameplay/diplomacy/` (~4200 lines). The web port is a
clean reimplementation of the essentials, not a literal port (the plan says to
fix the legacy defects, not reproduce them). Key files read:
`DiplomaticRelation.java` (NEUTRAL=0/FRIEND=1/ENEMY=2), `DiplomaticContract.java`
(durations: friend 12, peace 9, traitor/blackmark 20), `DiplomacyManager.java`
(`canUnitAttackHex` ~line 922, `transferMoney` ~line 1030, `onTurnEnded` ~897).

## Verification commands (run from repo root)
```sh
npx tsx devtools/sim.ts
npx tsx devtools/mapgen-tests.ts
npx tsx devtools/scenario-tests.ts
npx tsx devtools/campaign-tests.ts
npx tsx devtools/diplomacy-tests.ts   # to be written
node devtools/check-bundle.mjs        # builds + 900 KB client budget gate
cd web && npx lakebed dev --port 3203
node devtools/browser-check.mjs 3203  # or the production URL after deploy
```
Bundle headroom: assets are CDN-hosted (jsDelivr), bundle ~800 KB. Keep heavy
data out of the bundle (see memory `bundle-asset-hosting`).

## Remaining roadmap (Stages 10–14)

Authoritative ordering for the rest of the project. See
`LEGACY_INTEGRATION_PLAN.md` for the full per-stage technical detail; this is
the condensed sequencing.

### Stages 10–12 (~6 weeks): diplomacy, end to end
1. **Stage 10 — diplomacy state model & rules** (IN PROGRESS, see above).
   Relations/contracts/proposals/transfers/victory in the engine, behind
   `config.diplomacy`. Human/hotseat only. Finish the 4 "NOT yet done" items
   above (tests, verify, skirmish toggle, commit/deploy).
2. **Stage 11 — diplomacy UI.** Original-style flag control on the HUD; DOM
   panels (not canvas) for: country list + relation indicators, country
   details, declare war / friendship / black mark actions, exchange/proposal
   builder, proposal inbox + diplomatic log, contract & treasury preview before
   acceptance, diplomatic-victory status. Hotseat privacy: never reveal another
   human's pending proposals before the pass screen is acknowledged.
3. **Stage 12 — diplomatic AI + diplomatic campaign levels.** Port AI only
   after hotseat diplomacy is stable. AI weighs military threat / shared
   borders, economic value & ability to pay, current relation + cooldowns,
   existing contracts & black marks, progress toward diplomatic victory, and
   difficulty-specific risk. Use `state.rngState` for any randomness so
   sims/replays stay deterministic; add proposal cooldowns + per-turn budgets to
   avoid browser hangs / exchange loops. **Then** enable the campaign levels
   that depend on diplomacy objectives, and surface the `diplomacy` skirmish
   toggle for vs-AI (it only becomes fun once the AI negotiates/wages war).

### Stages 13–14: editor and the long tail
4. **Stage 13 — editor & user levels.** Reuse the Stage-6 scenario schema
   (`game/scenario.ts` + codec). Define the shared level schema covering active
   land, factions, provinces, units, buildings, starting money, rules, fog,
   diplomacy, goals, messages. Add editor tools, local level storage,
   import/export, and a user-level browser. The scenario loader already exists,
   so the editor mostly produces Scenarios the engine can already load.
5. **Stage 14 — polish.** Skins (other `assets/skins/*` atlases — host via the
   CDN like the ant atlas, see memory `bundle-asset-hosting`), localization
   (extract visible strings from JSX, then a language selector), city names
   (province naming), sound & music, statistics. Each unblocks a setting that
   was intentionally deferred from the Stage-4 settings panel.

### Cross-cutting rules for all remaining stages
- Everything stays client-side; no Lakebed DB for these features.
- Version every persisted structure; provide migrations.
- No dead buttons / no fake capabilities (e.g. don't expose a diplomacy toggle
  as vs-AI-ready before Stage 12; don't list Expert/Balancer/Master AI until
  distinct behavior exists).
- Run the full verification suite + bundle gate before each deploy; deploy after
  each stage; keep heavy data CDN-hosted, not embedded.
