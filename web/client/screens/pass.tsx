// Hotseat pass-the-device interstitial.

import { MenuButton } from "../ui/controls";
import { MENU_BACKGROUND_COLOR, ORIGINAL_FRACTION_COLORS } from "../sprites";

export function PassScreen({
  fraction,
  onContinue,
}: {
  fraction: number;
  onContinue: () => void;
}) {
  const color = ORIGINAL_FRACTION_COLORS[fraction] ?? "#999";
  return (
    <main
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: MENU_BACKGROUND_COLOR }}
      onClick={onContinue}
    >
      <div className="flex flex-col items-center gap-5 p-6 text-center">
        <span
          className="h-16 w-16 rounded-2xl ring-2 ring-black/20"
          style={{ background: color }}
        />
        <h2 className="text-3xl font-black text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
          Player {fraction + 1}
        </h2>
        <p className="font-semibold text-[#2e2e28]/80">Pass the device, then tap to start your turn.</p>
        <MenuButton onClick={onContinue}>Tap to start</MenuButton>
      </div>
    </main>
  );
}
