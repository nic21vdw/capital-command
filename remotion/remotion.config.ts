import { Config } from "@remotion/cli/config";

/**
 * Render configuration for the Capital Command manifesto video.
 * See https://www.remotion.dev/docs/config
 */
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(null); // auto based on CPU cores
Config.setEntryPoint("./src/index.ts");

// High-quality output for a hero brand video.
Config.setCrf(16); // lower = higher quality (0-51 for H.264)
Config.setPixelFormat("yuv420p");
Config.setCodec("h264");
