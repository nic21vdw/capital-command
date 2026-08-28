import React from "react";

/**
 * Whose name goes on the lower third of these decks. It was one person's,
 * written into the scene, so anyone rendering this deck introduced him. There
 * is no settings read here - this file is a static catalogue of demo projects
 * that Remotion bundles at build time - so it is a constant that says plainly
 * that it is a placeholder rather than a constant that says a name.
 */
const PRESENTER = { name: "Presenter", subtitle: "Your title here" };

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
import { ColdOpenHook as AirColdOpenHook } from "../../../video/ai-industrial-revolution/src/scenes/ColdOpenHook";
import { ThenVsNow as AirThenVsNow } from "../../../video/ai-industrial-revolution/src/scenes/ThenVsNow";
import { StepOne as AirStepOne } from "../../../video/ai-industrial-revolution/src/scenes/StepOne";
import { ModelPicker as AirModelPicker } from "../../../video/ai-industrial-revolution/src/scenes/ModelPicker";
import { EndCard as AirEndCard } from "../../../video/ai-industrial-revolution/src/scenes/EndCard";
import { VIDEO as CLAUDE_TRAILER_VIDEO } from "../../../video/claude-trailer/src/theme";
import { LogoReveal as ClaudeLogoReveal } from "../../../video/claude-trailer/src/scenes/LogoReveal";
import { HardestProblems as ClaudeHardestProblems } from "../../../video/claude-trailer/src/scenes/HardestProblems";
import { Capabilities as ClaudeCapabilities } from "../../../video/claude-trailer/src/scenes/Capabilities";
import { Momentum as ClaudeMomentum } from "../../../video/claude-trailer/src/scenes/Momentum";
import { EndCard as ClaudeEndCard } from "../../../video/claude-trailer/src/scenes/EndCard";
import { VIDEO as COLATERAL_INTRO_VIDEO } from "../../../video/colateral-intro/src/theme";
import { VIDEO as BROLL_VIDEO, VIDEO_VERTICAL as BROLL_VIDEO_VERTICAL, CLIP_FRAMES as BROLL_FRAMES } from "../../../video/broll-collateral/src/theme";
import { FloatingScreens as BrollFloatingScreens } from "../../../video/broll-collateral/src/scenes/FloatingScreens";
import { CardShuffle as BrollCardShuffle } from "../../../video/broll-collateral/src/scenes/CardShuffle";
import { DepthDolly as BrollDepthDolly } from "../../../video/broll-collateral/src/scenes/DepthDolly";
import { PipelineFlow as BrollPipelineFlow } from "../../../video/broll-collateral/src/scenes/PipelineFlow";
import { ClipGridPop as BrollClipGridPop } from "../../../video/broll-collateral/src/scenes/ClipGridPop";
import { CalendarFill as BrollCalendarFill } from "../../../video/broll-collateral/src/scenes/CalendarFill";
import { PhoneShowcase as BrollPhoneShowcase } from "../../../video/broll-collateral/src/scenes/PhoneShowcase";
import { VerticalStack as BrollVerticalStack } from "../../../video/broll-collateral/src/scenes/VerticalStack";
import { GlassMetrics as BrollGlassMetrics } from "../../../video/broll-collateral/src/scenes/GlassMetrics";
import { WordmarkAmbient as BrollWordmarkAmbient } from "../../../video/broll-collateral/src/scenes/WordmarkAmbient";
import { RevealDraftingTable as ColateralRevealDraftingTable } from "../../../video/colateral-intro/src/scenes/RevealDraftingTable";
import { RevealLoadPath as ColateralRevealLoadPath } from "../../../video/colateral-intro/src/scenes/RevealLoadPath";
import { RevealBeamyEntrance as ColateralRevealBeamyEntrance } from "../../../video/colateral-intro/src/scenes/RevealBeamyEntrance";
import { RevealCanvasSpawn as ColateralRevealCanvasSpawn } from "../../../video/colateral-intro/src/scenes/RevealCanvasSpawn";
import { RevealTypeset as ColateralRevealTypeset } from "../../../video/colateral-intro/src/scenes/RevealTypeset";

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
  /**
   * Optional section heading in the deck's project picker. Projects with the
   * same group are listed together under it; ungrouped projects fall under
   * "Videos". Purely presentational — nothing in the render path reads it.
   */
  group?: string;
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
        component: onSignalStage(() => <LowerThird name={PRESENTER.name} subtitle={PRESENTER.subtitle} />),
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
  },
  {
    id: "ai-industrial-revolution",
    name: "AI: The New Industrial Revolution",
    description: "Series hook/intro · 1080×1920 vertical",
    format: { width: 1080, height: 1920, fps: 30 },
    slides: [
      { id: "ColdOpenHook", title: "Cold Open Hook", note: "“AI is the new industrial revolution — of modern times”", component: AirColdOpenHook, durationInFrames: 90 },
      { id: "ThenVsNow", title: "Then vs Now", note: "1800s steam vs today’s AI — same shift, new century", component: AirThenVsNow, durationInFrames: 180 },
      { id: "StepOne", title: "Step 1", note: "“Choose the right model” — the one instruction", component: AirStepOne, durationInFrames: 150 },
      { id: "ModelPicker", title: "Model Picker", note: "Match the model to the job: fast · balanced · big brain", component: AirModelPicker, durationInFrames: 210 },
      { id: "EndCard", title: "End Card", note: "“That’s step 1” → next: put it to work", component: AirEndCard, durationInFrames: 120 }
    ]
  },
  {
    id: "claude-trailer",
    name: "Claude Trailer",
    description: "20s voiceover bed · 1920×1080 · Anthropic palette + starburst mark",
    format: CLAUDE_TRAILER_VIDEO,
    slides: [
      { id: "LogoReveal", title: "Logo Reveal", note: "Starburst spins up with pulse rings → Claude wordmark", component: ClaudeLogoReveal, durationInFrames: 120 },
      { id: "HardestProblems", title: "Hardest Problems", note: "“BUILT FOR THE HARDEST PROBLEMS”, word by word", component: ClaudeHardestProblems, durationInFrames: 140 },
      { id: "Capabilities", title: "Capabilities", note: "1M context · frontier reasoning · agentic cards", component: ClaudeCapabilities, durationInFrames: 160 },
      { id: "Momentum", title: "Momentum", note: "“Think deeper. Ship faster.” + spark comet sweep", component: ClaudeMomentum, durationInFrames: 90 },
      { id: "EndCard", title: "End Card", note: "Pulsing spark + wordmark → claude.ai", component: ClaudeEndCard, durationInFrames: 90 }
    ]
  },
  {
    id: "colateral-intro",
    name: "CoLateral Intro",
    description: "Name-reveal intro cards on the live product's dark stage · CoLateral purple + Beamy · 1920×1080",
    format: COLATERAL_INTRO_VIDEO,
    slides: [
      { id: "RevealDraftingTable", title: "Drafting Table", note: "Logo draws on like a CAD line, letters spawn, Beamy walks in and waves — calm/premium", component: ColateralRevealDraftingTable, durationInFrames: 180 },
      { id: "RevealLoadPath", title: "Load Path", note: "Loads drop, the beam deflects, the moment diagram traces, then it snaps straight into the wordmark — structural", component: ColateralRevealLoadPath, durationInFrames: 180 },
      { id: "RevealBeamyEntrance", title: "Beamy's Entrance", note: "Beamy dances a 4-beat loop while letters spawn on the beat — playful", component: ColateralRevealBeamyEntrance, durationInFrames: 180 },
      { id: "RevealCanvasSpawn", title: "Canvas Spawn", note: "Real tool cards spawn and link across the canvas, then converge into the mark — product-led", component: ColateralRevealCanvasSpawn, durationInFrames: 195 },
      { id: "RevealTypeset", title: "Typeset", note: "The live hero, animated — kerning settle, Beamy perched beside the mark — minimal/corporate", component: ColateralRevealTypeset, durationInFrames: 180 }
    ]
  },
  // ---------------------------------------------------------------------
  // B-roll library (`video/broll-collateral`). Ten interchangeable 5s clips
  // of the product itself — real CoLateral Command screens, drawn rather than
  // screenshotted so they never go stale, floating on iOS motion. Grouped into
  // four decks by what the footage is FOR, not by which file it lives in.
  // ---------------------------------------------------------------------
  {
    id: "broll-floating-ui",
    group: "B-Roll Library",
    name: "B-Roll · Floating UI",
    description: "Product screens floating in 3D with depth of field · 5s each · 1920×1080",
    format: BROLL_VIDEO,
    slides: [
      { id: "FloatingScreens", title: "Floating Screens", note: "Five screens drift at different depths, hero sharp in the middle", component: BrollFloatingScreens, durationInFrames: BROLL_FRAMES },
      { id: "CardShuffle", title: "Card Shuffle", note: "iOS app-switcher fan-out, hold, and settle back to the deck", component: BrollCardShuffle, durationInFrames: BROLL_FRAMES },
      { id: "DepthDolly", title: "Depth Dolly", note: "Lateral camera glide past a wall of screens — true perspective parallax", component: BrollDepthDolly, durationInFrames: BROLL_FRAMES }
    ]
  },
  {
    id: "broll-product-tour",
    group: "B-Roll Library",
    name: "B-Roll · Product Tour",
    description: "The app doing its job: fan-out, clips, scheduling · 5s each · 1920×1080",
    format: BROLL_VIDEO,
    slides: [
      { id: "PipelineFlow", title: "Pipeline Flow", note: "Stream Pipeline presents like a sheet, formats fly out as glass pills", component: BrollPipelineFlow, durationInFrames: BROLL_FRAMES },
      { id: "ClipGridPop", title: "Clip Grid Pop", note: "Finished 9:16 shorts lift out of the Clip Generator toward camera", component: BrollClipGridPop, durationInFrames: BROLL_FRAMES },
      { id: "CalendarFill", title: "Calendar Fill", note: "A month fills in, then an iOS sheet confirms 72 posts across 4 channels", component: BrollCalendarFill, durationInFrames: BROLL_FRAMES }
    ]
  },
  {
    id: "broll-vertical",
    group: "B-Roll Library",
    name: "B-Roll · Vertical Cuts",
    description: "Shorts / Reels / TikTok inserts · 5s each · 1080×1920 vertical",
    format: BROLL_VIDEO_VERTICAL,
    slides: [
      { id: "PhoneShowcase", title: "Phone Showcase", note: "iPhone rises in and pages the shorts feed with real iOS paging springs", component: BrollPhoneShowcase, durationInFrames: BROLL_FRAMES },
      { id: "VerticalStack", title: "Vertical Stack", note: "A column of screens climbs the frame, sharp only in the middle band", component: BrollVerticalStack, durationInFrames: BROLL_FRAMES }
    ]
  },
  {
    id: "broll-brand-atmos",
    group: "B-Roll Library",
    name: "B-Roll · Brand Atmos",
    description: "Claim tiles and the wordmark bookend · 5s each · 1920×1080",
    format: BROLL_VIDEO,
    slides: [
      { id: "GlassMetrics", title: "Glass Metrics", note: "Frosted tiles count up over out-of-focus product footage", component: BrollGlassMetrics, durationInFrames: BROLL_FRAMES },
      { id: "WordmarkAmbient", title: "Wordmark Ambient", note: "CoLateral resolves out of a blur — “One stream in. Every format out.”", component: BrollWordmarkAmbient, durationInFrames: BROLL_FRAMES }
    ]
  }
];

/**
 * Stable, Remotion-safe composition id for a slide. Slide ids repeat across
 * projects (e.g. "EndCard"), so namespace them by project. Must match what
 * `deck-entry.tsx` registers and what the render API selects.
 */
export const compositionId = (projectId: string, slideId: string) => `${projectId}--${slideId}`;
