const POST_CODE = /^[a-z0-9]{6}$/;
const CODES = 36 ** 6;

function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function postCode(id: string): string {
  const high = fnv1a(id, 0x811c9dc5) % 0x10000;
  const low = fnv1a(id, 0x2545f491);
  return ((high * 0x100000000 + low) % CODES).toString(36).padStart(6, "0");
}

export function isPostCode(value: unknown): value is string {
  return typeof value === "string" && POST_CODE.test(value);
}
