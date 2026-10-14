export function toIso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const normalised = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function isNewer(at: string, since: string | null): boolean {
  if (!since) return true;
  return Date.parse(at) > Date.parse(since);
}

export function laterOf(current: string | null, candidate: string): string {
  return current === null || Date.parse(candidate) > Date.parse(current) ? candidate : current;
}
