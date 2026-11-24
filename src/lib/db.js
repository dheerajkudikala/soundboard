import Dexie from "dexie";

export const db = new Dexie("soundboard");

db.version(1).stores({
  friends: "id, name, createdAt",
  clips: "id, friendId, title, createdAt",
  audio: "id",
  meta: "key",
});

db.version(2).stores({
  friends: "id, name, createdAt",
  clips: "id, friendId, title, createdAt, sourceId",
  audio: "id",
  sources: "id, createdAt",
  meta: "key",
});

export const FRIEND_COLORS = [
  "#818cf8",
  "#a78bfa",
  "#34d399",
  "#f472b6",
  "#38bdf8",
  "#fbbf24",
  "#fb7185",
];

export function uid() {
  return crypto.randomUUID();
}

export async function listFriends() {
  return db.friends.orderBy("createdAt").toArray();
}

export async function listClips() {
  return db.clips.orderBy("createdAt").reverse().toArray();
}

export async function addFriend(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Friend name is required");
  const existing = await db.friends.toArray();
  const friend = {
    id: uid(),
    name: trimmed,
    color: FRIEND_COLORS[existing.length % FRIEND_COLORS.length],
    createdAt: Date.now(),
  };
  await db.friends.add(friend);
  return friend;
}

export async function renameFriend(id, name) {
  await db.friends.update(id, { name: name.trim() });
}

export async function deleteFriend(id) {
  const clips = await db.clips.where("friendId").equals(id).toArray();
  await db.transaction("rw", db.friends, db.clips, db.audio, async () => {
    await db.friends.delete(id);
    for (const clip of clips) {
      await db.clips.delete(clip.id);
      await db.audio.delete(clip.id);
    }
  });
}

function clipFields({
  title,
  friendId,
  duration,
  transcript = "",
  sourceId = null,
  sourceStart = 0,
  sourceEnd = duration,
  volume = 1,
  playbackRate = 1,
  preservePitch = true,
}) {
  return {
    title: String(title || "").trim() || "Untitled clip",
    friendId,
    duration,
    transcript: String(transcript || "").trim(),
    sourceId: sourceId || null,
    sourceStart: Number(sourceStart) || 0,
    sourceEnd: Number.isFinite(sourceEnd) ? sourceEnd : duration,
    volume: Number.isFinite(volume) ? volume : 1,
    playbackRate: Number.isFinite(playbackRate) ? playbackRate : 1,
    preservePitch: preservePitch !== false,
  };
}

export async function saveSource(blob, name = "Voice memo") {
  const id = uid();
  await db.transaction("rw", db.sources, db.audio, async () => {
    await db.sources.add({ id, name, createdAt: Date.now() });
    await db.audio.put({ id, blob });
  });
  return id;
}

export async function getSourceBlob(id) {
  if (!id) return null;
  const row = await db.audio.get(id);
  return row?.blob || null;
}

export async function saveClip(input) {
  const id = uid();
  const clip = { id, createdAt: Date.now(), ...clipFields(input) };
  await db.transaction("rw", db.clips, db.audio, async () => {
    await db.clips.add(clip);
    if (input.blob) await db.audio.put({ id, blob: input.blob });
  });
  return clip;
}

export async function updateClip(id, patch) {
  await db.clips.update(id, patch);
}

export async function upsertClip({ boardId, blob, ...rest }) {
  if (boardId) {
    const patch = clipFields({ ...rest, duration: rest.duration });
    await db.transaction("rw", db.clips, db.audio, async () => {
      await db.clips.update(boardId, patch);
      if (blob) await db.audio.put({ id: boardId, blob });
    });
    return { id: boardId, ...patch };
  }
  return saveClip({ blob, ...rest });
}

export async function deleteClip(id) {
  const clip = await db.clips.get(id);
  await db.transaction("rw", db.clips, db.audio, async () => {
    await db.clips.delete(id);
    await db.audio.delete(id);
  });
  if (clip?.sourceId) {
    const others = await db.clips.where("sourceId").equals(clip.sourceId).count();
    if (others === 0) {
      await db.sources.delete(clip.sourceId);
      await db.audio.delete(clip.sourceId);
    }
  }
}

export async function getClipBlob(id) {
  const row = await db.audio.get(id);
  return row?.blob || null;
}

export async function mergeBoard({ friends, clips, keepIds }) {
  await db.transaction("rw", db.friends, db.clips, db.audio, async () => {
    for (const friend of friends || []) {
      if (friend?.id) await db.friends.put(friend);
    }
    for (const item of clips || []) {
      const { blob, ...clip } = item;
      if (!clip.id) continue;
      const current = await db.clips.get(clip.id);
      await db.clips.put({ ...(current || {}), ...clip, id: clip.id });
      if (blob) await db.audio.put({ id: clip.id, blob });
    }
    if (keepIds) {
      const local = await db.clips.toArray();
      for (const clip of local) {
        if (!keepIds.has(clip.id)) {
          await db.clips.delete(clip.id);
          await db.audio.delete(clip.id);
        }
      }
    }
  });
}

export async function replaceBoard({ friends, clips }) {
  await db.transaction("rw", db.friends, db.clips, db.audio, async () => {
    await db.friends.clear();
    await db.clips.clear();
    await db.audio.clear();
    if (friends?.length) await db.friends.bulkAdd(friends);
    for (const item of clips || []) {
      const { blob, ...clip } = item;
      await db.clips.put(clip);
      if (blob) await db.audio.put({ id: clip.id, blob });
    }
  });
}

const DEFAULT_FRIENDS = ["Silvano", "Avi", "Kushith"];

let seedPromise = null;

export function seedIfEmpty() {
  if (!seedPromise) seedPromise = seedIfEmptyInner();
  return seedPromise;
}

async function seedIfEmptyInner() {
  const seeded = await db.meta.get("seeded");
  if (seeded) return;
  const names = await db.friends.toArray();
  if (names.length === 0) {
    await db.friends.bulkAdd(
      DEFAULT_FRIENDS.map((name, i) => ({
        id: uid(),
        name,
        color: FRIEND_COLORS[i],
        createdAt: Date.now() + i,
      }))
    );
  }
  await db.meta.put({ key: "seeded", value: true });
}
