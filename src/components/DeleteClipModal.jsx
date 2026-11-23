import { useState } from "react";
import { Play, Square, Trash2 } from "lucide-react";

export default function DeleteClipModal({ title, hint, onPlay, onCancel, onConfirm }) {
  const [playing, setPlaying] = useState(false);

  async function preview() {
    setPlaying(true);
    try {
      await onPlay?.();
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <button type="button" className="absolute inset-0" aria-label="Cancel" onClick={onCancel} />
      <div
        className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900 p-4 shadow-2xl"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <h2 className="text-base font-semibold text-white">Delete this clip?</h2>
        <p className="mt-1 text-sm text-zinc-300">“{title}”</p>
        <p className="mt-2 text-xs text-zinc-500">
          {hint || "This cannot be undone. Play it first if you are not sure which one it is."}
        </p>
        <button
          type="button"
          onClick={preview}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-indigo-200"
        >
          {playing ? <Square size={14} /> : <Play size={14} />}
          {playing ? "Playing…" : "Play clip"}
        </button>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-full px-3 py-2.5 text-sm text-zinc-400">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-500 px-3 py-2.5 text-sm font-semibold text-white"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
