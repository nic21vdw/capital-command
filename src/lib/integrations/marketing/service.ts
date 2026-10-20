import { DEFAULT_SHORTS_PER_DAY } from "@/lib/publisher/shortsCap";
import type { PipelineRun } from "@/lib/pipeline/types";
import { validateDraftSource, type DraftSourceCommand, type DraftSourceReceipt } from "@/lib/pipeline/marketing-drafts";
import { MarketingHttpError, type MarketingHttpService } from "./http";
import { MarketingLedger, MarketingLedgerError } from "./ledger";
import type { Principal } from "./safety";

export interface MarketingSourceStore {
  listMarketingDrafts(ownerId: string): Promise<PipelineRun[]>;
  createMarketingDraft(ownerId: string, command: DraftSourceCommand): Promise<DraftSourceReceipt & { replayed: boolean }>;
}
/** Bind in the existing owning Next process. No tokens, queue copies or automatic enrollment. */
export function createMarketingService(options: {
  ownerId: string; ledger: MarketingLedger; sources: MarketingSourceStore;
  configuredDailyCap: number | null;
}): MarketingHttpService {
  function authorize(principal: Principal, scope: "read" | "write") {
    if (principal.ownerId !== options.ownerId || !principal.scopes.includes(scope)) {
      throw new MarketingHttpError(403, "scope_required", "This operation is outside the verified owner scope.");
    }
  }
  function publicFailure(error: unknown): never {
    if (error instanceof MarketingLedgerError) {
      const statuses = { forbidden: 403, not_found: 404, conflict: 409, invalid: 422, unavailable: 503 } as const;
      throw new MarketingHttpError(statuses[error.code], error.code, error.message);
    }
    throw error; // HTTP boundary maps unrecognized failures to a redacted uncertain result.
  }
  return {
    async workspace(principal) {
      authorize(principal, "read");
      try {
        const jobs = await options.ledger.list(principal);
        const states: Record<string, string> = {
          awaiting_review: "prepared", edits_requested: "changes_requested", claimed: "preparing", prepared: "prepared",
          failed_before_send: "failed", uncertain: "failed", accepted: "accepted", published: "published"
        };
        return {
          connection: { state: "connected", message: "Reading the existing local ledger. Review does not authorize publication." },
          sources: (await options.sources.listMarketingDrafts(principal.ownerId)).filter((run) => run.marketingSource?.ownerId === principal.ownerId)
            .map((run) => ({ id: run.id, title: run.name, sourceUrl: run.sourceUrl ?? "", status: run.status, createdAt: run.createdAt })),
          jobs: jobs.map((job) => ({ ...job, status: job.reviewed ? "approved" : states[job.status] ?? "failed", previewUrl: null })),
          policy: { configuredDailyCap: options.configuredDailyCap, codeDefaultDailyCap: DEFAULT_SHORTS_PER_DAY, historicalPreferenceDailyCap: 3 },
          capabilities: { createSource: principal.scopes.includes("write"), requestEdits: principal.scopes.includes("write"),
            approveJob: principal.scopes.includes("review"), retryJob: principal.scopes.includes("write") },
          provenance: { ledger: "capital-command", workerVerified: false, postingAuthorized: false, migrationPerformed: false }
        };
      } catch (error) { return publicFailure(error); }
    },
    async execute(principal, command) {
      if (principal.ownerId !== options.ownerId) throw new MarketingHttpError(403, "owner_mismatch", "Owner scope does not match.");
      try {
        if (command.operation === "create_source") {
          authorize(principal, "write");
          try { validateDraftSource(principal.ownerId, command); }
          catch { throw new MarketingHttpError(422, "invalid_source", "Use a supported public HTTPS video URL without credentials or tracking parameters."); }
          const result = await options.sources.createMarketingDraft(principal.ownerId, command);
          return { ok: true, result, message: "Source saved in the existing pipeline. Preparation has not started." };
        }
        const result = command.operation === "approve_job" ? await options.ledger.review(principal, command)
          : command.operation === "request_edits" ? await options.ledger.requestEdits(principal, command)
          : await options.ledger.retry(principal, command);
        return { ok: true, result, message: "Saved in the existing ledger. No publication was requested." };
      } catch (error) { return publicFailure(error); }
    }
  };
}
