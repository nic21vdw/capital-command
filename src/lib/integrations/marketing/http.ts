import { z } from "zod";
import { authenticateMarketingPrincipal, type MarketingAuthenticator, type MarketingOriginPolicy } from "./auth";
import type { Principal, Target } from "./safety";
import { saveEditorCommandSchema, deleteEditorCommandSchema, requestEditorExportCommandSchema,
  cancelEditorExportCommandSchema, reconcileEditorExportCommandSchema } from "./editor";
import { createEditorProjectFromSourceCommandSchema } from "./editor-types";

const text = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value));
const commandId = z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/);
const sourceUrl = z.string().max(2048).refine((value) => {
  try {
    if (/[\\\u0000-\u0020\u007f]/.test(value)) return false;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
      && ["youtube.com", "www.youtube.com", "youtu.be", "twitch.tv", "www.twitch.tv"].includes(url.hostname);
  } catch { return false; }
});
const canonicalTime = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/).refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
});

export const marketingHttpTargetSchema: z.ZodType<Target> = z.object({
  ownerId: text(128), jobId: text(128), revision: z.number().int().positive().safe(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  caption: z.string().min(1).max(20_000), platform: z.enum(["youtube", "instagram", "facebook", "tiktok"]),
  accountId: text(128), visibility: z.enum(["public", "private", "unlisted"]), audience: text(128), scheduledAt: canonicalTime,
}).strict();

export const marketingHttpCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create_source"), commandId, title: text(200), sourceUrl }).strict(),
  z.object({ operation: z.literal("request_edits"), commandId, target: marketingHttpTargetSchema,
    instructions: z.string().min(1).max(4000).refine((value) => value.trim().length > 0) }).strict(),
  z.object({ operation: z.literal("approve_job"), commandId, target: marketingHttpTargetSchema }).strict(),
  z.object({ operation: z.literal("retry_job"), commandId, target: marketingHttpTargetSchema }).strict(),
  saveEditorCommandSchema,
  deleteEditorCommandSchema,
  requestEditorExportCommandSchema,
  cancelEditorExportCommandSchema,
  reconcileEditorExportCommandSchema,
  createEditorProjectFromSourceCommandSchema,
  z.object({ operation: z.literal("prepare_source"), commandId: z.string().uuid(),
    runId: z.string().regex(/^site-[0-9a-f-]{36}$/i), expectedRevision: z.number().int().positive().safe(),
    sourceId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict(),
]);
export type MarketingHttpCommand = z.infer<typeof marketingHttpCommandSchema>;

/** Only construct with a deliberately public-safe message; never wrap an upstream exception message. */
export class MarketingHttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    message: string,
    readonly outcome: "failed" | "uncertain" = "failed"
  ) { super(message); this.name = "MarketingHttpError"; }
}

export interface MarketingHttpService {
  /** Public DTO only: never return a raw token/config/store object. */
  workspace(principal: Principal): unknown | Promise<unknown>;
  execute(principal: Principal, command: MarketingHttpCommand): unknown | Promise<unknown>;
}
export interface MarketingHttpDependencies {
  authenticate: MarketingAuthenticator;
  /** Required explicitly: same-origin loopback policy or a separately approved verified transport policy. */
  originAllowed: MarketingOriginPolicy;
  service: MarketingHttpService;
}

const BODY_LIMIT = 1024 * 1024;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie, Authorization" };
function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { ...headers, ...extra } });
}
function error(status: number, code: string, message: string, outcome: "failed" | "uncertain" = "failed", extra?: Record<string, string>) {
  return json({ ok: false, error: { code, message, retryable: false, outcome } }, status, extra);
}
function safeFailure(cause: unknown, executionStarted: boolean) {
  if (cause instanceof MarketingHttpError) return error(cause.status, cause.code, cause.message, cause.outcome);
  return error(500, "internal_error", executionStarted
    ? "The operation outcome could not be verified. Reconcile the command in the authoritative ledger before retrying."
    : "The workspace request could not be completed.", executionStarted ? "uncertain" : "failed");
}

async function readCommand(request: Request): Promise<MarketingHttpCommand | Response> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return error(415, "unsupported_media_type", "Send application/json.");
  }
  if (request.headers.get("content-encoding") && request.headers.get("content-encoding") !== "identity") {
    return error(415, "unsupported_encoding", "Compressed request bodies are not supported.");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) {
    return error(413, "body_limit", "The request body exceeds the allowed size.");
  }
  const reader = request.body?.getReader();
  if (!reader) return error(400, "invalid_request", "Send a valid command JSON object.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel(); return error(413, "body_limit", "The request body exceeds the allowed size."); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const parsed = marketingHttpCommandSchema.safeParse(data);
    return parsed.success ? parsed.data : error(400, "invalid_request", "Send an allowed command with its exact current target.");
  } catch { return error(400, "invalid_request", "Send a valid command JSON object."); }
  finally { reader.releaseLock(); }
}

/** Pure boundary only. Does not create routes, enable a transport, or grant publication. */
export function createMarketingHttpHandlers(deps: MarketingHttpDependencies) {
  if (typeof deps?.authenticate !== "function" || typeof deps?.originAllowed !== "function"
    || typeof deps?.service?.workspace !== "function" || typeof deps?.service?.execute !== "function") {
    throw new TypeError("Marketing HTTP requires explicit authentication, origin policy, and service dependencies.");
  }
  return {
    async workspace(request: Request): Promise<Response> {
      if (request.method !== "GET") return error(405, "method_not_allowed", "Use GET.", "failed", { Allow: "GET" });
      const principal = await authenticateMarketingPrincipal(request, deps.authenticate);
      if (!principal) return error(401, "authentication_required", "A verified session is required.");
      if (!principal.scopes.includes("read")) return error(403, "scope_required", "Read permission is required.");
      if (new URL(request.url).search) return error(400, "invalid_request", "Workspace ownership comes from the verified session.");
      try { return json(await deps.service.workspace(principal)); }
      catch (cause) { return safeFailure(cause, false); }
    },
    async operations(request: Request): Promise<Response> {
      if (request.method !== "POST") return error(405, "method_not_allowed", "Use POST.", "failed", { Allow: "POST" });
      const principal = await authenticateMarketingPrincipal(request, deps.authenticate);
      if (!principal) return error(401, "authentication_required", "A verified session is required.");
      let allowed = false;
      try { allowed = await deps.originAllowed(request) === true; } catch { /* Fail closed without exposing transport details. */ }
      if (!allowed) return error(403, "origin_denied", "This request transport is not approved.");
      if (new URL(request.url).search) return error(400, "invalid_request", "Command parameters belong in the validated JSON body.");
      const command = await readCommand(request);
      if (command instanceof Response) return command;
      const scope = command.operation === "approve_job" ? "review" : "write";
      if (!principal.scopes.includes(scope)) return error(403, "scope_required", "This command requires a matching user permission.");
      if ("target" in command && "ownerId" in command.target && command.target.ownerId !== principal.ownerId) return error(403, "owner_mismatch", "The target does not belong to the verified owner.");
      try { return json(await deps.service.execute(principal, command)); }
      catch (cause) { return safeFailure(cause, true); }
    },
  };
}
