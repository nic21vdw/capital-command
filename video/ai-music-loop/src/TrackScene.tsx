import React from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { AmbientBackground } from "./components/AmbientBackground";
import { Equalizer } from "./components/Equalizer";
import { LightRays } from "./components/LightRays";
import { Particles } from "./components/Particles";
import { TitleLockup } from "./components/TitleLockup";
import { WaveRing } from "./components/WaveRing";
import { useAudioLevels } from "./useAudioLevels";

type Props = {
  file: string;
  title: string;
  playAudio?: boolean;
};

export const TrackScene: React.FC<Props> = ({
  file,
  title,
  playAudio = true,
}) => {
  const src = staticFile(`tracks/${file}`);
  const { bars, level, bass, mid, high } = useAudioLevels(src, 64);

  return (
    <AbsoluteFill>
      {playAudio ? <Audio src={src} /> : null}
      <AmbientBackground level={level} bass={bass} />
      <LightRays level={level} mid={mid} />
      <Particles level={level} high={high} />
      <WaveRing bars={bars} level={level} bass={bass} />
      <TitleLockup title={title} level={level} />
      <Equalizer bars={bars} />
    </AbsoluteFill>
  );
};
