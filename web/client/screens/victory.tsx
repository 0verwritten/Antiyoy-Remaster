// End-of-game overlay.

import { MenuButton } from "../ui/controls";
import { ORIGINAL_FRACTION_COLORS } from "../sprites";

export function VictoryOverlay({
  label,
  winner,
  onReplay,
  onPlayAgain,
  onMenu,
}: {
  label: string;
  winner: number;
  onReplay: () => void;
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  const color = ORIGINAL_FRACTION_COLORS[winner] ?? "#999";
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
