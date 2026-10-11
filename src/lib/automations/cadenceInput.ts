import { z } from "zod";

// Leaf module (no fs): the Cadence card validates with the same rules the
// route enforces, so the form can say what is wrong before anything is sent.

export const MIN_SHORTS_PER_DAY = 1;
export const MAX_SHORTS_PER_DAY = 6;
export const MIN_SLOT_TIMES = 1;
export const MAX_SLOT_TIMES = 8;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isSlotTime(value: string): boolean {
  return TIME.test(value);
}

/** Sorted and without repeats, which is the only shape the config reader keeps anyway. */
export function normalizeTimes(times: string[]): string[] {
  return [...new Set(times.map((time) => time.trim()))].sort();
}

function timeList(label: string) {
  return z
    .array(z.string({ invalid_type_error: `${label} must be times like 09:30.` }))
    .superRefine((times, ctx) => {
      for (const time of times) {
        if (!isSlotTime(time.trim())) {
          const message = time.trim() === "" ? `${label}: fill in the empty time or remove it.` : `"${time}" is not a time. ${label} use 24-hour HH:MM, like 09:30 or 17:45.`;
          ctx.addIssue({ code: "custom", message });
          return;
        }
      }
      const count = normalizeTimes(times).length;
      if (count < MIN_SLOT_TIMES || count > MAX_SLOT_TIMES) {
        ctx.addIssue({ code: "custom", message: `${label}: choose between ${MIN_SLOT_TIMES} and ${MAX_SLOT_TIMES} different times (you have ${count}).` });
      }
    })
    .transform(normalizeTimes);
}

export const cadenceInputSchema = z
  .object({
    shortsPerDay: z
      .number({ invalid_type_error: "Shorts per day must be a whole number." })
      .int("Shorts per day must be a whole number.")
      .min(MIN_SHORTS_PER_DAY, `Shorts per day must be at least ${MIN_SHORTS_PER_DAY}.`)
      .max(MAX_SHORTS_PER_DAY, `Shorts per day can be at most ${MAX_SHORTS_PER_DAY}.`),
    slotTimes: timeList("Weekday slot times"),
    weekendSlotTimes: timeList("Weekend slot times")
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

export type CadenceInput = z.infer<typeof cadenceInputSchema>;

/** The editable values as the card holds them. */
export type CadenceValues = { shortsPerDay: number; slotTimes: string[]; weekendSlotTimes: string[] };

/** The .env name behind each editable value. */
export const CADENCE_ENV = {
  shortsPerDay: "PUBLISH_SHORTS_PER_DAY",
  slotTimes: "PUBLISH_SLOT_TIMES",
  weekendSlotTimes: "PUBLISH_WEEKEND_SLOT_TIMES"
} as const;

export type CadenceCheck = { ok: true; value: CadenceInput } | { ok: false; problem: string };

export function checkCadenceInput(raw: unknown): CadenceCheck {
  const parsed = cadenceInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, problem: parsed.error.issues[0]?.message ?? "Those cadence values are not valid." };
}
