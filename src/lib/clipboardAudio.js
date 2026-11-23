const NAME_RE = /\.(m4a|mp3|wav|aac|mp4|mov|caf|aiff|aif|m4v|mpeg)$/i;

export function isAudioLike(file) {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "");
  if (type.startsWith("audio/") || type.startsWith("video/")) return true;
  if (NAME_RE.test(name)) return true;
  if (type.includes("mpeg") || type.includes("mp4") || type.includes("m4a")) return true;
  return false;
}

function pickFromFileList(list) {
  const files = [...(list || [])];
  return files.find(isAudioLike) || files.find((f) => f.size > 1024) || null;
}

export function audioFileFromPasteEvent(event) {
  const data = event.clipboardData;
  if (!data) return null;

  const fromFiles = pickFromFileList(data.files);
  if (fromFiles) return fromFiles;

  for (const item of data.items || []) {
    const type = String(item.type || "").toLowerCase();
    const looksMedia =
      item.kind === "file" ||
      type.startsWith("audio/") ||
      type.startsWith("video/") ||
      type.includes("mp4") ||
      type.includes("mpeg") ||
      type.includes("m4a");
    if (!looksMedia) continue;
    const file = item.getAsFile?.();
    if (file && (isAudioLike(file) || file.size > 1024)) return file;
  }

  return null;
}

export function isTypingTarget(target) {
  const el = target;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
