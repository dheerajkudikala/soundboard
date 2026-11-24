import JSZip from "jszip";
import { db, listClips, listFriends, getClipBlob, replaceBoard, uid } from "./db";

export async function exportBoardZip() {
  const zip = new JSZip();
  const friends = await listFriends();
  const clips = await listClips();
  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    friends,
    clips: [],
  };

  for (const clip of clips) {
    const blob = await getClipBlob(clip.id);
    const file = `${clip.id}.wav`;
    if (blob) zip.file(file, blob);
    manifest.clips.push({ ...clip, file });
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob" });
}

export async function importBoardZip(file) {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("Zip is missing manifest.json");
  const manifest = JSON.parse(await manifestFile.async("string"));
  const friends = (manifest.friends || []).map((f) => ({
    id: f.id || uid(),
    name: f.name || "Friend",
    color: f.color,
    createdAt: f.createdAt || Date.now(),
  }));
  const clips = [];
  for (const clip of manifest.clips || []) {
    const entry = zip.file(clip.file);
    const blob = entry ? new Blob([await entry.async("arraybuffer")], { type: "audio/wav" }) : null;
    clips.push({
      id: clip.id || uid(),
      title: clip.title || "Untitled clip",
      friendId: clip.friendId || friends[0]?.id || "",
      duration: clip.duration || 0,
      createdAt: clip.createdAt || Date.now(),
      blob,
    });
  }
  await replaceBoard({ friends, clips });
}

export async function importBundledManifest() {
  try {
    const res = await fetch(`./sounds/manifest.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const manifest = await res.json();
    const friends = (manifest.friends || []).map((f, i) => ({
      id: f.id || uid(),
      name: f.name,
      color: f.color,
      createdAt: f.createdAt || Date.now() + i,
    }));
    const clips = [];
    for (const clip of manifest.clips || []) {
      const existing = await db.clips.get(clip.id);
      const hasAudio = Boolean(await db.audio.get(clip.id));
      if (existing && hasAudio) {
        clips.push({ ...existing, ...clip, blob: null });
        continue;
      }
      const audioRes = await fetch(`./sounds/${clip.file}?t=${Date.now()}`, { cache: "no-store" });
      if (!audioRes.ok) {
        if (existing) clips.push({ ...existing, ...clip, blob: null });
        continue;
      }
      clips.push({
        id: clip.id || uid(),
        title: clip.title,
        friendId: clip.friendId,
        duration: clip.duration || 0,
        createdAt: clip.createdAt || Date.now(),
        volume: clip.volume ?? 1,
        playbackRate: clip.playbackRate ?? 1,
        preservePitch: clip.preservePitch !== false,
        blob: await audioRes.blob(),
      });
    }
    if (friends.length || clips.length) {
      await db.transaction("rw", db.friends, db.clips, db.audio, async () => {
        for (const friend of friends) {
          if (friend.id) await db.friends.put(friend);
        }
        for (const item of clips) {
          const { blob, ...clip } = item;
          const current = await db.clips.get(clip.id);
          await db.clips.put({ ...(current || {}), ...clip, id: clip.id });
          if (blob) await db.audio.put({ id: clip.id, blob });
        }
      });
    }
    await db.meta.put({ key: "bundled", value: `board-${manifest.clips?.length || 0}` });
    return Boolean(clips.length);
  } catch (error) {
    console.warn("Bundled sounds skipped", error);
    return false;
  }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
