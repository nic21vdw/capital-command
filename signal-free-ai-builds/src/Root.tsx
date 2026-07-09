import React from "react";
import { AbsoluteFill, Composition } from "remotion";
import { COLOR_BG, VIDEO } from "./theme";
import { Video, TOTAL_FRAMES, TIMELINE } from "./Video";
import { ColdOpenTitle } from "./scenes/ColdOpenTitle";
import { CommentCTA } from "./scenes/CommentCTA";
import { EndCard } from "./scenes/EndCard";
import { SeriesLogo, SeriesLogoProps } from "./components/SeriesLogo";
import { LowerThird, LowerThirdProps } from "./components/LowerThird";

// Wrap a scene on the Signal background so standalone renders/previews aren't
// transparent. (For transparent overlays to composite in an external editor,
// render a scene with `--codec=prores` / a WebM alpha codec — see README.)
const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: COLOR_BG }}>{children}</AbsoluteFill>
);

/**
 * Registers the full launch video PLUS each scene as its own composition, so
 * individual inserts can be rendered separately for compositing.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="FreeAIBuilds"
        component={Video}
        durationInFrames={TOTAL_FRAMES}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />

      {/* ---- Individual scenes (render standalone) ---- */}
      <Composition
        id="ColdOpenTitle"
        component={ColdOpenTitle}
        durationInFrames={TIMELINE.coldOpen.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="SeriesLogo"
        component={(props: SeriesLogoProps) => (
          <Stage>
            <SeriesLogo {...props} />
          </Stage>
        )}
        durationInFrames={TIMELINE.seriesLogo.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        defaultProps={{ title: "FREE AI BUILDS" } as SeriesLogoProps}
      />
      <Composition
        id="LowerThird"
        component={(props: LowerThirdProps) => (
          <Stage>
            <LowerThird {...props} />
          </Stage>
        )}
        durationInFrames={TIMELINE.lowerThirdA.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
        defaultProps={
          { name: "Nic Vandewetering", subtitle: "Structural Engineer, Building CoLateral" } as LowerThirdProps
        }
      />
      <Composition
        id="CommentCTA"
        component={() => (
          <Stage>
            <CommentCTA />
          </Stage>
        )}
        durationInFrames={TIMELINE.commentCta.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
      <Composition
        id="EndCard"
        component={() => (
          <Stage>
            <EndCard />
          </Stage>
        )}
        durationInFrames={TIMELINE.endCard.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />
    </>
  );
};
