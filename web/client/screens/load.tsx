// Load-game screen: manual save slots + autosave, with rename, delete and
// JSON import/export. All data lives in IndexedDB on this device.

import { useEffect, useState } from "preact/hooks";
import {
  deleteSave,
  downloadJson,
  listSaves,
  newRecordId,
  pickJsonFile,
  putSave,
  validateSaveRecord,
  type SaveRecord,
} from "../game-storage";
import { MENU_BACKGROUND_COLOR } from "../sprites";
import { MenuButton } from "../ui/controls";

function describeConfig(record: SaveRecord): string {
  const c = record.config;
  const mode = (c.mode ?? "antiyoy") === "slay" ? "Slay" : "Normal";
  const humans = c.humanCount === 0 ? "AI only" : c.humanCount === 1 ? "vs AI" : `${c.humanCount} humans`;
  return `${mode} · ${c.mapSize} · ${c.playerCount}p · ${humans} · round ${record.state.round + 1}`;
}

export function LoadScreen({
  onBack,
  onLoad,
}: {
  onBack: () => void;
  onLoad: (record: SaveRecord) => void;
}) {
  const [saves, setSaves] = useState<SaveRecord[] | null>(null);

  const refresh = () => {
    listSaves().then(setSaves, () => setSaves([]));
  };
  useEffect(refresh, []);

  async function importSave() {
    const raw = await pickJsonFile();
    const record = raw ? validateSaveRecord(raw) : null;
    if (!record) {
      alert("That file is not a valid Antiyoy save.");
      return;
    }
    record.id = newRecordId(); // never overwrite an existing slot on import
    record.updatedAt = Date.now();
    await putSave(record);
    refresh();
  }

  return (
    <main
      className="min-h-screen w-full flex items-start justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-md flex flex-col gap-5 py-4">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Load game
          </h1>
        </header>

        <section className="flex flex-col gap-3 rounded-3xl bg-[#b3ae7e] p-4 shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          {saves === null && <p className="p-3 text-center text-sm font-bold text-[#2e2e28]/70">Loading…</p>}
          {saves !== null && saves.length === 0 && (
            <p className="p-3 text-center text-sm font-bold text-[#2e2e28]/70">
              No saved games yet. Use Save in the in-game pause menu.
            </p>
          )}
          {saves?.map((record) => (
            <div key={record.id} className="rounded-2xl bg-[#f0eee3] p-3 text-[#3a3a33] shadow-[0_2px_0_rgba(0,0,0,0.15)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-base font-black">{record.name}</span>
                <span className="shrink-0 text-xs font-semibold opacity-60">
                  {new Date(record.updatedAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-0.5 text-xs font-semibold opacity-70">{describeConfig(record)}</div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => onLoad(record)}
                  className="min-h-[40px] rounded-xl bg-[#3a3a33] text-sm font-bold text-[#f0eee3]"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const name = prompt("Rename save:", record.name);
                    if (!name) return;
                    putSave({ ...record, name }).then(refresh);
                  }}
                  className="min-h-[40px] rounded-xl bg-[#e2dfc8] text-sm font-bold"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => downloadJson(`antiyoy-save-${record.name.replace(/\W+/g, "_")}.json`, record)}
                  className="min-h-[40px] rounded-xl bg-[#e2dfc8] text-sm font-bold"
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete save "${record.name}"?`)) deleteSave(record.id).then(refresh);
                  }}
                  className="min-h-[40px] rounded-xl bg-[#a3322a]/90 text-sm font-bold text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>

        <MenuButton onClick={importSave}>Import save file</MenuButton>
        <MenuButton onClick={onBack}>Back</MenuButton>
      </div>
    </main>
  );
}
