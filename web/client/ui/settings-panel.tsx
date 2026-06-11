// Settings controls, shared by the dedicated settings screen and the
// in-game pause overlay (so opening settings never unmounts the board).

import { useState } from "preact/hooks";
import { saveSettings, settings } from "../settings";
import { Chip } from "./controls";

export function SettingsPanel() {
  const [, refresh] = useState(0);

  function setSetting<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    settings[key] = value;
    saveSettings();
    refresh((n) => n + 1);
  }

  const labelCls = "mb-2 block text-sm font-bold text-[#2e2e28]";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className={labelCls}>AI speed</label>
        <div className="grid grid-cols-3 gap-2">
          {(["slow", "normal", "fast"] as const).map((value) => (
            <Chip key={value} selected={settings.aiSpeed === value} onClick={() => setSetting("aiSpeed", value)}>
              {value}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <label className={labelCls}>Hex outlines</label>
        <div className="grid grid-cols-2 gap-2">
          <Chip selected={!settings.showAllBorders} onClick={() => setSetting("showAllBorders", false)}>
            Territory borders
          </Chip>
          <Chip selected={settings.showAllBorders} onClick={() => setSetting("showAllBorders", true)}>
            Full grid
          </Chip>
        </div>
      </div>

      <div>
        <label className={labelCls}>Unit animations</label>
        <div className="grid grid-cols-2 gap-2">
          <Chip selected={settings.unitAnimations} onClick={() => setSetting("unitAnimations", true)}>On</Chip>
          <Chip selected={!settings.unitAnimations} onClick={() => setSetting("unitAnimations", false)}>Off</Chip>
        </div>
      </div>

      <div>
        <label className={labelCls}>Ask before ending turn</label>
        <div className="grid grid-cols-2 gap-2">
          <Chip selected={settings.confirmEndTurn} onClick={() => setSetting("confirmEndTurn", true)}>On</Chip>
          <Chip selected={!settings.confirmEndTurn} onClick={() => setSetting("confirmEndTurn", false)}>Off</Chip>
        </div>
      </div>
    </div>
  );
}
