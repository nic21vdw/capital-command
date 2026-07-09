import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findConflictCopies, isConflictCopyName } from "@/lib/storage/workspace";

describe("isConflictCopyName", () => {
  it("flags Dropbox conflicted copies", () => {
    expect(isConflictCopyName("capital-command (conflicted copy 2026-07-09).json")).toBe(true);
    expect(isConflictCopyName("jobs (DESKTOP-AB12 conflict 1).json")).toBe(true);
  });

  it("flags numeric duplicate copies of workspace JSON files", () => {
    expect(isConflictCopyName("capital-command (1).json")).toBe(true);
    expect(isConflictCopyName("title-log (2).jsonl")).toBe(true);
  });

  it("leaves ordinary files alone", () => {
    expect(isConflictCopyName("capital-command.json")).toBe(false);
    expect(isConflictCopyName("my clip (1).mp4")).toBe(false);
    expect(isConflictCopyName("notes about conflict.json")).toBe(false);
  });
});

describe("findConflictCopies", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "cc-workspace-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds conflict copies in the root and nested folders", async () => {
    await writeFile(path.join(root, "capital-command.json"), "{}");
    await writeFile(path.join(root, "capital-command (conflicted copy).json"), "{}");
    await mkdir(path.join(root, "clips"), { recursive: true });
    await writeFile(path.join(root, "clips", "jobs (1).json"), "[]");

    const hits = await findConflictCopies(root);
    expect(hits).toHaveLength(2);
    expect(hits.some((hit) => hit.includes("conflicted copy"))).toBe(true);
    expect(hits.some((hit) => hit.includes("jobs (1).json"))).toBe(true);
  });

  it("skips machine-local bin folders and returns empty for a clean workspace", async () => {
    await mkdir(path.join(root, "clips", "bin"), { recursive: true });
    await writeFile(path.join(root, "clips", "bin", "cache (1).json"), "{}");
    await writeFile(path.join(root, "capital-command.json"), "{}");

    expect(await findConflictCopies(root)).toEqual([]);
  });

  it("tolerates a missing folder", async () => {
    expect(await findConflictCopies(path.join(root, "does-not-exist"))).toEqual([]);
  });
});
