// Skirmish setup screen: full legacy configuration (map size incl. huge,
// players with per-size limits, difficulty, game mode, tree density,
// starting provinces, preferred color, seed) persisted as the last-used
// setup. The six legacy difficulty labels are exposed because each maps to a
// distinct AI tuning.

import { useState } from "preact/hooks";
import {
  maxPlayersForMapSize,
  TREES_PERCENTAGES,
} from "../game/constants";
import type { Difficulty, GameConfig, MapSize } from "../game/types";
import { MENU_BACKGROUND_COLOR, ORIGINAL_FRACTION_COLORS } from "../sprites";
import { Chip, MenuButton } from "../ui/controls";
import { loadSkirmishSetup, saveSkirmishSetup, type SkirmishSetup } from "../skirmish-setup";

const MAP_SIZES: MapSize[] = ["small", "medium", "large", "huge"];
const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "expert", "balancer", "master"];

export function SkirmishScreen({
  onPlay,
  onBack,
}: {
  onPlay: (config: GameConfig) => void;
  onBack: () => void;
}) {
  const [setup, setSetup] = useState<SkirmishSetup>(() => loadSkirmishSetup());
  // Empty seed field = a fresh random map every game.
  const [seedText, setSeedText] = useState("");

  const maxPlayers = maxPlayersForMapSize(setup.mapSize);
  const playerCount = Math.min(setup.playerCount, maxPlayers);
  const humanCount = Math.min(setup.humanCount, playerCount);

  function update(patch: Partial<SkirmishSetup>) {
    setSetup((s) => ({ ...s, ...patch }));
  }

  function play() {
    const normalized = { ...setup, playerCount, humanCount };
    saveSkirmishSetup(normalized);
    const parsedSeed = Math.abs(Math.floor(Number(seedText)));
    onPlay({
      mapSize: normalized.mapSize,
      playerCount,
      humanCount,
      seed: seedText.trim() !== "" && Number.isFinite(parsedSeed) ? parsedSeed % 2 ** 31 : Date.now() % 2 ** 31,
      difficulty: normalized.difficulty,
      mode: normalized.mode,
      treePercentage: normalized.treePercentage,
      startingProvinces: normalized.startingProvinces,
      colorOffset: normalized.colorOffset,
      fogOfWar: normalized.fogOfWar,
      diplomacy: normalized.diplomacy,
      nightBattle: normalized.nightBattle,
    });
  }

  const labelCls = "mb-2 block text-sm font-bold text-[#2e2e28]";
  const treeIndex = Math.max(0, TREES_PERCENTAGES.indexOf(setup.treePercentage));
  const mapSizeIndex = Math.max(0, MAP_SIZES.indexOf(setup.mapSize));

  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-md flex flex-col gap-6 py-4">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Skirmish
          </h1>
        </header>

        <section className="flex flex-col gap-5 rounded-3xl bg-[#b3ae7e] p-5 shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <div>
            <label className={labelCls}>Map size: {setup.mapSize}</label>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#2e2e28]/60">small</span>
              <input
                type="range"
                min="0"
                max={MAP_SIZES.length - 1}
                step="1"
                value={mapSizeIndex}
                aria-label="Map size"
                onInput={(event) => update({ mapSize: MAP_SIZES[Number(event.currentTarget.value)] })}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-[#3a3a33]"
              />
              <span className="text-xs font-bold text-[#2e2e28]/60">huge</span>
            </div>
          </div>

          <div>
            <label className={labelCls}>Players: {playerCount}</label>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#2e2e28]/60">2</span>
              <input
                type="range"
                min="2"
                max={maxPlayers}
                step="1"
                value={playerCount}
                aria-label="Player count"
                onInput={(event) => {
                  const count = Number(event.currentTarget.value);
                  update({ playerCount: count, humanCount: Math.min(humanCount, count) });
                }}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-[#3a3a33]"
              />
              <span className="text-xs font-bold text-[#2e2e28]/60">{maxPlayers}</span>
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Humans: {humanCount}{" "}
              <span className="font-normal opacity-60">
                {humanCount === 0 ? "(watch AI)" : humanCount === 1 ? "(vs AI)" : "(pass & play)"}
              </span>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#2e2e28]/60">0</span>
              <input
                type="range"
                min="0"
                max={playerCount}
                step="1"
                value={humanCount}
                aria-label="Human player count"
                onInput={(event) => update({ humanCount: Number(event.currentTarget.value) })}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-[#3a3a33]"
              />
              <span className="min-w-[1ch] text-xs font-bold text-[#2e2e28]/60">{playerCount}</span>
            </div>
          </div>

          <div>
            <label className={labelCls}>Difficulty</label>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTIES.map((difficulty) => (
                <Chip
                  key={difficulty}
                  selected={setup.difficulty === difficulty}
                  onClick={() => update({ difficulty })}
                >
                  {difficulty}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Game mode{" "}
              <span className="font-normal opacity-60">
                {setup.mode === "antiyoy" ? "(conquer neutral land)" : "(all land owned from start)"}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Chip selected={setup.mode === "antiyoy"} onClick={() => update({ mode: "antiyoy" })}>
                Normal
              </Chip>
              <Chip selected={setup.mode === "slay"} onClick={() => update({ mode: "slay" })}>
                Slay
              </Chip>
            </div>
          </div>

          <details className="rounded-2xl bg-[#a49f70] px-4 py-3 text-[#2e2e28]">
            <summary className="cursor-pointer select-none text-sm font-bold">More options</summary>
            <div className="mt-4 flex flex-col gap-4">
              <div>
                <label className={labelCls}>
                  Night Battle{" "}
                  <span className="mr-1 inline-block rounded bg-[#a3322a] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                    Beta
                  </span>{" "}
                  <span className="font-normal opacity-60">(dark map lit by lanterns)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Chip selected={setup.nightBattle} onClick={() => update({ nightBattle: true })}>On</Chip>
                  <Chip selected={!setup.nightBattle} onClick={() => update({ nightBattle: false })}>Off</Chip>
                </div>
              </div>

              <div>
                <label className={labelCls}>Player color</label>
                <div className="flex flex-wrap gap-2">
                  {ORIGINAL_FRACTION_COLORS.map((color, i) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Player color ${i + 1}`}
                      onClick={() => update({ colorOffset: i })}
                      className={`h-11 w-11 rounded-xl ring-2 transition ${
                        setup.colorOffset === i ? "ring-[#2e2e28] scale-110" : "ring-black/20"
                      }`}
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>Trees: {setup.treePercentage}%</label>
                <input
                  type="range"
                  min="0"
                  max={TREES_PERCENTAGES.length - 1}
                  step="1"
                  value={treeIndex}
                  aria-label="Tree density"
                  onInput={(event) =>
                    update({ treePercentage: TREES_PERCENTAGES[Number(event.currentTarget.value)] })
                  }
                  className="h-2 w-full cursor-pointer accent-[#3a3a33]"
                />
              </div>

              {setup.mode === "antiyoy" && (
                <div>
                  <label className={labelCls}>Starting provinces per player</label>
                  <div className="grid grid-cols-5 gap-2">
                    {([0, 1, 2, 3, 4] as const).map((n) => (
                      <Chip key={n} selected={setup.startingProvinces === n} onClick={() => update({ startingProvinces: n })}>
                        {n === 0 ? "auto" : n}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className={labelCls}>
                  Fog of war{" "}
                  <span className="font-normal opacity-60">(see only near your land)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Chip selected={setup.fogOfWar} onClick={() => update({ fogOfWar: true })}>On</Chip>
                  <Chip selected={!setup.fogOfWar} onClick={() => update({ fogOfWar: false })}>Off</Chip>
                </div>
              </div>

              <div>
                <label className={labelCls}>
                  Diplomacy{" "}
                  <span className="font-normal opacity-60">
                    {humanCount >= 2 ? "(declare war before attacks)" : "(basic AI support)"}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Chip selected={setup.diplomacy} onClick={() => update({ diplomacy: true })}>On</Chip>
                  <Chip selected={!setup.diplomacy} onClick={() => update({ diplomacy: false })}>Off</Chip>
                </div>
              </div>

              <div>
                <label className={labelCls}>
                  Map seed <span className="font-normal opacity-60">(empty = random)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={seedText}
                    aria-label="Map seed"
                    placeholder="random"
                    onInput={(event) => setSeedText(event.currentTarget.value.replace(/[^0-9]/g, ""))}
                    className="min-h-[44px] min-w-0 flex-1 rounded-xl bg-[#e2dfc8] px-3 text-sm font-bold text-[#3a3a33] outline-none ring-[#3a3a33] placeholder:text-[#3a3a33]/40 focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={() => setSeedText(String(Math.floor(Math.random() * 2 ** 31)))}
                    className="min-h-[44px] rounded-xl bg-[#f0eee3] px-4 text-sm font-bold text-[#3a3a33] shadow-[0_2px_0_rgba(0,0,0,0.2)] active:translate-y-[1px] active:shadow-none"
                  >
                    Roll
                  </button>
                </div>
              </div>
            </div>
          </details>

          <MenuButton onClick={play} className="mt-1 text-xl">
            Play
          </MenuButton>
        </section>

        <MenuButton onClick={onBack}>Back</MenuButton>
      </div>
    </main>
  );
}
