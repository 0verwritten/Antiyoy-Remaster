// Dedicated settings screen (reached from the main menu).

import { MENU_BACKGROUND_COLOR } from "../sprites";
import { MenuButton } from "../ui/controls";
import { SettingsPanel } from "../ui/settings-panel";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-md flex flex-col gap-6">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Settings
          </h1>
        </header>

        <section className="rounded-3xl bg-[#b3ae7e] p-5 shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <SettingsPanel />
        </section>

        <MenuButton onClick={onBack}>Back</MenuButton>
      </div>
    </main>
  );
}
