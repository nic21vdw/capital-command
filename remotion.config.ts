import { Config } from "@remotion/cli/config";
import { remotionConcurrency, REMOTION_EXPORT } from "./src/lib/remotion/export";

// Config for the "Manhattan Column Buckling Explained" segment package.
// The entry point (src/remotion/index.ts) is auto-detected by the CLI.
Config.setVideoImageFormat(REMOTION_EXPORT.imageFormat);
Config.setScale(REMOTION_EXPORT.scale);
Config.setCrf(REMOTION_EXPORT.crf);
Config.setOverwriteOutput(true);
Config.setConcurrency(remotionConcurrency());
