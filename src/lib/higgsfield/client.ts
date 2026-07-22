/**
 * Higgsfield avatar video generation: submits a prompt against Nic's trained
 * avatar and polls for the finished render — real footage, no lines needed.
 *
 * House AI pattern: *Configured() gate, pure request builder, graceful
 * fallback (no key configured -> clear error, never a thrown exception).
 *
 * NOTE: Higgsfield's public REST API surface isn't vendored anywhere in this
 * repo yet, so the endpoint paths/payload shape below are a best-effort
 * placeholder (matching Higgsfield's documented job-submit/job-status
 * pattern) — once real API docs or a working `higgsfield` CLI token are on
 * hand, this file is the only place that needs to change.
 */

const HIGGSFIELD_API_BASE = "https://api.higgsfield.ai/v1";

export function higgsfieldConfigured() {
  return Boolean(process.env.HIGGSFIELD_API_KEY);
}

export type HiggsfieldJobStatus = "queued" | "processing" | "completed" | "failed";

/** Submits an avatar-video generation job. Never throws. */
export async function submitAvatarVideoJob(input: {
  prompt: string;
  avatarId?: string;
}): Promise<{ externalJobId: string | null; error: string | null }> {
  if (!higgsfieldConfigured()) {
    return { externalJobId: null, error: "HIGGSFIELD_API_KEY is not set — add it to .env to generate avatar videos." };
  }
  try {
    const response = await fetch(`${HIGGSFIELD_API_BASE}/avatar/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HIGGSFIELD_API_KEY}`
      },
      body: JSON.stringify({
        prompt: input.prompt,
        avatar_id: input.avatarId || process.env.HIGGSFIELD_AVATAR_ID || undefined
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { externalJobId: null, error: `Higgsfield rejected the request (${response.status}): ${detail.slice(0, 200) || "no detail"}` };
    }
    const data = (await response.json()) as { id?: string; job_id?: string };
    const jobId = data.id ?? data.job_id ?? null;
    if (!jobId) return { externalJobId: null, error: "Higgsfield did not return a job id." };
    return { externalJobId: jobId, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { externalJobId: null, error: `Could not reach Higgsfield (${message}).` };
  }
}

/** Polls a Higgsfield job for completion. Never throws. */
export async function checkAvatarVideoJob(
  externalJobId: string
): Promise<{ status: HiggsfieldJobStatus; videoUrl?: string; thumbnailUrl?: string; error?: string }> {
  if (!higgsfieldConfigured()) return { status: "failed", error: "HIGGSFIELD_API_KEY is not set." };
  try {
    const response = await fetch(`${HIGGSFIELD_API_BASE}/jobs/${externalJobId}`, {
      headers: { Authorization: `Bearer ${process.env.HIGGSFIELD_API_KEY}` }
    });
    if (!response.ok) return { status: "failed", error: `Higgsfield status check failed (${response.status}).` };
    const data = (await response.json()) as {
      status?: string;
      video_url?: string;
      thumbnail_url?: string;
      error?: string;
    };
    if (data.status === "completed" || data.status === "succeeded") {
      return { status: "completed", videoUrl: data.video_url, thumbnailUrl: data.thumbnail_url };
    }
    if (data.status === "failed" || data.status === "error") {
      return { status: "failed", error: data.error || "Generation failed." };
    }
    return { status: "processing" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { status: "failed", error: `Could not reach Higgsfield (${message}).` };
  }
}
