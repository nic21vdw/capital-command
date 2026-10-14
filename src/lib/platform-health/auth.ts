const AUTH_PATTERNS: RegExp[] = [
  /\bHTTP 401\b/,
  /"code"\s*:\s*190\b/,
  /\(#190\)/,
  /\bsession has expired\b/i,
  /\berror validating access token\b/i,
  /\binvalid oauth access token\b/i,
  /\binvalid_grant\b/i,
  /\btoken has been expired or revoked\b/i,
  /\bconnection expired or was revoked\b/i,
  /\baccess_token_invalid\b/i,
  /\brefresh_token_(?:expired|invalid)\b/i
];

const MAX_REASON_LENGTH = 280;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

export function isAuthFailure(error: unknown): boolean {
  const message = messageOf(error);
  return message !== "" && AUTH_PATTERNS.some((pattern) => pattern.test(message));
}

export function authFailureReason(error: unknown): string {
  const message = messageOf(error).trim();
  const quoted = /"message"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(message)?.[1];
  let reason = message;
  if (quoted) {
    try {
      reason = String(JSON.parse(quoted));
    } catch {
      reason = message;
    }
  }
  return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…` : reason;
}
