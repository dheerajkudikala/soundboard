import { db, uid } from "./db";

function fingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export async function pullSitePack({ overwriteMeta = false } = {}) {
  try {
    const res = await fetch("./sounds/manifest.json", { cache: "no-store" });
    if (!res.ok) return false;
    const text = await res.text();
    const stamp = fingerprint(text);
    const previous = await db.meta.get("packHash");
    const manifest = JSON.parse(text);
    const clips = manifest.clips || [];
    const needed = [];
    for (const clip of clips) {
      if (!clip.id || !clip.file) continue;
      if (!(await db.audio.get(clip.id))) needed.push(clip);
    }
    if (previous?.value === stamp && needed.length === 0) return false;

    const audio = new Map();
    await Promise.all(
      needed.map(async (clip) => {
        const audioRes = await fetch(`./sounds/${clip.file}`, { cache: "no-store" });
        if (audioRes.ok) audio.set(clip.id, await audioRes.blob());
      })
    );

    await db.transaction("rw", db.friends, db.clips, db.audio, db.meta, async () => {
      for (const [i, friend] of (manifest.friends || []).entries()) {
        if (!friend?.id) continue;
        const row = {
          id: friend.id || uid(),
          name: friend.name,
          color: friend.color,
          createdAt: friend.createdAt || Date.now() + i,
        };
        const current = await db.friends.get(row.id);
        if (!current) await db.friends.add(row);
        else if (overwriteMeta) await db.friends.put({ ...current, ...row });
      }

      for (const clip of clips) {
        if (!clip.id) continue;
        const current = await db.clips.get(clip.id);
        const next = {
          id: clip.id,
          title: clip.title,
          friendId: clip.friendId,
          duration: clip.duration || 0,
          createdAt: clip.createdAt || Date.now(),
          volume: clip.volume ?? 1,
          playbackRate: clip.playbackRate ?? 1,
          preservePitch: clip.preservePitch !== false,
        };
        if (!current) await db.clips.put(next);
        else if (overwriteMeta) await db.clips.put({ ...current, ...next });
        const blob = audio.get(clip.id);
        if (blob) await db.audio.put({ id: clip.id, blob });
      }

      await db.meta.put({ key: "packHash", value: stamp });
    });
    return true;
  } catch {
    return false;
  }
}
