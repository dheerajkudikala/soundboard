import { getAudioContext } from "./audio";

function makeBuffer(channels, length, sampleRate) {
  return getAudioContext().createBuffer(channels, length, sampleRate);
}

function fadeBuffer(buffer, fadeMs = 5) {
  const fadeSamples = Math.min(
    Math.floor((buffer.sampleRate * fadeMs) / 1000),
    Math.floor(buffer.length / 2)
  );
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const src = buffer.getChannelData(ch);
    const dest = out.getChannelData(ch);
    dest.set(src);
    for (let i = 0; i < fadeSamples; i += 1) {
      const g = i / fadeSamples;
      dest[i] *= g;
      dest[dest.length - 1 - i] *= g;
    }
  }
  return out;
}

export function sliceBuffer(buffer, startSec, endSec) {
  const start = Math.max(0, Math.floor(startSec * buffer.sampleRate));
  const end = Math.min(buffer.length, Math.floor(endSec * buffer.sampleRate));
  const length = Math.max(1, end - start);
  const out = makeBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(start, end));
  }
  return out;
}

export function audioBufferToWavBlob(buffer, { fadeMs = 5 } = {}) {
  const faded = fadeBuffer(buffer, fadeMs);
  const channels = faded.numberOfChannels;
  const sampleRate = faded.sampleRate;
  const length = faded.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const view = new DataView(new ArrayBuffer(headerSize + dataSize));

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const chans = Array.from({ length: channels }, (_, i) => faded.getChannelData(i));
  for (let i = 0; i < length; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      const sample = Math.max(-1, Math.min(1, chans[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([view.buffer], { type: "audio/wav" });
}

export function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const whole = Math.floor(s);
  const ms = Math.round((s - whole) * 1000)
    .toString()
    .padStart(3, "0");
  return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${ms}`;
}

export function parseTimestamp(value) {
  const match = String(value).trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}
