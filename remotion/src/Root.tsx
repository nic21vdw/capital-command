import React from "react";
import { Composition } from "remotion";
import { TitleCard, titleCardSchema } from "./compositions/TitleCard";
import { BulletReveal, bulletRevealSchema } from "./compositions/BulletReveal";
import { StatCounter, statCounterSchema } from "./compositions/StatCounter";

// Everything is 1080p @ 30fps so segments drop straight into the editors.
// Length is driven by each segment's `durationInFrames` prop (seconds × 30),
// so Claude — or you, in Studio — controls it per render without a CLI flag.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TitleCard"
        component={TitleCard}
        fps={30}
        width={1920}
        height={1080}
        schema={titleCardSchema}
        calculateMetadata={({ props }) => ({
          durationInFrames: props.durationInFrames,
        })}
        defaultProps={{
          title: "How I automate my content",
          subtitle: "Built with CoLateral Command",
          theme: "lime" as const,
          durationInFrames: 120,
        }}
      />
      <Composition
        id="BulletReveal"
        component={BulletReveal}
        fps={30}
        width={1920}
        height={1080}
        schema={bulletRevealSchema}
        calculateMetadata={({ props }) => ({
          durationInFrames: props.durationInFrames,
        })}
        defaultProps={{
          heading: "Three things nobody tells you",
          bullets: [
            "Record once, reuse everywhere",
            "Let the agent build the visuals",
            "Compounding beats intensity",
          ],
          stagger: 45,
          theme: "violet" as const,
          durationInFrames: 240,
        }}
      />
      <Composition
        id="StatCounter"
        component={StatCounter}
        fps={30}
        width={1920}
        height={1080}
        schema={statCounterSchema}
        calculateMetadata={({ props }) => ({
          durationInFrames: props.durationInFrames,
        })}
        defaultProps={{
          label: "Monthly recurring revenue",
          value: 1240,
          prefix: "$",
          suffix: "",
          decimals: 0,
          theme: "ocean" as const,
          durationInFrames: 90,
        }}
      />
    </>
  );
};
