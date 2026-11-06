import type { Principal } from "./safety";

/** Must verify an existing session/transport credential; never just read an identity header. */
export type MarketingAuthenticator = (request: Request) => unknown | Promise<unknown>;
export type MarketingOriginPolicy = (request: Request) => boolean | Promise<boolean>;

/**
 * Copy only owner and the user scopes understood by the safety boundary.
 * A verified worker identity has no implicit user permission.
 * The callback owns authentication; this function does not provision credentials.
 */
export async function authenticateMarketingPrincipal(
  request: Request, authenticate: MarketingAuthenticator
): Promise<Principal | null> {
  try {
    const value = await authenticate(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as { ownerId?: unknown; scopes?: unknown };
    if (typeof candidate.ownerId !== "string" || !candidate.ownerId.trim() || candidate.ownerId.length > 128
      || /[\u0000-\u001f\u007f]/.test(candidate.ownerId) || !Array.isArray(candidate.scopes)
      || candidate.scopes.length > 16
      || !candidate.scopes.every((scope) => ["read", "write", "review", "worker"].includes(scope))) return null;
    const scopes = candidate.scopes.filter((scope): scope is "read" | "write" | "review" => scope !== "worker");
    return { ownerId: candidate.ownerId, scopes: [...new Set(scopes)] };
  } catch {
    // Authentication exceptions may contain credentials. They are never surfaced or logged.
    return null;
  }
}

/** Origin check only, not authentication. A verified session is still required. */
export function isSameOriginLoopbackMutation(request: Request): boolean {
  try {
    if (request.method !== "POST") return false;
    const url = new URL(request.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) return false;
    if (request.headers.get("origin") !== url.origin) return false;
    const fetchSite = request.headers.get("sec-fetch-site");
    return fetchSite === null || fetchSite === "same-origin";
  } catch { return false; }
}
