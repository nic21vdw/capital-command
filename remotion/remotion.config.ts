// Remotion CLI config. Docs: https://www.remotion.dev/docs/config
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// H.264 MP4 drops cleanly into the Long-Form and Clips editors.
Config.setCodec("h264");
