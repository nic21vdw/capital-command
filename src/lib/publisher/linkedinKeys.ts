export const LINKEDIN_KEYS = {
  accessToken: "linkedin.accessToken",
  accessExpiresAt: "linkedin.accessExpiresAt",
  refreshToken: "linkedin.refreshToken",
  refreshExpiresAt: "linkedin.refreshExpiresAt",
  scope: "linkedin.scope",
  memberId: "linkedin.memberId",
  profile: "linkedin.profile",
  author: "linkedin.author",
  organizations: "linkedin.organizations",
  pending: "linkedin.pending"
} as const;

export const LINKEDIN_PAGE_SCOPE = "w_organization_social";

export const LINKEDIN_SETUP_DOC = "docs/LINKEDIN_SETUP.md";

export const LINKEDIN_SETUP_DOC_URL = "https://github.com/nic21vdw/capital-command/blob/main/docs/LINKEDIN_SETUP.md";

export const LINKEDIN_POST_ATTEMPT_PREFIX = "posting:";

export function postAttemptHandle(mediaUrn: string | undefined): string {
  return `${LINKEDIN_POST_ATTEMPT_PREFIX}${mediaUrn ?? ""}`;
}

export const LINKEDIN_REARMED_PREFIX = "rearmed:";

export function rearmedHandle(mediaUrn: string | undefined): string {
  return `${LINKEDIN_REARMED_PREFIX}${mediaUrn ?? ""}`;
}

export function isPostAttempt(handle: string | undefined): boolean {
  return Boolean(handle?.startsWith(LINKEDIN_POST_ATTEMPT_PREFIX));
}

export function isRearmedAttempt(handle: string | undefined): boolean {
  return Boolean(handle?.startsWith(LINKEDIN_REARMED_PREFIX));
}

export function mediaOfHandle(handle: string | undefined): string | undefined {
  if (!handle) return undefined;
  const prefix = [LINKEDIN_POST_ATTEMPT_PREFIX, LINKEDIN_REARMED_PREFIX].find((candidate) => handle.startsWith(candidate));
  const media = prefix ? handle.slice(prefix.length) : handle;
  return media || undefined;
}
