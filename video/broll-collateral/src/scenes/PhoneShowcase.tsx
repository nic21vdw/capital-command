import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Stage";
import { PhoneFeed, PhoneFrame } from "../components/PhoneFrame";
import { FloatingScreen } from "../components/FloatingScreen";
import { clipFade, drift, enter, SPRING_HERO, SPRING_SMOOTH } from "../motion";
import { CLIP_FRAMES } from "../theme";

/**
 * "Phone Showcase" — vertical B-roll, 1080×1920.
 *
 * An iPhone rises into frame and pages through the shorts feed. The paging is
 * the point: each swipe is a separate critically-damped spring, so the feed
 * snaps and settles exactly like iOS paging rather than scrolling linearly.
 * Two desktop screens hang blurred behind it for depth.
 */
const SWIPES = [40, 74, 108]; // frames at which the feed pages

export const PhoneShowcase: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = clipFade(frame, CLIP_FRAMES);

  const present = enter(frame, fps, 0, SPRING_HERO);

  // Each swipe contributes a full page once its own spring fires.
  const offset = SWIPES.reduce((sum, at) => sum + enter(frame, fps, at, SPRING_SMOOTH), 0);

  return (
    <Stage tint="#6f97ff" shiftX={drift(frame, 150) * 16} shiftY={drift(frame, 150, 1.9) * 22}>
      <AbsoluteFill style={{ perspective: 1700, opacity: fade }}>
        <AbsoluteFill style={{ transformStyle: "preserve-3d" }}>
          {/* desktop screens behind, well out of focus */}
          <FloatingScreen
            variant="pipeline"
            scale={0.5}
            x={-90}
            y={-830 + drift(frame, 150, 0.5) * 20}
            z={-420}
            rotateX={12}
            rotateY={10}
            blur={6}
            opacity={present * 0.5}
            progress={0.8}
          />
          <FloatingScreen
            variant="clips"
            scale={0.46}
            x={70}
            y={850 + drift(frame, 150, 2.3) * 20}
            z={-460}
            rotateX={-12}
            rotateY={-9}
            blur={6.5}
            opacity={present * 0.42}
            progress={0.9}
          />

          <PhoneFrame
            // 1.5× fills the 1080×1920 frame; the phone is the subject here.
            scale={1.5 * (0.94 + 0.06 * present)}
            y={(1 - present) * 420 + drift(frame, 150) * 14}
            rotateY={-8 + drift(frame, 150, 1.1) * 2.5}
            rotateX={2}
            rotateZ={drift(frame, 150, 0.3) * 1.2}
            opacity={present}
          >
            <PhoneFeed offset={offset} />
          </PhoneFrame>
        </AbsoluteFill>
      </AbsoluteFill>
    </Stage>
  );
};
