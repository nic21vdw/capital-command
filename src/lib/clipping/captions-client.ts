import type { SilenceRange } from "@/lib/clipping/analysis";
import type { CaptionSegment } from "@/types/domain";

/**
 * One job's cached source captions. `/api/clips` deliberately omits them, so a
 * page that needs a transcript asks for the single job it is working on.
 */
export async function loadJobCaptions(jobId: string): Promise<CaptionSegment[]> {
  try {
    const response = await fetch(`/api/clips/${jobId}/captions`, { cache: "no-store" });
    if (!response.ok) return [];
    return ((await response.json()) as { captions?: CaptionSegment[] }).captions ?? [];
  } catch {
    return [];
  }
}

/**
 * One job's detected silence ranges. Omitted from `/api/clips` for the same
 * reason as the captions — they are most of a job's weight and only the clip
 * being opened needs them.
 */
export async function loadJobSilences(jobId: string): Promise<SilenceRange[]> {
  try {
    const response = await fetch(`/api/clips/${jobId}/silences`, { cache: "no-store" });
    if (!response.ok) return [];
    return ((await response.json()) as { silences?: SilenceRange[] }).silences ?? [];
  } catch {
    return [];
  }
}
