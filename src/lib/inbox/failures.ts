import { isAuthFailure } from "@/lib/platform-health/auth";

export type FailureKind = "auth" | "scope" | "gone" | "comments-disabled" | "throttled" | "other";

const GONE: RegExp[] = [/Unsupported get request/i, /videoNotFound/i, /\bHTTP 404\b/];

const SCOPE: RegExp[] = [
  /insufficientPermissions/i,
  /ACCESS_TOKEN_SCOPE_INSUFFICIENT/,
  /insufficient authentication scopes/i,
  /"code"\s*:\s*(?:10|2\d\d)\b/,
  /\(#(?:10|2\d\d)\)/,
  /does not have permission/i,
  /requires? (?:the )?'?[a-z_ ]*'? ?permission/i,
  /permission (?:is )?required/i,
  /threads_read_replies|instagram_manage_comments|pages_read_user_content|pages_manage_engagement|pages_read_engagement/
];

const THROTTLED: RegExp[] = [
  /quotaExceeded|rateLimitExceeded|dailyLimitExceeded|userRateLimitExceeded/i,
  /\bHTTP 429\b/,
  /"code"\s*:\s*(?:4|17|32|341|613)\b/,
  /\(#(?:4|17|32|341|613)\)/,
  /request limit reached/i,
  /too many calls/i
];

const COMMENTS_DISABLED: RegExp[] = [/commentsDisabled/i, /disabled comments/i];

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

export function classifyFailure(error: unknown): FailureKind {
  const message = messageOf(error);
  if (!message) return "other";
  if (isAuthFailure(error)) return "auth";
  if (GONE.some((pattern) => pattern.test(message))) return "gone";
  if (SCOPE.some((pattern) => pattern.test(message))) return "scope";
  if (THROTTLED.some((pattern) => pattern.test(message))) return "throttled";
  if (COMMENTS_DISABLED.some((pattern) => pattern.test(message))) return "comments-disabled";
  return "other";
}
