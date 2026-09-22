// Remotion CLI config. Docs: https://www.remotion.dev/docs/config
import os from "node:os";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// H.264 MP4 drops cleanly into the Long-Form and Clips editors.
Config.setCodec("h264");
const cpus = os.cpus()?.length || 2;
Config.setConcurrency(Math.max(1, Math.min(8, cpus - 1)));
