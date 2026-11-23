import { getAudioContext } from "./audio";

function mixCenter(buffer) {
  const n = buffer.length;
  const out = new Float32Array(n);
  const chs = buffer.numberOfChannels;
  const left = buffer.getChannelData(0);
  const right = chs > 1 ? buffer.getChannelData(1) : left;
  if (chs === 1) {
    out.set(left);
    return out;
  }
  for (let i = 0; i < n; i += 1) {
    const mid = (left[i] + right[i]) * 0.5;
    const side = (left[i] - right[i]) * 0.5;
    out[i] = mid * 0.92 - side * 0.18;
  }
  return out;
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i += 1) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function fft(re, im, inverse) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size >> 1;
    const ang = ((inverse ? 2 : -2) * Math.PI) / size;
    const wpr = Math.cos(ang);
    const wpi = Math.sin(ang);
    for (let i = 0; i < n; i += size) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k += 1) {
        const er = re[i + k];
        const ei = im[i + k];
        const or = re[i + k + half];
        const oi = im[i + k + half];
        const tr = wr * or - wi * oi;
        const ti = wr * oi + wi * or;
        re[i + k] = er + tr;
        im[i + k] = ei + ti;
        re[i + k + half] = er - tr;
        im[i + k + half] = ei - ti;
        const nwr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr;
        wr = nwr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[i] || 0;
}

function smooth(arr, radius) {
  const tmp = arr.slice();
  for (let i = 0; i < arr.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const j = i + k;
      if (j >= 0 && j < arr.length) {
        sum += tmp[j];
        count += 1;
      }
    }
    arr[i] = sum / count;
  }
}

function spectralFlatness(mag2, lo, hi) {
  let logSum = 0;
  let arith = 0;
  let n = 0;
  for (let k = lo; k <= hi; k += 1) {
    const v = mag2[k] + 1e-20;
    logSum += Math.log(v);
    arith += v;
    n += 1;
  }
  if (!n) return 1;
  const geo = Math.exp(logSum / n);
  return geo / (arith / n + 1e-20);
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function gate(samples, sampleRate) {
  const win = Math.max(32, Math.floor(sampleRate * 0.012));
  const hop = Math.max(16, Math.floor(win / 2));
  const energies = [];
  for (let i = 0; i + win < samples.length; i += hop) {
    let e = 0;
    for (let j = 0; j < win; j += 1) e += samples[i + j] * samples[i + j];
    energies.push(Math.sqrt(e / win));
  }
  const speech = percentile(energies, 0.72);
  const thresh = Math.max(1e-5, speech * 0.08);
  const gain = new Float32Array(samples.length);
  gain.fill(1);
  for (let i = 0, f = 0; i + win < samples.length; i += hop, f += 1) {
    const g = energies[f] < thresh ? Math.max(0.02, energies[f] / (thresh + 1e-8)) ** 2.2 : 1;
    for (let j = 0; j < hop && i + j < samples.length; j += 1) gain[i + j] = g;
  }
  let prev = 1;
  for (let i = 0; i < samples.length; i += 1) {
    prev += (gain[i] - prev) * 0.08;
    samples[i] *= prev;
  }
}

function matchPeak(out, original) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < out.length; i += 1) {
    a = Math.max(a, Math.abs(original[i]));
    b = Math.max(b, Math.abs(out[i]));
  }
  if (b < 1e-8) return;
  const scale = Math.min(0.98, (a * 0.92) / b);
  for (let i = 0; i < out.length; i += 1) out[i] *= scale;
}

export function cloneAudioBuffer(buffer) {
  const audio = getAudioContext();
  const out = audio.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    out.getChannelData(ch).set(buffer.getChannelData(ch));
  }
  return out;
}

