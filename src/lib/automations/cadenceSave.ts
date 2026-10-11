import { writeEnvValues, type EnvIo } from "@/lib/envFile";
import { CADENCE_ENV, type CadenceInput } from "@/lib/automations/cadenceInput";

/**
 * Writes the posting rhythm to `.env` and the live environment. Nothing else
 * has to be told: `publisherConfig()` reads `process.env` on every call, so the
 * next booking, the slot grid and the Uploading Center all see the new values.
 * Nothing is rebooked — a post already in the queue keeps the time it has.
 */
export async function saveCadence(input: CadenceInput, io?: EnvIo): Promise<void> {
  const values: Record<string, string> = {};
  if (input.shortsPerDay !== undefined) values[CADENCE_ENV.shortsPerDay] = String(input.shortsPerDay);
  if (input.slotTimes) values[CADENCE_ENV.slotTimes] = input.slotTimes.join(",");
  if (input.weekendSlotTimes) values[CADENCE_ENV.weekendSlotTimes] = input.weekendSlotTimes.join(",");
  await writeEnvValues(values, io);
}
