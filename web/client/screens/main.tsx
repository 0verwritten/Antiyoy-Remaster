// Main menu in the original olive style: Play, Resume (when a game is
// active), Settings, About. The native Exit action has no browser
// equivalent and is omitted.

import { MENU_BACKGROUND_COLOR } from "../sprites";
import { MenuButton } from "../ui/controls";

export function MainMenuScreen({
  canResume,
  onPlay,
  onResume,
  onLoad,
  onReplays,
  onSettings,
  onAbout,
}: {
  canResume: boolean;
  onPlay: () => void;
  onResume: () => void;
  onLoad: () => void;
  onReplays: () => void;
  onSettings: () => void;
  onAbout: () => void;
}) {
  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-xs flex flex-col gap-6">
        <header className="text-center">
          <h1 className="text-6xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Antiyoy
          </h1>
          <p className="mt-1 text-xs font-semibold text-[#2e2e28]/70">
            Web remaster of Antiyoy by yiotro
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {canResume && <MenuButton onClick={onResume}>Resume</MenuButton>}
          <MenuButton onClick={onPlay} className="text-xl">
            Play
          </MenuButton>
          <MenuButton onClick={onLoad}>Load game</MenuButton>
          <MenuButton onClick={onReplays}>Replays</MenuButton>
          <MenuButton onClick={onSettings}>Settings</MenuButton>
          <MenuButton onClick={onAbout}>About</MenuButton>
        </div>
      </div>
    </main>
  );
}
