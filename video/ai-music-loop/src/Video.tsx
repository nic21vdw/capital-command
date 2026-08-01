import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import manifest from "./track-manifest.json";
import { TrackScene } from "./TrackScene";

export type SingleTrackProps = {
  trackIndex: number;
};

export const SingleTrackVideo: React.FC<SingleTrackProps> = ({
  trackIndex,
}) => {
  const track =
    manifest.tracks[
      Math.max(0, Math.min(manifest.tracks.length - 1, trackIndex))
    ];

  return (
    <AbsoluteFill>
      <TrackScene file={track.file} title={track.title} playAudio />
    </AbsoluteFill>
  );
};

export type PlaylistProps = {
  fromTrack?: number;
  trackCount?: number;
};

export const PlaylistVideo: React.FC<PlaylistProps> = ({
  fromTrack = 0,
  trackCount,
}) => {
  const start = Math.max(0, fromTrack);
  const end =
    trackCount == null
      ? manifest.tracks.length
      : Math.min(manifest.tracks.length, start + trackCount);
  const slice = manifest.tracks.slice(start, end);

  let cursor = 0;

  return (
    <AbsoluteFill>
      {slice.map((track) => {
        const from = cursor;
        cursor += track.frames;
        return (
          <Sequence
            key={track.file}
            from={from}
            durationInFrames={track.frames}
            name={track.title}
          >
            <TrackScene file={track.file} title={track.title} playAudio />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const Video = SingleTrackVideo;
