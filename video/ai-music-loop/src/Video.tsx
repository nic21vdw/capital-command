import React from "react";
import { AbsoluteFill } from "remotion";
import { AmbientBackground } from "./components/AmbientBackground";
import { Equalizer } from "./components/Equalizer";
import { LightRays } from "./components/LightRays";
import { Particles } from "./components/Particles";
import { TitleLockup } from "./components/TitleLockup";
import { WaveRing } from "./components/WaveRing";

export const Video: React.FC = () => {
  return (
    <AbsoluteFill>
      <AmbientBackground />
      <LightRays />
      <Particles />
      <WaveRing />
      <TitleLockup />
      <Equalizer />
    </AbsoluteFill>
  );
};
