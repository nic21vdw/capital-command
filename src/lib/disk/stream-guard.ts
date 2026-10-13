import { isNoSpaceError } from "@/lib/disk/space";

type ErrorSource = { on(event: "error", listener: (error: Error) => void): unknown };

const guards = new WeakSet<object>();

export function guardStreamsAgainstNoSpace(streams: ErrorSource[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) {
    if (guards.has(stream)) continue;
    guards.add(stream);
    stream.on("error", (error) => {
      if (isNoSpaceError(error)) return;
      throw error;
    });
  }
}
