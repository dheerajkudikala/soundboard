import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import { AudioLines, ClipboardPaste, Pause, Play, Repeat, Save, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { saveClip, saveSource, upsertClip } from "../lib/db";
import { audioBufferToWavBlob, formatTimestamp, parseTimestamp, sliceBuffer } from "../lib/wav";
import { invalidateBuffer, unlockAudio } from "../lib/audio";
import { attachTranscripts, clipsFromWhisperChunks, detectSpeechSegments, guessFriendId } from "../lib/segments";
import NameModal from "./NameModal.jsx";
import ClipSuggestions from "./ClipSuggestions.jsx";
import { audioFileFromPasteEvent, isTypingTarget } from "../lib/clipboardAudio";
import { cloneAudioBuffer, isolateVoice } from "../lib/voiceIsolate";

const ACCEPT = "audio/*,video/*,.m4a,.mp3,.wav,.aac,.mp4,.mov";

export default function Clipper({ friends, onSaved, onCreateFriend }) {
  const wrapRef = useRef(null);
  const timelineRef = useRef(null);
  const wsRef = useRef(null);
  const regionsRef = useRef(null);
  const regionRef = useRef(null);
  const fileRef = useRef(null);
  const loadFileRef = useRef(null);
  const pasteTargetRef = useRef(null);

  const [fileName, setFileName] = useState("");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [zoom, setZoom] = useState(80);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(3);
  const [duration, setDuration] = useState(0);
  const [clipName, setClipName] = useState("");
  const [friendId, setFriendId] = useState(friends[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [friendModal, setFriendModal] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [activeClipId, setActiveClipId] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState("");
  const [awaitingPaste, setAwaitingPaste] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [isolating, setIsolating] = useState(false);
  const analyzeToken = useRef(0);
  const activeClipIdRef = useRef("");
  const sourceIdRef = useRef(null);
  const originalBufferRef = useRef(null);
  const paintingRef = useRef(false);
  const suggestionsRef = useRef([]);

  useEffect(() => {
    if (!friendId && friends[0]?.id) setFriendId(friends[0].id);
  }, [friends, friendId]);

  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  useEffect(() => {
    wsRef.current?.zoom(zoom);
  }, [zoom]);

  const regionLayout = `${suggestions.map((item) => item.id).join("|")}:${activeClipId}`;
  useEffect(() => {
    if (!ready || !suggestions.length) return;
    paintRegions(suggestions, activeClipId);
  }, [regionLayout, ready]);

  useEffect(() => {
    return () => wsRef.current?.destroy();
  }, []);

  function syncRegion(region) {
    if (paintingRef.current) return;
    regionRef.current = region;
    setStart(region.start);
    setEnd(region.end);
    const id = activeClipIdRef.current;
    if (!id) return;
    setSuggestions((list) =>
      list.map((item) => (item.id === id ? { ...item, start: region.start, end: region.end } : item))
    );
  }

  function paintRegions(list = suggestionsRef.current, activeId = activeClipIdRef.current) {
    const plugin = regionsRef.current;
    if (!plugin) return;
    paintingRef.current = true;
    plugin.clearRegions();
    let active = null;
    for (const clip of list) {
      const isActive = clip.id === activeId;
      const region = plugin.addRegion({
        id: clip.id,
        start: clip.start,
        end: clip.end,
        drag: isActive,
        resize: isActive,
        color: isActive ? "rgba(165, 180, 252, 0.14)" : "rgba(255, 255, 255, 0.045)",
      });
      if (isActive) active = region;
    }
    regionRef.current = active;
    window.requestAnimationFrame(() => {
      paintingRef.current = false;
    });
  }

  function mapSuggestions(raw, friendFallback) {
    return raw.map((seg, index) => ({
      id: `clip-${index}-${seg.start.toFixed(2)}`,
      start: seg.start,
      end: seg.end,
      text: seg.text || "",
      title: "",
      friendId: guessFriendId(seg.text, friends) || friendFallback,
      selected: true,
    }));
  }

  function focusClip(item) {
    if (!item) return;
    activeClipIdRef.current = item.id;
    setActiveClipId(item.id);
    setClipName(item.title);
    if (item.friendId) setFriendId(item.friendId);
    setStart(item.start);
    setEnd(item.end);
  }

  async function analyzeBuffer(buffer, token) {
    const friendFallback = friendId || friends[0]?.id || "";
    const silenceSegs = detectSpeechSegments(buffer);
    if (token !== analyzeToken.current) return;
    const mapped = mapSuggestions(silenceSegs, friendFallback);
    setSuggestions(mapped);
    setStatus(
      mapped.length > 1
        ? `Split into ${mapped.length} clips from the gaps. Name each one, then save.`
        : "Name this clip, or trim the region if you want a smaller cut."
    );
    if (mapped[0]) {
      activeClipIdRef.current = mapped[0].id;
      setActiveClipId(mapped[0].id);
      setStart(mapped[0].start);
      setEnd(mapped[0].end);
    }
    setTranscribing(true);
    setProgress("Finding pauses…");
    try {
      const { transcribeBuffer } = await import("../lib/transcribe.js");
      const whisper = await transcribeBuffer(buffer, (info) => {
        if (token === analyzeToken.current) setProgress(info.message);
      });
      if (token !== analyzeToken.current) return;
      const chunks = clipsFromWhisperChunks(whisper?.chunks, buffer.duration);
      setSuggestions((prev) => {
        const labeled = attachTranscripts(
          prev.map((item) => ({ start: item.start, end: item.end, text: item.text })),
          chunks.length ? chunks : [{ start: 0, end: buffer.duration, text: whisper?.text || "" }]
        );
        return prev.map((item, index) => ({
          ...item,
          text: labeled[index]?.text || item.text,
          friendId: item.friendId || guessFriendId(labeled[index]?.text, friends) || friendFallback,
        }));
      });
      setProgress("");
    } catch (error) {
      if (token !== analyzeToken.current) return;
      setProgress("");
      setStatus(
        mapped.length
          ? `Split into ${mapped.length} clips. Name each one — transcription skipped.`
          : error.message || "Could not transcribe."
      );
    } finally {
      if (token === analyzeToken.current) setTranscribing(false);
    }
  }

  async function loadFile(file) {
    if (!file || !wrapRef.current) return;
    unlockAudio();
    setReady(false);
    setStatus("");
    setSuggestions([]);
    setProgress("");
    setFileName(file.name);
    setIsolated(false);
    originalBufferRef.current = null;
    try {
      sourceIdRef.current = await saveSource(file, file.name);
    } catch {
      sourceIdRef.current = null;
    }
    analyzeToken.current += 1;
    const token = analyzeToken.current;
    wsRef.current?.destroy();
    wrapRef.current.innerHTML = "";
    if (timelineRef.current) timelineRef.current.innerHTML = "";

    const regions = RegionsPlugin.create();
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
      cursorWidth: 1,
      height: 112,
      barWidth: 1,
      barGap: 1,
      barRadius: 0,
      normalize: true,
      dragToSeek: true,
      minPxPerSec: zoom,
      plugins: [regions, timeline],
    });

    wsRef.current = ws;
    regionsRef.current = regions;

    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => {
      if (loop && regionRef.current) {
        ws.play(regionRef.current.start, regionRef.current.end);
      } else {
        setPlaying(false);
      }
    });

    regions.on("region-updated", syncRegion);
    regions.on("region-created", syncRegion);

    try {
      await ws.loadBlob(file);
      const dur = ws.getDuration();
      setDuration(dur);
      setReady(true);
      const buffer = ws.getDecodedData();
      if (buffer) {
        originalBufferRef.current = cloneAudioBuffer(buffer);
        analyzeBuffer(buffer, token);
      }
      else {
        ws.once("decode", () => {
          const decoded = ws.getDecodedData();
          if (decoded) {
            originalBufferRef.current = cloneAudioBuffer(decoded);
            analyzeBuffer(decoded, token);
          }
        });
      }
    } catch (error) {
      setStatus(error.message || "Could not decode this file in the browser.");
    }
  }

  loadFileRef.current = loadFile;

  async function usePastedFile(file) {
    if (!file) {
      setStatus("That paste had no audio. Copy the recording in Voice Memos, click the paste box, then press ⌘V.");
      return;
    }
    setAwaitingPaste(false);
    setStatus(`Pasted ${file.name || "voice memo"}`);
    if (pasteTargetRef.current) pasteTargetRef.current.innerHTML = "";
    await loadFileRef.current?.(file);
  }

  function armPaste() {
    setAwaitingPaste(true);
    setStatus("Press ⌘V now (or long-press → Paste on iPhone).");
    requestAnimationFrame(() => pasteTargetRef.current?.focus());
  }

  function handlePaste(event) {
    const file = audioFileFromPasteEvent(event);
    if (file) {
      event.preventDefault();
      event.stopPropagation();
      usePastedFile(file);
      return;
    }
    if (awaitingPaste && !isTypingTarget(event.target)) {
      setStatus("Clipboard had no audio file. Copy the memo again from Voice Memos, then paste here.");
    }
  }

  useEffect(() => {
    function onPaste(event) {
      if (isTypingTarget(event.target)) return;
      handlePaste(event);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [awaitingPaste]);

  function setRegionTimes(nextStart, nextEnd) {
    const ws = wsRef.current;
    const region = regionRef.current;
    if (!ws || !region) return;
    const total = ws.getDuration?.() || duration;
    const s = Math.max(0, Math.min(nextStart, Math.max(total, 0.1) - 0.05));
    const e = Math.min(total || nextEnd, Math.max(s + 0.05, nextEnd));
    region.setOptions({ start: s, end: e });
    setStart(s);
    setEnd(e);
    const id = activeClipIdRef.current;
    if (id) {
      setSuggestions((list) => list.map((item) => (item.id === id ? { ...item, start: s, end: e } : item)));
    }
  }

  function togglePlay() {
    const ws = wsRef.current;
    if (!ws) return;
    if (playing) ws.pause();
    else ws.play();
  }

  async function applyBuffer(buffer, token, isolatedNext) {
    const ws = wsRef.current;
    if (!ws || !buffer) return;
    const blob = audioBufferToWavBlob(buffer, { fadeMs: 2 });
    await ws.loadBlob(blob);
    setDuration(ws.getDuration());
    setIsolated(isolatedNext);
    if (token === analyzeToken.current) analyzeBuffer(buffer, token);
  }

  async function toggleIsolate() {
    const ws = wsRef.current;
    if (!ws || isolating) return;
    const original = originalBufferRef.current || ws.getDecodedData();
    if (!original) return;
    if (!originalBufferRef.current) originalBufferRef.current = cloneAudioBuffer(original);
    analyzeToken.current += 1;
    const token = analyzeToken.current;
    if (isolated) {
      setStatus("Restored original audio.");
      await applyBuffer(originalBufferRef.current, token, false);
      return;
    }
    setIsolating(true);
    setStatus("Isolating voice…");
    try {
      const cleaned = await isolateVoice(originalBufferRef.current, (message) => {
        if (token === analyzeToken.current) setStatus(message);
      });
      if (token !== analyzeToken.current) return;
      await applyBuffer(cleaned, token, true);
      setStatus("Voice isolated. Background is pulled down — preview, then save.");
    } catch (error) {
      setStatus(error.message || "Could not isolate voice.");
    } finally {
      setIsolating(false);
    }
  }

  function previewSelection() {
    const ws = wsRef.current;
    const region = regionRef.current;
    if (!ws || !region) return;
    ws.play(region.start, region.end);
  }

  async function save() {
    const ws = wsRef.current;
    const region = regionRef.current;
    if (!ws || !region) return;
    if (!clipName.trim()) {
      setStatus("Name this clip first.");
      return;
    }
    if (!friendId) {
      setStatus("Pick or add a friend.");
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      let buffer = ws.getDecodedData();
      if (!buffer) throw new Error("Waveform is still decoding.");
      const sliced = sliceBuffer(buffer, region.start, region.end);
      const blob = audioBufferToWavBlob(sliced, { fadeMs: 5 });
      await saveClip({
        title: clipName,
        friendId,
        blob,
        duration: sliced.duration,
        transcript: clipName,
        sourceId: sourceIdRef.current,
        sourceStart: region.start,
        sourceEnd: region.end,
        volume: 1,
        playbackRate: 1,
        preservePitch: true,
      });
      setStatus(`Saved “${clipName.trim()}”. Keep scrubbing this memo.`);
      setClipName("");
      onSaved?.();
    } catch (error) {
      setStatus(error.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSelected() {
    const ws = wsRef.current;
    const buffer = ws?.getDecodedData();
    if (!buffer) return;
    const chosen = suggestions.filter((item) => item.selected);
    if (!chosen.length) return;
    const missing = chosen.filter((item) => !item.title.trim());
    if (missing.length) {
      setStatus(`Name every clip before saving. ${missing.length} still need a name.`);
      focusClip(missing[0]);
      return;
    }
    setSaving(true);
    try {
      const savedIds = {};
      for (const item of chosen) {
        const sliced = sliceBuffer(buffer, item.start, item.end);
        const blob = audioBufferToWavBlob(sliced, { fadeMs: 5 });
        if (item.boardId) invalidateBuffer(item.boardId);
        const stored = await upsertClip({
          boardId: item.boardId,
          title: item.title,
          friendId: item.friendId || friendId,
          blob,
          duration: sliced.duration,
          transcript: item.text,
          sourceId: sourceIdRef.current,
          sourceStart: item.start,
          sourceEnd: item.end,
          volume: 1,
          playbackRate: 1,
          preservePitch: true,
        });
        savedIds[item.id] = stored.id;
      }
      setStatus(`Saved ${chosen.length} clip${chosen.length === 1 ? "" : "s"} to the board. They stay there even if you keep editing.`);
      setSuggestions((list) =>
        list.map((item) => (savedIds[item.id] ? { ...item, boardId: savedIds[item.id], selected: true } : item))
      );
      onSaved?.();
    } catch (error) {
      setStatus(error.message || "Could not save selected clips.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (event) => {
      if (event.code !== "Space") return;
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      togglePlay();
    };
    const onWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setZoom((z) => Math.max(20, Math.min(280, z + (event.deltaY < 0 ? 12 : -12))));
    };
    window.addEventListener("keydown", onKey);
    const wrap = wrapRef.current;
    wrap?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      wrap?.removeEventListener("wheel", onWheel);
    };
  }, [playing, ready]);

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) loadFile(file);
        }}
        className={`flex flex-col items-center justify-center rounded-3xl border border-dashed px-4 py-8 text-center transition ${
          dragOver || awaitingPaste ? "border-indigo-400 bg-indigo-500/10" : "border-white/15 bg-zinc-900/50"
        }`}
      >
        <Upload className="mb-2 text-indigo-300" size={22} />
        <p className="text-sm font-medium">Drop, choose, or paste a Voice Memo</p>
        <p className="mt-1 max-w-md text-xs text-zinc-500">
          Copy in Voice Memos, tap the box below, then press ⌘V or Paste. Chrome cannot read the clipboard by itself.
        </p>
        <p className="mt-3 text-xs font-medium text-indigo-200">
          {awaitingPaste ? "Ready — press ⌘V or Paste" : "Tap the box, then paste"}
        </p>
        <div
          ref={pasteTargetRef}
          role="textbox"
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          aria-label="Paste voice memo"
          onFocus={() => setAwaitingPaste(true)}
          onPaste={handlePaste}
          className="mt-2 min-h-[56px] w-full max-w-md rounded-2xl border border-white/15 bg-zinc-950 px-3 py-4 text-sm text-zinc-400 outline-none focus:border-indigo-400"
        />
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadFile(file);
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold"
          >
            Choose file
          </button>
          <button
            type="button"
            onClick={armPaste}
            className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-200"
          >
            <ClipboardPaste size={13} /> Paste Voice Memo
          </button>
        </div>
        {fileName ? <p className="mt-2 text-xs text-zinc-400">{fileName}</p> : null}
      </div>

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/60 p-3">
        <div ref={timelineRef} className="mb-1 min-h-[22px]" />
        <div ref={wrapRef} className="ws-wrap min-h-[128px]" />
        {!ready ? (
          <p className="py-8 text-center text-xs text-zinc-500">Load a recording to see the waveform.</p>
        ) : null}
      </div>

      {suggestions.length || transcribing ? (
        <ClipSuggestions
          items={suggestions}
          activeId={activeClipId}
          transcribing={transcribing}
          progress={progress}
          friendId={friendId}
          friends={friends}
          onSelect={focusClip}
          onChange={(id, patch) => {
            setSuggestions((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
            if (id === activeClipId && patch.title != null) setClipName(patch.title);
            if (id === activeClipId && patch.friendId) setFriendId(patch.friendId);
          }}
          onRemove={(id) => {
            setSuggestions((list) => {
              const next = list.filter((item) => item.id !== id);
              if (id === activeClipIdRef.current && next[0]) {
                queueMicrotask(() => focusClip(next[0]));
              }
              return next;
            });
          }}
          onPreview={(item) => {
            focusClip(item);
            const ws = wsRef.current;
            if (ws) ws.play(item.start, item.end);
          }}
          onSaveSelected={saveSelected}
          saving={saving}
        />
      ) : null}

      {ready ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm font-medium"
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={previewSelection}
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/20 px-3 py-2 text-sm font-medium text-indigo-200"
            >
              Preview Selection
            </button>
            <button
              type="button"
              onClick={toggleIsolate}
              disabled={isolating}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium disabled:opacity-60 ${
                isolated ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-zinc-200"
              }`}
            >
              <AudioLines size={14} />
              {isolating ? "Isolating…" : isolated ? "Voice isolated" : "Isolate voice"}
            </button>
            <button
              type="button"
              onClick={() => setLoop((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium ${
                loop ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-zinc-300"
              }`}
            >
              <Repeat size={14} /> Loop
            </button>
            <span className="ml-auto text-xs text-zinc-500">{formatTimestamp(duration)}</span>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setZoom((z) => Math.max(20, z - 20))} className="rounded-full bg-white/10 p-2">
              <ZoomOut size={16} />
            </button>
            <input
              type="range"
              min="20"
              max="280"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-indigo-500"
            />
            <button type="button" onClick={() => setZoom((z) => Math.min(280, z + 20))} className="rounded-full bg-white/10 p-2">
              <ZoomIn size={16} />
            </button>
          </div>

          {suggestions.length ? (
            <p className="text-xs text-zinc-500">
              Drag the highlighted region to trim the selected clip. Names are in the list above.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TimeField
              label="Start"
              value={start}
              onChange={(v) => setRegionTimes(v, end)}
              onNudge={(d) => setRegionTimes(start + d, end)}
            />
            <TimeField
              label="End"
              value={end}
              onChange={(v) => setRegionTimes(start, v)}
              onNudge={(d) => setRegionTimes(start, end + d)}
            />
          </div>

          {suggestions.length ? null : (
          <div className="grid gap-3 rounded-3xl border border-white/10 bg-zinc-900/50 p-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">Clip name</span>
              <input
                value={clipName}
                onChange={(e) => setClipName(e.target.value)}
                placeholder="that one quote"
                className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">Friend</span>
              <div className="mt-1 flex gap-2">
                <select
                  value={friendId}
                  onChange={(e) => setFriendId(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-sm outline-none"
                >
                  {friends.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setFriendModal(true)}
                  className="shrink-0 rounded-xl border border-white/10 px-3 text-xs font-semibold"
                >
                  New
                </button>
              </div>
            </label>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Save size={16} />
              Save Clip to Board
            </button>
            <p className="text-xs text-zinc-500">
              Saving does not close this recording. Keep slicing quotes from the same memo.
            </p>
          </div>
          )}
        </>
      ) : null}

      {status ? <p className="text-sm text-indigo-200">{status}</p> : null}

      <NameModal
        open={friendModal}
        title="Add friend"
        label="Name"
        placeholder="Avi"
        confirmLabel="Add friend"
        onClose={() => setFriendModal(false)}
        onSubmit={async (name) => {
          const created = await onCreateFriend(name);
          if (created?.id) setFriendId(created.id);
        }}
      />
    </div>
  );
}

function TimeField({ label, value, onChange, onNudge }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-3">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <input
        value={formatTimestamp(value)}
        onChange={(e) => onChange(parseTimestamp(e.target.value))}
        className="mt-1 w-full bg-transparent text-lg font-medium tracking-wide outline-none"
      />
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
