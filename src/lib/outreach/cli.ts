import { readFile } from "node:fs/promises";
import path from "node:path";
import { mergeContacts } from "@/lib/outreach/model";
import { updateOutreachStore } from "@/lib/outreach/store";

/**
 * Outreach import CLI — merge a research file of contacts into
 * data/outreach.json, deduped by url.
 *
 *   npm run outreach:import -- <file.json>
 *
 * The file is a JSON array of contacts, or { "contacts": [...] }. Each needs
 * a name and a url; everything else (platform, approxAudience, recentVideo
 * { title, url }, fit, angle, status, affiliateCode, licenceSent,
 * lastContactedAt, nextFollowUpAt, notes) is optional. A url already on the
 * list is updated with only the fields the file supplies, so a re-import never
 * wipes a status or notes written in the app.
 *
 * It writes the data folder of the checkout it runs in (process.cwd()), so run
 * it from the checkout whose list you mean to change.
 */

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) {
    console.error("Usage: npm run outreach:import -- <contacts.json>");
    process.exit(1);
  }

  const resolved = path.resolve(file);
  let rows: unknown;
  try {
    const parsed = JSON.parse(await readFile(resolved, "utf8")) as unknown;
    rows = Array.isArray(parsed) ? parsed : (parsed as { contacts?: unknown } | null)?.contacts;
  } catch (error) {
    console.error(`Could not read ${resolved}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (!Array.isArray(rows)) {
    console.error(`${resolved} must hold a JSON array of contacts, or { "contacts": [...] }.`);
    process.exit(1);
  }

  const summary: Omit<ReturnType<typeof mergeContacts>, "contacts"> = { added: 0, updated: 0, skipped: [] };
  const store = await updateOutreachStore((current) => {
    const result = mergeContacts(current.contacts, rows as unknown[]);
    Object.assign(summary, { added: result.added, updated: result.updated, skipped: result.skipped });
    return { ...current, contacts: result.contacts };
  });
  const { added, updated, skipped } = summary;

  console.log(`Outreach import from ${resolved}`);
  console.log(`  added:   ${added}`);
  console.log(`  updated: ${updated} (matched an existing url)`);
  console.log(`  total:   ${store.contacts.length} contacts`);
  if (skipped.length > 0) {
    console.error(`  skipped: ${skipped.length} invalid row(s)`);
    for (const row of skipped) console.error(`    row ${row.index}: ${row.reason}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
