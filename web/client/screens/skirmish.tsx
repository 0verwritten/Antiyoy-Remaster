// Skirmish setup screen (map size, players, difficulty, game mode).

import { useState } from "preact/hooks";
import type { Difficulty, GameConfig, GameMode, MapSize } from "../game/types";
import { MENU_BACKGROUND_COLOR } from "../sprites";
import { Chip, MenuButton } from "../ui/controls";

export function SkirmishScreen({
  onPlay,
  onBack,
  initial,
}: {
  onPlay: (config: GameConfig) => void;
  onBack: () => void;
  initial: GameConfig | null;
}) {
  const [mapSize, setMapSize] = useState<MapSize>(initial?.mapSize ?? "medium");
  const [playerCount, setPlayerCount] = useState(initial?.playerCount ?? 2);
  const [humanCount, setHumanCount] = useState(initial?.humanCount ?? 1);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? "normal");
  const [mode, setMode] = useState<GameMode>(initial?.mode ?? "antiyoy");

  const clampedHumans = Math.min(humanCount, playerCount);

  function play() {
    onPlay({
      mapSize,
      playerCount,
      humanCount: clampedHumans,
      seed: Date.now() % 2 ** 31,
      difficulty,
      mode,
    });
  }

  const labelCls = "mb-2 block text-sm font-bold text-[#2e2e28]";

  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-md flex flex-col gap-6">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Skirmish
          </h1>
        </header>

        <section className="flex flex-col gap-5 rounded-3xl bg-[#b3ae7e] p-5 shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <div>
            <label className={labelCls}>Map size</label>
            <div className="grid grid-cols-3 gap-2">
              {(["small", "medium", "large"] as MapSize[]).map((m) => (
                <Chip key={m} selected={mapSize === m} onClick={() => setMapSize(m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Players: {playerCount}</label>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#2e2e28]/60">2</span>
              <input
                type="range"
                min="2"
                max="6"
                step="1"
                value={playerCount}
                aria-label="Player count"
                onInput={(event) => {
                  const count = Number(event.currentTarget.value);
                  setPlayerCount(count);
                  if (humanCount > count) setHumanCount(count);
                }}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-[#3a3a33]"
              />
              <span className="text-xs font-bold text-[#2e2e28]/60">6</span>
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Humans: {clampedHumans}{" "}
              <span className="font-normal opacity-60">
                {clampedHumans === 0 ? "(watch AI)" : clampedHumans === 1 ? "(vs AI)" : "(pass & play)"}
              </span>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[#2e2e28]/60">0</span>
              <input
                type="range"
                min="0"
                max={playerCount}
                step="1"
                value={clampedHumans}
                aria-label="Human player count"
                onInput={(event) => setHumanCount(Number(event.currentTarget.value))}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-[#3a3a33]"
              />
              <span className="min-w-[1ch] text-xs font-bold text-[#2e2e28]/60">{playerCount}</span>
            </div>
          </div>

          <div>
            <label className={labelCls}>Difficulty</label>
            <div className="grid grid-cols-3 gap-2">
              {(["easy", "normal", "hard"] as Difficulty[]).map((d) => (
                <Chip key={d} selected={difficulty === d} onClick={() => setDifficulty(d)}>
                  {d}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Game mode{" "}
              <span className="font-normal opacity-60">
                {mode === "antiyoy" ? "(conquer neutral land)" : "(all land owned from start)"}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Chip selected={mode === "antiyoy"} onClick={() => setMode("antiyoy")}>
                Normal
              </Chip>
              <Chip selected={mode === "slay"} onClick={() => setMode("slay")}>
                Slay
              </Chip>
            </div>
          </div>

          <MenuButton onClick={play} className="mt-1 text-xl">
            Play
          </MenuButton>
        </section>

        <MenuButton onClick={onBack}>Back</MenuButton>
      </div>
    </main>
  );
}
