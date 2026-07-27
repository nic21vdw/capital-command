import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Threads autopilot CLI — what Windows Task Scheduler runs.
 *
 *   npx tsx src/lib/threads/cli.ts tick [--dry-run]
 *   npx tsx src/lib/threads/cli.ts plan [--force] [--focus "topic"]
 *   npx tsx src/lib/threads/cli.ts run-due [--dry-run]
 *   npx tsx src/lib/threads/cli.ts status [--all]
 *   npx tsx src/lib/threads/cli.ts check
 *
 * Every command talks to the running app over HTTP instead of importing the
 * queue. That is deliberate: the app owns data/threads-queue.json, and a second
 * process holding its own copy would clobber the app's writes. `tick` is the
 * one to schedule — it plans today's batch if it isn't scheduled yet and posts
 * whatever is due, so running it every few minutes is the whole automation.
 */

// Next.js loads .env automatically; this CLI runs outside Next, so read it here
// (without overriding anything already set in the environment).
function loadDotEnv() {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
      if (!(match[1] in process.env)) process.env[match[1]] = value;
    }
  } catch {
    // No .env — rely on the ambient environment.
  }
}
loadDotEnv();

type ThreadsOutcome = { slot: number; accountId: string; outcome: string; detail: string };
type RunReport = { published: number; failed: number; skipped: number; outcomes: ThreadsOutcome[]; note?: string };
type PlanResult = { date: string; created: number; droppedPastSlots: number; skipped?: string };
type AccountSummary = { accountId: string; total: number; published: number; pending: number; failed: number };
type BatchSummary = {
  date: string;
  total: number;
  published: number;
  pending: number;
  failed: number;
  skipped: number;
  nextAt?: string;
  accounts: AccountSummary[];
};
type AccountCheck = { accountId: string; label: string; posts: string; ok: boolean; username?: string | null; error?: string };

function baseUrl(): string {
  return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

async function call(method: "GET" | "POST", body?: unknown): Promise<Record<string, unknown>> {
  const url = `${baseUrl()}/api/threads`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    throw new Error(
      `Could not reach Capital Command at ${baseUrl()} (${
        error instanceof Error ? error.message : String(error)
      }). The autopilot runs inside the app, so it has to be up. Start it with \`npm run start\`, or set APP_BASE_URL.`
    );
  }
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Non-JSON body — the status check below reports it.
  }
  if (!response.ok) {
    const message = typeof parsed.error === "string" ? parsed.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return parsed;
}

function printPlan(plan: PlanResult | undefined) {
  if (!plan) return;
  if (plan.skipped) {
    console.log(`[threads] plan (${plan.date}): ${plan.skipped}`);
    return;
  }
  console.log(
    `[threads] plan (${plan.date}): scheduled ${plan.created} post(s)${
      plan.droppedPastSlots ? `, dropped ${plan.droppedPastSlots} slot(s) already past` : ""
    }`
  );
}

function printRun(run: RunReport | undefined) {
  if (!run) return;
  if (run.note) {
    console.log(`[threads] ${run.note}`);
    return;
  }
  for (const outcome of run.outcomes) {
    console.log(`[threads]   slot ${outcome.slot} ${outcome.accountId} → ${outcome.outcome} — ${outcome.detail}`);
  }
  console.log(`[threads] posted ${run.published}, failed ${run.failed}, skipped ${run.skipped}`);
}

function printBatch(batch: BatchSummary) {
  const next = batch.nextAt ? `, next ${new Date(batch.nextAt).toLocaleString()}` : "";
  console.log(
    `  ${batch.date}: ${batch.published}/${batch.total} posted, ${batch.pending} pending, ${batch.failed} failed, ${batch.skipped} skipped${next}`
  );
  for (const account of batch.accounts ?? []) {
    console.log(`    ${account.accountId}: ${account.published}/${account.total} posted, ${account.pending} pending`);
  }
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "help";
  const dryRun = hasFlag(argv, "dry-run");

  if (command === "tick") {
    const body = await call("POST", { action: "tick", dryRun });
    printPlan(body.plan as PlanResult | undefined);
    printRun(body.run as RunReport | undefined);
    return;
  }

  if (command === "plan") {
    const body = await call("POST", {
      action: "plan",
      force: hasFlag(argv, "force"),
      ...(flagValue(argv, "focus") ? { focus: flagValue(argv, "focus") } : {})
    });
    printPlan(body.plan as PlanResult | undefined);
    return;
  }

  if (command === "run-due") {
    const body = await call("POST", { action: "run-due", dryRun });
    printRun(body.run as RunReport | undefined);
    return;
  }

  if (command === "check") {
    const body = await call("POST", { action: "check" });
    const checks = (body.checks as AccountCheck[] | undefined) ?? [];
    for (const check of checks) {
      const who = check.username ? `@${check.username}` : check.label;
      console.log(
        check.ok
          ? `[threads] ${check.accountId}: connected as ${who}, posting the ${check.posts} version.`
          : `[threads] ${check.accountId}: NOT usable — ${check.error}`
      );
    }
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
    return;
  }

  if (command === "status") {
    const body = await call("GET");
    const blocked = body.blockedReason as string | null;
    console.log(blocked ? `[threads] idle — ${blocked}` : "[threads] armed and connected.");
    const settings = body.settings as
      | {
          timezone: string;
          postsPerDay: number;
          accounts: Array<{ id: string; label: string; posts: string; offsetMinutes: number }>;
          unassignedVersions: string[];
        }
      | undefined;
    if (settings) {
      console.log(`[threads] ${settings.postsPerDay} slots/day in ${settings.timezone}`);
      for (const account of settings.accounts) {
        console.log(
          `[threads]   ${account.id} (${account.label}): posts the ${account.posts} version, +${account.offsetMinutes} min`
        );
      }
      for (const version of settings.unassignedVersions) {
        console.log(`[threads]   WARNING: no account posts the ${version} version — half the pack goes unused.`);
      }
    }
    const batches = (body.batches as BatchSummary[] | undefined) ?? [];
    const shown = hasFlag(argv, "all") ? batches : batches.slice(0, 3);
    if (shown.length === 0) console.log("  nothing scheduled yet.");
    for (const batch of shown) printBatch(batch);
    return;
  }

  console.log(
    [
      "Threads autopilot — one stream of daily posts, scheduled and sent unattended.",
      "",
      "  tick [--dry-run]              plan today's batch if needed, then post what's due",
      "  plan [--force] [--focus t]    schedule today's batch only",
      "  run-due [--dry-run]           post what's due only",
      "  status [--all]                what is scheduled and what went out",
      "  check                         validate the Threads token without posting"
    ].join("\n")
  );
}

main().catch((error) => {
  console.error(`[threads] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
