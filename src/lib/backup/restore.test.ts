import { createServer, type Server } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatRestoreReport, isPortAnswering, restoreBackup } from "@/lib/backup/restore";
import { runStateBackup } from "@/lib/backup/state-backup";
import { openZip, writeZip } from "@/lib/backup/zip";

function temp(label: string) {
  return mkdtempSync(path.join(tmpdir(), `restore-${label}-`));
}

function put(root: string, relative: string, content: string) {
  const file = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function read(root: string, relative: string) {
  return readFileSync(path.join(root, ...relative.split("/")), "utf8");
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function listen(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((socket) => socket.end());
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

async function freePort(): Promise<number> {
  const port = await listen();
  const server = servers.pop()!;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function makeBackup() {
  const root = temp("root");
  const data = path.join(root, "data");
  put(data, "capital-command.json", '{"version":"backed-up"}');
  put(data, "publish-queue.json", '{"items":["a","b"]}');
  put(data, "threads-queue.json", '{"threads":[]}');
  put(data, "clips/jobs.json", '{"jobs":[]}');
  put(data, "publisher-tokens.json", '{"youtube":"LIVE-TOKEN"}');
  put(root, ".env", "KEY=1\n");
  const dest = temp("dest");
  const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: new Date(2026, 9, 13, 3, 30) });
  if (!result.ok) throw new Error(result.error);
  return { root, data, archive: result.path };
}

describe("restore to a staging folder", () => {
  it("extracts into staging, leaves data/ alone and reports what would change", async () => {
    const { root, data, archive } = await makeBackup();
    put(data, "publish-queue.json", '{"items":["a","b","c","d"]}');
    put(data, "threads-queue.json", '{"threads":[]}');
    put(data, "title-log.jsonl", '{"only":"live"}\n');
    const staging = path.join(root, "staging");
    const before = readdirSync(data).sort();

    const result = await restoreBackup({ archive, dataDir: data, rootDir: root, stagingDir: staging });

    expect(result.live).toBe(false);
    expect(result.stagingDir).toBe(staging);
    expect(read(staging, "data/publish-queue.json")).toBe('{"items":["a","b"]}');
    expect(existsSync(path.join(staging, "manifest.json"))).toBe(true);
    expect(result.changed).toEqual(["publish-queue.json"]);
    expect(result.unchanged).toBeGreaterThanOrEqual(2);
    expect(result.added).toEqual([]);
    expect(result.notInBackup).toContain("title-log.jsonl");
    expect(readdirSync(data).sort()).toEqual(before);
    expect(read(data, "publish-queue.json")).toBe('{"items":["a","b","c","d"]}');
  });

  it("reports files the backup has that data/ is missing as added", async () => {
    const { root, data, archive } = await makeBackup();
    writeFileSync(path.join(data, "threads-queue.json"), "x");
    const { rmSync } = await import("node:fs");
    rmSync(path.join(data, "clips"), { recursive: true });

    const result = await restoreBackup({ archive, dataDir: data, rootDir: root, stagingDir: path.join(root, "staging") });
    expect(result.added).toEqual(["clips/jobs.json"]);
    expect(result.changed).toEqual(["threads-queue.json"]);
  });

  it("names the secrets that must be reconnected", async () => {
    const { root, data, archive } = await makeBackup();
    const result = await restoreBackup({ archive, dataDir: data, rootDir: root, stagingDir: path.join(root, "staging") });
    expect(result.secrets.map((secret) => secret.path).sort()).toEqual([".env", "publisher-tokens.json"]);

    const report = formatRestoreReport(result);
    expect(report).toContain("publisher-tokens.json");
    expect(report).toContain(".env");
    expect(report).toMatch(/reconnect/i);
    expect(report).toMatch(/would change/i);
    expect(report).toContain("--live");
  });

  it("refuses an archive that tries to write outside the staging folder", async () => {
    const { root, data } = await makeBackup();
    const evil = path.join(temp("evil"), "evil.zip");
    await writeZip(evil, [
      { name: "data/../../escaped.txt", data: Buffer.from("x") },
      { name: "manifest.json", data: Buffer.from("{}") }
    ]);
    const staging = path.join(root, "staging");
    await expect(restoreBackup({ archive: evil, dataDir: data, rootDir: root, stagingDir: staging })).rejects.toThrow(/outside|unsafe/i);
    expect(existsSync(path.join(root, "escaped.txt"))).toBe(false);
    expect(existsSync(path.join(path.dirname(root), "escaped.txt"))).toBe(false);
  });

  it("says plainly when the file is missing or is not a backup", async () => {
    const { root, data } = await makeBackup();
    await expect(restoreBackup({ archive: path.join(root, "nope.zip"), dataDir: data, rootDir: root })).rejects.toThrow(/not found|no such/i);
    const junk = path.join(root, "junk.zip");
    writeFileSync(junk, "plain text");
    await expect(restoreBackup({ archive: junk, dataDir: data, rootDir: root })).rejects.toThrow(/zip/i);
    const bare = path.join(root, "bare.zip");
    await writeZip(bare, [{ name: "data/x.json", data: Buffer.from("{}") }]);
    await expect(restoreBackup({ archive: bare, dataDir: data, rootDir: root })).rejects.toThrow(/manifest/i);
  });
});

describe("restore --live", () => {
  it("is refused while the app answers on the port, and changes nothing", async () => {
    const { root, data, archive } = await makeBackup();
    put(data, "publish-queue.json", '{"items":["live"]}');
    const port = await listen();

    await expect(restoreBackup({ archive, dataDir: data, rootDir: root, live: true, port })).rejects.toThrow(/stop the app/i);

    expect(read(data, "publish-queue.json")).toBe('{"items":["live"]}');
    expect(existsSync(path.join(root, "backups"))).toBe(false);
  });

  it("detects a listener on the port", async () => {
    const busy = await listen();
    expect(await isPortAnswering(busy)).toBe(true);
    expect(await isPortAnswering(await freePort())).toBe(false);
  });

  it("overwrites data/ when the app is stopped, keeping a safety copy of what it replaced", async () => {
    const { root, data, archive } = await makeBackup();
    put(data, "publish-queue.json", '{"items":["live"]}');
    put(data, "capital-command.json", '{"version":"backed-up"}');
    put(data, "title-log.jsonl", '{"only":"live"}\n');
    put(data, "publisher-tokens.json", '{"youtube":"NEWER-LIVE-TOKEN"}');
    put(data, "backup-status.json", '{"at":"live-status","ok":true}');
    const port = await freePort();

    const result = await restoreBackup({
      archive,
      dataDir: data,
      rootDir: root,
      live: true,
      port,
      stagingDir: path.join(root, "staging"),
      now: new Date(2026, 9, 14, 9, 5)
    });

    expect(result.live).toBe(true);
    expect(read(data, "publish-queue.json")).toBe('{"items":["a","b"]}');
    expect(read(data, "title-log.jsonl")).toBe('{"only":"live"}\n');
    expect(read(data, "publisher-tokens.json")).toBe('{"youtube":"NEWER-LIVE-TOKEN"}');
    expect(read(data, "backup-status.json")).toBe('{"at":"live-status","ok":true}');
    expect(result.applied).toEqual(["publish-queue.json"]);

    expect(result.safetyArchive).toBeDefined();
    const safety = openZip(readFileSync(result.safetyArchive!));
    expect(safety.read("data/publish-queue.json").toString()).toBe('{"items":["live"]}');
    expect(safety.entries.map((entry) => entry.name)).toEqual(["data/publish-queue.json"]);
    expect(readdirSync(data).some((name) => name.endsWith(".tmp"))).toBe(false);
    expect(formatRestoreReport(result)).toContain(result.safetyArchive!);
  });

  it("restores into an empty data folder", async () => {
    const { root, archive } = await makeBackup();
    const fresh = path.join(temp("fresh"), "data");
    const result = await restoreBackup({
      archive,
      dataDir: fresh,
      rootDir: root,
      live: true,
      port: await freePort(),
      stagingDir: path.join(root, "staging")
    });
    expect(read(fresh, "publish-queue.json")).toBe('{"items":["a","b"]}');
    expect(read(fresh, "clips/jobs.json")).toBe('{"jobs":[]}');
    expect(result.safetyArchive).toBeUndefined();
    expect(result.applied.sort()).toEqual(["capital-command.json", "clips/jobs.json", "publish-queue.json", "threads-queue.json"]);
  });
});
