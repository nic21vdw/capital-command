import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // ffmpeg-static resolves its binary path via __dirname, which breaks when
  // bundled — keep it external so the resolved path points at node_modules.
  // @huggingface/transformers ships native ONNX runtimes that must not be
  // bundled either; it powers local Whisper transcription of uploads.
  serverExternalPackages: ["ffmpeg-static", "@huggingface/transformers"]
};

export default nextConfig;
