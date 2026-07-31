import React from "react";
import { Composition } from "remotion";
import { FloatingScreens } from "./scenes/FloatingScreens";
import { CardShuffle } from "./scenes/CardShuffle";
import { DepthDolly } from "./scenes/DepthDolly";
import { PipelineFlow } from "./scenes/PipelineFlow";
import { ClipGridPop } from "./scenes/ClipGridPop";
import { CalendarFill } from "./scenes/CalendarFill";
import { PhoneShowcase } from "./scenes/PhoneShowcase";
import { VerticalStack } from "./scenes/VerticalStack";
import { GlassMetrics } from "./scenes/GlassMetrics";
import { WordmarkAmbient } from "./scenes/WordmarkAmbient";
import { CLIP_FRAMES, VIDEO, VIDEO_VERTICAL } from "./theme";

/**
 * B-roll library for CoLateral advertising collateral — ten interchangeable
 * 5-second clips (150 frames @ 30fps) of the product moving, with iOS motion
 * throughout. Every clip fades in and out at its own edges, so any two cut
 * together without a flash.
 *
 *   Floating UI    FloatingScreens · CardShuffle · DepthDolly       16:9
 *   Product Tour   PipelineFlow · ClipGridPop · CalendarFill        16:9
 *   Vertical Cuts  PhoneShowcase · VerticalStack                    9:16
 *   Brand Atmos    GlassMetrics · WordmarkAmbient                   16:9
 *
 * These same scenes are wired into the app's Segment Deck
 * (`src/app/presentation/projects.tsx`), which is where they get previewed and
 * exported as MP4s day to day; this Root is for `npm run preview` here.
 */
export const RemotionRoot: React.FC = () => {
  const wide = { durationInFrames: CLIP_FRAMES, fps: VIDEO.fps, width: VIDEO.width, height: VIDEO.height } as const;
  const tall = {
    durationInFrames: CLIP_FRAMES,
    fps: VIDEO_VERTICAL.fps,
    width: VIDEO_VERTICAL.width,
    height: VIDEO_VERTICAL.height,
  } as const;

  return (
    <>
      <Composition id="FloatingScreens" component={FloatingScreens} {...wide} />
      <Composition id="CardShuffle" component={CardShuffle} {...wide} />
      <Composition id="DepthDolly" component={DepthDolly} {...wide} />
      <Composition id="PipelineFlow" component={PipelineFlow} {...wide} />
      <Composition id="ClipGridPop" component={ClipGridPop} {...wide} />
      <Composition id="CalendarFill" component={CalendarFill} {...wide} />
      <Composition id="GlassMetrics" component={GlassMetrics} {...wide} />
      <Composition id="WordmarkAmbient" component={WordmarkAmbient} {...wide} />
      <Composition id="PhoneShowcase" component={PhoneShowcase} {...tall} />
      <Composition id="VerticalStack" component={VerticalStack} {...tall} />
    </>
  );
};
