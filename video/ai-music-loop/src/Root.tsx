import React from "react";
import { Composition } from "remotion";
import {
  PlaylistVideo,
  SingleTrackVideo,
  type PlaylistProps,
  type SingleTrackProps,
} from "./Video";
import { FPS } from "./theme";
import manifest from "./track-manifest.json";

const DEFAULT_TRACK = 3;

export const RemotionRoot: React.FC = () => {
  const defaultTrack = manifest.tracks[DEFAULT_TRACK];

  return (
    <>
      <Composition
        id="AiMusicTrack"
        component={SingleTrackVideo}
        durationInFrames={defaultTrack.frames}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ trackIndex: DEFAULT_TRACK } satisfies SingleTrackProps}
        calculateMetadata={({ props }) => {
          const track =
            manifest.tracks[
              Math.max(
                0,
                Math.min(manifest.tracks.length - 1, props.trackIndex),
              )
            ];
          return {
            durationInFrames: track.frames,
            props,
          };
        }}
      />

      <Composition
        id="AiMusicPlaylist"
        component={PlaylistVideo}
        durationInFrames={manifest.totalFrames}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={
          {
            fromTrack: 0,
            trackCount: 3,
          } satisfies PlaylistProps
        }
        calculateMetadata={({ props }) => {
          const start = Math.max(0, props.fromTrack ?? 0);
          const end =
            props.trackCount == null
              ? manifest.tracks.length
              : Math.min(manifest.tracks.length, start + props.trackCount);
          const frames = manifest.tracks
            .slice(start, end)
            .reduce((sum, track) => sum + track.frames, 0);
          return {
            durationInFrames: Math.max(1, frames),
            props,
          };
        }}
      />
    </>
  );
};
