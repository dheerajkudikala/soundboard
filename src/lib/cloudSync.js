import { getClipBlob, listClips, listFriends, replaceBoard } from "./db";

const PASTE_ID = "bc8a66za";
const PASTE_EDIT = "dGbkX6NA";
const PASTE_EDIT_URL = `https://rentry.co/api/edit/${PASTE_ID}`;
const PASTE_RAW_URL = `https://rentry.co/api/raw/${PASTE_ID}`;
const RAW_CODE = "sbsync";

let publishTimer = 0;

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

async function readRemote() {
  const res = await fetch(PASTE_RAW_URL, {
    cache: "no-store",
    headers: { Authorization: RAW_CODE, "rentry-auth": RAW_CODE },
  });
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed?.status && parsed.status !== "200") return null;
    if (parsed?.friends || parsed?.clips) return parsed;
    if (typeof parsed.content === "string") return JSON.parse(parsed.content);
  } catch {
    return null;
  }
  return null;
}

async function writeRemote(payload) {
  const body = new URLSearchParams();
  body.set("edit_code", PASTE_EDIT);
  body.set("metadata", `SECRET_RAW_ACCESS_CODE = ${RAW_CODE}`);
  body.set("text", JSON.stringify(payload));
  const res = await fetch(PASTE_EDIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Could not save the shared board.");
  const json = await res.json().catch(() => ({}));
  if (json.status && String(json.status) !== "200") {
    throw new Error(json.content || "Could not save the shared board.");
  }
}

export async function publishBoard() {
  const friends = await listFriends();
  const clips = await listClips();
  const packed = [];
  for (const clip of clips) {
    const blob = await getClipBlob(clip.id);
    packed.push({
      id: clip.id,
      title: clip.title,
      friendId: clip.friendId,
      duration: clip.duration || 0,
      createdAt: clip.createdAt,
      volume: clip.volume ?? 1,
      playbackRate: clip.playbackRate ?? 1,
      preservePitch: clip.preservePitch !== false,
      audio: blob ? await blobToDataUrl(blob) : "",
    });
  }
  await writeRemote({ v: Date.now(), friends, clips: packed });
  return { ok: true, clips: packed.length };
}

export function schedulePublish() {
  window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => {
    publishBoard().catch((error) => console.warn("Board sync failed", error));
  }, 800);
}

export async function pullPublishedBoard() {
  const remote = await readRemote();
  if (!remote?.clips?.length && !remote?.friends?.length) return false;
  const friends = (remote.friends || []).map((friend) => ({
    id: friend.id,
    name: friend.name,
    color: friend.color,
    createdAt: friend.createdAt || Date.now(),
  }));
  const clips = [];
  for (const clip of remote.clips || []) {
    if (!clip.audio) continue;
    clips.push({
      id: clip.id,
      title: clip.title,
      friendId: clip.friendId,
      duration: clip.duration || 0,
      createdAt: clip.createdAt || Date.now(),
      volume: clip.volume ?? 1,
      playbackRate: clip.playbackRate ?? 1,
      preservePitch: clip.preservePitch !== false,
      blob: dataUrlToBlob(clip.audio),
    });
  }
  if (!friends.length && !clips.length) return false;
  await replaceBoard({ friends, clips });
  return true;
}
