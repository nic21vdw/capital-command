export const STORY_PRIVACY = "private" as const;

export type StoryVideoStatus = {
  privacyStatus: typeof STORY_PRIVACY;
  selfDeclaredMadeForKids: boolean;
  embeddable?: boolean;
};

export class PrivacyGuardError extends Error {}

export function assertPrivate(body: unknown): void {
  const status = (body as { status?: Record<string, unknown> } | null)?.status;
  if (!status || status.privacyStatus !== STORY_PRIVACY) {
    throw new PrivacyGuardError(`Refusing to send privacyStatus "${String(status?.privacyStatus)}": story edits only ever upload as private.`);
  }
  if ("publishAt" in status) {
    throw new PrivacyGuardError("Refusing to send publishAt: a scheduled go-live would make a story edit public.");
  }
}

export function storyStatus(madeForKids = false): StoryVideoStatus {
  return { privacyStatus: STORY_PRIVACY, selfDeclaredMadeForKids: madeForKids };
}
