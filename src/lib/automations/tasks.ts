import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { AutomationId, AutomationTask } from "@/lib/automations/types";

const execFileAsync = promisify(execFile);
const names = {
  ingest: "Capital Command channel scan",
  publisher: "Capital Command publish runner",
  threads: "Capital Command threads autopilot"
} as const;
const taskSchema = z.object({
  id: z.enum(["ingest", "publisher", "threads"]),
  state: z.enum(["ready", "running", "disabled", "missing", "other-checkout", "unknown"]),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastResult: z.number().nullable(),
  schedule: z.string().nullable()
});
const unknown: AutomationTask = { state: "unknown", nextRunAt: null, lastRunAt: null, lastResult: null, schedule: null };
let cached: { at: number; value: Partial<Record<AutomationId, AutomationTask>> } | null = null;

export function parseAutomationTasks(raw: string): Partial<Record<AutomationId, AutomationTask>> {
  const parsed = JSON.parse(raw) as unknown;
  const tasks = z.array(taskSchema).parse(Array.isArray(parsed) ? parsed : [parsed]);
  return Object.fromEntries(tasks.map(({ id, ...task }) => [id, task]));
}

export async function readAutomationTasks(): Promise<Partial<Record<AutomationId, AutomationTask>>> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const fallback = { ingest: unknown, publisher: unknown, threads: unknown };
  if (process.platform !== "win32") return fallback;
  const cwd = process.cwd().replace(/'/g, "''");
  const entries = Object.entries(names).map(([id, name]) => `@{id='${id}';name='${name}'}`).join(",");
  const script = `$ErrorActionPreference='Stop'; $root='${cwd}'; $items=@(${entries}); $result=@(foreach($item in $items){ $task=Get-ScheduledTask -TaskName $item.name -ErrorAction SilentlyContinue; if(!$task){ @{id=$item.id;state='missing';nextRunAt=$null;lastRunAt=$null;lastResult=$null;schedule=$null}; continue }; $matches=@($task.Actions | Where-Object { $_.WorkingDirectory -and [IO.Path]::GetFullPath($_.WorkingDirectory).TrimEnd('\\') -eq $root.TrimEnd('\\') }); if(!$matches){ @{id=$item.id;state='other-checkout';nextRunAt=$null;lastRunAt=$null;lastResult=$null;schedule=$null}; continue }; $info=Get-ScheduledTaskInfo -InputObject $task; $state=$task.State.ToString().ToLowerInvariant(); if($state -notin @('ready','running','disabled')){$state='unknown'}; $trigger=@($task.Triggers)[0]; $schedule=if($trigger.Repetition.Interval){$trigger.Repetition.Interval}else{$trigger.StartBoundary}; @{id=$item.id;state=$state;nextRunAt=$(if($info.NextRunTime.Year -gt 2000){$info.NextRunTime.ToUniversalTime().ToString('o')}else{$null});lastRunAt=$(if($info.LastRunTime.Year -gt 2000){$info.LastRunTime.ToUniversalTime().ToString('o')}else{$null});lastResult=[double]$info.LastTaskResult;schedule=$schedule} }); ConvertTo-Json -InputObject $result -Compress -Depth 4`;
  let value: Partial<Record<AutomationId, AutomationTask>> = fallback;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 64 * 1024
    });
    value = parseAutomationTasks(stdout.trim());
  } catch {
    value = fallback;
  }
  cached = { at: Date.now(), value };
  return value;
}
