import { readFile, writeFile } from "node:fs/promises";
import { applyEnvValue, envFilePath } from "@/lib/podcast/publicUrl";

/**
 * Settings the app lets Nic change from a screen live in `.env`, because that
 * is where every other process that reads them (the publish runner, the CLIs)
 * looks. `next start` reads `.env` once at boot, so the file alone would leave
 * the running server on the old value until a restart — `process.env` is set
 * as well, and only after the file is safely written, so the two never
 * disagree.
 */

export type EnvIo = {
  /** Where the file is. Defaults to the `.env` in the working directory. */
  file?: string;
  read?: (file: string) => Promise<string>;
  write?: (file: string, contents: string) => Promise<void>;
  /** The live environment to update. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
};

/** Raised when the file cannot be saved; the message is fit to show as it is. */
export class EnvWriteError extends Error {}

function describe(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "the file is read-only or the app is not allowed to change it";
  if (code === "ENOENT") return "the folder that should hold it does not exist";
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * Sets several keys in one write. A missing `.env` is created; every other
 * line (comments, secrets, CRLF endings) is left exactly as it was. If the
 * write fails nothing in `process.env` changes either.
 */
export async function writeEnvValues(values: Record<string, string>, io: EnvIo = {}): Promise<void> {
  const file = io.file ?? envFilePath();
  const read = io.read ?? ((path: string) => readFile(path, "utf8"));
  const write = io.write ?? ((path: string, contents: string) => writeFile(path, contents, "utf8"));
  const env = io.env ?? process.env;

  let current = "";
  try {
    current = await read(file);
  } catch (error) {
    // No .env yet is normal on a fresh checkout; anything else (a permission
    // error, a directory in its place) is not, and writing over it would hide it.
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
      throw new EnvWriteError(`The settings file (.env) could not be read: ${describe(error)}. Nothing was changed.`);
    }
  }

  let next = current;
  for (const [key, value] of Object.entries(values)) next = applyEnvValue(next, key, value);
  try {
    await write(file, next);
  } catch (error) {
    throw new EnvWriteError(`The settings file (.env) could not be saved: ${describe(error)}. Nothing was changed.`);
  }
  for (const [key, value] of Object.entries(values)) env[key] = value;
}
