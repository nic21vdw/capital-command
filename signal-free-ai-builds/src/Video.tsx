import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { COLOR_BG } from "./theme";
import { ColdOpenTitle } from "./scenes/ColdOpenTitle";
import { CommentCTA } from "./scenes/CommentCTA";
import { EndCard } from "./scenes/EndCard";
import { SeriesLogo } from "./components/SeriesLogo";
import { LowerThird } from "./components/LowerThird";

/**
 * Timeline for the "Free AI Builds" launch video.
 *
 * These are INSERT graphics — in the real edit most of the runtime is
 * direct-to-camera footage, and each scene below gets dropped onto its own
 * point in the timeline. The `from`/`durationInFrames` values here just space
 * everything out with gaps so you can preview all scenes in one pass.
 *
 * To match your final edit, change a scene's `from` (start frame) below — see
 * README.md. Each <Sequence> is independent; they do NOT need to be adjacent.
 */
export const TIMELINE = {
  coldOpen: { from: 0, durationInFrames: 90 }, // 3s
  seriesLogo: { from: 110, durationInFrames: 60 }, // 2s
  lowerThirdA: { from: 190, durationInFrames: 100 },
  lowerThirdB: { from: 305, durationInFrames: 100 },
  commentCta: { from: 410, durationInFrames: 120 }, // 4s, last CTA before end card
  endCard: { from: 530, durationInFrames: 90 } // 3s, final scene
} as const;

export const TOTAL_FRAMES = 620;

export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR_BG }}>
      <Sequence name="ColdOpenTitle" {...TIMELINE.coldOpen}>
        <ColdOpenTitle />
      </Sequence>

      <Sequence name="SeriesLogo" {...TIMELINE.seriesLogo}>
        <SeriesLogo title="FREE AI BUILDS" />
      </Sequence>

      {/* Two LowerThird instances with DIFFERENT props — proof the component is
          reusable/parameterised for future episodes. */}
      <Sequence name="LowerThird — Nic" {...TIMELINE.lowerThirdA}>
        <LowerThird name="Nic Vandewetering" subtitle="Structural Engineer, Building CoLateral" />
      </Sequence>

      <Sequence name="LowerThird — reuse demo" {...TIMELINE.lowerThirdB}>
        <LowerThird name="Guest Name" subtitle="Their Title Here" />
      </Sequence>

      <Sequence name="CommentCTA" {...TIMELINE.commentCta}>
        <CommentCTA />
      </Sequence>

      <Sequence name="EndCard" {...TIMELINE.endCard}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
