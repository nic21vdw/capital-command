import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // ffmpeg-static resolves its binary path via __dirname, which breaks when
  // bundled — keep it external so the resolved path points at node_modules.
  serverExternalPackages: ["ffmpeg-static"]
};

export default nextConfig;
