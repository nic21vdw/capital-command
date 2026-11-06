import { createHash } from "node:crypto";
import { MarketingEditor, requestEditorExportCommandSchema, type EditorWorkerPorts } from "./editor";
import { canonicalEditorJson } from "./editor-state";
import { editorReceiptSchema, type EditorBinding, type EditorReceipt, type RequestEditorExportCommand } from "./editor-types";
import type { PreparedEditorMedia, EditorCancellationControl } from "./composition";
import type { Principal } from "./safety";

type DispatchWorker = EditorWorkerPorts & PreparedEditorMedia & EditorCancellationControl & {
  prepare(projectId: string, requestId: string, attemptId: string): Promise<unknown>;
};
type CompositionBinding = { ownerId: string; editor: MarketingEditor;
  preparedEditorMedia?: PreparedEditorMedia; editorCancellation?: EditorCancellationControl };
export type EditorExportDispatch = {
  /** Validates trusted code composition, never a public identity or capability. */
  assertComposition(binding: CompositionBinding): void;
  dispatchOnce(input: { command: RequestEditorExportCommand; receipt: EditorReceipt }): Promise<void>;
};

/** No upstream error, file, proof or worker identity crosses the public boundary. */
export class EditorExportDispatchUncertain extends Error {
  constructor() {
    super("The recorded editor export requires reconciliation using its original command identity.");
    this.name = "EditorExportDispatchUncertain";
  }
}

function internalCommandId(identity: unknown): string {
  const bytes = createHash("sha256").update(canonicalEditorJson(identity)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Awaited, same-process preparation only. No installation, startup scan, timer,
 * queue or recovery ledger. Public receipt replay must never invoke this port.
 */
export function createEditorExportDispatcher(options: {
  binding: EditorBinding; editor: MarketingEditor; worker: DispatchWorker;
}): EditorExportDispatch {
  const binding = structuredClone(options.binding);
  const { editor, worker } = options;
  editor.assertDispatcherBinding(binding, worker);
  worker.assertPreparationOnly();
  const receiptPrincipal: Principal = { ownerId: binding.ownerId, scopes: ["write"] };
  const workerPrincipal: Principal = { ownerId: binding.ownerId, scopes: ["worker"] };
  return {
    assertComposition(composition) {
      editor.assertDispatcherBinding(binding, worker);
      if (composition.ownerId !== binding.ownerId || composition.editor !== editor
        || composition.preparedEditorMedia !== worker
        || (composition.editorCancellation && composition.editorCancellation !== worker)) {
        throw new Error("The dispatcher requires the original owner, editor and worker composition.");
      }
    },
    async dispatchOnce(input) {
      // Parse/copy before awaiting; caller mutations cannot change this attempt.
      const command = requestEditorExportCommandSchema.parse(input.command);
      const receipt = editorReceiptSchema.parse(input.receipt);
      const { target } = command;
      const requestId = command.commandId;
      const record = binding.records.find((row) => row.projectId === target.projectId);
      if (!record || record.jobId !== target.jobId || record.clipId !== target.clipId
        || receipt.commandId !== requestId || receipt.requestId !== requestId
        || receipt.operation !== command.operation || receipt.state !== "pending_dispatch"
        || receipt.attemptId || receipt.cancelCommandId || receipt.revision !== target.revision
        || receipt.digest !== target.digest || receipt.renderSignature !== target.renderSignature) {
        throw new EditorExportDispatchUncertain();
      }
      let attemptId: string | undefined;
      const identity = { ownerId: binding.ownerId, record, requestId };
      const outcomeId = (outcome: "prepared" | "uncertain") => internalCommandId({
        namespace: "marketing-editor-dispatch-outcome-v1", ...identity, attemptId, outcome,
      });
      try {
        // The supplied receipt is only a hint. Re-read its immutable original
        // payload before touching worker authority or the locked claim CAS.
        const original = await editor.replay(receiptPrincipal, command);
        if (!original || canonicalEditorJson(original.receipt) !== canonicalEditorJson(receipt)) {
          throw new EditorExportDispatchUncertain();
        }
        const claimId = internalCommandId({ namespace: "marketing-editor-dispatch-claim-v1", ...identity });
        const claim = await editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: claimId, target, requestId });
        // A saved claim receipt may still say claimed after restart/cancellation.
        // Only this call's newly committed claim owns the right to prepare.
        if (claim.replayed === true) return;
        if (claim.replayed !== false || claim.receipt.commandId !== claimId || claim.receipt.operation !== "claim_editor_export"
          || claim.receipt.state !== "claimed" || claim.receipt.requestId !== requestId
          || !claim.attemptId || claim.receipt.attemptId !== claim.attemptId
          || claim.receipt.revision !== target.revision || claim.receipt.digest !== target.digest
          || claim.receipt.renderSignature !== target.renderSignature) throw new EditorExportDispatchUncertain();
        attemptId = claim.attemptId;
        await worker.prepare(target.projectId, requestId, attemptId);
        // Deliberately ignore prepare's return value. The editor independently
        // obtains exact-attempt artifact evidence through this same worker.
        await editor.recordExportOutcome(workerPrincipal, { operation: "record_editor_export_outcome",
          commandId: outcomeId("prepared"), target, requestId, attemptId, outcome: "prepared" });
      } catch {
        if (attemptId) {
          try {
            // Existing CAS accepts only this still-claimed exact target/attempt.
            // Prepared, stopped, stale and deleted records cannot be downgraded.
            await editor.recordExportOutcome(workerPrincipal, { operation: "record_editor_export_outcome",
              commandId: outcomeId("uncertain"), target, requestId, attemptId, outcome: "uncertain" });
          } catch { /* Retain the durable claim/fence when confirmation is lost. */ }
        }
        throw new EditorExportDispatchUncertain();
      }
    },
  };
}
