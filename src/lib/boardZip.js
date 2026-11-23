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
    const res = await fetch("./sounds/manifest.json");
    if (!res.ok) return;
    const manifest = await res.json();
    const already = await db.meta.get("bundled");
    if (already) return;
    if (!manifest.clips?.length && !manifest.friends?.length) {
      await db.meta.put({ key: "bundled", value: true });
      return;
    }
    const localClips = await db.clips.count();
    if (localClips > 0) {
      await db.meta.put({ key: "bundled", value: true });
      return;
    }

    const friends = await Promise.all(
      (manifest.friends || []).map(async (f, i) => ({
        id: f.id || uid(),
        name: f.name,
        color: f.color,
        createdAt: Date.now() + i,
      }))
    );
    const clips = [];
    for (const clip of manifest.clips || []) {
      const audioRes = await fetch(`./sounds/${clip.file}`);
      if (!audioRes.ok) continue;
      const blob = await audioRes.blob();
      clips.push({
        id: clip.id || uid(),
        title: clip.title,
        friendId: clip.friendId,
        duration: clip.duration || 0,
        createdAt: clip.createdAt || Date.now(),
        blob,
      });
    }
    if ((friends.length || clips.length) && (await db.clips.count()) === 0) {
      await replaceBoard({ friends, clips });
    }
    await db.meta.put({ key: "bundled", value: true });
  } catch (error) {
    console.warn("Bundled sounds skipped", error);
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
