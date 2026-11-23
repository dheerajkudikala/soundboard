import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getClipBlob } from "../lib/db";
import { onPlaybackChange, playClip, stopClip } from "../lib/audio";

export default function Pad({ clip, friend, playOnly, onRename, onDelete }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return onPlaybackChange((ids) => setPlaying(ids.includes(clip.id)));
  }, [clip.id]);

  async function trigger() {
    const blob = await getClipBlob(clip.id);
    if (!blob) return;
    if (playing) {
      stopClip(clip.id);
      return;
    }
    await playClip(clip.id, blob, {
      volume: clip.volume ?? 1,
      playbackRate: clip.playbackRate ?? 1,
      preservePitch: clip.preservePitch !== false,
    });
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={trigger}
        className={`flex w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/80 text-left shadow-lg shadow-indigo-500/5 transition active:scale-[0.98] ${
          playOnly ? "min-h-[132px] p-5" : "min-h-[88px] p-3"
        }`}
        style={{ boxShadow: playing ? `0 0 0 1px ${friend?.color || "#818cf8"}` : undefined }}
      >
        <div className="flex items-start justify-between">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: friend?.color || "#818cf8" }}
          />
          {playing ? (
            <span className="pad-eq flex h-5 items-end gap-0.5">
              <span className="h-full w-0.5 origin-bottom rounded-full bg-indigo-300" />
              <span className="h-full w-0.5 origin-bottom rounded-full bg-indigo-300" />
              <span className="h-full w-0.5 origin-bottom rounded-full bg-indigo-300" />
            </span>
          ) : playOnly ? (
            <span className="h-5" />
          ) : (
            <span className="text-[10px] text-zinc-500">
              {clip.playbackRate && clip.playbackRate !== 1 ? `${Number(clip.playbackRate).toFixed(2)}x · ` : ""}
              {clip.duration ? `${clip.duration.toFixed(1)}s` : ""}
            </span>
          )}
        </div>
        <p className={`line-clamp-2 font-medium leading-snug text-zinc-100 ${playOnly ? "text-xl" : "text-sm"}`}>
          {clip.title}
        </p>
      </button>

      {playOnly ? null : (
      <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
        <button
          type="button"
          onClick={() => onRename(clip)}
          className="rounded-full bg-zinc-950/80 p-1.5 text-zinc-300"
          aria-label="Edit clip"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(clip)}
          className="rounded-full bg-zinc-950/80 p-1.5 text-rose-300"
          aria-label="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
      )}
    </div>
  );
}
