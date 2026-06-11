// About screen: project credits and links (replaces the native Exit action,
// which has no browser equivalent).

import { MENU_BACKGROUND_COLOR } from "../sprites";
import { MenuButton } from "../ui/controls";

export function AboutScreen({ onBack }: { onBack: () => void }) {
  const linkCls = "font-bold underline decoration-2 underline-offset-2";
  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-md flex flex-col gap-6">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            About
          </h1>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl bg-[#b3ae7e] p-6 text-[#2e2e28] shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          <p className="font-semibold">
            A from-scratch web remaster of <span className="font-black">Antiyoy</span>, the
            turn-based strategy game by yiotro, using the original game's sprites, palette and
            rules.
          </p>
          <p className="text-sm font-semibold">
            Original game:{" "}
            <a className={linkCls} href="https://github.com/yiotro/Antiyoy" target="_blank" rel="noreferrer">
              github.com/yiotro/Antiyoy
            </a>
          </p>
          <p className="text-sm font-semibold">
            This remaster:{" "}
            <a className={linkCls} href="https://github.com/0verwritten/Antiyoy-Remaster" target="_blank" rel="noreferrer">
              github.com/0verwritten/Antiyoy-Remaster
            </a>
          </p>
          <p className="text-sm font-semibold opacity-80">
            Everything runs in your browser — games, settings and progress stay on this device.
          </p>
        </section>

        <MenuButton onClick={onBack}>Back</MenuButton>
      </div>
    </main>
  );
}
