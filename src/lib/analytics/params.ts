import { classifyFailure } from "@/lib/analytics/http";

export function isParameterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    classifyFailure(error).kind === "other" &&
    /\(HTTP 400\)/.test(message) &&
    /"code"\s*:\s*100\b/.test(message) &&
    !/"error_subcode"\s*:\s*33\b/.test(message)
  );
}
