// End-of-game overlays (skirmish victory + campaign win/loss).

import { MenuButton } from "../ui/controls";

export function VictoryOverlay({
  label,
  color,
  onReplay,
  onPlayAgain,
  onMenu,
}: {
  label: string;
  color: string;
  onReplay: () => void;
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-5 rounded-3xl bg-[#b3ae7e] p-8 text-center shadow-[0_4px_0_rgba(0,0,0,0.25)]">
        <span
          className="h-16 w-16 rounded-2xl ring-2 ring-black/20"
          style={{ background: color }}
        />
        <h2 className="text-3xl font-black text-[#2e2e28]">{label} wins!</h2>
        <div className="flex flex-wrap justify-center gap-3">
          <MenuButton onClick={onReplay}>Replay</MenuButton>
          <MenuButton onClick={onPlayAgain}>Play again</MenuButton>
          <MenuButton onClick={onMenu}>Menu</MenuButton>
        </div>
      </div>
    </div>
  );
}

export function CampaignOverlay({
  level,
  won,
  hasNext,
  onRetry,
  onNext,
  onReplay,
  onMenu,
}: {
  level: number;
  won: boolean;
  hasNext: boolean;
  onRetry: () => void;
  onNext: () => void;
  onReplay: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-5 rounded-3xl bg-[#b3ae7e] p-8 text-center shadow-[0_4px_0_rgba(0,0,0,0.25)]">
        <h2 className="text-3xl font-black text-[#2e2e28]">
          {won ? `Level ${level} complete!` : `Level ${level} failed`}
        </h2>
        <p className="font-semibold text-[#2e2e28]/80">
          {won
            ? hasNext
              ? "The next level is unlocked."
              : "You have finished the campaign!"
            : "Your kingdom was destroyed."}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {won && hasNext && <MenuButton onClick={onNext}>Next level</MenuButton>}
          {!won && <MenuButton onClick={onRetry}>Retry</MenuButton>}
          <MenuButton onClick={onReplay}>Replay</MenuButton>
          <MenuButton onClick={onMenu}>Campaign menu</MenuButton>
        </div>
      </div>
    </div>
  );
}
