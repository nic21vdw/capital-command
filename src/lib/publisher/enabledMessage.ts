/**
 * The one sentence every surface says when publishing is off. It lives in its
 * own leaf module because `enabled.ts` reaches `.env` through `node:fs`, and
 * the screens that print this are client components — same split as the release
 * module's `shared.ts`. Server code imports it from `enabled.ts`, which
 * re-exports it.
 */
export const PUBLISHING_OFF_MESSAGE = "Publishing is switched off — turn it on in Settings.";
