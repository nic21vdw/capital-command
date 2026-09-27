const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function mutationOriginAllowed(request: Request): boolean {
  try {
    const target = new URL(request.url);
    if (!["http:", "https:"].includes(target.protocol) || !LOOPBACK_HOSTS.has(target.hostname)) return false;
    const host = request.headers.get("host");
    const authority = host === null ? target : new URL(`${target.protocol}//${host}`);
    if (!LOOPBACK_HOSTS.has(authority.hostname)
      || (host !== null && authority.host !== host)
      || authority.port !== target.port) return false;

    const site = request.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin") return false;
    const origin = request.headers.get("origin");
    if (origin === null) return site === null || site === "same-origin";
    const source = new URL(origin);
    return origin === source.origin && source.origin === authority.origin;
  } catch {
    return false;
  }
}
