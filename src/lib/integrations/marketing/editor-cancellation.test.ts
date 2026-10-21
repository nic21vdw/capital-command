import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cancelEditorExportCommandSchema, reconcileEditorExportCommandSchema, settleEditorExportCancellationCommandSchema,
  requestEditorExportCommandSchema, editorCommandSchema } from "./editor";
import { marketingEditorStateSchema } from "./editor-types";

const target = { projectId: "project-1", jobId: "job-1", clipId: "clip-1", revision: 0,
  digest: "a".repeat(64), renderSignature: "renderer1" };
describe("editor cancellation command boundary", () => {
  it.each(["cancel_editor_export", "reconcile_editor_export"])("accepts only the exact public %s request/attempt identity", (operation) => {
    const command = { operation, commandId: randomUUID(), target, requestId: randomUUID(), attemptId: randomUUID() };
    expect(editorCommandSchema.parse(command)).toEqual(command);
    for (const extra of [{ workerEpoch: randomUUID() }, { outcome: "canceled" }, { ownerId: "someone-else" }, { settled: true }]) {
      expect(editorCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false);
    }
  });
  it("keeps settlement outside the public union and requires the existing cancellation UUID", () => {
    const command = { operation: "settle_editor_export_cancellation", commandId: randomUUID(), target,
      requestId: randomUUID(), attemptId: randomUUID(), cancelCommandId: randomUUID() };
    expect(settleEditorExportCancellationCommandSchema.parse(command)).toEqual(command);
    expect(editorCommandSchema.safeParse(command).success).toBe(false);
    expect(settleEditorExportCancellationCommandSchema.safeParse({ ...command, outcome: "canceled" }).success).toBe(false);
  });
  it("requires UUIDs for exact cancellation/restart links and refuses target mutations", () => {
    const command = { operation: "cancel_editor_export", commandId: randomUUID(), target, requestId: randomUUID() };
    expect(cancelEditorExportCommandSchema.parse(command)).toEqual(command);
    expect(reconcileEditorExportCommandSchema.safeParse({ ...command, operation: "reconcile_editor_export", attemptId: "arbitrary" }).success).toBe(false);
    expect(cancelEditorExportCommandSchema.safeParse({ ...command, target: { ...target, ownerId: "foreign" } }).success).toBe(false);
    expect(requestEditorExportCommandSchema.safeParse({ operation: "request_editor_export", commandId: randomUUID(), target,
      supersedesRequestId: "not-a-uuid" }).success).toBe(false);
  });
  it("round-trips durable epoch, cancellation, reconciliation and one-to-one restart metadata on the original row", () => {
    const intent = { requestId: randomUUID(), revision: 0, digest: target.digest, renderSignature: target.renderSignature,
      state: "cancel_requested", attemptId: randomUUID(), workerEpoch: randomUUID(),
      cancellation: { commandId: randomUUID(), requestedAt: "2026-10-21T22:00:00.000Z" },
      reconciliation: { commandId: randomUUID(), reconciledAt: "2026-10-21T22:00:01.000Z", reason: "unconfirmed_attempt" },
      supersededByRequestId: randomUUID() };
    const state = { ownerId: "owner", jobId: "job-1", clipId: "clip-1", revision: 0,
      digest: target.digest, renderSignature: target.renderSignature, receipts: [], exports: [intent] };
    expect(marketingEditorStateSchema.parse(state)).toEqual(state);
  });
});
