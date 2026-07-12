import { NextRequest, NextResponse } from "next/server";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";

// NOTE: do not import from `projects.tsx` here — it loads Remotion scene
// components at module scope, which throw in this server (RSC) context
// ("Remotion requires React.createContext"). The route only needs the ids;
// `selectComposition` validates that the composition actually exists. This
// must stay in sync with `compositionId` in `projects.tsx`.
const compositionId = (projectId: string, slideId: string) => `${projectId}--${slideId}`;
const ID_RE = /^[A-Za-z0-9_-]+$/;

// Bundling + headless-Chromium rendering must run in the Node.js runtime, and
// a clip can take tens of seconds to render.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Chromium can be pointed at an already-installed binary via env; otherwise
// Remotion downloads its own Chrome Headless Shell on first render.
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
// Restricted networks (proxies with a custom CA) break Google Fonts fetches
// inside headless Chromium; opt in to ignoring cert errors there.
const ignoreCertificateErrors = process.env.REMOTION_IGNORE_CERT_ERRORS === "1";

// Bundle once per server process and reuse it across requests — bundling is
// the slow part and the composition set never changes at runtime.
let bundlePromise: Promise<string> | null = null;
function getServeUrl() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.resolve(process.cwd(), "src/remotion/deck-entry.tsx"),
      // Keep Next's own webpack out of it; Remotion bundles standalone.
      onProgress: () => undefined
    }).catch((err) => {
      // Reset so a later request can retry a failed bundle.
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project");
  const slideId = searchParams.get("slide");

  if (!projectId || !slideId || !ID_RE.test(projectId) || !ID_RE.test(slideId)) {
    return NextResponse.json({ error: "Missing or invalid 'project' or 'slide' query param." }, { status: 400 });
  }

  const id = compositionId(projectId, slideId);
  const outPath = path.join(os.tmpdir(), `deck-${id}-${process.hrtime.bigint()}.mp4`);

  try {
    const serveUrl = await getServeUrl();
    const composition = await selectComposition({
      serveUrl,
      id,
      browserExecutable,
      chromiumOptions: { ignoreCertificateErrors }
    });

    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      outputLocation: outPath,
      browserExecutable,
      chromiumOptions: { ignoreCertificateErrors, gl: "swangle" }
    });

    const file = await fs.readFile(outPath);
    const filename = `${projectId}-${slideId}.mp4`;
    return new NextResponse(file as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(file.byteLength),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (err) {
    console.error("[presentation/render] failed", err);
    const message = err instanceof Error ? err.message : "Render failed";
    // Remotion throws when the composition id isn't registered — surface that
    // as a 404 rather than a generic server error.
    const status = /find composition/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await fs.rm(outPath, { force: true }).catch(() => undefined);
  }
}