export async function isolateVoice(buffer, onProgress) {
  const sr = buffer.sampleRate;
  const input = mixCenter(buffer);
  const fftSize = 2048;
  const hop = 512;
  const bins = fftSize / 2;
  const window = hann(fftSize);
  const frameCount = 1 + Math.max(0, Math.ceil((input.length - fftSize) / hop));
  const mag2Frames = new Array(frameCount);
  const reFrames = new Array(frameCount);
  const imFrames = new Array(frameCount);
  const energy = new Float32Array(frameCount);

  onProgress?.("Listening for voice vs noise…");
  for (let f = 0; f < frameCount; f += 1) {
    const start = f * hop;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i += 1) {
      re[i] = (input[start + i] || 0) * window[i];
    }
    fft(re, im, false);
    const mag2 = new Float32Array(bins + 1);
    let e = 0;
    for (let k = 0; k <= bins; k += 1) {
      const p = re[k] * re[k] + im[k] * im[k];
      mag2[k] = p;
      e += p;
    }
    mag2Frames[f] = mag2;
    reFrames[f] = re;
    imFrames[f] = im;
    energy[f] = e;
    if (f % 48 === 0) await yieldToUi();
  }

  const noiseCut = percentile(energy, 0.16);
  const noise = new Float32Array(bins + 1);
  let noiseCount = 0;
  for (let f = 0; f < frameCount; f += 1) {
    if (energy[f] <= noiseCut * 1.2) {
      const mag2 = mag2Frames[f];
      for (let k = 0; k <= bins; k += 1) noise[k] += mag2[k];
      noiseCount += 1;
    }
  }
  if (!noiseCount) {
    const order = [...energy.keys()].sort((a, b) => energy[a] - energy[b]).slice(0, Math.max(1, Math.floor(frameCount * 0.1)));
    for (const f of order) {
      const mag2 = mag2Frames[f];
      for (let k = 0; k <= bins; k += 1) noise[k] += mag2[k];
      noiseCount += 1;
    }
  }
  for (let k = 0; k <= bins; k += 1) noise[k] /= noiseCount;
  smooth(noise, 2);

  const hz = sr / fftSize;
  const voiceLo = Math.max(1, Math.floor(85 / hz));
  const voiceHi = Math.min(bins, Math.floor(4200 / hz));
  const keepHi = Math.min(bins, Math.floor(7800 / hz));

  onProgress?.("Pulling the voice forward…");
  for (let f = 0; f < frameCount; f += 1) {
    const mag2 = mag2Frames[f];
    const re = reFrames[f];
    const im = imFrames[f];
    const flat = spectralFlatness(mag2, voiceLo, voiceHi);
    const speech = 1 - Math.min(1, Math.max(0, (flat - 0.12) / 0.5));
    for (let k = 0; k <= bins; k += 1) {
      const n = noise[k] * 2.1;
      const y = mag2[k];
      let g = y / (y + n + 1e-12);
      g *= g;
      if (k < voiceLo || k > keepHi) g *= 0.05;
      else if (k > voiceHi) g *= 0.28;
      g *= 0.18 + 0.82 * speech;
      g = Math.max(0.003, Math.min(1, g));
      re[k] *= g;
      im[k] *= g;
      if (k > 0 && k < bins) {
        re[fftSize - k] = re[k];
        im[fftSize - k] = -im[k];
      }
    }
    if (f % 48 === 0) await yieldToUi();
  }

  const ola = new Float32Array(frameCount * hop + fftSize);
  const norm = new Float32Array(ola.length);
  for (let f = 0; f < frameCount; f += 1) {
    const re = reFrames[f];
    const im = imFrames[f];
    fft(re, im, true);
    const start = f * hop;
    for (let i = 0; i < fftSize; i += 1) {
      ola[start + i] += re[i] * window[i];
      norm[start + i] += window[i] * window[i];
    }
  }
  const out = new Float32Array(input.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = ola[i] / Math.max(1e-8, norm[i]);
  }
  gate(out, sr);
  matchPeak(out, input);

  const audio = getAudioContext();
  const result = audio.createBuffer(1, out.length, sr);
  result.getChannelData(0).set(out);
  return result;
}
