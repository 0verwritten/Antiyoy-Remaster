// Replay library: finished games persisted to IndexedDB (newest first,
// bounded), with watch, rename, delete and JSON import/export.

import { useEffect, useState } from "preact/hooks";
import {
  deleteReplay,
  downloadJson,
  listReplays,
  newRecordId,
  pickJsonFile,
  putReplay,
  validateReplayRecord,
  type ReplayRecord,
} from "../game-storage";
import { MENU_BACKGROUND_COLOR } from "../sprites";
import { MenuButton } from "../ui/controls";
import { ReplayViewer } from "./replay";

function describeReplay(record: ReplayRecord): string {
  const c = record.config;
  const mode = (c.mode ?? "antiyoy") === "slay" ? "Slay" : "Normal";
  const winner = record.winner === null ? "no winner" : `P${record.winner + 1} won`;
  return `${mode} · ${c.mapSize} · ${c.playerCount}p · ${record.rounds} rounds · ${winner} · ${record.steps.length} steps`;
}

export function ReplaysScreen({ onBack }: { onBack: () => void }) {
  const [replays, setReplays] = useState<ReplayRecord[] | null>(null);
  const [watching, setWatching] = useState<ReplayRecord | null>(null);

  const refresh = () => {
    listReplays().then(setReplays, () => setReplays([]));
  };
  useEffect(refresh, []);

  async function importReplay() {
    const raw = await pickJsonFile();
    const record = raw ? validateReplayRecord(raw) : null;
    if (!record) {
      alert("That file is not a valid Antiyoy replay.");
      return;
    }
    record.id = newRecordId();
    await putReplay(record);
    refresh();
  }

  if (watching) {
    return (
      <main className="relative h-screen w-screen overflow-hidden">
        <ReplayViewer
          initialState={watching.initial}
          steps={watching.steps}
          onClose={() => setWatching(null)}
        />
      </main>
    );
  }

  return (
    <main
      className="min-h-screen w-full flex items-start justify-center p-5"
      style={{ background: MENU_BACKGROUND_COLOR }}
    >
      <div className="w-full max-w-md flex flex-col gap-5 py-4">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-[#f0eee3] drop-shadow-[0_2px_0_rgba(0,0,0,0.3)]">
            Replays
          </h1>
        </header>

        <section className="flex flex-col gap-3 rounded-3xl bg-[#b3ae7e] p-4 shadow-[0_4px_0_rgba(0,0,0,0.2)]">
          {replays === null && <p className="p-3 text-center text-sm font-bold text-[#2e2e28]/70">Loading…</p>}
          {replays !== null && replays.length === 0 && (
            <p className="p-3 text-center text-sm font-bold text-[#2e2e28]/70">
              No replays yet. Finished games are saved here automatically.
            </p>
          )}
          {replays?.map((record) => (
            <div key={record.id} className="rounded-2xl bg-[#f0eee3] p-3 text-[#3a3a33] shadow-[0_2px_0_rgba(0,0,0,0.15)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-base font-black">{record.name}</span>
                <span className="shrink-0 text-xs font-semibold opacity-60">
                  {new Date(record.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-0.5 text-xs font-semibold opacity-70">{describeReplay(record)}</div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setWatching(record)}
                  className="min-h-[40px] rounded-xl bg-[#3a3a33] text-sm font-bold text-[#f0eee3]"
                >
                  Watch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const name = prompt("Rename replay:", record.name);
                    if (!name) return;
                    putReplay({ ...record, name }).then(refresh);
                  }}
                  className="min-h-[40px] rounded-xl bg-[#e2dfc8] text-sm font-bold"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => downloadJson(`antiyoy-replay-${record.name.replace(/\W+/g, "_")}.json`, record)}
                  className="min-h-[40px] rounded-xl bg-[#e2dfc8] text-sm font-bold"
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete replay "${record.name}"?`)) deleteReplay(record.id).then(refresh);
                  }}
                  className="min-h-[40px] rounded-xl bg-[#a3322a]/90 text-sm font-bold text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>

        <MenuButton onClick={importReplay}>Import replay file</MenuButton>
        <MenuButton onClick={onBack}>Back</MenuButton>
      </div>
    </main>
  );
}
