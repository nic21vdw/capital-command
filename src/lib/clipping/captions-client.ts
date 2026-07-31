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
