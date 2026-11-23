let ctx;
const buffers = new Map();
const sources = new Map();
const listeners = new Set();

export function getAudioContext() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

export function unlockAudio() {
  try {
    const audio = getAudioContext();
    if (audio.state === "suspended") audio.resume();
  } catch {
    /* ignore */
  }
}

export function onPlaybackChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const playing = [...sources.keys()];
  listeners.forEach((fn) => fn(playing));
}

export async function decodeBlob(blob) {
  const audio = getAudioContext();
  const copy = await blob.arrayBuffer();
  return audio.decodeAudioData(copy);
}

export function invalidateBuffer(id) {
  buffers.delete(id);
}

export async function cacheClip(id, blob) {
  if (buffers.has(id)) return buffers.get(id);
  const buffer = await decodeBlob(blob);
  buffers.set(id, buffer);
  return buffer;
}

export function stopClip(id) {
  const rec = sources.get(id);
  if (!rec) return;
  try {
    rec.source?.stop?.();
  } catch {
    /* already stopped */
  }
  try {
    rec.el?.pause?.();
    if (rec.el) rec.el.src = "";
  } catch {
    /* ignore */
  }
  if (rec.url) URL.revokeObjectURL(rec.url);
  try {
    rec.gain?.disconnect?.();
    rec.node?.disconnect?.();
  } catch {
    /* ignore */
  }
  sources.delete(id);
  emit();
}

export function stopAll() {
  for (const id of [...sources.keys()]) stopClip(id);
}

let playToken = 0;

export async function playClip(id, blob, fx = {}) {
  unlockAudio();
  stopAll();
  const token = ++playToken;
  const volume = Number.isFinite(fx.volume) ? fx.volume : 1;
  const rate = Number.isFinite(fx.playbackRate) ? fx.playbackRate : 1;
  const preservePitch = fx.preservePitch !== false;
  const audio = getAudioContext();

  if (preservePitch && Math.abs(rate - 1) > 0.001) {
    const url = URL.createObjectURL(blob);
    const el = new Audio();
    el.src = url;
    el.preservesPitch = true;
    el.webkitPreservesPitch = true;
    el.mozPreservesPitch = true;
    el.playbackRate = Math.min(2, Math.max(0.5, rate));
    const node = audio.createMediaElementSource(el);
    const gain = audio.createGain();
    gain.gain.value = volume;
    node.connect(gain);
    gain.connect(audio.destination);
    const finish = () => {
      if (sources.get(id)?.el === el) stopClip(id);
    };
    el.addEventListener("ended", finish);
    sources.set(id, { source: null, el, url, node, gain });
    emit();
    await el.play();
    if (token !== playToken) {
      stopClip(id);
      return;
    }
    return;
  }

  const buffer = await cacheClip(id, blob);
  if (token !== playToken) return;
  const source = audio.createBufferSource();
  const gain = audio.createGain();
  source.buffer = buffer;
  source.playbackRate.value = Math.min(2, Math.max(0.5, rate));
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(audio.destination);
  source.onended = () => {
    if (sources.get(id)?.source === source) {
      sources.delete(id);
      emit();
    }
  };
  source.start(0);
  sources.set(id, { source, gain, startedAt: audio.currentTime, duration: buffer.duration / rate });
  emit();
}

export function isPlaying(id) {
  return sources.has(id);
}

if (typeof window !== "undefined") {
  const unlock = () => unlockAudio();
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("click", unlock);
}
