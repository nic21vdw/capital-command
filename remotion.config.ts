import os from "node:os";
import { Config } from "@remotion/cli/config";

// Config for the "Manhattan Column Buckling Explained" segment package.
// The entry point (src/remotion/index.ts) is auto-detected by the CLI.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Parallel frame rendering: leave one core free, cap at 8. Was hard-coded to 1.
const cpus = os.cpus()?.length || 2;
Config.setConcurrency(Math.max(1, Math.min(8, cpus - 1)));
