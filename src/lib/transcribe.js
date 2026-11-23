import { resampleMono16k } from "./segments";

let pipelinePromise = null;

async function getPipeline(onProgress) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      return pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
        dtype: "q8",
        progress_callback: (data) => {
          if (!onProgress) return;
          if (data.status === "progress") {
            onProgress({
              stage: "download",
              message: `Downloading speech model… ${Math.round(data.progress || 0)}%`,
            });
          } else if (data.status === "ready") {
            onProgress({ stage: "ready", message: "Transcribing…" });
          }
        },
      });
    })();
  }
  return pipelinePromise;
}

export async function transcribeBuffer(audioBuffer, onProgress) {
  onProgress?.({ stage: "load", message: "Loading speech model…" });
  const asr = await getPipeline(onProgress);
  const audio = resampleMono16k(audioBuffer);
  onProgress?.({ stage: "run", message: "Transcribing quotes…" });
  const result = await asr(audio, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  return {
    text: String(result?.text || "").trim(),
    chunks: Array.isArray(result?.chunks) ? result.chunks : [],
  };
}
