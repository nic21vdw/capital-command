import { mkdir } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

const OPTIONS = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: "word" };

async function load() {
  const { env, pipeline } = await import("@huggingface/transformers");
  await mkdir(workerData.cacheDir, { recursive: true });
  env.cacheDir = workerData.cacheDir;
  return pipeline("automatic-speech-recognition", workerData.modelId, { dtype: "q8" });
}

let transcriber;

parentPort.on("message", async ({ id, pcm }) => {
  try {
    const result = await transcriber(new Float32Array(pcm), OPTIONS);
    parentPort.postMessage({ id, chunks: result.chunks ?? [] });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});

load().then(
  (loaded) => {
    transcriber = loaded;
    parentPort.postMessage({ ready: true });
  },
  (error) => {
    parentPort.postMessage({ ready: false, error: error instanceof Error ? error.message : String(error) });
  }
);
