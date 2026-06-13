// Campaign level selector: a grid of levels with lock/complete state, in the
// original olive style. Locked levels can't be started.

import { useEffect, useState } from "preact/hooks";
import { campaignLevels, CAMPAIGN_LEVEL_COUNT, ensureCampaignData } from "../game/campaign";
import {
  completedLevels,
  isLevelUnlocked,
  resetCampaign,
} from "../campaign-storage";
import { MENU_BACKGROUND_COLOR } from "../sprites";
import { MenuButton } from "../ui/controls";

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: "#3f7a3f",
  normal: "#a8862e",
  hard: "#a3322a",
};

export function CampaignScreen({
  onBack,
  onPlayLevel,
}: {
  onBack: () => void;
  onPlayLevel: (level: number) => void;
}) {
  const [, bump] = useState(0);
  // Prefetch the hosted level data so fixed levels load their exact map
  // rather than the generated fallback.
  const [dataError, setDataError] = useState(false);
  useEffect(() => {
    ensureCampaignData().catch(() => setDataError(true));
  }, []);
  const done = new Set(completedLevels());
  const levels = campaignLevels();
  const completedCount = levels.filter((l) => done.has(l.level)).length;

  return (
    <main
      className="min-h-screen w-full flex items-start justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-md flex flex-col gap-5 py-4">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Campaign
          </h1>
          <p className="mt-1 text-xs font-semibold text-[#2e2e28]/70">
            {completedCount} / {CAMPAIGN_LEVEL_COUNT} levels complete
          </p>
          {dataError && (
            <p className="mt-1 text-xs font-semibold text-[#a3322a]">
              Level data unavailable — levels will use generated maps.
            </p>
          )}
        </header>

        <section className="rounded-3xl bg-[#b3ae7e] p-4 shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <div className="grid grid-cols-4 gap-2.5">
            {levels.map((info) => {
              const unlocked = isLevelUnlocked(info.level);
              const completed = done.has(info.level);
              return (
                <button
                  key={info.level}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => unlocked && onPlayLevel(info.level)}
                  title={`Level ${info.level} · ${info.difficulty}${unlocked ? "" : " · locked"}`}
                  className={`relative flex aspect-square items-center justify-center rounded-xl text-lg font-black shadow-[0_2px_0_rgba(0,0,0,0.2)] transition active:translate-y-[1px] active:shadow-none ${
                    unlocked ? "bg-[#f0eee3] text-[#3a3a33]" : "cursor-not-allowed bg-[#9a9568] text-[#2e2e28]/40"
                  }`}
                >
                  {unlocked ? info.level : "🔒"}
                  <span
                    className="absolute bottom-1 right-1 h-2 w-2 rounded-full ring-1 ring-black/20"
                    style={{ background: DIFFICULTY_COLOR[info.difficulty] }}
                  />
                  {completed && (
                    <span className="absolute left-1 top-0.5 text-xs font-black text-[#2c7a2c]">✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          onClick={() => {
            if (confirm("Reset all campaign progress?")) {
              resetCampaign();
              bump((n) => n + 1);
            }
          }}
          className="min-h-[44px] rounded-xl bg-[#a3322a]/90 px-3 text-sm font-bold text-white shadow-[0_2px_0_rgba(0,0,0,0.2)] active:translate-y-[1px] active:shadow-none"
        >
          Reset progress
        </button>
        <MenuButton onClick={onBack}>Back</MenuButton>
      </div>
    </main>
  );
}
