import React from "react";
import { Composition, registerRoot } from "remotion";
import { PROJECTS, compositionId } from "../app/presentation/projects";

/**
 * Remotion entry point used by the server-side render API
 * (`/api/presentation/render`). It registers one <Composition> per Segment
 * Deck slide across every project, using the same slide list the in-app
 * viewer renders — so anything previewable in `deck.tsx` is exportable as an
 * MP4. Ids are namespaced by project via `compositionId`.
 */
const DeckRoot: React.FC = () => (
  <>
    {PROJECTS.flatMap((project) =>
      project.slides.map((slide) => (
        <Composition
          key={compositionId(project.id, slide.id)}
          id={compositionId(project.id, slide.id)}
          component={slide.component}
          durationInFrames={slide.durationInFrames}
          fps={project.format.fps}
          width={project.format.width}
          height={project.format.height}
        />
      ))
    )}
  </>
);

registerRoot(DeckRoot);
