import { MarketingEditor, MarketingEditorError, type EditorSnapshot } from "./editor";
import { MarketingHttpError, type MarketingHttpService } from "./http";
import type { MarketingResourceService } from "./resources-http";
import type { Principal } from "./safety";
import { createExistingRecordReader } from "./records";
import { createProtectedMediaReader } from "./media";
import type { PreparationSourceAccess } from "@/lib/pipeline/marketing-preparation";
import path from "node:path";
import { dataRoot } from "@/lib/paths";
import type { createMarketingAnalyticsReader } from "./analytics";
import { createHash } from "node:crypto";
import type { createStoredEditorOverlayResolver, StoredEditorOverlayStreamingRead } from "./editor-overlay-assets";
import type { createStoredEditorMusicResolver, StoredEditorMusicAsset } from "./editor-audio-assets";
import { createStoredMusicMediaReader } from "./editor-music-media";
import { canonicalEditorJson } from "./editor-state";

function musicMetadata(asset: StoredEditorMusicAsset) {
  const { slot, format, mimeType, demuxer, codec, bitsPerSample, sampleRate, channels,
    sampleFrames, durationSec, byteLength, sha256, sourceRefSha256 } = asset;
  return { slot, format, mimeType, demuxer, codec, bitsPerSample, sampleRate, channels,
    sampleFrames, durationSec, byteLength, sha256, sourceRefSha256 };
}

type RecordReader = ReturnType<typeof createExistingRecordReader>;
export type PreparedEditorMedia = {
  readCurrentArtifact(projectId: string, requestId: string): Promise<{
    file: string; renderSignature: string; projectDigest: string; assertCurrent(): void;
  }>;
};
export type EditorCancellationControl = {
  /** Rechecks the saved fence; returning does not assert that a child stopped. */
  abortExact(projectId: string, requestId: string, attemptId: string, cancelCommandId: string): Promise<void>;
};

