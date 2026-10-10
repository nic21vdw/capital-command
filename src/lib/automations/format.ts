/**
 * Plain-words versions of what the Windows scheduler reports, so the
 * Automations screen reads like a status page and not like Task Scheduler's
 * export. Pure, so each is covered by format.test.ts.
 */

const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i;

function unit(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * "PT5M" -> "every 5 min", "PT1H" -> "every hour", "P1D" -> "every day".
 * Anything that is not an ISO-8601 duration (a start time, say) comes back
 * unchanged, so an unexpected scheduler value is shown rather than hidden.
 */
export function describeInterval(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const match = DURATION.exec(raw);
  if (!match || raw.length < 3) return raw;
  const [days, hours, minutes, seconds] = [match[1], match[2], match[3], match[4]].map((part) => (part ? Number(part) : 0));
  if (days === 1 && !hours && !minutes && !seconds) return "every day";
  if (hours === 1 && !days && !minutes && !seconds) return "every hour";
  const parts: string[] = [];
  if (days) parts.push(unit(days, "day"));
  if (hours) parts.push(unit(hours, "hour"));
  if (minutes) parts.push(`${minutes} min`);
  if (seconds) parts.push(`${seconds} sec`);
  if (!parts.length) return raw;
  return `every ${parts.join(" ")}`;
}

/**
 * What Task Scheduler's last result code means in a sentence. The code itself
 * is kept for a tooltip; Nic should not have to know that 267009 is "running".
 */
export function describeTaskResult(code: number | null | undefined): string {
  if (code === null || code === undefined) return "no result recorded";
  if (code === 0) return "finished normally";
  if (code === 267009) return "still running";
  if (code === 267011) return "has not run yet";
  if (code === 267014) return "was stopped before it finished";
  return "ended with an error";
}
