import React from "react";
import { Composition } from "remotion";
import { TitleCard, titleCardSchema } from "./compositions/TitleCard";
import { BulletReveal, bulletRevealSchema } from "./compositions/BulletReveal";
import { StatCounter, statCounterSchema } from "./compositions/StatCounter";
import {
  Presentation,
  presentationSchema,
  presentationDuration,
} from "./compositions/Presentation";

// A full video is just an ordered list of segments. Edit this array (or pass
// --props) to change the whole thing; each segment's `durationInFrames` sets
// how long it holds so you can talk over it.
const fable5Ocean = {
  segments: [
    {
      type: "title" as const,
      title: "Fable 5 is back",
      subtitle: "What Anthropic's relaunch means for coders",
      theme: "ocean" as const,
      durationInFrames: 150,
    },
    {
      type: "bullets" as const,
      heading: "What actually happened",
      bullets: [
        "Jun 9 — Fable 5 goes public",
        "Jun 12 — pulled under export controls",
        "Jul 1 — controls lifted, worldwide GA",
      ],
      stagger: 60,
      theme: "ocean" as const,
      durationInFrames: 540,
    },
    {
      type: "stat" as const,
      label: "Fable 5 · SWE-Bench Pro (coding)",
      value: 80.3,
      prefix: "",
      suffix: "%",
      decimals: 1,
      theme: "ocean" as const,
      durationInFrames: 300,
    },
    {
      type: "bullets" as const,
      heading: "The pressure on GPT-5.6",
      bullets: [
        "GPT-5.6: limited preview, vetted orgs only",
        "Fable 5: worldwide, generally available",
        "Access beats benchmarks if you can't log in",
      ],
      stagger: 60,
      theme: "ocean" as const,
      durationInFrames: 540,
    },
    {
      type: "bullets" as const,
      heading: "The catch for coders (now Jul 12)",
      bullets: [
        "Included window extended: Jul 7 → Jul 12",
        "Pro/Max: up to 50% of weekly limits",
        "After that: pay-per-token usage credits",
      ],
      stagger: 60,
      theme: "ocean" as const,
      durationInFrames: 540,
    },
    {
      type: "stat" as const,
      label: "Fable 5 output · usage-credit rate",
      value: 50,
      prefix: "$",
      suffix: " / 1M",
      decimals: 0,
      theme: "ocean" as const,
      durationInFrames: 300,
    },
  ],
};

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
      <Composition
        id="Presentation"
        component={Presentation}
        fps={30}
        width={1920}
        height={1080}
        schema={presentationSchema}
        calculateMetadata={({ props }) => ({
          durationInFrames: presentationDuration(props),
        })}
        defaultProps={fable5Ocean}
      />
    </>
  );
};
