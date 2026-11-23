function mixMono(buffer) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (channels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(length);
  for (let ch = 0; ch < channels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) out[i] += data[i] / channels;
  }
  return out;
}

export function detectSpeechSegments(buffer, options = {}) {
  const {
    minClip = 0.28,
    maxClip = 10,
    minSilence = 0.22,
    pad = 0.06,
  } = options;
  const data = mixMono(buffer);
  const sr = buffer.sampleRate;
  const hop = Math.max(1, Math.floor(sr * 0.02));
  const rms = [];
  for (let i = 0; i < data.length; i += hop) {
    const end = Math.min(data.length, i + hop);
    let sum = 0;
    for (let j = i; j < end; j += 1) sum += data[j] * data[j];
    rms.push(Math.sqrt(sum / (end - i)));
  }

  const ranked = [...rms].sort((a, b) => a - b);
  const noise = ranked[Math.floor(ranked.length * 0.18)] || 0.008;
  const thresh = Math.max(0.012, noise * 3.2);

  const minSpeechFrames = Math.round(minClip / 0.02);
  const minSilenceFrames = Math.round(minSilence / 0.02);
  const ranges = [];
  let i = 0;
  while (i < rms.length) {
    while (i < rms.length && rms[i] < thresh) i += 1;
    if (i >= rms.length) break;
    let start = i;
    let end = i;
    let silentRun = 0;
    while (end < rms.length) {
      if (rms[end] < thresh) {
        silentRun += 1;
        if (silentRun >= minSilenceFrames) break;
      } else {
        silentRun = 0;
      }
      end += 1;
    }
    const speechEnd = end - silentRun;
    if (speechEnd - start >= minSpeechFrames) {
      ranges.push([start, speechEnd]);
    }
    i = Math.max(end, start + 1);
  }

  const duration = buffer.duration;
  const clips = [];
  for (const [fs, fe] of ranges) {
    let start = Math.max(0, fs * 0.02 - pad);
    let end = Math.min(duration, fe * 0.02 + pad);
    if (end - start > maxClip) {
      const pieces = splitLong(rms, fs, fe, maxClip, hop, sr, duration, pad);
      clips.push(...pieces);
    } else if (end - start >= minClip) {
      clips.push({ start, end });
    }
  }

  if (!clips.length && duration > 0.4) {
    return [{ start: 0, end: duration }];
  }
  return clips;
}

function splitLong(rms, fs, fe, maxClip, hop, sr, duration, pad) {
  const maxFrames = Math.round(maxClip / 0.02);
  const out = [];
  let cursor = fs;
  while (cursor < fe) {
    const limit = Math.min(fe, cursor + maxFrames);
    let split = limit;
    if (limit < fe) {
      let quietest = rms[limit];
      split = limit;
      for (let k = cursor + Math.round(maxFrames * 0.4); k < limit; k += 1) {
        if (rms[k] < quietest) {
          quietest = rms[k];
          split = k;
        }
      }
    }
    const start = Math.max(0, cursor * 0.02 - pad);
    const end = Math.min(duration, split * 0.02 + pad);
    if (end - start >= 0.4) out.push({ start, end });
    cursor = split;
  }
  return out;
}

export function resampleMono16k(buffer) {
  const data = mixMono(buffer);
  const srcRate = buffer.sampleRate;
  const target = 16000;
  if (srcRate === target) return data;
  const ratio = srcRate / target;
  const length = Math.max(1, Math.floor(data.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(data.length - 1, i0 + 1);
    const t = x - i0;
    out[i] = data[i0] * (1 - t) + data[i1] * t;
  }
  return out;
}

export function clipsFromWhisperChunks(chunks, duration) {
  return (chunks || [])
    .map((chunk) => {
      const start = Number(chunk.timestamp?.[0] ?? 0);
      let end = Number(chunk.timestamp?.[1]);
      if (!Number.isFinite(end)) end = Math.min(duration, start + 4);
      return {
        start: Math.max(0, start),
        end: Math.min(duration, end),
        text: String(chunk.text || "").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((clip) => clip.end - clip.start >= 0.35);
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function attachTranscripts(segments, chunks) {
  if (!chunks?.length) return segments.map((s) => ({ ...s, text: s.text || "" }));
  return segments.map((seg) => {
    const hits = chunks
      .filter((chunk) => overlap(seg, chunk) > 0.12)
      .sort((a, b) => a.start - b.start);
    return {
      ...seg,
      text: hits
        .map((h) => h.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    };
  });
}

function mergeTiny(clips) {
  const out = [];
  for (const clip of clips) {
    const prev = out[out.length - 1];
    const dur = clip.end - clip.start;
    if (prev && dur < 0.85 && clip.start - prev.end < 0.45) {
      prev.end = clip.end;
      prev.text = [prev.text, clip.text].filter(Boolean).join(" ").trim();
    } else {
      out.push({ ...clip });
    }
  }
  return out;
}

export function buildSuggestions({ duration, silenceSegs, whisper }) {
  const chunks = clipsFromWhisperChunks(whisper?.chunks, duration);
  const gaps = silenceSegs.length ? silenceSegs : [{ start: 0, end: duration }];
  const fallback = chunks.length
    ? chunks
    : [{ start: 0, end: duration, text: whisper?.text || "" }];
  return attachTranscripts(gaps, fallback);
}

export function titleFromTranscript(text, fallback, index) {
  const clean = String(text || "")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .trim();
  if (clean) {
    const clipped = clean.length > 52 ? `${clean.slice(0, 52).trim()}…` : clean;
    return clipped;
  }
  return fallback || `Clip ${index + 1}`;
}

export function guessFriendId(text, friends) {
  const hay = String(text || "").toLowerCase();
  if (!hay) return "";
  const hit = friends.find((f) => hay.includes(String(f.name).toLowerCase()));
  return hit?.id || "";
}
