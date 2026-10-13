import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { guardStreamsAgainstNoSpace } from "@/lib/disk/stream-guard";

const noSpace = () =>
  Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", errno: -4055, syscall: "write" });

describe("guardStreamsAgainstNoSpace", () => {
  it("lets a full disk on stdout or stderr pass instead of becoming an uncaughtException", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    guardStreamsAgainstNoSpace([stdout, stderr]);

    expect(() => stdout.emit("error", noSpace())).not.toThrow();
    expect(() => stderr.emit("error", noSpace())).not.toThrow();
  });

  it("still surfaces any other stream error", () => {
    const stdout = new EventEmitter();
    guardStreamsAgainstNoSpace([stdout]);

    expect(() => stdout.emit("error", Object.assign(new Error("EACCES"), { code: "EACCES" }))).toThrow("EACCES");
  });

  it("without the guard the same error is thrown, which is what hit the server", () => {
    const stdout = new EventEmitter();

    expect(() => stdout.emit("error", noSpace())).toThrow("ENOSPC");
  });

  it("is safe to call twice", () => {
    const stdout = new EventEmitter();
    guardStreamsAgainstNoSpace([stdout]);
    guardStreamsAgainstNoSpace([stdout]);

    expect(stdout.listenerCount("error")).toBe(1);
  });
});
