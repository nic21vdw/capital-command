import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Next.js doesn't get confused by
  // stray lockfiles elsewhere on the machine (e.g. in the user's home folder).
  outputFileTracingRoot: projectRoot,
  // ffmpeg-static resolves its binary path via __dirname, which breaks when
  // bundled — keep it external so the resolved path points at node_modules.
  // @huggingface/transformers ships native ONNX runtimes that must not be
  // bundled either; it powers local Whisper transcription of uploads.
  serverExternalPackages: ["ffmpeg-static", "@huggingface/transformers"],
  // Keep the ONNX runtimes (~250 MB across platforms) out of serverless
  // bundles: they blow past Vercel's function size limit. Local dev and
  // `next start` (where clipping actually runs) load them from node_modules
  // directly, so transcription is unaffected.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@huggingface/transformers/**",
      "node_modules/onnxruntime-node/**",
      "node_modules/onnxruntime-web/**"
    ]
  }
};

export default nextConfig;
