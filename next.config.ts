import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so Next.js doesn't get confused by
  // stray lockfiles elsewhere on the machine (e.g. in the user's home folder).
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
