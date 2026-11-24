import { getAudioContext } from "./audio";
import { audioBufferToWavBlob } from "./wav";
import { db, getClipBlob, listClips, listFriends, mergeBoard } from "./db";

const PASTE_ID = "bc8a66za";
const PASTE_EDIT = "dGbkX6NA";
const CHUNK = 70_000;
const POLL_MS = 2500;

let publishTimer = 0;
let lastRev = 0;
const listeners = new Set();

const sync = {
  status: "idle",
  message: "Waiting to sync",
  at: 0,
};

export function getSyncState() {
  return { ...sync };
}

export function onSyncChange(fn) {
  listeners.add(fn);
  fn(getSyncState());
  return () => listeners.delete(fn);
}

function emit(patch) {
  Object.assign(sync, patch, { at: Date.now() });
  const snapshot = getSyncState();
  for (const fn of listeners) fn(snapshot);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [prefix, data] = String(dataUrl).split(",");
  const mime = /data:([^;]+)/.exec(prefix)?.[1] || "audio/wav";
  const bytes = Uint8Array.from(atob(data || ""), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function compactWav(blob) {
  if (!blob) return null;
  try {
    const ctx = getAudioContext();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const sampleRate = 22050;
    const length = Math.max(1, Math.round(buffer.duration * sampleRate));
    const offline = new OfflineAudioContext(1, length, sampleRate);
    const src = offline.createBufferSource();
    src.buffer = buffer;
    src.connect(offline.destination);
    src.start(0);
    return audioBufferToWavBlob(await offline.startRendering(), { fadeMs: 2 });
  } catch {
    return blob;
  }
}

function parseRemote(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed);
  if (parsed?.status && String(parsed.status) !== "200") {
    if (typeof parsed.content === "string" && parsed.content.trim().startsWith("{")) {
      return JSON.parse(parsed.content);
    }
    return null;
  }
  if (parsed?.friends || parsed?.clips || parsed?.v) return parsed;
  if (typeof parsed.content === "string") {
    const content = parsed.content.trim();
    if (content.startsWith("{")) return JSON.parse(content);
    return { _raw: content };
  }
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store", credentials: "omit", mode: "cors" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function readPaste(id) {
  const urls = [
    `https://rentry.co/${id}/raw`,
    `https://rentry.co/api/raw/${id}`,
    `https://rentry.org/${id}/raw`,
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const text = await fetchText(url);
      try {
        const parsed = parseRemote(text);
        if (parsed) return parsed;
      } catch {
        /* raw audio payload */
      }
      if (text) return { _raw: text };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not read the live board.");
}

async function writePaste(id, text) {
  const body = new URLSearchParams();
  body.set("edit_code", PASTE_EDIT);
  body.set("text", text);
  body.set("metadata", "");
  const res = await fetch(`https://rentry.co/api/edit/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
    credentials: "omit",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.status && String(json.status) !== "200")) {
    throw new Error(json.content || `Could not save ${id}`);
  }
}

async function createPaste(text) {
  const body = new URLSearchParams();
  body.set("edit_code", PASTE_EDIT);
  body.set("text", text);
  const res = await fetch("https://rentry.co/api/new", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
    credentials: "omit",
  });
  const json = await res.json().catch(() => ({}));
  const url = String(json.url || json.content?.url || "");
  const id = url.split("/").filter(Boolean).pop();
  if (!id) throw new Error(json.content || "Could not create clip paste.");
  return id;
}

async function writeTextParts(existingIds, text) {
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
  const ids = [];
  for (let i = 0; i < parts.length; i += 1) {
    const current = existingIds[i];
    if (current) {
      await writePaste(current, parts[i]);
      ids.push(current);
    } else {
      ids.push(await createPaste(parts[i]));
    }
  }
  return ids;
}

async function readTextParts(ids) {
  const chunks = [];
  for (const id of ids) {
    const parsed = await readPaste(id);
    if (parsed?._raw) chunks.push(parsed._raw);
    else if (typeof parsed === "string") chunks.push(parsed);
    else chunks.push(await fetchText(`https://rentry.co/${id}/raw`));
  }
  return chunks.join("");
}

async function bundledFiles() {
  try {
    const res = await fetch(`./sounds/manifest.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return new Map();
    const manifest = await res.json();
    return new Map((manifest.clips || []).map((clip) => [clip.id, clip.file]));
  } catch {
    return new Map();
  }
}

export async function fillMissingAudio() {
  const files = await bundledFiles();
  for (const [id, file] of files) {
    const existing = await getClipBlob(id);
    if (existing) continue;
    try {
      const res = await fetch(`./sounds/${file}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) continue;
      await db.audio.put({ id, blob: await res.blob() });
    } catch {
      /* skip */
    }
  }
}

async function blobForRemoteClip(clip, files) {
  if (clip.audio) return dataUrlToBlob(clip.audio);
  if (clip.parts?.length) {
    const text = await readTextParts(clip.parts);
    if (text.startsWith("data:")) return dataUrlToBlob(text);
    return dataUrlToBlob(`data:audio/wav;base64,${text}`);
  }
  const file = files.get(clip.id);
  if (!file) return null;
  const res = await fetch(`./sounds/${file}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.blob();
}

export async function publishBoard() {
  emit({ status: "syncing", message: "Saving to the live board…" });
  try {
    const files = await bundledFiles();
    const friends = await listFriends();
    const clips = await listClips();
    const previous = await db.meta.get("liveIndex");
    const prevMap = new Map((previous?.clips || []).map((clip) => [clip.id, clip]));
    const packed = [];

    for (const clip of clips) {
      const prior = prevMap.get(clip.id) || {};
      const row = {
        id: clip.id,
        title: clip.title,
        friendId: clip.friendId,
        duration: clip.duration || 0,
        createdAt: clip.createdAt,
        volume: clip.volume ?? 1,
        playbackRate: clip.playbackRate ?? 1,
        preservePitch: clip.preservePitch !== false,
        updatedAt: Date.now(),
      };
      const localBlob = await getClipBlob(clip.id);
      const stamp = localBlob ? `${localBlob.size}:${Math.round((clip.duration || 0) * 1000)}` : "";
      if (files.has(clip.id) && !prior.parts) {
        packed.push({ ...row, stamp });
        continue;
      }
      if (prior.parts?.length && prior.stamp === stamp) {
        packed.push({ ...row, parts: prior.parts, stamp });
        continue;
      }
      const blob = await compactWav(localBlob);
      if (!blob) {
        packed.push({ ...row, parts: prior.parts || undefined, stamp });
        continue;
      }
      const dataUrl = await blobToDataUrl(blob);
      row.parts = await writeTextParts(prior.parts || [], dataUrl);
      row.stamp = stamp;
      packed.push(row);
    }

    const payload = { v: Date.now(), friends, clips: packed };
    await writePaste(PASTE_ID, JSON.stringify(payload));
    await db.meta.put({ key: "liveIndex", ...payload, clips: packed });
    lastRev = payload.v;
    emit({ status: "ok", message: `Live · ${packed.length} clips` });
    return { ok: true, clips: packed.length };
  } catch (error) {
    emit({ status: "error", message: error.message || "Sync failed" });
    throw error;
  }
}

export function schedulePublish() {
  window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => {
    publishBoard().catch(() => {});
  }, 250);
}

export async function pullPublishedBoard({ prune = false } = {}) {
  emit({ status: sync.status === "error" ? "error" : "syncing", message: "Checking live board…" });
  try {
    const remote = await readPaste(PASTE_ID);
    if (!remote || (!remote.clips && !remote.friends)) {
      emit({ status: "error", message: "Live board is empty or blocked" });
      return false;
    }
    if (remote.v && remote.v === lastRev) {
      emit({ status: "ok", message: "Live board is up to date" });
      return false;
    }
    const files = await bundledFiles();
    const clips = [];
    for (const clip of remote.clips || []) {
      clips.push({
        id: clip.id,
        title: clip.title,
        friendId: clip.friendId,
        duration: clip.duration || 0,
        createdAt: clip.createdAt || Date.now(),
        volume: clip.volume ?? 1,
        playbackRate: clip.playbackRate ?? 1,
        preservePitch: clip.preservePitch !== false,
        blob: await blobForRemoteClip(clip, files),
      });
    }
    await mergeBoard({
      friends: remote.friends || [],
      clips,
      keepIds: prune ? new Set((remote.clips || []).map((clip) => clip.id)) : undefined,
    });
    await fillMissingAudio();
    lastRev = remote.v || Date.now();
    emit({ status: "ok", message: `Live · ${clips.length} clips` });
    return true;
  } catch (error) {
    emit({ status: "error", message: error.message || "Could not reach the live board" });
    throw error;
  }
}

export { POLL_MS };
