import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { useCurrentFrame, useVideoConfig } from "remotion";

export type AudioLevels = {
  bars: number[];
  level: number;
  bass: number;
  mid: number;
  high: number;
  ready: boolean;
};

const EMPTY: AudioLevels = {
  bars: Array.from({ length: 64 }, () => 0),
  level: 0,
  bass: 0,
  mid: 0,
  high: 0,
  ready: false,
};

export function useAudioLevels(
  src: string,
  numberOfSamples = 64,
): AudioLevels {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(src);

  if (!audioData) {
    return EMPTY;
  }

  const bars = visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples,
    optimizeFor: "speed",
  });

  const level =
    bars.reduce((sum, value) => sum + value, 0) / Math.max(bars.length, 1);
  const third = Math.floor(bars.length / 3);
  const avg = (slice: number[]) =>
    slice.reduce((sum, value) => sum + value, 0) / Math.max(slice.length, 1);

  return {
    bars,
    level,
    bass: avg(bars.slice(0, third)),
    mid: avg(bars.slice(third, third * 2)),
    high: avg(bars.slice(third * 2)),
    ready: true,
  };
}
