import { Config } from "@remotion/cli/config";

// Config for the "Manhattan Column Buckling Explained" segment package.
// The entry point (src/remotion/index.ts) is auto-detected by the CLI.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(1);
