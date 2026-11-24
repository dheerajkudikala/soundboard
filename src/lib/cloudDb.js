import { db, getClipBlob, listClips, listFriends, mergeBoard, uid } from "./db";

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

export function normalizeDbUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (!url.hostname.endsWith("firebaseio.com") && !url.hostname.endsWith("firebasedatabase.app")) {
    throw new Error("Use the Firebase Realtime Database URL (firebaseio.com).");
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\.json$/, "");
  const prefix = !path || path === "" ? "/sb" : path;
  return `${url.origin}${prefix === "/" ? "/sb" : prefix}`;
}

export async function getDbUrl() {
  const local = await db.meta.get("dbUrl");
  if (local?.value) return String(local.value);
  try {
    const res = await fetch("./db.json", { cache: "no-store" });
    if (!res.ok) return "";
    const cfg = await res.json();
    return cfg.url ? normalizeDbUrl(cfg.url) : "";
  } catch {
    return "";
  }
}

export async function setDbUrl(value) {
  const url = value ? normalizeDbUrl(value) : "";
  if (!url) await db.meta.delete("dbUrl");
  else await db.meta.put({ key: "dbUrl", value: url });
  return url;
}

async function rest(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
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

export async function pushBoard() {
  const root = await getDbUrl();
  if (!root) return { skipped: "need-db" };
  const pack = await buildLocal();
  const stamp = `${JSON.stringify(pack.friends)}|${pack.clips.map((c) => `${c.id}:${c.hash}:${c.title}:${c.friendId}`).join(",")}`;
  const last = await db.meta.get("dbStamp");
  if (last?.value === stamp) return { skipped: "unchanged", clips: pack.clips.length };

  const remote = (await rest(`${root}/board.json`)) || { clips: [] };
  const remoteHashes = new Map((remote.clips || []).map((clip) => [clip.id, clip.hash]));
  const keep = new Set(pack.clips.map((clip) => clip.id));

  for (const item of pack.audio) {
    if (remoteHashes.get(item.id) === item.hash) continue;
    await rest(`${root}/audio/${item.id}.json`, {
      method: "PUT",
      body: { h: item.hash, d: bytesToBase64(item.bytes) },
    });
  }
  await rest(`${root}/board.json`, {
    method: "PUT",
    body: { friends: pack.friends, clips: pack.clips, at: Date.now() },
  });
  for (const clip of remote.clips || []) {
    if (!keep.has(clip.id)) await rest(`${root}/audio/${clip.id}.json`, { method: "DELETE" });
  }

  await db.meta.put({ key: "dbStamp", value: stamp });
  return { clips: pack.clips.length };
}

export async function pullBoard({ overwriteMeta = false } = {}) {
  const root = await getDbUrl();
  if (!root) return false;
  const board = await rest(`${root}/board.json`);
  if (!board?.clips) return false;

  const stamp = `${board.at || ""}:${(board.clips || []).map((c) => `${c.id}:${c.hash}:${c.title}`).join(",")}`;
  const previous = await db.meta.get("dbPullStamp");
  const needed = [];
  for (const clip of board.clips || []) {
    if (!clip.id) continue;
    if (!(await db.audio.get(clip.id))) needed.push(clip);
    else if (clip.hash) {
      const known = await db.meta.get(`audioHash:${clip.id}`);
      if (known?.value !== clip.hash) needed.push(clip);
    }
  }
  if (previous?.value === stamp && needed.length === 0 && !overwriteMeta) return false;

  const clips = [];
  for (const clip of board.clips || []) {
    if (!clip.id) continue;
    let blob = null;
    if (needed.some((item) => item.id === clip.id)) {
      const row = await rest(`${root}/audio/${clip.id}.json`);
      if (row?.d) blob = base64ToBlob(row.d);
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
    if (clip.hash) await db.meta.put({ key: `audioHash:${clip.id}`, value: clip.hash });
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
    keepIds: overwriteMeta && board.at ? new Set(clips.map((clip) => clip.id)) : undefined,
  });
  await db.meta.put({ key: "dbPullStamp", value: stamp });
  return true;
}

export function subscribeBoard(onChange) {
  let source = null;
  let stopped = false;

  async function start() {
    const root = await getDbUrl();
    if (!root || stopped) return () => {};
    try {
      source = new EventSource(`${root}/board.json`);
      const handle = () => {
        onChange();
      };
      source.addEventListener("put", handle);
      source.addEventListener("patch", handle);
      source.onerror = () => {
        source?.close();
        source = null;
        if (!stopped) window.setTimeout(start, 4000);
      };
    } catch {
      if (!stopped) window.setTimeout(start, 4000);
    }
  }

  start();
  return () => {
    stopped = true;
    source?.close();
  };
}
