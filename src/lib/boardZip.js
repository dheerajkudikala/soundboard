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
  const { pullSitePack } = await import("./sitePack");
  return pullSitePack({ overwriteMeta: false });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
