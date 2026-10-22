import { readAutomationControls, withAutomationControlsLock } from "@/lib/automations/store";
import type { CredentialSource } from "@/lib/publisher/credentials";
import { FileLockTimeoutError } from "@/lib/storage/file-lock";

export const THREADS_CREDENTIAL_FIELDS = ["THREADS_ACCESS_TOKEN", "THREADS_USER_ID"] as const;

/** Presence/source and saved controls only; never checks a provider or reads a token. */
export type ThreadsCredentialRecovery = {
  control: "paused" | "running" | "unreadable";
  tokenSource: CredentialSource | null;
  envOwnedFields: string[];
};

export function changesThreadsCredentials(names: readonly string[]): boolean {
  return THREADS_CREDENTIAL_FIELDS.some((name) => names.includes(name));
}

export async function readThreadsCredentialRecovery(
  sources: Record<string, CredentialSource | null>
): Promise<ThreadsCredentialRecovery> {
  let control: ThreadsCredentialRecovery["control"];
  try {
    // isAutomationPaused deliberately returns true on errors. Recovery needs
    // evidence of an explicit saved pause, not that fail-closed fallback.
    control = (await readAutomationControls()).threads?.paused === true ? "paused" : "running";
  } catch {
    control = "unreadable";
  }
  return {
    control,
    tokenSource: sources.THREADS_ACCESS_TOKEN ?? null,
    envOwnedFields: THREADS_CREDENTIAL_FIELDS.filter((name) => sources[name] === "env")
  };
}

export class ThreadsCredentialRecoveryError extends Error {
  constructor(readonly code: "threads_pause_required" | "threads_controls_unavailable" | "threads_controls_busy") {
    super(code === "threads_pause_required"
      ? "Pause Threads in Automations before changing its credentials. Saving does not resume delivery."
      : code === "threads_controls_busy"
        ? "Automation controls are busy or their saved lock needs owner review. Keep Threads paused. After an interrupted operation, ask the owner to check the control lock; never remove a live lock."
      : "Threads pause could not be verified. Repair the saved automation controls before changing credentials.");
  }
}

/**
 * The disk write and its environment update finish while resume is excluded.
 * If resume wins first, the save refuses. No pause, resume, queue retry, token
 * validation or provider request is performed here. An already in-flight
 * provider request cannot be recalled by a pause or by this transaction.
 */
export async function withPausedThreadsCredentialChange<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await withAutomationControlsLock(async () => {
      let paused: boolean;
      try {
        paused = (await readAutomationControls()).threads?.paused === true;
      } catch {
        throw new ThreadsCredentialRecoveryError("threads_controls_unavailable");
      }
      if (!paused) throw new ThreadsCredentialRecoveryError("threads_pause_required");
      return work();
    });
  } catch (error) {
    if (error instanceof FileLockTimeoutError) throw new ThreadsCredentialRecoveryError("threads_controls_busy");
    throw error;
  }
}
