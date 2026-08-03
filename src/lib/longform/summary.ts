import { editedDurationSec } from "@/lib/longform/plan";
import type { LongformProject } from "@/lib/longform/types";

/**
 * A project as the studio's project list needs it. The four fields left out —
 * the transcript, the detected silences, the segment plan and the caption
 * track — are almost the whole weight of a project (25 of them come to 6.4 MB,
 * of which 6.35 MB is those four), and the list draws none of them: the only
 * thing it wanted from `segments` was the edited runtime, which comes along
 * here as a number.
 *
 * Opening one in the editor fetches the whole project from
 * `/api/longform/projects/<id>`.
 */
export type LongformProjectSummary = Omit<LongformProject, "transcript" | "silences" | "segments" | "captions"> & {
  /** Runtime of the edited video, or null while the plan is still being made. */
  editedDurationSec: number | null;
};

export function projectSummary(project: LongformProject): LongformProjectSummary {
  const summary: LongformProjectSummary & Partial<LongformProject> = {
    ...project,
    editedDurationSec: project.status === "ready" ? editedDurationSec(project.segments, project.hook) : null
  };
  delete summary.transcript;
  delete summary.silences;
  delete summary.segments;
  delete summary.captions;
  return summary;
}
