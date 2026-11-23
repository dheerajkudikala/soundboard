import { getClipBlob, listClips, listFriends, replaceBoard } from "./db";

export const GITHUB_OWNER = "dheerajkudikala";
export const GITHUB_REPO = "soundboard";
const TOKEN_KEY = "soundboard.githubToken";
const RAW = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public/sounds`;

let publishTimer = 0;

export function getGithubToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setGithubToken(token) {
  const value = String(token || "").trim();
  if (!value) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, value);
}

export function hasGithubToken() {
  return Boolean(getGithubToken());
}

async function api(path, { method = "GET", body, token } = {}) {
  const auth = token || getGithubToken();
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function putPath(branch, path, contentBase64, message) {
  const current = await api(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURI(path)}?ref=${branch}`
  );
  return api(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURI(path)}`, {
    method: "PUT",
    body: {
      message,
      content: contentBase64,
      branch,
      ...(current?.sha ? { sha: current.sha } : {}),
    },
  });
}

async function deletePath(branch, path, sha, message) {
  if (!sha) return;
  await api(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURI(path)}`, {
    method: "DELETE",
    body: { message, branch, sha },
  });
}

async function listFolder(branch, path) {
  const data = await api(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURI(path)}?ref=${branch}`
  );
  return Array.isArray(data) ? data : [];
}

function clipRecord(clip, file) {
  return {
    id: clip.id,
    title: clip.title,
    friendId: clip.friendId,
    duration: clip.duration || 0,
    createdAt: clip.createdAt,
    file,
    volume: clip.volume ?? 1,
    playbackRate: clip.playbackRate ?? 1,
    preservePitch: clip.preservePitch !== false,
  };
}

export async function testGithubToken(token) {
  const data = await api("/user", { token });
  return data?.login || "";
}

export async function publishBoard() {
  if (!getGithubToken()) return { skipped: true };
  const friends = await listFriends();
  const clips = await listClips();
  const manifestClips = [];
  const keep = new Set(["manifest.json"]);

  for (const clip of clips) {
    const blob = await getClipBlob(clip.id);
    const file = `${clip.id}.wav`;
    keep.add(file);
    manifestClips.push(clipRecord(clip, file));
    if (blob) {
      const content = await blobToBase64(blob);
      await putPath("main", `public/sounds/${file}`, content, `Sync clip ${clip.title}`);
      await putPath("gh-pages", `sounds/${file}`, content, `Sync clip ${clip.title}`);
    }
  }

  const manifest = {
    version: Date.now(),
    friends,
    clips: manifestClips,
  };
  const manifestB64 = btoa(unescape(encodeURIComponent(JSON.stringify(manifest, null, 2))));
  await putPath("main", "public/sounds/manifest.json", manifestB64, "Sync soundboard");
  await putPath("gh-pages", "sounds/manifest.json", manifestB64, "Sync soundboard");

  for (const branch of ["main", "gh-pages"]) {
    const folder = branch === "main" ? "public/sounds" : "sounds";
    const files = await listFolder(branch, folder);
    for (const file of files) {
      if (file.type !== "file") continue;
      if (keep.has(file.name)) continue;
      if (!file.name.endsWith(".wav") && file.name !== "manifest.json") continue;
      await deletePath(branch, file.path, file.sha, `Remove ${file.name}`);
    }
  }
  return { ok: true, clips: clips.length };
}

export function schedulePublish() {
  if (!getGithubToken()) return;
  window.clearTimeout(publishTimer);
  publishTimer = window.setTimeout(() => {
    publishBoard().catch((error) => {
      console.warn("Soundboard sync failed", error);
    });
  }, 1200);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function fetchBlob(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.blob();
}

export async function pullPublishedBoard() {
  const manifest =
    (await fetchJson(`${RAW}/manifest.json?t=${Date.now()}`)) ||
    (await fetchJson(`./sounds/manifest.json?t=${Date.now()}`));
  if (!manifest?.clips?.length && !manifest?.friends?.length) return false;

  const friends = (manifest.friends || []).map((friend) => ({
    id: friend.id,
    name: friend.name,
    color: friend.color,
    createdAt: friend.createdAt || Date.now(),
  }));
  const clips = [];
  for (const clip of manifest.clips || []) {
    const blob =
      (await fetchBlob(`${RAW}/${clip.file}?t=${Date.now()}`)) ||
      (await fetchBlob(`./sounds/${clip.file}?t=${Date.now()}`));
    if (!blob) continue;
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
  if (!friends.length && !clips.length) return false;
  await replaceBoard({ friends, clips });
  return true;
}
