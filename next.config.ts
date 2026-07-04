import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
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
