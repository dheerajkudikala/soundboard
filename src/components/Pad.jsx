import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getClipBlob } from "../lib/db";
import { onPlaybackChange, playClip, primeClip, stopClip, unlockAudio } from "../lib/audio";

export default function Pad({ clip, friend, playOnly, onRename, onDelete }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return onPlaybackChange((ids) => setPlaying(ids.includes(clip.id)));
  }, [clip.id]);

  useEffect(() => {
    let dead = false;
    getClipBlob(clip.id).then((blob) => {
      if (!dead && blob) primeClip(clip.id, blob);
    });
    return () => {
      dead = true;
    };
  }, [clip.id]);

  function trigger() {
    unlockAudio();
    if (playing) {
      stopClip(clip.id);
      return;
    }
    const fx = {
      volume: clip.volume ?? 1,
      playbackRate: clip.playbackRate ?? 1,
      preservePitch: clip.preservePitch !== false,
    };
    void getClipBlob(clip.id).then((blob) => {
      if (blob) return playClip(clip.id, blob, fx);
    });
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={trigger}
        className={`flex w-full flex-col justify-between overflow-hidden border border-white/10 bg-zinc-900/80 text-left shadow-lg shadow-indigo-500/5 transition active:scale-[0.98] ${
          playOnly ? "min-h-[84px] rounded-xl p-2" : "min-h-[88px] rounded-2xl p-3"
        }`}
        style={{ boxShadow: playing ? `0 0 0 1px ${friend?.color || "#818cf8"}` : undefined }}
      >
        <div className="flex items-start justify-between gap-1">
          <span
            className={`min-w-0 truncate rounded-md font-semibold ${
              playOnly ? "px-1 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]"
            }`}
            style={{
              color: friend?.color || "#c7d2fe",
              background: `${friend?.color || "#818cf8"}33`,
            }}
          >
            {friend?.name || "Clip"}
          </span>
          {playing ? (
            <span className={`pad-eq flex shrink-0 items-end gap-0.5 ${playOnly ? "h-3" : "h-5"}`}>
              <span className="h-full w-0.5 origin-bottom rounded-full bg-indigo-300" />
              <span className="h-full w-0.5 origin-bottom rounded-full bg-indigo-300" />
              <span className="h-full w-0.5 origin-bottom rounded-full bg-indigo-300" />
            </span>
          ) : playOnly ? null : (
            <span className="shrink-0 text-[10px] text-zinc-500">
              {clip.playbackRate && clip.playbackRate !== 1 ? `${Number(clip.playbackRate).toFixed(2)}x · ` : ""}
              {clip.duration ? `${clip.duration.toFixed(1)}s` : ""}
            </span>
          )}
        </div>
        <p
          className={`font-medium leading-snug text-zinc-100 ${
            playOnly ? "mt-1 line-clamp-3 text-[11px]" : "line-clamp-2 text-sm"
          }`}
        >
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
