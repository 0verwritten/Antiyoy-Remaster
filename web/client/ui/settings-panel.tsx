// Settings controls, shared by the dedicated settings screen and the
// in-game pause overlay (so opening settings never unmounts the board).
// Options whose backing feature does not exist yet (sound, autosave, water
// texture, skins, city names, language) are intentionally absent.

import { useEffect, useState } from "preact/hooks";
import { resetSettings, saveSettings, settings } from "../settings";
import { getInstallState, installApp, subscribeToInstallState } from "../pwa";
import { Chip } from "./controls";

function Toggle({
  label,
  value,
  onChange,
  onLabel = "On",
  offLabel = "Off",
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-bold text-[#2e2e28]">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        <Chip selected={value} onClick={() => onChange(true)}>{onLabel}</Chip>
        <Chip selected={!value} onClick={() => onChange(false)}>{offLabel}</Chip>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const [, bump] = useState(0);
  const [installState, setInstallState] = useState(getInstallState);
  const refresh = () => bump((n) => n + 1);

  useEffect(() => subscribeToInstallState(() => setInstallState(getInstallState())), []);

  function setSetting<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    settings[key] = value;
    saveSettings();
    refresh();
  }

  const labelCls = "mb-2 block text-sm font-bold text-[#2e2e28]";
  // Original sensitivity preference: slider index / 6, default 1.0.
  const sensIndex = Math.round(settings.cameraSensitivity * 6);
  const fullscreen = typeof document !== "undefined" && !!document.fullscreenElement;

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
        <label className={labelCls}>
          Camera sensitivity: {(settings.cameraSensitivity).toFixed(2)}x
        </label>
        <input
          type="range"
          min="1"
          max="12"
          step="1"
          value={sensIndex}
          aria-label="Camera sensitivity"
          onInput={(event) =>
            setSetting("cameraSensitivity", Math.max(0.1, Number(event.currentTarget.value) / 6))
          }
          className="h-2 w-full cursor-pointer accent-[#3a3a33]"
        />
      </div>

      <Toggle label="Unit animations" value={settings.unitAnimations} onChange={(v) => setSetting("unitAnimations", v)} />
      <Toggle label="Ask before ending turn" value={settings.confirmEndTurn} onChange={(v) => setSetting("confirmEndTurn", v)} />
      <Toggle label="Hold to march" value={settings.holdToMarch} onChange={(v) => setSetting("holdToMarch", v)} />
      <Toggle
        label="Auto-select next unit"
        value={settings.autoTransition}
        onChange={(v) => setSetting("autoTransition", v)}
      />
      <Toggle label="Left-handed layout" value={settings.leftHanded} onChange={(v) => setSetting("leftHanded", v)} />
      <Toggle
        label="Resume button on main menu"
        value={settings.showResumeButton}
        onChange={(v) => setSetting("showResumeButton", v)}
      />

      <div>
        <label className={labelCls}>Fullscreen</label>
        <button
          type="button"
          onClick={() => {
            if (document.fullscreenElement) {
              void document.exitFullscreen();
            } else {
              void document.documentElement.requestFullscreen?.();
            }
            // The fullscreenchange event lands after the promise; refresh a beat later.
            setTimeout(refresh, 150);
          }}
          className="min-h-[44px] w-full rounded-xl bg-[#f0eee3] px-3 text-sm font-bold text-[#3a3a33] shadow-[0_2px_0_rgba(0,0,0,0.2)] active:translate-y-[1px] active:shadow-none"
        >
          {fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        </button>
      </div>

      <div>
        <label className={labelCls}>Install app</label>
        <button
          type="button"
          disabled={installState === "installed" || installState === "unavailable"}
          onClick={() => {
            if (installState === "ios") {
              alert('To install Antiyoy, tap the Share button in Safari, then choose "Add to Home Screen".');
              return;
            }
            void installApp();
          }}
          className="min-h-[44px] w-full rounded-xl bg-[#f0eee3] px-3 text-sm font-bold text-[#3a3a33] shadow-[0_2px_0_rgba(0,0,0,0.2)] active:translate-y-[1px] active:shadow-none disabled:cursor-default disabled:opacity-55 disabled:active:translate-y-0"
        >
          {installState === "installed"
            ? "App installed"
            : installState === "ios"
              ? "Add to Home Screen"
              : installState === "available"
                ? "Install Antiyoy"
                : "Install unavailable"}
        </button>
        {installState === "unavailable" && (
          <p className="mt-2 text-xs text-[#5b5a50]">Use your browser menu to install this app when supported.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          if (confirm("Reset all settings to defaults?")) {
            resetSettings();
            refresh();
          }
        }}
        className="min-h-[44px] w-full rounded-xl bg-[#a3322a] px-3 text-sm font-bold text-white shadow-[0_2px_0_rgba(0,0,0,0.2)] active:translate-y-[1px] active:shadow-none"
      >
        Reset settings
      </button>
    </div>
  );
}
