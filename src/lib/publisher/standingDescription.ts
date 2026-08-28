import { setClipDescription } from "@/lib/clipping/editor";

/**
 * Put the document's standing clip description where the code that writes
 * upload metadata can reach it.
 *
 * `generateClipMetadata` cannot read the document itself: it runs inside the
 * enqueue path, which is hot, and a store read per generated clip made an
 * already slow test flaky. So the value is pushed in at the two moments it can
 * change - when a process starts, and when Settings saves - rather than pulled
 * on every use.
 *
 * A document that cannot be read leaves the description empty, which is what an
 * install that never wrote one gets. It is not a reason to fail an upload.
 */
export async function refreshClipDescription() {
  try {
    const { readAppData } = await import("@/lib/storage/store");
    const data = await readAppData();
    setClipDescription(data.settings.clipDescription ?? "");
  } catch {
    setClipDescription("");
  }
}
