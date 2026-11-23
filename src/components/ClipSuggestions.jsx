import { Play, Trash2 } from "lucide-react";
import { formatTimestamp } from "../lib/wav";

export default function ClipSuggestions({
  items,
  activeId,
  transcribing,
  progress,
  friendId,
  friends,
  onSelect,
  onChange,
  onRemove,
  onPreview,
  onSaveSelected,
  saving,
}) {
  const keep = items.filter((item) => item.selected);
  const unnamed = keep.filter((item) => !item.title.trim()).length;

  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-zinc-900/50 p-3">
      <div>
        <h2 className="text-sm font-semibold text-white">Name each clip</h2>
        <p className="text-xs text-zinc-500">
          {transcribing
            ? progress || "Splitting on gaps…"
            : `${items.length} clips from pauses. Tap one to trim it on the waveform, then type a name.`}
        </p>
      </div>

      {transcribing ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-indigo-500 to-violet-600" />
        </div>
      ) : null}

      <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        {items.map((item, index) => {
          const active = item.id === activeId;
          const needsName = item.selected && !item.title.trim();
          return (
            <article
              key={item.id}
              className={`rounded-2xl border px-3 py-3 ${
                active ? "border-indigo-400/50 bg-indigo-500/10" : "border-white/10 bg-zinc-950/50"
              }`}
            >
              <button type="button" onClick={() => onSelect(item)} className="mb-2 flex w-full items-center justify-between gap-2 text-left">
                <span className="text-xs font-semibold text-zinc-300">
                  Clip {index + 1}
                  {item.boardId ? <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-emerald-300">Saved</span> : null}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {formatTimestamp(item.start)} – {formatTimestamp(item.end)}
                </span>
              </button>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500">Name</span>
                <input
                  value={item.title}
                  placeholder={`Name clip ${index + 1}`}
                  onFocus={() => onSelect(item)}
                  onChange={(e) => onChange(item.id, { title: e.target.value })}
                  className={`mt-1 w-full rounded-xl border bg-zinc-950 px-3 py-2.5 text-sm outline-none ${
                    needsName ? "border-amber-400/40" : "border-white/10 focus:border-indigo-400"
                  }`}
                />
              </label>
              {item.text ? (
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">Heard: “{item.text}”</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={item.friendId || friendId}
                  onChange={(e) => onChange(item.id, { friendId: e.target.value })}
                  className="min-w-[8rem] flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs"
                >
                  {friends.map((friend) => (
                    <option key={friend.id} value={friend.id}>
                      {friend.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onPreview(item)}
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-200"
                >
                  <Play size={11} /> Play
                </button>
                {item.boardId ? null : (
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] text-zinc-500 hover:text-rose-300"
                >
                  <Trash2 size={11} /> Hide
                </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onSaveSelected}
        disabled={saving || !keep.length || unnamed > 0}
        className="w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {unnamed > 0
          ? `Name ${unnamed} more clip${unnamed === 1 ? "" : "s"} to save`
          : `Save ${keep.length} clip${keep.length === 1 ? "" : "s"} to board`}
      </button>
    </section>
  );
}