function cancellationSettlementCommandId(commandId: string): string {
  // One internal receipt per explicit user command, including lost-response replay.
  const bytes = createHash("sha256").update(`marketing-editor-cancellation-settlement:${commandId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/**
 * Compose ONLY inside the existing owning Node service. Explicit bindings are
 * supplied by its authenticated owner registry. This installs no transport,
 * credential, scheduler, queue, process or automatic legacy enrollment.
 */
export function composeMarketingParity(options: {
  ownerId: string;
  base: MarketingHttpService;
  records: RecordReader;
  editor: MarketingEditor;
  preparationAccess?: PreparationSourceAccess;
  preparedEditorMedia?: PreparedEditorMedia;
  editorCancellation?: EditorCancellationControl;
  overlayAssets?: Pick<ReturnType<typeof createStoredEditorOverlayResolver>, "resolve" | "resolveMany">;
  musicAssets?: Pick<ReturnType<typeof createStoredEditorMusicResolver>, "resolve">;
  analytics?: ReturnType<typeof createMarketingAnalyticsReader>;
}): { service: MarketingHttpService; resources: MarketingResourceService } {
  const imageReads = new Map<string, { dataRoot: string; relativePath: string; guard: StoredEditorOverlayStreamingRead }>();
  const imageGrant = (entry: { dataRoot: string; relativePath: string; guard: StoredEditorOverlayStreamingRead }) => {
    const assertCurrent = () => {
      if (dataRoot() !== entry.dataRoot) throw new Error("The verified image data root changed.");
      entry.guard.assertCurrentFile();
    };
    assertCurrent();
    return { dataRoot: entry.dataRoot, relativePath: entry.relativePath, sourceType: "clip_export" as const, assertCurrent };
  };
  const imageKey = (snapshot: EditorSnapshot, overlayId: string, sha256: string) => `overlay:${snapshot.target.projectId}:${snapshot.target.revision}:${snapshot.target.digest}:${sha256}:${createHash("sha256").update(overlayId).digest("hex")}`;
  const musicKey = (snapshot: EditorSnapshot, sha256: string) => `music:${snapshot.target.projectId}:${snapshot.target.revision}:${snapshot.target.digest}:${sha256}`;
  function authorize(principal: Principal, scope: "read" | "write") {
    if (principal.ownerId !== options.ownerId || !principal.scopes.includes(scope)) {
      throw new MarketingHttpError(403, "forbidden", "This operation is outside the verified owner scope.");
    }
  }
  function failure(error: unknown): never {
    const safe = {
      forbidden: [403, "This record is outside the verified owner scope."],
      not_found: [404, "This scoped record is unavailable."],
      conflict: [409, "The original record changed. Read its current revision before retrying."],
      invalid: [422, "The command does not match the complete current record."],
      unavailable: [503, "The authoritative record could not be read or confirmed."],
    } as const;
    const code = error instanceof MarketingEditorError ? error.code : undefined;
    if (code) throw new MarketingHttpError(safe[code][0], code, safe[code][1]);
    throw error; // Unknown write failures remain uncertain at the HTTP boundary.
  }
  async function publicSnapshot(ownerId: string, snapshot: EditorSnapshot) {
    async function reference(descriptor: { jobId: string; fileName: string }) {
      const mediaId = await options.records.mediaId(ownerId, descriptor);
      if (!mediaId) throw new MarketingHttpError(503, "unavailable", "The original editor media is not in this owner's approved media scope.");
      return { mediaId, url: `/api/marketing/media/${encodeURIComponent(mediaId)}` };
    }
    // Every stored asset needs the matching verified owner connection.
    const imageRows = snapshot.media.overlays ?? [];
    if (snapshot.requiresAssetConnection || (imageRows.length && !options.overlayAssets) || (snapshot.media.music && !options.musicAssets)) {
      throw new MarketingHttpError(503, "unavailable", "This project requires the original image or audio asset connection before it can be edited here.");
    }
    let overlayMedia: { overlayId: string; mediaId: string; url: string }[];
    try {
      const images = imageRows.length ? await options.overlayAssets!.resolveMany(snapshot.target, imageRows.map((row) => row.overlayId)) : [];
      overlayMedia = images.map((asset) => {
        asset.assertCurrentFile();
        const mediaId = imageKey(snapshot, asset.overlayId, asset.sha256);
        return { overlayId: asset.overlayId, mediaId, url: `/api/marketing/media/${encodeURIComponent(mediaId)}` };
      });
    } catch { throw new MarketingHttpError(503, "unavailable", "The existing stored images could not be verified for this editor revision."); }
    let musicMedia: { mediaId: string; url: string } | undefined;
    if (snapshot.media.music) {
      try {
        const asset = await options.musicAssets!.resolve(snapshot.target);
        if (!asset || canonicalEditorJson(musicMetadata(asset)) !== canonicalEditorJson(snapshot.media.music)) throw new Error("Music identity changed.");
        await asset.verifyCurrent();
        const mediaId = musicKey(snapshot, asset.sha256);
        musicMedia = { mediaId, url: `/api/marketing/media/${encodeURIComponent(mediaId)}` };
      } catch { throw new MarketingHttpError(503, "unavailable", "The existing stored music could not be verified for this editor revision."); }
    }
    let prepared;
    if (snapshot.export.state === "prepared" && snapshot.export.requestId && options.preparedEditorMedia) {
      const proof = await options.preparedEditorMedia.readCurrentArtifact(snapshot.target.projectId, snapshot.export.requestId);
      if (proof.projectDigest !== snapshot.target.digest || proof.renderSignature !== snapshot.target.renderSignature) {
        throw new MarketingHttpError(409, "conflict", "The prepared media no longer matches this editor revision.");
      }
      proof.assertCurrent();
      const mediaId = `prepared:${snapshot.target.projectId}:${snapshot.export.requestId}`;
      prepared = { mediaId, url: `/api/marketing/media/${encodeURIComponent(mediaId)}`, current: true, renderSignature: proof.renderSignature };
    }
    return { ...snapshot, media: {
      source: await reference(snapshot.media.source),
      musicRequired: Boolean(snapshot.media.music),
      ...(overlayMedia.length ? { overlays: overlayMedia } : {}),
      ...(musicMedia ? { music: musicMedia } : {}),
      ...(snapshot.media.poster ? { poster: await reference(snapshot.media.poster) } : {}),
      ...(prepared ? { edited: prepared } : snapshot.media.edited ? { edited: { ...await reference(snapshot.media.edited),
        current: snapshot.media.edited.current, renderSignature: snapshot.media.edited.renderSignature } } : {}),
    } };
  }
  const readMedia = createProtectedMediaReader({ resolveMedia: async (ownerId, mediaId) => {
    if (mediaId.startsWith("overlay:")) {
      if (ownerId !== options.ownerId || !options.overlayAssets) return null;
      try {
        const match = /^overlay:([A-Za-z0-9_-]{1,128}):(\d{1,16}):([a-f0-9]{64}):([a-f0-9]{64}):([a-f0-9]{64})$/.exec(mediaId);
        if (!match) return null;
        const snapshot = await options.editor.load({ ownerId, scopes: ["read"] }, match[1]);
        if (snapshot.requiresAssetConnection || String(snapshot.target.revision) !== match[2] || snapshot.target.digest !== match[3]) return null;
        const rows = (snapshot.media.overlays ?? []).filter((row) => createHash("sha256").update(row.overlayId).digest("hex") === match[5]);
        if (rows.length !== 1 || imageKey(snapshot, rows[0].overlayId, match[4]) !== mediaId) return null;
        const cached = imageReads.get(mediaId);
        if (cached) {
          try {
            const grant = imageGrant(cached);
            imageReads.delete(mediaId); imageReads.set(mediaId, cached);
            return grant;
          } catch { imageReads.delete(mediaId); }
        }
        const assetRoot = dataRoot();
        const asset = await options.overlayAssets.resolve(snapshot.target, rows[0].overlayId);
        if (dataRoot() !== assetRoot) return null;
        if (asset.sha256 !== match[4]) return null;
        const file = /^\/api\/clips\/overlay-images\/([a-f0-9]{40}\.(?:png|jpg|webp))$/.exec(asset.src)?.[1];
        if (!file) return null;
        const entry = { dataRoot: assetRoot, relativePath: path.join("overlay-images", file), guard: asset.streamingRead() };
        const grant = imageGrant(entry);
        imageReads.set(mediaId, entry);
        if (imageReads.size > 128) imageReads.delete(imageReads.keys().next().value!);
        return grant;
      } catch { imageReads.delete(mediaId); return null; }
    }
    if (!mediaId.startsWith("prepared:")) return options.records.resolveMedia(ownerId, mediaId);
    if (ownerId !== options.ownerId || !options.preparedEditorMedia) return null;
    const match = /^prepared:([A-Za-z0-9_-]{1,128}):([0-9a-f-]{36})$/i.exec(mediaId);
    if (!match) return null;
    // The trusted worker rechecks the exact prepared intent and original job.
    // This separate owner/target check must not decode unrelated preview assets.
    const target = await options.editor.readPreparedTarget({ ownerId, scopes: ["read"] }, match[1], match[2]);
    const proof = await options.preparedEditorMedia.readCurrentArtifact(match[1], match[2]);
    if (proof.projectDigest !== target.digest || proof.renderSignature !== target.renderSignature) return null;
    return { dataRoot: dataRoot(), relativePath: path.relative(dataRoot(), proof.file), sourceType: "clip_export", assertCurrent: proof.assertCurrent };
  } });
  const readMusic = createStoredMusicMediaReader({ resolveMusic: async (ownerId, mediaId) => {
    if (ownerId !== options.ownerId || !options.musicAssets) return null;
    const match = /^music:([A-Za-z0-9_-]{1,128}):(\d{1,16}):([a-f0-9]{64}):([a-f0-9]{64})$/.exec(mediaId);
    if (!match) return null;
    const snapshot = await options.editor.load({ ownerId, scopes: ["read"] }, match[1]);
    if (snapshot.requiresAssetConnection || !snapshot.media.music || String(snapshot.target.revision) !== match[2]
      || snapshot.target.digest !== match[3] || snapshot.media.music.sha256 !== match[4]) return null;
    const asset = await options.musicAssets.resolve(snapshot.target);
    if (!asset || musicKey(snapshot, asset.sha256) !== mediaId
      || canonicalEditorJson(musicMetadata(asset)) !== canonicalEditorJson(snapshot.media.music)) return null;
    return asset;
  } });
  const resources: MarketingResourceService = {
    async analytics(principal) {
      authorize(principal, "read");
      if (!options.analytics) throw new MarketingHttpError(503, "unavailable", "Saved analytics are not configured for this owner.");
      return options.analytics.snapshot(principal.ownerId);
    },
    async records(principal) {
      authorize(principal, "read");
      return options.records.read(principal.ownerId);
    },
    async editor(principal, projectId) {
      authorize(principal, "read");
      try { return await publicSnapshot(principal.ownerId, await options.editor.load(principal, projectId)); }
      catch (error) { return failure(error); }
    },
    async media(principal, mediaId, request) {
      authorize(principal, "read");
      return mediaId.startsWith("music:") ? readMusic(principal.ownerId, mediaId, request) : readMedia(principal.ownerId, mediaId, request);
    },
  };
  const service: MarketingHttpService = {
    async workspace(principal) {
      authorize(principal, "read");
      try {
        const [base, records, editorProjects, analytics] = await Promise.all([
          options.base.workspace(principal), options.records.read(principal.ownerId), options.editor.list(principal),
          options.analytics?.snapshot(principal.ownerId) ?? null,
        ]);
        if (!base || typeof base !== "object" || Array.isArray(base)) throw new Error("Invalid workspace DTO");
        return { ...base, records, editorProjects, analytics };
      } catch (error) { return failure(error); }
    },
    async execute(principal, command) {
      if (command.operation !== "save_editor_project" && command.operation !== "request_editor_export" && command.operation !== "delete_editor_project"
        && command.operation !== "cancel_editor_export" && command.operation !== "reconcile_editor_export" && command.operation !== "prepare_source") {
        return options.base.execute(principal, command);
      }
      authorize(principal, "write");
      try {
        if (command.operation === "prepare_source") {
          if (!options.preparationAccess) throw new MarketingHttpError(503, "unavailable", "This owner's uploaded source preparation is not configured.");
          if (options.preparationAccess.ownerId !== principal.ownerId || !options.preparationAccess.sourceIds.has(command.sourceId)) {
            throw new MarketingHttpError(403, "forbidden", "This uploaded source is outside the verified owner scope.");
          }
          // Loading the original pipeline initializes its owning caches. Reads
          // must never do that; only this explicit command may enter the owner.
          const preparation = await import("@/lib/pipeline/marketing-preparation");
          let result;
          try { result = await preparation.requestMarketingPreparation(principal.ownerId, command, options.preparationAccess); }
          catch (error) {
            if (error instanceof preparation.MarketingPreparationAccessError) throw new MarketingHttpError(403, "forbidden", "This uploaded source is outside the verified owner scope.");
            if (error instanceof preparation.MarketingPreparationConflict) throw new MarketingHttpError(409, "conflict", "The original preparation changed. Read its current revision before retrying.");
            throw error;
          }
          return { ok: true, result, message: "Preparation intent recorded in the original pipeline. A trusted worker must dispatch it; no publication was requested." };
        }
        // A stop/reconciliation must never depend on a slow or revoked preview.
        // The durable user receipt remains immutable; a later read shows settlement.
        if (command.operation === "cancel_editor_export") {
          const result = await options.editor.cancelExport(principal, command);
          const { receipt } = result;
          if (receipt.state === "cancel_requested" && receipt.requestId && receipt.attemptId && receipt.cancelCommandId && options.editorCancellation) {
            try {
              await options.editorCancellation.abortExact(command.target.projectId, receipt.requestId, receipt.attemptId, receipt.cancelCommandId);
              await options.editor.settleExportCancellation({ ownerId: principal.ownerId, scopes: ["worker"] }, {
                operation: "settle_editor_export_cancellation", commandId: cancellationSettlementCommandId(command.commandId),
                target: command.target, requestId: receipt.requestId, attemptId: receipt.attemptId, cancelCommandId: receipt.cancelCommandId,
              });
            } catch {
              // The cancellation fence was committed. A failed/late controller or
              // changed target cannot undo it or become a fabricated stopped result.
            }
          }
          return result;
        }
        if (command.operation === "reconcile_editor_export") return options.editor.reconcileExport(principal, command);
        const replay = await options.editor.replay(principal, command);
        if (replay) {
          if (!replay.snapshot) return replay;
          try { return { ...replay, snapshot: await publicSnapshot(principal.ownerId, replay.snapshot) }; }
          catch { return { ...replay, snapshot: null, reconciliation: { state: "record_unavailable" } }; }
        }
        // Deleting an explicitly bound editor row does not require its source
        // job or media to survive. It records a tombstone, not worker cancellation.
        if (command.operation === "delete_editor_project") return options.editor.deleteProject(principal, command);
        // Resolve scope/media BEFORE writing as well as after. A revoked media
        // binding must not cause a successful edit hidden behind a read error.
        await publicSnapshot(principal.ownerId, await options.editor.load(principal, command.target.projectId));
        const result = command.operation === "save_editor_project"
          ? await options.editor.save(principal, command) : await options.editor.requestExport(principal, command);
        if (!result.snapshot) return result;
        try { return { ...result, snapshot: await publicSnapshot(principal.ownerId, result.snapshot) }; }
        catch {
          // The durable command completed. A response-projection failure must
          // retain its UUID for reconciliation, never invite a fresh command.
          throw new MarketingHttpError(503, "unavailable", "The command was recorded, but its current preview could not be confirmed. Retain this command identity and reconcile it.", "uncertain");
        }
      } catch (error) { return failure(error); }
    },
  };
  return { service, resources };
}
