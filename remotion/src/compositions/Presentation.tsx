import React from "react";
import { Series } from "remotion";
import { z } from "zod";
import { TitleCard, titleCardSchema } from "./TitleCard";
import { BulletReveal, bulletRevealSchema } from "./BulletReveal";
import { StatCounter, statCounterSchema } from "./StatCounter";

// One ordered list of segments -> one continuous MP4. Each segment's
// animation restarts at its own start (Series.Sequence resets the frame
// clock), so it looks identical to the standalone renders — just joined.
const segmentSchema = z.discriminatedUnion("type", [
  titleCardSchema.extend({ type: z.literal("title") }),
  bulletRevealSchema.extend({ type: z.literal("bullets") }),
  statCounterSchema.extend({ type: z.literal("stat") }),
]);

export const presentationSchema = z.object({
  segments: z.array(segmentSchema),
});

export type PresentationProps = z.infer<typeof presentationSchema>;

export const Presentation: React.FC<PresentationProps> = ({ segments }) => {
  return (
    <Series>
      {segments.map((seg, i) => (
        <Series.Sequence key={i} durationInFrames={seg.durationInFrames}>
          {seg.type === "title" ? (
            <TitleCard {...seg} />
          ) : seg.type === "bullets" ? (
            <BulletReveal {...seg} />
          ) : (
            <StatCounter {...seg} />
          )}
        </Series.Sequence>
      ))}
    </Series>
  );
};

// Sum of every segment's length -> the whole video's duration.
export const presentationDuration = (props: PresentationProps): number =>
  props.segments.reduce((total, s) => total + s.durationInFrames, 0);
