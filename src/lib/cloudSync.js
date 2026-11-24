import { getClipBlob, listClips, listFriends, mergeBoard } from "./db";

const PASTE_ID = "bc8a66za";
const PASTE_EDIT = "dGbkX6NA";
const PASTE_EDIT_URL = `https://rentry.co/api/edit/${PASTE_ID}`;
const PASTE_RAW_URL = `https://rentry.co/api/raw/${PASTE_ID}`;
const RAW_CODE = "sbsync";

let publishTimer = 0;
let bundledIdsPromise = null;

function bundledIds() {
  if (!bundledIdsPromise) {
    bundledIdsPromise = fetch(`./sounds/manifest.json?t=${Date.now()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { clips: [] }))
      .then((manifest) => new Set((manifest.clips || []).map((clip) => clip.id)))
      .catch(() => new Set());
  }
  return bundledIdsPromise;
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

function parseRemote(text) {
  const parsed = JSON.parse(text);
  if (parsed?.status && String(parsed.status) !== "200") {
    if (typeof parsed.content === "string" && parsed.content.trim().startsWith("{")) {
      return JSON.parse(parsed.content);
    }
    return null;
  }
  if (parsed?.friends || parsed?.clips) return parsed;
  if (typeof parsed.content === "string") return JSON.parse(parsed.content);
  return null;
}

async function readRemote() {
  const plain = await fetch(PASTE_RAW_URL, { cache: "no-store" });
  const plainText = await plain.text();
  try {
    const parsed = parseRemote(plainText);
    if (parsed?.clips || parsed?.friends) return parsed;
  } catch {
    /* needs auth */
  }
  const authed = await fetch(PASTE_RAW_URL, {
    cache: "no-store",
    headers: { Authorization: RAW_CODE },
  });
  const text = await authed.text();
  try {
    return parseRemote(text);
  } catch {
    return null;
  }
}

async function writeRemote(payload) {
  const body = new URLSearchParams();
  body.set("edit_code", PASTE_EDIT);
  body.set("metadata", `SECRET_RAW_ACCESS_CODE = ${RAW_CODE}`);
  body.set("text", JSON.stringify(payload));
  const res = await fetch(PASTE_EDIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.status && String(json.status) !== "200")) {
    throw new Error(json.content || "Could not save the shared board.");
  }
}

export async function publishBoard() {
  const shipped = await bundledIds();
  const friends = await listFriends();
  const clips = await listClips();
  const packed = [];
  for (const clip of clips) {
    const row = {
      id: clip.id,
      title: clip.title,
      friendId: clip.friendId,
      duration: clip.duration || 0,
      createdAt: clip.createdAt,
      volume: clip.volume ?? 1,
      playbackRate: clip.playbackRate ?? 1,
      preservePitch: clip.preservePitch !== false,
    };
    if (!shipped.has(clip.id)) {
      const blob = await getClipBlob(clip.id);
      if (blob) row.audio = await blobToDataUrl(blob);
    }
    packed.push(row);
  }
  await writeRemote({ v: Date.now(), friends, clips: packed });
  return { ok: true, clips: packed.length };
}

export function schedulePublish() {
  window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => {
    publishBoard().catch((error) => console.warn("Board sync failed", error));
  }, 400);
}

export async function pullPublishedBoard() {
  const remote = await readRemote();
  if (!remote) return false;
  if (!remote.clips?.length && !remote.friends?.length) return false;
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
      blob: clip.audio ? dataUrlToBlob(clip.audio) : null,
    });
  }
  await mergeBoard({
    friends: remote.friends || [],
    clips,
    keepIds: new Set((remote.clips || []).map((clip) => clip.id)),
  });
  return true;
}
