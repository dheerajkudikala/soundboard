let ctx;
const buffers = new Map();
const sources = new Map();
const listeners = new Set();
const primedUrls = new Map();
let playToken = 0;
let primed = false;

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

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
  if (primed) return;
  primed = true;
  try {
    const el = new Audio(SILENT_WAV);
    el.playsInline = true;
    el.setAttribute("playsinline", "true");
    el.volume = 0.01;
    el.play().catch(() => {
      primed = false;
    });
  } catch {
    primed = false;
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
  const url = primedUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    primedUrls.delete(id);
  }
}

export async function cacheClip(id, blob) {
  if (buffers.has(id)) return buffers.get(id);
  const buffer = await decodeBlob(blob);
  buffers.set(id, buffer);
  return buffer;
}

export function primeClip(id, blob) {
  if (!blob) return primedUrls.get(id);
  if (primedUrls.has(id)) return primedUrls.get(id);
  const url = URL.createObjectURL(blob);
  primedUrls.set(id, url);
  return url;
}

export function hasPrimedClip(id) {
  return primedUrls.has(id);
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
  } catch {
    /* ignore */
  }
  if (rec.url && !primedUrls.has(id)) URL.revokeObjectURL(rec.url);
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

function attachElement(id, el, url) {
  const finish = () => {
    if (sources.get(id)?.el === el) stopClip(id);
  };
  el.addEventListener("ended", finish);
  el.addEventListener("error", finish);
  sources.set(id, { source: null, el, url, node: null, gain: null });
  emit();
}

async function blobFor(id, blob) {
  if (blob) return blob;
  const url = primedUrls.get(id);
  if (!url) return null;
  const res = await fetch(url);
  return res.blob();
}

export async function playClip(id, blob, fx = {}) {
  unlockAudio();
  stopAll();
  const token = ++playToken;
  const volume = Math.max(0, Number.isFinite(fx.volume) ? fx.volume : 1);
  const rate = Number.isFinite(fx.playbackRate) ? fx.playbackRate : 1;
  const preservePitch = fx.preservePitch !== false;
  const audioBlob = await blobFor(id, blob);
  const url = primedUrls.get(id) || (audioBlob ? primeClip(id, audioBlob) : null);
  if (!url && !audioBlob) return;

  if (audioBlob) {
    try {
      await playViaWebAudio(id, audioBlob, { volume, rate, token });
      if (token === playToken && sources.has(id)) return;
    } catch {
      /* iOS HTMLAudio fallback below */
    }
  }

  if (!url || token !== playToken) return;
  const el = new Audio();
  el.playsInline = true;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.preload = "auto";
  el.src = url;
  el.volume = Math.max(0, Math.min(1, volume));
  el.playbackRate = Math.min(2, Math.max(0.5, rate));
  el.preservesPitch = preservePitch;
  el.webkitPreservesPitch = preservePitch;
  attachElement(id, el, url);
  try {
    await el.play();
  } catch {
    if (token !== playToken) return;
    if (audioBlob) await playViaWebAudio(id, audioBlob, { volume, rate, token });
    return;
  }
  if (token !== playToken) stopClip(id);
}

async function playViaWebAudio(id, blob, { volume, rate, token }) {
  if (!blob) return;
  const audio = getAudioContext();
  await audio.resume();
  if (String(id).startsWith("__")) invalidateBuffer(id);
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
  sources.set(id, { source, gain, startedAt: audio.currentTime, duration: buffer.duration / Math.max(0.05, rate) });
  emit();
}

export function isPlaying(id) {
  return sources.has(id);
}

if (typeof window !== "undefined") {
  const unlock = () => unlockAudio();
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("touchend", unlock, { passive: true });
  window.addEventListener("click", unlock);
}
