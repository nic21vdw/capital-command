import { createHash } from "node:crypto";
import { prepareClipExport, preparationSpecDigest, preparationMusicAssetIdentity, verifyPreparedClipExport, type ExportSpec, type PreparationExportBinding,
  type PreparationArtifactRead, type PreparationExportCurrent, type PreparationExportProof,
  type PreparationOverlayAssetIdentity, type PreparationMusicAssetIdentity } from "@/lib/clipping/export";
import { renderSignature } from "@/lib/clipping/export-signature";
import { clipProjectSchema } from "@/lib/storage/schemas";
import type { ClipJob } from "@/lib/clipping/types";
import type { ClipProject } from "@/types/domain";
import type { createStoredEditorOverlayResolver } from "./editor-overlay-assets";
import type { createStoredEditorMusicResolver } from "./editor-audio-assets";
import { abortEditorAttempt, getEditorWorkerEpoch, inspectEditorAttempt, readEditorCancellationSettlement,
  runEditorAttempt, type EditorAttemptIdentity, type EditorAttemptTarget } from "./editor-active-attempts";

// Structural types keep this internal adapter independent of HTTP composition.
// They intentionally satisfy MarketingEditor's EditorWorkerPorts contract.
type Intent = { requestId: string; attemptId?: string; revision: number; digest: string;
  renderSignature: string; state: string; exportId?: string; artifactSha256?: string; overlayAssets?: PreparationOverlayAssetIdentity[];
  musicAsset?: PreparationMusicAssetIdentity;
  workerEpoch?: string; cancellation?: { commandId: string; requestedAt: string } };
type ManagedProject = ClipProject & { marketingEditor?: { ownerId: string; jobId: string; clipId: string;
  revision: number; digest: string; renderSignature: string; deletedAt?: string; exports: Intent[] } };
