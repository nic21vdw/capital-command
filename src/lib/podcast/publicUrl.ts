import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The one setting the Podcast page can change for itself.
 *
 * It lives in `.env` next to the other `S3_*` variables rather than in a
 * podcast settings file, because `publisherConfig()` is the only reader of it
 * and every other process that builds a URL out of the bucket — the publish
 * runner, the CLIs, a GitHub Actions run — reads it from there too. A second
 * store would mean two answers to "where does the bucket live".
 */
export const PUBLIC_BASE_URL_KEY = "S3_PUBLIC_BASE_URL";

export type PublicBaseUrlCheck = { ok: true; url: string } | { ok: false; problem: string };

const UNREACHABLE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const UNREACHABLE_SUFFIXES = [".local", ".localhost", ".internal", ".test", ".invalid"];

function isPrivateAddress(hostname: string): boolean {
  if (UNREACHABLE_HOSTS.has(hostname)) return true;
  if (UNREACHABLE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;
  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

/**
 * Whether an address can be the permanent home of the feed, and if not, what
 * is wrong with it in the words of the person fixing it. Every rule here is
 * one Spotify would otherwise enforce days later by email: an enclosure it
 * cannot fetch over the public internet is a show that never goes live.
 */
export function checkPublicBaseUrl(raw: string): PublicBaseUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, problem: "Paste the bucket's public address first." };

  // A pasted R2 public address is usually bare ("pub-xxxx.r2.dev"), and
  // rejecting that for a missing scheme would be pedantry, not validation.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, problem: `"${trimmed}" is not a web address.` };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      problem: "The feed's address has to start with https — Spotify will not fetch episode files over http."
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      problem: "Take the username and password out of the address. This URL goes in a public feed anyone can read."
    };
  }
  if (url.search || url.hash) {
    return {
      ok: false,
      problem: "Drop the ? or # part. This is the base address the episode files hang off, not a link to one file."
    };
  }
  if (!url.hostname.includes(".") || isPrivateAddress(url.hostname)) {
    return {
      ok: false,
      problem: `${url.hostname} is only reachable from this machine. Spotify reads the feed from the public internet, so it needs the bucket's public address.`
    };
  }

  const directory = url.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${url.origin}${directory}` };
}

/**
 * One assignment rewritten inside a `.env` file, with every other line, comment,
 * blank line, byte-order mark and line ending left exactly as it was — the file
 * is full of secrets this has no business reformatting.
 */
export function applyEnvValue(contents: string, key: string, value: string): string {
  const bom = contents.startsWith("\ufeff") ? "\ufeff" : "";
  const body = bom ? contents.slice(1) : contents;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);

  const assignment = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const index = lines.findIndex((line) => assignment.test(line));
  if (index >= 0) {
    lines[index] = lines[index].replace(/=.*$/, `=${value}`);
  } else if (lines[lines.length - 1] === "") {
    lines.splice(lines.length - 1, 0, `${key}=${value}`);
  } else {
    lines.push(`${key}=${value}`);
  }

  return bom + lines.join(eol);
}

/** The `.env` Next loaded this process from. */
export function envFilePath(): string {
  return path.join(process.cwd(), ".env");
}

/**
 * Stores the address and makes the running server use it. `next start` reads
 * `.env` once at boot, so writing the file alone would leave every URL the app
 * builds until the next restart pointing at the old answer — putting it in
 * `process.env` as well is what makes the setting take effect with nothing to
 * restart by hand.
 */
export async function writePublicBaseUrl(url: string): Promise<void> {
  const file = envFilePath();
  const current = await readFile(file, "utf8").catch(() => "");
  await writeFile(file, applyEnvValue(current, PUBLIC_BASE_URL_KEY, url), "utf8");
  process.env[PUBLIC_BASE_URL_KEY] = url;
}
