import React from "react";
import { AbsoluteFill } from "remotion";
import { VIDEO as BUCKLING_VIDEO } from "../../remotion/theme";
import { TitleComp } from "../../remotion/compositions/TitleComp";
import { HeadlineComp } from "../../remotion/compositions/HeadlineComp";
import { ColumnVsBeamComp } from "../../remotion/compositions/ColumnVsBeamComp";
import { BucklingComp } from "../../remotion/compositions/BucklingComp";
import { CausesComp } from "../../remotion/compositions/CausesComp";
import { COLOR_BG as SIGNAL_BG, VIDEO as SIGNAL_VIDEO } from "../../../signal-free-ai-builds/src/theme";
import { ColdOpenTitle } from "../../../signal-free-ai-builds/src/scenes/ColdOpenTitle";
import { CommentCTA } from "../../../signal-free-ai-builds/src/scenes/CommentCTA";
import { EndCard } from "../../../signal-free-ai-builds/src/scenes/EndCard";
import { SeriesLogo } from "../../../signal-free-ai-builds/src/components/SeriesLogo";
import { LowerThird } from "../../../signal-free-ai-builds/src/components/LowerThird";
import { ColdOpenTitle as VibeColdOpenTitle } from "../../../video/vibe-coding-first-steps/src/scenes/ColdOpenTitle";
import { TierList as VibeTierList } from "../../../video/vibe-coding-first-steps/src/scenes/TierList";
import { TheMove as VibeTheMove } from "../../../video/vibe-coding-first-steps/src/scenes/TheMove";
import { ByTheWay as VibeByTheWay } from "../../../video/vibe-coding-first-steps/src/scenes/ByTheWay";
import { EndCard as VibeEndCard } from "../../../video/vibe-coding-first-steps/src/scenes/EndCard";

export type Slide = {
  id: string;
  title: string;
  note: string;
  component: React.FC;
  durationInFrames: number;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  format: { width: number; height: number; fps: number };
  slides: Slide[];
};

// Overlay scenes (logo, lower third, CTA, end card) render transparent on
// their own — stage them on the series background like the Remotion Root does.
const onSignalStage = (Scene: React.FC): React.FC =>
  function Staged() {
    return (
      <AbsoluteFill style={{ backgroundColor: SIGNAL_BG }}>
        <Scene />
      </AbsoluteFill>
    );
  };

/**
 * Single source of truth for the Segment Deck. Consumed by both the in-app
 * viewer (`deck.tsx`) and the server-side Remotion entry (`deck-entry.tsx`)
 * that renders downloadable MP4s — keep every slide here so a video can be
 * both previewed and exported without duplicating the list.
 */
export const PROJECTS: Project[] = [
  {
    id: "column-buckling",
    name: "Manhattan Column Buckling",
    description: "Explainer diagram segments · 1920×1080",
    format: BUCKLING_VIDEO,
    slides: [
      { id: "TitleComp", title: "Title", note: "Animated title reveal + lower third", component: TitleComp, durationInFrames: 4 * BUCKLING_VIDEO.fps },
      { id: "HeadlineComp", title: "Headlines", note: "“beam” struck through, “COLUMN” stamp", component: HeadlineComp, durationInFrames: 6 * BUCKLING_VIDEO.fps },
      { id: "ColumnVsBeamComp", title: "Column vs Beam", note: "Buckle vs sag, side by side", component: ColumnVsBeamComp, durationInFrames: 8 * BUCKLING_VIDEO.fps },
      { id: "BucklingComp", title: "Euler Buckling", note: "Straight, then S-curve past P_cr", component: BucklingComp, durationInFrames: 6 * BUCKLING_VIDEO.fps },
      { id: "CausesComp", title: "Four Causes", note: "Sequenced cause cards, 3s each", component: CausesComp, durationInFrames: 12 * BUCKLING_VIDEO.fps }
    ]
  },
  {
    id: "free-ai-builds",
    name: "Free AI Builds",
    description: "Signal series inserts · 1080×1920 vertical",
    format: SIGNAL_VIDEO,
    slides: [
      { id: "ColdOpenTitle", title: "Cold Open Title", note: "3s wordmark reveal over glow pulse", component: ColdOpenTitle, durationInFrames: 90 },
      { id: "SeriesLogo", title: "Series Logo", note: "2s spark mark + wordmark card", component: onSignalStage(() => <SeriesLogo />), durationInFrames: 60 },
      {
        id: "LowerThird",
        title: "Lower Third",
        note: "Reusable name/title slide-in card",
        component: onSignalStage(() => <LowerThird name="Nic Vandewetering" subtitle="Structural Engineer, Building CoLateral" />),
        durationInFrames: 100
      },
      { id: "CommentCTA", title: "Comment CTA", note: "4s comment call-to-action", component: onSignalStage(CommentCTA), durationInFrames: 120 },
      { id: "EndCard", title: "End Card", note: "3s series end card", component: onSignalStage(EndCard), durationInFrames: 90 }
    ]
  },
  {
    id: "vibe-coding-first-steps",
    name: "Vibe Coding: First Steps",
    description: "Vibe Coding series, episode 1 · 1080×1920 vertical",
    format: { width: 1080, height: 1920, fps: 30 },
    slides: [
      { id: "ColdOpenTitle", title: "Cold Open Title", note: "“How to start vibe coding — in the simplest terms”", component: VibeColdOpenTitle, durationInFrames: 90 },
      { id: "TierList", title: "Tier List", note: "Gemini BAD · ChatGPT OKAY · Claude GOOD", component: VibeTierList, durationInFrames: 210 },
      { id: "TheMove", title: "The Move", note: "“Buy the $20 account” → GOOD", component: VibeTheMove, durationInFrames: 120 },
      { id: "ByTheWay", title: "By The Way", note: "“You don’t need to know how to code” → GOOD", component: VibeByTheWay, durationInFrames: 120 },
      { id: "EndCard", title: "End Card", note: "“That’s step 1” → next: your first prompt", component: VibeEndCard, durationInFrames: 120 }
    ]
  }
];

/**
 * Stable, Remotion-safe composition id for a slide. Slide ids repeat across
 * projects (e.g. "EndCard"), so namespace them by project. Must match what
 * `deck-entry.tsx` registers and what the render API selects.
 */
export const compositionId = (projectId: string, slideId: string) => `${projectId}--${slideId}`;
