import { authenticateMarketingPrincipal, type MarketingAuthenticator } from "./auth";
import type { Principal } from "./safety";
import { MarketingHttpError } from "./http";

/** Narrow server-owned readers. A caller never selects a store, file path or owner. */
export interface MarketingResourceService {
  records?(principal: Principal): unknown | Promise<unknown>;
  editor?(principal: Principal, projectId: string): unknown | Promise<unknown>;
  media?(principal: Principal, mediaId: string, request: Request): Response | Promise<Response>;
}

const headers = {
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie, Authorization",
};
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;
export function validMarketingResourceId(value: unknown, maximum = 128): value is string {
  return typeof value === "string" && value.length <= maximum && identifier.test(value) && !value.includes("..");
}
function failure(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message, retryable: false, outcome: "failed" } }, { status, headers });
}

export function createMarketingResourceHandlers(deps: {
  authenticate: MarketingAuthenticator; service: MarketingResourceService;
}) {
  async function read(request: Request, kind: "records" | "editor" | "media", id?: string): Promise<Response> {
    const allowed = kind === "media" ? ["GET", "HEAD"] : ["GET"];
    if (!allowed.includes(request.method)) {
      const response = failure(405, "method_not_allowed", `Use ${allowed.join(" or ")}.`);
      response.headers.set("Allow", allowed.join(", "));
      return response;
    }
    const principal = await authenticateMarketingPrincipal(request, deps.authenticate);
    if (!principal) return failure(401, "authentication_required", "A verified session is required.");
    if (!principal.scopes.includes("read")) return failure(403, "scope_required", "Read permission is required.");
    if (new URL(request.url).search || (kind !== "records" && !validMarketingResourceId(id, kind === "media" ? 512 : 128))) {
      return failure(400, "invalid_request", "Use the exact resource identifier from the scoped workspace.");
    }
    try {
      if (kind === "media" && deps.service.media) {
        const response = await deps.service.media(principal, id!, request);
        // Apply the private boundary even when a reader supplies range/error headers.
        const secured = new Headers(response.headers);
        for (const [name, value] of Object.entries(headers)) secured.set(name, value);
        return new Response(request.method === "HEAD" ? null : response.body, {
          status: response.status, statusText: response.statusText, headers: secured,
        });
      }
      if (kind === "editor" && deps.service.editor) {
        return Response.json(await deps.service.editor(principal, id!), { headers });
      }
      if (kind === "records" && deps.service.records) {
        return Response.json(await deps.service.records(principal), { headers });
      }
      return failure(503, "resource_unavailable", "This owner-scoped reader is not configured.");
    } catch (error) {
      if (error instanceof MarketingHttpError) return failure(error.status, error.code, error.message);
      return failure(503, "read_unavailable", "The authoritative record could not be read. No changes were made.");
    }
  }
  return {
    records: (request: Request) => read(request, "records"),
    editor: (request: Request, projectId: string) => read(request, "editor", projectId),
    media: (request: Request, mediaId: string) => read(request, "media", mediaId),
  };
}