type RecordBinding = { projectId: string; jobId: string; clipId: string; sourceFile: string; sourceSha256: string };
type Store = { read(): Promise<{ clipProjects: ClipProject[] } | null>; readJob(jobId: string): Promise<ClipJob | undefined> };

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(",")}}`;
}
function projectDigest(project: ClipProject): string {
  const { marketingEditor: _state, updatedAt: _updated, renderSignature: _signature,
    captionCount: _count, captionsOmitted: _omitted, ...content } = project as ManagedProject;
  void [_state, _updated, _signature, _count, _omitted];
  return createHash("sha256").update(canonical(content)).digest("hex");
}
export function editorPreparationSpec(project: ClipProject): ExportSpec {
  return { jobId: project.jobId, sourceFile: project.sourceFile, baseDurationSec: project.baseDurationSec,
    trimStart: project.trimStart, trimEnd: project.trimEnd, segments: project.segments,
    compositionMode: project.compositionMode, reframe: project.reframe, faceSource: project.faceSource,
    screenSource: project.screenSource, captions: project.captions, captionStyle: project.captionStyle,
    captionsVisible: project.captionsVisible, highlightCurrentWord: project.highlightCurrentWord,
    overlays: project.overlays, audio: project.audio, sfx: project.sfx, settings: project.exportSettings };
}

/**
 * Explicit owner-process adapter, never installed by an HTTP route or constructor.
 * The caller supplies original-record reads and SHA-256 identities from a trusted
 * enrollment. No credentials, discovery, uploads, attachments or publication.
 */
export function createEditorPreparationWorker(options: {
  binding: { ownerId: string; records: readonly RecordBinding[] }; store: Store;
  overlayAssets?: Pick<ReturnType<typeof createStoredEditorOverlayResolver>, "resolveMany">;
  musicAssets?: Pick<ReturnType<typeof createStoredEditorMusicResolver>, "resolve">;
}) {
  const binding = structuredClone(options.binding);
  const id = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
  if (!binding.ownerId?.trim() || binding.ownerId.length > 128 || !Array.isArray(binding.records)
    || binding.records.some((record) => ![record.projectId, record.jobId, record.clipId].every(id)
      || !/^[a-f0-9]{64}$/.test(record.sourceSha256)
      || !record.sourceFile || record.sourceFile.length > 255 || record.sourceFile.startsWith(".")
      || /[\\/:\u0000-\u001f\u007f]/.test(record.sourceFile) || !/\.(?:mp4|webm|mov|mkv)$/i.test(record.sourceFile))
    || new Set(binding.records.map((record) => record.projectId)).size !== binding.records.length) {
    throw new Error("Explicit trusted original editor source identities are required.");
  }
  const proofs = new Map<string, PreparationExportProof>();
  const streamReads = new Map<string, { key: string; artifact: PreparationArtifactRead }>();
  function attemptIdentity(projectId: string, requestId: string, attemptId: string, workerEpoch: string): EditorAttemptIdentity {
    const record = binding.records.find((candidate) => candidate.projectId === projectId);
    if (!record) throw new Error("The editor project is outside the trusted render allowlist.");
    return { ownerId: binding.ownerId, ...record, requestId, attemptId, workerEpoch };
  }
  function attemptTarget(intent: Readonly<Intent>): EditorAttemptTarget {
    return { revision: intent.revision, digest: intent.digest, renderSignature: intent.renderSignature,
      overlayAssetsSha256: createHash("sha256").update(canonical(intent.musicAsset
        ? { overlayAssets: intent.overlayAssets ?? [], musicAsset: intent.musicAsset } : intent.overlayAssets ?? [])).digest("hex") };
  }
  // Cancellation/reconciliation reads only durable owner and attempt identity.
  // Old retained fences remain usable after edits/deletion or media failure.
  async function control(projectId: string, requestId: string, attemptId?: string) {
    const record = binding.records.find((candidate) => candidate.projectId === projectId);
    if (!record) throw new Error("The editor project is outside the trusted render allowlist.");
    const projects = (await options.store.read())?.clipProjects.filter((project) => project.id === projectId) ?? [];
    if (projects.length !== 1) throw new Error("The original editor project is missing or ambiguous.");
    const project = structuredClone(projects[0]) as ManagedProject;
    const state = project.marketingEditor;
    const intents = state?.exports.filter((candidate) => candidate.requestId === requestId) ?? [];
    const intent = intents.length === 1 ? intents[0] : undefined;
    if (!state || project.jobId !== record.jobId || project.sourceFile !== record.sourceFile
      || state.ownerId !== binding.ownerId || state.jobId !== record.jobId || state.clipId !== record.clipId
      || !intent || intent.attemptId !== attemptId) throw new Error("The original editor attempt ownership changed.");
    return { record, project, state, intent };
  }
  async function exactControl(project: Readonly<ClipProject>, intent: Readonly<Intent>) {
    const loaded = await control(project.id, intent.requestId, intent.attemptId);
    const suppliedState = (project as ManagedProject).marketingEditor;
    if (project.jobId !== loaded.project.jobId || project.sourceFile !== loaded.project.sourceFile
      || suppliedState?.ownerId !== binding.ownerId || suppliedState.jobId !== loaded.state.jobId
      || suppliedState.clipId !== loaded.state.clipId || canonical(intent) !== canonical(loaded.intent)) {
      throw new Error("The requested editor attempt evidence changed.");
    }
    return loaded;
  }
  async function current(projectId: string, requestId: string, attemptId: string, phase: "claimed" | "prepared" = "claimed", verifyAssets = true):
    Promise<PreparationExportCurrent & { evidence?: { exportId: string; artifactSha256: string } }> {
    const { record, project, state, intent } = await control(projectId, requestId, attemptId);
    const digest = projectDigest(project);
    const spec = editorPreparationSpec(project);
    const signature = renderSignature(spec);
    if (project.jobId !== record.jobId || project.sourceFile !== record.sourceFile
      || !state || state.deletedAt || state.ownerId !== binding.ownerId || state.jobId !== record.jobId
      || state.clipId !== record.clipId || state.digest !== digest || state.renderSignature !== signature
      || !intent || intent.state !== phase || intent.attemptId !== attemptId || intent.digest !== digest
      || intent.revision !== state.revision || intent.renderSignature !== signature
      || (phase === "claimed" && intent.workerEpoch !== getEditorWorkerEpoch())) {
      throw new Error("The original editor render source, revision or claimed attempt changed.");
    }
    // Parse for validation without replacing the persisted project's identity.
    const parsed = clipProjectSchema.parse(project);
    if (preparationSpecDigest(editorPreparationSpec(parsed)) !== preparationSpecDigest(spec)) {
      throw new Error("The original editor render spec is not canonical.");
    }
    const job = await options.store.readJob(record.jobId);
    const clips = job?.clips.filter((clip) => clip.id === record.clipId && (clip.file === record.sourceFile
      || clip.variants?.some((variant) => variant.file === record.sourceFile))) ?? [];
    if (!job || job.id !== record.jobId || clips.length !== 1 || Math.abs(project.clipStart - clips[0].start) > 0.001
      || Math.abs(project.clipEnd - clips[0].end) > 0.001) throw new Error("The original clip media binding changed.");
    const imageRows = project.overlays.filter((row) => row.kind !== "text");
    const manifest = intent.overlayAssets ?? [];
    if (imageRows.length !== manifest.length || imageRows.some((row, index) => row.id !== manifest[index].overlayId || row.src !== manifest[index].src)) {
      throw new Error("The persisted image asset manifest does not match this exact project.");
    }
    if (imageRows.length && !options.overlayAssets) throw new Error("The existing image asset resolver is not configured.");
    const assets = verifyAssets && imageRows.length ? await options.overlayAssets!.resolveMany({ projectId,
      jobId: record.jobId, clipId: record.clipId, revision: state.revision, digest, renderSignature: signature }, imageRows.map((row) => row.id)) : [];
    if (verifyAssets && canonical(assets.map(({ overlayId, src, sha256, format, byteLength, width, height }) =>
      ({ overlayId, src, sha256, format, byteLength, width, height }))) !== canonical(manifest)) {
      throw new Error("The existing image bytes do not match the explicit export request.");
    }
    const musicManifest = intent.musicAsset;
    if (Boolean(spec.audio.musicSrc) !== Boolean(musicManifest) || (spec.audio.musicSrc && (!options.musicAssets
      || createHash("sha256").update(spec.audio.musicSrc).digest("hex") !== musicManifest?.sourceRefSha256))) {
      throw new Error("The persisted music asset manifest does not match this exact project or resolver.");
    }
    const target = { projectId, jobId: record.jobId, clipId: record.clipId, revision: state.revision, digest, renderSignature: signature };
    const music = verifyAssets && spec.audio.musicSrc ? await options.musicAssets!.resolve(target) : undefined;
    if (verifyAssets && (canonical(music ? preparationMusicAssetIdentity(music) : undefined) !== canonical(musicManifest)
      || (music && canonical(music.target) !== canonical(target)))) {
      throw new Error("The existing music bytes do not match the explicit export request.");
    }
    const identity: PreparationExportBinding = { ownerId: binding.ownerId, projectId, jobId: record.jobId,
      clipId: record.clipId, sourceFile: record.sourceFile, sourceSha256: record.sourceSha256,
      projectDigest: digest, specSha256: preparationSpecDigest(spec), renderSignature: signature, requestId, attemptId,
      ...(intent.workerEpoch ? { workerEpoch: intent.workerEpoch } : {}),
      ...(musicManifest ? { musicAsset: structuredClone(musicManifest) } : {}),
      ...(manifest.length ? { overlayAssets: structuredClone(manifest) } : {}) };
    let evidence: { exportId: string; artifactSha256: string } | undefined;
    if (phase === "prepared") {
      if (intent.exportId !== `preparation-${attemptId}` || !intent.artifactSha256 || !/^[a-f0-9]{64}$/.test(intent.artifactSha256)) {
        throw new Error("The original prepared artifact proof is incomplete.");
      }
      evidence = { exportId: intent.exportId, artifactSha256: intent.artifactSha256 };
    }
    return { binding: identity, spec, evidence, ...(assets.length ? { overlayAssets: assets } : {}), ...(music ? { musicAsset: music } : {}) };
  }
  async function readArtifact(projectId: string, requestId: string, attemptId: string): Promise<PreparationExportProof> {
    const snapshot = await current(projectId, requestId, attemptId, "prepared");
    // Retain only small persisted evidence in the recovery callback, never its
    // resolved raster/PCM copies or the original inline music string.
    const evidence = structuredClone(snapshot.evidence!);
    const evidenceKey = canonical(evidence);
    return verifyPreparedClipExport(snapshot.binding,
      async () => {
        const latest = await current(projectId, requestId, attemptId, "prepared");
        if (canonical(latest.evidence) !== evidenceKey) throw new Error("The persisted preparation proof changed.");
        return latest;
      }, evidence);
  }
  return {
    assertPreparationOnly(): void { /* This adapter has no publication or attachment port. */ },
    getWorkerEpoch: getEditorWorkerEpoch,
    async inspectAttempt(project: Readonly<ClipProject>, intent: Readonly<Intent>) {
      const loaded = await exactControl(project, intent);
      if (!loaded.intent.workerEpoch || !loaded.intent.attemptId) {
        return Object.freeze({ workerEpoch: getEditorWorkerEpoch(), status: "prior_epoch" as const, assertCurrent() {} });
      }
      return inspectEditorAttempt(attemptIdentity(project.id, intent.requestId, loaded.intent.attemptId, loaded.intent.workerEpoch), attemptTarget(loaded.intent));
    },
    async readCancellationSettlement(project: Readonly<ClipProject>, intent: Readonly<Intent>) {
      const loaded = await exactControl(project, intent);
      if (!loaded.intent.workerEpoch || !loaded.intent.attemptId || !loaded.intent.cancellation) return null;
      return readEditorCancellationSettlement(attemptIdentity(project.id, intent.requestId, loaded.intent.attemptId, loaded.intent.workerEpoch),
        attemptTarget(loaded.intent), loaded.intent.cancellation.commandId);
    },
    /** Durable fence must already exist. Returning does not assert successful stop. */
    async abortExact(projectId: string, requestId: string, attemptId: string, cancelCommandId: string): Promise<void> {
      const { intent } = await control(projectId, requestId, attemptId);
      if (!intent.workerEpoch || intent.cancellation?.commandId !== cancelCommandId) {
        throw new Error("The exact persisted editor cancellation fence is required before abort.");
      }
      await abortEditorAttempt(attemptIdentity(projectId, requestId, attemptId, intent.workerEpoch), attemptTarget(intent), cancelCommandId);
    },
    prepare(projectId: string, requestId: string, attemptId: string,
      renderOptions: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {}): Promise<PreparationExportProof> {
      // The global reservation is synchronous, including before the first store read.
      return runEditorAttempt(attemptIdentity(projectId, requestId, attemptId, getEditorWorkerEpoch()), async (lease) => {
        const { intent } = await control(projectId, requestId, attemptId);
        if (intent.workerEpoch !== getEditorWorkerEpoch()) throw new Error("The editor claim belongs to a different owning process epoch.");
        lease.bindTarget(attemptTarget(intent));
        lease.assertActive();
        const initial = await current(projectId, requestId, attemptId);
        lease.assertActive();
        const proof = await prepareClipExport(initial.binding, () => current(projectId, requestId, attemptId), { ...renderOptions, signal: lease.signal });
        await current(projectId, requestId, attemptId);
        lease.assertActive();
        proofs.set(`${projectId}:${requestId}:${attemptId}`, proof);
        return proof;
      }, { signal: renderOptions.signal });
    },
    /** Protected media adapter only: resolves a persisted prepared attempt, even after restart. */
    readArtifact,
    async readCurrentArtifact(projectId: string, requestId: string): Promise<PreparationArtifactRead> {
      const cacheId = `${projectId}:${requestId}`;
      try {
        if (!binding.records.some((record) => record.projectId === projectId)) throw new Error("The editor project is outside the trusted render allowlist.");
        const projects = (await options.store.read())?.clipProjects.filter((project) => project.id === projectId) ?? [];
        const state = (projects.length === 1 ? projects[0] as ManagedProject : undefined)?.marketingEditor;
        const intents = state?.exports.filter((intent) => intent.requestId === requestId) ?? [];
        if (state?.ownerId !== binding.ownerId || intents.length !== 1 || intents[0].state !== "prepared" || !intents[0].attemptId) {
          throw new Error("The current original editor artifact is not prepared for this owner and request.");
        }
        // Every hit re-reads original project/job/claim identity. Only streaming
        // avoids repeated whole-media hashes, never render/approval verification.
        const snapshot = await current(projectId, requestId, intents[0].attemptId, "prepared", false);
        const key = canonical({ binding: snapshot.binding, evidence: snapshot.evidence });
        const cached = streamReads.get(cacheId);
        if (cached?.key === key) {
          try {
            cached.artifact.assertCurrent();
            streamReads.delete(cacheId); streamReads.set(cacheId, cached);
            return cached.artifact;
          } catch { streamReads.delete(cacheId); }
        }
        const proof = await readArtifact(projectId, requestId, intents[0].attemptId);
        const artifact = proof.streamingRead();
        streamReads.delete(cacheId); streamReads.set(cacheId, { key, artifact });
        if (streamReads.size > 128) streamReads.delete(streamReads.keys().next().value!);
        return artifact;
      } catch (error) {
        streamReads.delete(cacheId);
        throw error;
      }
    },
    async readPreparation(project: Readonly<ClipProject>, intent: Readonly<Intent>) {
      if (!intent.attemptId) return null;
      const proof = proofs.get(`${project.id}:${intent.requestId}:${intent.attemptId}`);
      if (!proof) return null;
      const latest = await current(project.id, intent.requestId, intent.attemptId);
      if (projectDigest(project) !== latest.binding.projectDigest || intent.digest !== latest.binding.projectDigest
        || intent.renderSignature !== latest.binding.renderSignature) throw new Error("The requested editor proof changed.");
      await proof.verifyCurrent();
      return { requestId: proof.requestId, attemptId: proof.attemptId, digest: proof.projectDigest,
        renderSignature: proof.renderSignature, exportId: proof.exportId, artifactSha256: proof.artifactSha256,
        ...(proof.musicAsset ? { musicAsset: Object.freeze(structuredClone(proof.musicAsset)) } : {}),
        ...(proof.overlayAssets?.length ? { overlayAssets: structuredClone(proof.overlayAssets) } : {}),
        assertCurrent: proof.assertCurrent };
    }
  };
}
