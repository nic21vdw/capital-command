import { describe, expect, it } from "vitest";
import { makeClipProject } from "@/lib/clipping/editor";
import { renderSignature } from "@/lib/clipping/export-signature";
import { clipProjectSchema } from "@/lib/storage/schemas";
import type { ClipProject } from "@/types/domain";

function base(): ClipProject {
  return makeClipProject({
    jobId: "job-1",
    name: "Clip 1",
    sourceFile: "clip-01.mp4",
    sourceUrl: "https://example.com/v",
    clipStart: 0,
    clipEnd: 30
  });
}

function clientSig(project: ClipProject) {
  return renderSignature({ ...project, settings: project.exportSettings });
}

// Mirror the export route + export.ts: parse the incoming project, then compute
// the signature from the parsed fields.
function serverSig(project: ClipProject) {
  const p = clipProjectSchema.parse(JSON.parse(JSON.stringify(project)));
  return renderSignature({
    baseDurationSec: p.baseDurationSec,
    trimStart: p.trimStart,
    trimEnd: p.trimEnd || p.baseDurationSec,
    compositionMode: p.compositionMode,
    reframe: p.reframe,
    faceSource: p.faceSource,
    screenSource: p.screenSource,
    captions: p.captions,
    captionStyle: p.captionStyle,
    captionsVisible: p.captionsVisible,
    highlightCurrentWord: p.highlightCurrentWord,
    overlays: p.overlays,
    audio: p.audio,
    sfx: p.sfx,
    settings: p.exportSettings
  });
}

describe("renderSignature is order-independent", () => {
  it("client and server agree for a trimmed, captioned project", () => {
    const project: ClipProject = {
      ...base(),
      trimStart: 5,
      trimEnd: 20,
      captions: [{ id: "c1", start: 1, end: 2, text: "Hello", words: [], enabled: true }]
    };
    expect(clientSig(project)).toBe(serverSig(project));
  });

  it("a nested object rebuilt in a different key order still matches", () => {
    // The editor's reducers spread/rebuild nested objects; a reframe rebuilt as
    // {offsetX, offsetY, scale} used to hash differently from the schema-ordered
    // {scale, offsetX, offsetY} the server stores, flagging the clip forever.
    const schemaOrder: ClipProject = { ...base(), reframe: { scale: 1.5, offsetX: 0.1, offsetY: 0.2 } };
    const editorOrder: ClipProject = {
      ...base(),
      reframe: { offsetX: 0.1, offsetY: 0.2, scale: 1.5 } as ClipProject["reframe"]
    };
    expect(clientSig(schemaOrder)).toBe(clientSig(editorOrder));
    expect(clientSig(editorOrder)).toBe(serverSig(editorOrder));
  });

  it("an explicit undefined optional matches an omitted one", () => {
    const omitted: ClipProject = { ...base() };
    const explicitUndefined: ClipProject = { ...base(), faceSource: undefined };
    expect(clientSig(omitted)).toBe(clientSig(explicitUndefined));
  });
});
