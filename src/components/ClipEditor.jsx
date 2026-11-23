import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import { AudioLines, Pause, Play, Save, Scissors, Trash2, Volume2, X } from "lucide-react";
import { getClipBlob, getSourceBlob, saveClip, upsertClip } from "../lib/db";
import { detectSpeechSegments } from "../lib/segments";
import { audioBufferToWavBlob, formatTimestamp, sliceBuffer } from "../lib/wav";
import { decodeBlob, invalidateBuffer, playClip, stopAll, stopClip, unlockAudio } from "../lib/audio";
import DeleteClipModal from "./DeleteClipModal.jsx";
import { cloneAudioBuffer, isolateVoice } from "../lib/voiceIsolate";

function chunkId() {
  return crypto.randomUUID();
}

export default function ClipEditor({ clip, friends, onClose, onSaved }) {
  const wrapRef = useRef(null);
  const timelineRef = useRef(null);
  const wsRef = useRef(null);
  const regionsRef = useRef(null);
  const paintingRef = useRef(false);
  const sourceBufferRef = useRef(null);
  const originalBufferRef = useRef(null);
  const chunksRef = useRef([]);
  const activeIdRef = useRef("");
  const playheadRef = useRef(0);

  const [title, setTitle] = useState(clip.title || "");
  const [friendId, setFriendId] = useState(clip.friendId || friends[0]?.id || "");
  const [volume, setVolume] = useState(clip.volume ?? 1);
  const [rate, setRate] = useState(clip.playbackRate ?? 1);
  const [preservePitch, setPreservePitch] = useState(clip.preservePitch !== false);
  const [duration, setDuration] = useState(clip.duration || 0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("Tap the waveform to place the playhead, then Split.");
  const [saving, setSaving] = useState(false);
  const [hasSource, setHasSource] = useState(Boolean(clip.sourceId));
  const [chunks, setChunks] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [playhead, setPlayhead] = useState(0);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isolated, setIsolated] = useState(false);
  const [isolating, setIsolating] = useState(false);

  const sourceId = clip.sourceId || null;
  const active = chunks.find((c) => c.id === activeId) || chunks[0];
  const start = active?.start ?? 0;
  const end = active?.end ?? 0;

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  function paintChunks(list = chunksRef.current, currentId = activeIdRef.current) {
    const plugin = regionsRef.current;
    if (!plugin) return;
    paintingRef.current = true;
    plugin.clearRegions();
    for (const piece of list) {
      const isActive = piece.id === currentId;
      plugin.addRegion({
        id: piece.id,
        start: piece.start,
        end: piece.end,
        drag: isActive,
        resize: isActive,
        color: isActive ? "rgba(165, 180, 252, 0.2)" : "rgba(255, 255, 255, 0.07)",
      });
    }
    window.requestAnimationFrame(() => {
      paintingRef.current = false;
    });
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      unlockAudio();
      const sourceBlob = clip.sourceId ? await getSourceBlob(clip.sourceId) : null;
      const blob = sourceBlob || (await getClipBlob(clip.id));
      if (!blob || dead || !wrapRef.current) return;
      setHasSource(Boolean(sourceBlob));
      const buffer = await decodeBlob(blob);
      if (dead) return;
      sourceBufferRef.current = buffer;
      originalBufferRef.current = cloneAudioBuffer(buffer);
      setIsolated(false);
      const dur = buffer.duration;
      setDuration(dur);
      const nextStart = sourceBlob ? clip.sourceStart ?? 0 : 0;
      const nextEnd = sourceBlob ? Math.min(dur, clip.sourceEnd ?? dur) : dur;
      const first = { id: "chunk-0", start: nextStart, end: Math.max(nextStart + 0.05, nextEnd) };
      setChunks([first]);
      setActiveId(first.id);
      activeIdRef.current = first.id;
      chunksRef.current = [first];
      playheadRef.current = nextStart;
      setPlayhead(nextStart);

      wrapRef.current.innerHTML = "";
      if (timelineRef.current) timelineRef.current.innerHTML = "";
      const regions = RegionsPlugin.create();
      regionsRef.current = regions;
      const timeline = TimelinePlugin.create({
        container: timelineRef.current,
        primaryLabelInterval: 5,
        style: { fontSize: "11px", color: "#a1a1aa" },
      });
      const ws = WaveSurfer.create({
        container: wrapRef.current,
        waveColor: "#52525b",
        progressColor: "#c4b5fd",
        cursorColor: "#fafafa",
        cursorWidth: 2,
        height: 120,
        barWidth: 1,
        barGap: 1,
        barRadius: 0,
        normalize: true,
        dragToSeek: true,
        minPxPerSec: 70,
        plugins: [regions, timeline],
      });
      wsRef.current = ws;
      ws.on("play", () => setPlaying(true));
      ws.on("pause", () => setPlaying(false));
      ws.on("finish", () => setPlaying(false));
      const markPlayhead = (time) => {
        if (!Number.isFinite(time)) return;
        playheadRef.current = time;
        setPlayhead(time);
      };
      ws.on("interaction", markPlayhead);
      ws.on("timeupdate", markPlayhead);
      ws.on("click", markPlayhead);
      regions.on("region-clicked", (region, event) => {
        event.stopPropagation();
        setActiveId(region.id);
        activeIdRef.current = region.id;
        markPlayhead(ws.getCurrentTime());
      });
      regions.on("region-updated", (region) => {
        if (paintingRef.current) return;
        setChunks((list) =>
          list.map((piece) => (piece.id === region.id ? { ...piece, start: region.start, end: region.end } : piece))
        );
      });
      await ws.loadBlob(blob);
      ws.setTime(nextStart);
      paintChunks([first], first.id);
    })();
    return () => {
      dead = true;
      stopClip("__editor__");
      wsRef.current?.destroy();
    };
  }, [clip.id, clip.sourceId]);

  useEffect(() => {
    if (!regionsRef.current || !chunks.length) return;
    paintChunks(chunks, activeId);
  }, [chunks.length, activeId, chunks.map((c) => c.id).join("|")]);

  function updateActive(nextStart, nextEnd) {
    if (!active) return;
    const total = wsRef.current?.getDuration?.() || duration;
    const s = Math.max(0, Math.min(nextStart, total - 0.05));
    const e = Math.min(total, Math.max(s + 0.05, nextEnd));
    setChunks((list) => list.map((piece) => (piece.id === active.id ? { ...piece, start: s, end: e } : piece)));
  }

  function preview() {
    wsRef.current?.play(start, end);
  }

  async function renderSlice(from, to) {
    const buffer = sourceBufferRef.current;
    if (!buffer) throw new Error("Audio is still loading.");
    return audioBufferToWavBlob(sliceBuffer(buffer, from, to), { fadeMs: 5 });
  }

  async function previewMix() {
    try {
      stopClip("__editor__");
      const blob = await renderSlice(start, end);
      await playClip("__editor__", blob, { volume, playbackRate: rate, preservePitch });
    } catch (error) {
      setStatus(error.message || "Preview failed.");
    }
  }

  function togglePlay() {
    const ws = wsRef.current;
    if (!ws) return;
    if (playing) ws.pause();
    else ws.play();
  }

  async function persistOriginal(from, to) {
    const blob = await renderSlice(from, to);
    invalidateBuffer(clip.id);
    return upsertClip({
      boardId: clip.id,
      title,
      friendId,
      blob,
      duration: to - from,
      transcript: clip.transcript || "",
      sourceId: sourceId || null,
      sourceStart: from,
      sourceEnd: to,
      volume,
      playbackRate: rate,
      preservePitch,
    });
  }

  function splitAtPlayhead() {
    const t = playheadRef.current;
    const piece = chunksRef.current.find((c) => c.id === activeIdRef.current) || chunksRef.current[0];
    if (!piece) {
      setStatus("Load the clip first.");
      return;
    }
    if (t <= piece.start + 0.05 || t >= piece.end - 0.05) {
      setStatus(`Playhead is at ${formatTimestamp(t)}. Tap inside the highlighted chunk, then Split.`);
      return;
    }
    const left = { ...piece, end: t };
    const right = { id: chunkId(), start: t, end: piece.end };
    setChunks((list) => {
      const index = list.findIndex((c) => c.id === piece.id);
      const next = [...list];
      next.splice(index, 1, left, right);
      return next;
    });
    setActiveId(right.id);
    activeIdRef.current = right.id;
    setStatus("Split. Select a chunk below and tap Delete to drop it. Save when it sounds right.");
  }

  function confirmDeleteChunk(id) {
    if (chunks.length <= 1) {
      setStatus("Keep at least one chunk. Trim the edges if you want it shorter.");
      return;
    }
    const piece = chunks.find((c) => c.id === id);
    if (piece) setPendingDelete(piece);
  }

  function deleteChunk(id) {
    const next = chunks.filter((c) => c.id !== id);
    if (!next.length) return;
    setChunks(next);
    const pick = next[0];
    setActiveId(pick.id);
    activeIdRef.current = pick.id;
    setPendingDelete(null);
    setStatus("Chunk removed. Save to update the board. Other saved clips stay.");
  }

  async function save() {
    if (!title.trim()) {
      setStatus("Name this clip first.");
      return;
    }
    const remaining = [...chunks].sort((a, b) => a.start - b.start);
    if (!remaining.length) return;
    setSaving(true);
    try {
      await persistOriginal(remaining[0].start, remaining[0].end);
      for (let i = 1; i < remaining.length; i += 1) {
        const piece = remaining[i];
        await saveClip({
          title: `${title.trim()} ${i + 1}`,
          friendId,
          blob: await renderSlice(piece.start, piece.end),
          duration: piece.end - piece.start,
          transcript: "",
          sourceId: sourceId || null,
          sourceStart: piece.start,
          sourceEnd: piece.end,
          volume,
          playbackRate: rate,
          preservePitch,
        });
      }
      setStatus(
        remaining.length > 1
          ? `Saved ${remaining.length} chunks to the board.`
          : "Saved. Deleted chunks were not added to the board."
      );
      onSaved?.();
    } catch (error) {
      setStatus(error.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleIsolate() {
    const original = originalBufferRef.current || sourceBufferRef.current;
    const ws = wsRef.current;
    if (!original || !ws || isolating) return;
    if (isolated) {
      sourceBufferRef.current = original;
      await ws.loadBlob(audioBufferToWavBlob(original, { fadeMs: 2 }));
      setIsolated(false);
      paintChunks();
      setStatus("Restored original audio.");
      return;
    }
    setIsolating(true);
    setStatus("Isolating voice…");
    try {
      const cleaned = await isolateVoice(original, (message) => setStatus(message));
      sourceBufferRef.current = cleaned;
      await ws.loadBlob(audioBufferToWavBlob(cleaned, { fadeMs: 2 }));
      setIsolated(true);
      paintChunks();
      setStatus("Voice isolated. Preview, then Save so only the voice is on the pad.");
    } catch (error) {
      setStatus(error.message || "Could not isolate voice.");
    } finally {
      setIsolating(false);
    }
  }

  function stripSilence() {
    const buffer = sourceBufferRef.current;
    if (!buffer || !active) return;
    const slice = sliceBuffer(buffer, start, end);
    const segs = detectSpeechSegments(slice);
    if (!segs.length) {
      setStatus("No sound found in this chunk.");
      return;
    }
    updateActive(start + segs[0].start, start + segs[segs.length - 1].end);
    setStatus("Tightened this chunk to audible audio.");
  }

  function splitSilentGaps() {
    const buffer = sourceBufferRef.current;
    if (!buffer || !active) return;
    const slice = sliceBuffer(buffer, start, end);
    const segs = detectSpeechSegments(slice);
    if (segs.length < 2) {
      setStatus("Not enough gaps. Tap a cut point and use Split, or Strip silence.");
      return;
    }
    const pieces = segs.map((seg, index) => ({
      id: index === 0 ? active.id : chunkId(),
      start: start + seg.start,
      end: start + seg.end,
    }));
    setChunks((list) => {
      const index = list.findIndex((c) => c.id === active.id);
      const next = [...list];
      next.splice(index, 1, ...pieces);
      return next;
    });
    setActiveId(pieces[0].id);
    setStatus(`${pieces.length} sound chunks. Delete the ones you don’t want, then Save.`);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/95 px-4 py-4 backdrop-blur-md" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
      <div className="mx-auto max-w-5xl space-y-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-indigo-300">Clip editor</p>
            <h2 className="text-lg font-semibold">{hasSource ? "Full recording context" : "Edit saved clip"}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Tap the waveform to place the playhead, Split, then Delete any chunk you don’t want.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 p-2 text-zinc-300" aria-label="Close editor">
            <X size={16} />
          </button>
        </header>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/70 p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
            <span>Playhead {formatTimestamp(playhead)}</span>
            <span>{chunks.length} chunk{chunks.length === 1 ? "" : "s"}</span>
          </div>
          <div ref={timelineRef} className="mb-1 min-h-[22px]" />
          <div ref={wrapRef} className="ws-wrap min-h-[120px]" />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={togglePlay} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm">
            {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : "Play all"}
          </button>
          <button type="button" onClick={preview} className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/20 px-3 py-2 text-sm text-indigo-200">
            Preview chunk
          </button>
          <button type="button" onClick={previewMix} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm">
            Preview mix
          </button>
          <button type="button" onClick={splitAtPlayhead} className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-2 text-sm font-semibold">
            <Scissors size={14} /> Split at playhead
          </button>
          <button type="button" onClick={stripSilence} className="rounded-full bg-white/10 px-3 py-2 text-sm">
            Strip silence
          </button>
          <button type="button" onClick={splitSilentGaps} className="rounded-full bg-white/10 px-3 py-2 text-sm">
            Split quiet gaps
          </button>
          <button
            type="button"
            onClick={toggleIsolate}
            disabled={isolating}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm disabled:opacity-60 ${
              isolated ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10"
            }`}
          >
            <AudioLines size={14} />
            {isolating ? "Isolating…" : isolated ? "Voice isolated" : "Isolate voice"}
          </button>
        </div>

        <section className="space-y-2 rounded-3xl border border-white/10 bg-zinc-900/50 p-3">
          <h3 className="text-sm font-semibold">Chunks</h3>
          {chunks.map((piece, index) => {
            const selected = piece.id === activeId;
            return (
              <div
                key={piece.id}
                className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${
                  selected ? "border-indigo-400/40 bg-indigo-500/10" : "border-white/10 bg-zinc-950/40"
                }`}
              >
                <button type="button" onClick={() => setActiveId(piece.id)} className="min-w-0 flex-1 text-left">
                  <p className="text-xs font-semibold text-zinc-200">Chunk {index + 1}</p>
                  <p className="text-[11px] text-zinc-500">
                    {formatTimestamp(piece.start)} – {formatTimestamp(piece.end)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(piece.id);
                    wsRef.current?.play(piece.start, piece.end);
                  }}
                  className="rounded-full bg-white/10 p-2 text-indigo-200"
                  aria-label="Play chunk"
                >
                  <Play size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => confirmDeleteChunk(piece.id)}
                  disabled={chunks.length <= 1}
                  className="rounded-full bg-white/10 p-2 text-rose-300 disabled:opacity-30"
                  aria-label="Delete chunk"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </section>

        <div className="grid grid-cols-2 gap-3">
          <TimeChip label="Start" value={start} onNudge={(d) => updateActive(start + d, end)} />
          <TimeChip label="End" value={end} onNudge={(d) => updateActive(start, end + d)} />
        </div>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">Name</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
          />
        </label>

        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">Friend</span>
          <select
            value={friendId}
            onChange={(e) => setFriendId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm"
          >
            {friends.map((friend) => (
              <option key={friend.id} value={friend.id}>
                {friend.name}
              </option>
            ))}
          </select>
        </label>

        <section className="space-y-3 rounded-3xl border border-white/10 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Volume2 size={16} className="text-indigo-300" /> Mix
          </div>
          <label className="block">
            <span className="mb-1 flex justify-between text-[11px] text-zinc-500">
              Volume <span>{Math.round(volume * 100)}%</span>
            </span>
            <input type="range" min="0" max="3" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full accent-indigo-500" />
          </label>
          <label className="block">
            <span className="mb-1 flex justify-between text-[11px] text-zinc-500">
              Speed / pitch <span>{rate.toFixed(2)}x</span>
            </span>
            <input type="range" min="0.5" max="2" step="0.05" value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-full accent-indigo-500" />
          </label>
          <div className="flex rounded-full bg-zinc-950 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setPreservePitch(true)}
              className={`flex-1 rounded-full px-3 py-2 ${preservePitch ? "bg-indigo-500 text-white" : "text-zinc-400"}`}
            >
              Preserve pitch
            </button>
            <button
              type="button"
              onClick={() => setPreservePitch(false)}
              className={`flex-1 rounded-full px-3 py-2 ${!preservePitch ? "bg-violet-600 text-white" : "text-zinc-400"}`}
            >
              Chipmunk / Slow-mo
            </button>
          </div>
        </section>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold disabled:opacity-60"
        >
          <Save size={16} /> Save {chunks.length > 1 ? `${chunks.length} chunks` : "clip"}
        </button>
        {status ? <p className="text-sm text-indigo-200">{status}</p> : null}
      </div>
      {pendingDelete ? (
        <DeleteClipModal
          title={`Chunk ${chunks.findIndex((c) => c.id === pendingDelete.id) + 1}`}
          hint="Play it first if you are not sure. Deleting only drops this chunk; tap Save after."
          onCancel={() => {
            stopAll();
            setPendingDelete(null);
          }}
          onPlay={async () => {
            const blob = await renderSlice(pendingDelete.start, pendingDelete.end);
            await playClip("__editor-delete__", blob, { volume, playbackRate: rate, preservePitch });
          }}
          onConfirm={() => {
            stopAll();
            deleteChunk(pendingDelete.id);
          }}
        />
      ) : null}
    </div>
  );
}

function TimeChip({ label, value, onNudge }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-3">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-medium">{formatTimestamp(value)}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => onNudge(-0.1)} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">
          −0.1s
        </button>
        <button type="button" onClick={() => onNudge(0.1)} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">
          +0.1s
        </button>
      </div>
    </div>
  );
}
