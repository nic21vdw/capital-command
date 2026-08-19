import type { LongformProject } from "@/lib/longform/types";
import type { QueueItem } from "@/lib/publisher/types";
import type { Carousel } from "@/types/domain";

/**
 * What is finished but not booked.
 *
 * A day's summary says what goes out; on its own it never says what COULD go
 * out. Renders that finished and were never scheduled are invisible — a
 * long-form edit sits in its project and a rendered carousel deck sits on disk,
 * and nothing anywhere counts them. This is that count, worked out by asking
 * the queue what it already references rather than by trusting a flag.
 */

export type PrepItem = { id: string; title: string };

export type PrepInventory = {
  longform: {
    ready: number;
    scheduled: number;
    unscheduled: PrepItem[];
  };
  carousels: {
    rendered: number;
    scheduled: number;
    unscheduled: PrepItem[];
  };
};

function normalize(path: string): string {
  return path.split("\\").join("/").toLowerCase();
}

/** Every media path the queue already references, normalized for matching. */
export function queuedMediaPaths(items: QueueItem[]): string[] {
  const paths: string[] = [];
  for (const item of items) {
    if (item.clipPath) paths.push(normalize(item.clipPath));
    if (item.sourceClipPath) paths.push(normalize(item.sourceClipPath));
    for (const image of item.imagePaths ?? []) paths.push(normalize(image));
  }
  return paths;
}

/** True when some queued media path sits inside a folder named `id`. */
function isReferenced(paths: string[], id: string): boolean {
  const needle = `/${id.toLowerCase()}/`;
  return paths.some((path) => path.includes(needle));
}

export function buildPrepInventory(input: {
  queue: QueueItem[];
  projects: LongformProject[];
  /** Carousels whose slide deck is actually rendered on disk. */
  renderedCarousels: Carousel[];
}): PrepInventory {
  const paths = queuedMediaPaths(input.queue);

  const ready = input.projects.filter(
    (project) => project.status === "ready" && project.exports.some((record) => record.status === "done")
  );
  const longformUnscheduled = ready.filter((project) => !isReferenced(paths, project.id));

  const carouselsUnscheduled = input.renderedCarousels.filter(
    (carousel) => !isReferenced(paths, carousel.id)
  );

  return {
    longform: {
      ready: ready.length,
      scheduled: ready.length - longformUnscheduled.length,
      unscheduled: longformUnscheduled.map((project) => ({
        id: project.id,
        title: project.name || "Untitled edit"
      }))
    },
    carousels: {
      rendered: input.renderedCarousels.length,
      scheduled: input.renderedCarousels.length - carouselsUnscheduled.length,
      unscheduled: carouselsUnscheduled.map((carousel) => ({
        id: carousel.id,
        title: carousel.title || "Untitled carousel"
      }))
    }
  };
}
