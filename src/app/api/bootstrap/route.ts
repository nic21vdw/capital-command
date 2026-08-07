import { NextResponse } from "next/server";
import { repairAppDataOverlays } from "@/lib/clipping/overlay-images";
import { derivePortfolioSummary } from "@/lib/derive";
import { ensureExecution } from "@/lib/execution/server";
import { readApiStatus } from "@/lib/apiStatus";
import { AppDataUnreadableError, latestGoodSnapshot, readAppData, writeAppData } from "@/lib/storage/store";

export async function GET() {
  // This is the payload the whole dashboard mounts from, so it is also where
  // an inline overlay picture hurts most - see repairAppDataOverlays.
  // The shell mounts from THIS, so an unreadable file answered as a 500 left
  // every screen rendering from empty state — the app looking brand new rather
  // than saying it could not read the document.
  let stored;
  try {
    stored = await repairAppDataOverlays(await readAppData());
  } catch (error) {
    if (error instanceof AppDataUnreadableError) {
      // The offer to restore rides along with the refusal, so the dead-end
      // screen can show a way out instead of only a "try again".
      const snapshot = await latestGoodSnapshot();
      return NextResponse.json(
        {
          error: error.message,
          unreadable: true,
          copyName: error.copyPath ? error.copyPath.split(/[\\/]/).pop() : null,
          snapshot: snapshot ? { savedAt: snapshot.savedAt, bytes: snapshot.bytes } : null
        },
        { status: 503 }
      );
    }
    throw error;
  }

  // Seed default execution goals and reconcile any ended weeks into debt before
  // the dashboard renders, persisting the result so reconciliation is durable.
  const ensured = ensureExecution(stored);
  const data = ensured.data;
  if (ensured.changed) {
    await writeAppData(data);
  }

  return NextResponse.json({
    data,
    summary: derivePortfolioSummary(data),
    apiStatus: readApiStatus()
  });
}
