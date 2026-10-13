import { mutationOriginAllowed } from "./mutation-origin";

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const MUTATION_GUARD_EXEMPT: Readonly<Record<string, string>> = {
  "/api/instagram/webhook":
    "Meta posts subscribed events to this URL from outside the machine, so it can never pass the loopback check. The route verifies the X-Hub-Signature-256 HMAC against IG_APP_SECRET and refuses every event while that secret is unset."
};

export function mutationGuardRefuses(request: Request): boolean {
  if (READ_ONLY_METHODS.has(request.method.toUpperCase())) return false;
  if (new URL(request.url).pathname in MUTATION_GUARD_EXEMPT) return false;
  return !mutationOriginAllowed(request);
}
