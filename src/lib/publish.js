import { db, getClipBlob, listClips, listFriends } from "./db";

const OWNER = "dheerajkudikala";
const REPO = "soundboard";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

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

function textBytes(text) {
  return new TextEncoder().encode(text);
}

export async function getPublishToken() {
  const row = await db.meta.get("publishToken");
  return String(row?.value || "").trim();
}

export async function setPublishToken(token) {
  const value = String(token || "").trim();
  if (!value) {
    await db.meta.delete("publishToken");
    return;
  }
  await db.meta.put({ key: "publishToken", value });
}

export async function getPublishStatus() {
  const row = await db.meta.get("publishStatus");
  return row?.value || { state: "idle" };
}

async function setStatus(value) {
  await db.meta.put({ key: "publishStatus", value });
  return value;
}

async function gh(token, url, { method = "GET", body } = {}) {
  const res = await fetch(url.startsWith("http") ? url : `${API}${url}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = new Error(data?.message || `GitHub ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function createBlob(token, bytes) {
  const data = await gh(token, "/git/blobs", {
    method: "POST",
    body: { content: bytesToBase64(bytes), encoding: "base64" },
  });
  return data.sha;
}

async function commitBranch(token, branch, updates, deletes) {
  const ref = await gh(token, `/git/refs/heads/${branch}`);
  const head = ref?.object?.sha || ref?.[0]?.object?.sha;
  if (!head) throw new Error(`Missing ${branch} branch`);
  const commit = await gh(token, `/git/commits/${head}`);
  const tree = await gh(token, "/git/trees", {
    method: "POST",
    body: {
      base_tree: commit.tree.sha,
      tree: [
        ...updates.map((item) => ({
          path: item.path,
          mode: "100644",
          type: "blob",
          sha: item.sha,
        })),
        ...deletes.map((path) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: null,
        })),
      ],
    },
  });
  const next = await gh(token, "/git/commits", {
    method: "POST",
    body: {
      message: "soundboard: update phones",
      tree: tree.sha,
      parents: [head],
    },
  });
  await gh(token, `/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: { sha: next.sha },
  });
}

async function listSoundWavs(token, branch, dir) {
  const listing = await gh(token, `/contents/${dir}?ref=${encodeURIComponent(branch)}`);
  if (!Array.isArray(listing)) return [];
  return listing.filter((item) => item.type === "file" && item.name.endsWith(".wav")).map((item) => item.name);
}

async function buildPack() {
  const [friends, clips] = await Promise.all([listFriends(), listClips()]);
  const audio = [];
  for (const clip of clips) {
    const blob = await getClipBlob(clip.id);
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    audio.push({
      id: clip.id,
      hash: fingerprintBytes(bytes),
      bytes,
    });
  }
  const manifestClips = clips.map((clip) => ({
    id: clip.id,
    title: clip.title,
    friendId: clip.friendId,
    duration: clip.duration || 0,
    createdAt: clip.createdAt,
    file: `${clip.id}.wav`,
    volume: clip.volume ?? 1,
    playbackRate: clip.playbackRate ?? 1,
    preservePitch: clip.preservePitch !== false,
  }));
  const manifest = `${JSON.stringify({ version: 2, friends, clips: manifestClips }, null, 2)}\n`;
  return { friends, clips: manifestClips, audio, manifest };
}

async function publishLocal(pack) {
  const clips = [];
  for (const clip of pack.clips) {
    const row = pack.audio.find((item) => item.id === clip.id);
    clips.push({
      ...clip,
      audio: row ? bytesToBase64(row.bytes) : "",
    });
  }
  const res = await fetch("/__board-publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ friends: pack.friends, clips }),
  });
  return res.ok;
}

async function publishGitHub(token, pack) {
  const blobCache = (await db.meta.get("gitBlobShas"))?.value || {};
  const updates = [];
  const keepWavs = new Set();

  for (const item of pack.audio) {
    keepWavs.add(`${item.id}.wav`);
    let sha = blobCache[item.hash];
    if (!sha) {
      sha = await createBlob(token, item.bytes);
      blobCache[item.hash] = sha;
    }
    updates.push({ name: `${item.id}.wav`, sha });
  }

  const manifestSha = await createBlob(token, textBytes(pack.manifest));
  updates.push({ name: "manifest.json", sha: manifestSha });

  const [liveWavs, sourceWavs] = await Promise.all([
    listSoundWavs(token, "gh-pages", "sounds"),
    listSoundWavs(token, "main", "public/sounds"),
  ]);

  await commitBranch(
    token,
    "gh-pages",
    updates.map((item) => ({ path: `sounds/${item.name}`, sha: item.sha })),
    liveWavs.filter((name) => !keepWavs.has(name)).map((name) => `sounds/${name}`)
  );
  await commitBranch(
    token,
    "main",
    updates.map((item) => ({ path: `public/sounds/${item.name}`, sha: item.sha })),
    sourceWavs.filter((name) => !keepWavs.has(name)).map((name) => `public/sounds/${name}`)
  );

  await db.meta.put({ key: "gitBlobShas", value: blobCache });
}

let timer = 0;
let running = false;
let queued = false;
const listeners = new Set();

function emit(status) {
  listeners.forEach((fn) => fn(status));
}

export function onPublishStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function packStamp(pack) {
  return `${pack.manifest}\n${pack.audio.map((item) => `${item.id}:${item.hash}`).join("|")}`;
}

async function publishNow() {
  const pack = await buildPack();
  const token = await getPublishToken();
  const stamp = packStamp(pack);
  const last = await db.meta.get("publishedStamp");
  if (last?.value === stamp && token) {
    emit(await setStatus({ state: "ok", at: Date.now(), clips: pack.clips.length }));
    return;
  }
  emit(await setStatus({ state: "saving", at: Date.now() }));

  const localOk = import.meta.env.DEV ? await publishLocal(pack).catch(() => false) : false;
  if (token) {
    await publishGitHub(token, pack);
  } else if (!localOk) {
    emit(await setStatus({ state: "need-token", at: Date.now() }));
    return;
  }

  await db.meta.put({ key: "publishedStamp", value: stamp });
  emit(await setStatus({ state: "ok", at: Date.now(), clips: pack.clips.length }));
}

export function queuePublish() {
  queued = true;
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    if (running) return;
    running = true;
    try {
      while (queued) {
        queued = false;
        try {
          await publishNow();
        } catch (error) {
          emit(
            await setStatus({
              state: "error",
              at: Date.now(),
              message: error.message || "Could not update phones",
            })
          );
        }
      }
    } finally {
      running = false;
    }
  }, 900);
}
