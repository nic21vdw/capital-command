import { writeEnvValues, type EnvIo } from "@/lib/envFile";
import { CADENCE_ENV, type CadenceInput } from "@/lib/automations/cadenceInput";

/**
 * Writes the posting rhythm to `.env` and the live environment. Nothing else
 * has to be told: `publisherConfig()` reads `process.env` on every call, so the
 * next booking, the slot grid and the Uploading Center all see the new values.
 * Nothing is rebooked — a post already in the queue keeps the time it has.
 * Threads posts per day is read by `threadsConfig()` on every tick the same
 * way, so it is picked up by the next batch the autopilot plans.
 */
export async function saveCadence(input: CadenceInput, io?: EnvIo): Promise<void> {
  const values: Record<string, string> = {};
  if (input.shortsPerDay !== undefined) values[CADENCE_ENV.shortsPerDay] = String(input.shortsPerDay);
  if (input.threadsPostsPerDay !== undefined) values[CADENCE_ENV.threadsPostsPerDay] = String(input.threadsPostsPerDay);
  if (input.slotTimes) values[CADENCE_ENV.slotTimes] = input.slotTimes.join(",");
  if (input.weekendSlotTimes) values[CADENCE_ENV.weekendSlotTimes] = input.weekendSlotTimes.join(",");
  await writeEnvValues(values, io);
}
