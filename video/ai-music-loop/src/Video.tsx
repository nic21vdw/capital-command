import React from "react";
import { AbsoluteFill } from "remotion";
import { AmbientBackground } from "./components/AmbientBackground";
import { Equalizer } from "./components/Equalizer";
import { FloorGrid } from "./components/FloorGrid";
import { LaserBeams } from "./components/LaserBeams";
import { Particles } from "./components/Particles";
import { Signature } from "./components/Signature";
import { TitleLockup } from "./components/TitleLockup";
import { WaveRing } from "./components/WaveRing";

export const Video: React.FC = () => {
  return (
    <AbsoluteFill>
      <AmbientBackground />
      <FloorGrid />
      <LaserBeams />
      <Particles />
      <WaveRing />
      <TitleLockup />
      <Equalizer />
      <Signature />
    </AbsoluteFill>
  );
};
