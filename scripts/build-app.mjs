import { spawnSync } from "node:child_process";
import { join } from "node:path";

const env = { ...process.env, NODE_ENV: "production" };
delete env.TURBOPACK;
delete env.NEXT_PHASE;
delete env.NEXT_RUNTIME;

const result = spawnSync(process.execPath, [join(process.cwd(), "node_modules/next/dist/bin/next"), "build", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
  windowsHide: true
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
