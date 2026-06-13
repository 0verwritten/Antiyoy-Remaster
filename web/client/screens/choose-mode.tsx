// Play submenu: pick Skirmish or Campaign. Only implemented destinations
// appear (no dead buttons).

import { MENU_BACKGROUND_COLOR } from "../sprites";
import { MenuButton } from "../ui/controls";

export function ChooseModeScreen({
  onSkirmish,
  onCampaign,
  onBack,
}: {
  onSkirmish: () => void;
  onCampaign: () => void;
  onBack: () => void;
}) {
  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-xs flex flex-col gap-4">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Play
          </h1>
        </header>
        <MenuButton onClick={onSkirmish} className="text-xl">
          Skirmish
        </MenuButton>
        <MenuButton onClick={onCampaign} className="text-xl">
          Campaign
        </MenuButton>
        <MenuButton onClick={onBack}>Back</MenuButton>
      </div>
    </main>
  );
}
