import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dataPath } from "@/lib/paths";
import { AUTOMATION_IDS, type AutomationControl, type AutomationId, type AutomationOutcome } from "@/lib/automations/types";

const controlSchema = z.object({
  paused: z.boolean(),
  changedAt: z.string().datetime().nullable()
});
const controlsSchema = z.record(z.enum(AUTOMATION_IDS), controlSchema);
const outcomeSchema = z.object({
  at: z.string().datetime(),
  status: z.enum(["completed", "failed", "paused"]),
  detail: z.string().max(1200)
});
let writes = Promise.resolve();

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  try {
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function readAutomationControls(): Promise<Partial<Record<AutomationId, AutomationControl>>> {
  try {
    return controlsSchema.parse(JSON.parse(await readFile(dataPath("automations", "control.json"), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Automation controls could not be read. Automatic work is paused until the saved controls are repaired.");
  }
}

export async function isAutomationPaused(id: AutomationId): Promise<boolean> {
  try {
    return (await readAutomationControls())[id]?.paused ?? false;
  } catch {
    return true;
  }
}

export async function setAutomationPaused(id: AutomationId, paused: boolean): Promise<AutomationControl> {
  const control = controlSchema.parse({ paused, changedAt: new Date().toISOString() });
  const pending = writes.then(async () => {
    const controls = await readAutomationControls();
    await writeAtomic(dataPath("automations", "control.json"), { ...controls, [id]: control });
  });
  writes = pending.catch(() => undefined);
  await pending;
  return control;
}

export async function recordAutomationOutcome(id: AutomationId, outcome: AutomationOutcome): Promise<void> {
  await writeAtomic(dataPath("automations", `${id}-outcome.json`), outcomeSchema.parse(outcome));
}

export async function readAutomationOutcome(id: AutomationId): Promise<AutomationOutcome | null> {
  try {
    return outcomeSchema.parse(JSON.parse(await readFile(dataPath("automations", `${id}-outcome.json`), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`The saved ${id} outcome could not be read.`);
  }
}
