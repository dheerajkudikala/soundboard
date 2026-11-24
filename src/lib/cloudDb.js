import { db, getClipBlob, listClips, listFriends, mergeBoard, uid } from "./db";

export const DB_ROOT = "https://soundboard-1c917-default-rtdb.firebaseio.com/sb";

export function isPhoneDevice() {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPod|Android/i.test(navigator.userAgent)) return true;
  return navigator.maxTouchPoints > 1 && !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function fingerprintBytes(bytes) {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  hash ^= bytes.length;
  hash = Math.imul(hash, 16777619);
  for (let i = 0; i < bytes.length; i += step) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  if (bytes.length) {
    hash ^= bytes[bytes.length - 1];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBlob(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/wav" });
}

function asClipList(clips) {
  if (Array.isArray(clips)) return clips.filter(Boolean);
  if (clips && typeof clips === "object") return Object.values(clips);
  return [];
}

async function rest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${DB_ROOT}${path}`, {
    method,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Database ${res.status}`);
  if (!text || text === "null") return null;
  return JSON.parse(text);
}

async function buildLocal() {
  const [friends, clips] = await Promise.all([listFriends(), listClips()]);
  const audio = [];
  const meta = [];
  for (const clip of clips) {
    const blob = await getClipBlob(clip.id);
    let hash = "";
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      hash = fingerprintBytes(bytes);
      audio.push({ id: clip.id, hash, bytes });
    }
    meta.push({
      id: clip.id,
      title: clip.title,
      friendId: clip.friendId,
      duration: clip.duration || 0,
      createdAt: clip.createdAt,
      volume: clip.volume ?? 1,
      playbackRate: clip.playbackRate ?? 1,
      preservePitch: clip.preservePitch !== false,
      hash,
    });
  }
  return { friends, clips: meta, audio };
}

export async function getDbUrl() {
  return DB_ROOT;
}

export async function setDbUrl() {
  return DB_ROOT;
}

export async function pushBoard() {
  if (isPhoneDevice()) return { skipped: "phone" };
  const pack = await buildLocal();
  const stamp = pack.clips.map((c) => `${c.id}:${c.hash}:${c.title}:${c.friendId}`).join(",");
  const remote = (await rest("/board.json")) || {};
  const remoteClips = asClipList(remote.clips);
  if (remote.at && (await db.meta.get("dbStamp"))?.value === stamp) {
    return { skipped: "unchanged", clips: pack.clips.length };
  }

  const remoteHashes = new Map(remoteClips.map((clip) => [clip.id, clip.hash]));
  const keep = new Set(pack.clips.map((clip) => clip.id));

  await rest("/board.json", {
    method: "PUT",
    body: { friends: pack.friends, clips: pack.clips, at: Date.now() },
  });

  for (const item of pack.audio) {
    if (remoteHashes.get(item.id) === item.hash) continue;
    await rest(`/audio/${item.id}.json`, {
      method: "PUT",
      body: { h: item.hash, d: bytesToBase64(item.bytes) },
    });
  }

  for (const clip of remoteClips) {
    if (!keep.has(clip.id)) await rest(`/audio/${clip.id}.json`, { method: "DELETE" });
  }

  await db.meta.put({ key: "dbStamp", value: stamp });
  return { clips: pack.clips.length };
}

export async function pullBoard({ overwriteMeta = false } = {}) {
  const board = await rest("/board.json");
  const clipsMeta = asClipList(board?.clips);
  if (!board || !clipsMeta.length) return false;

  const stamp = `${board.at || ""}:${clipsMeta.map((c) => `${c.id}:${c.hash}:${c.title}`).join(",")}`;
  const previous = await db.meta.get("dbPullStamp");
  const needed = [];
  for (const clip of clipsMeta) {
    if (!clip?.id) continue;
    if (!(await db.audio.get(clip.id))) needed.push(clip);
    else if (clip.hash && (await db.meta.get(`audioHash:${clip.id}`))?.value !== clip.hash) {
      needed.push(clip);
    }
  }
  if (previous?.value === stamp && needed.length === 0 && !overwriteMeta) return false;

  const clips = [];
  for (const clip of clipsMeta) {
    if (!clip?.id) continue;
    let blob = null;
    if (needed.some((item) => item.id === clip.id)) {
      const row = await rest(`/audio/${clip.id}.json`);
      if (row?.d) {
        blob = base64ToBlob(row.d);
        if (clip.hash) await db.meta.put({ key: `audioHash:${clip.id}`, value: clip.hash });
      }
    }
    clips.push({
      id: clip.id,
      title: clip.title,
      friendId: clip.friendId,
      duration: clip.duration || 0,
      createdAt: clip.createdAt || Date.now(),
      volume: clip.volume ?? 1,
      playbackRate: clip.playbackRate ?? 1,
      preservePitch: clip.preservePitch !== false,
      blob,
    });
  }

  const friends = (board.friends || []).map((friend, i) => ({
    id: friend.id || uid(),
    name: friend.name,
    color: friend.color,
    createdAt: friend.createdAt || Date.now() + i,
  }));

  await mergeBoard({
    friends,
    clips,
    keepIds: overwriteMeta ? new Set(clips.map((clip) => clip.id)) : undefined,
  });
  await db.meta.put({ key: "dbPullStamp", value: stamp });
  return true;
}

export function subscribeBoard(onChange) {
  let source = null;
  let stopped = false;
  let timer = 0;

  const ping = () => {
    if (!stopped) onChange();
  };

  function startStream() {
    try {
      source = new EventSource(`${DB_ROOT}/board.json`);
      source.addEventListener("put", ping);
      source.addEventListener("patch", ping);
      source.onerror = () => {
        source?.close();
        source = null;
      };
    } catch {
      source = null;
    }
  }

  startStream();
  timer = window.setInterval(ping, 4000);
  return () => {
    stopped = true;
    source?.close();
    window.clearInterval(timer);
  };
}
