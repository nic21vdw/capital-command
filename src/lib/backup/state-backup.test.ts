import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKUP_FOLDER_NAME,
  KEEP_BACKUPS,
  defaultDriveCandidates,
  historyDaysFromEnv,
  resolveBackupDir,
  runStateBackup,
  type BackupManifest
} from "@/lib/backup/state-backup";
import { readBackupStatus } from "@/lib/backup/status-file";
import { openZip } from "@/lib/backup/zip";

function temp(label: string) {
  return mkdtempSync(path.join(tmpdir(), `backup-${label}-`));
}

function put(root: string, relative: string, content: string | Buffer = "{}") {
  const file = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

const LIMITS = { maxFileBytes: 1000, maxLogBytes: 100 };

function seed() {
  const root = temp("root");
  const data = path.join(root, "data");
  put(data, "capital-command.json", '{"app":true}');
  put(data, "publish-queue.json", '{"items":[1]}');
  put(data, "threads-queue.json", '{"threads":[1]}');
  put(data, "threads-state.json", '{"state":1}');
  put(data, "automations/control.json", '{"paused":false}');
  put(data, "automations/history/publisher-2026-10-13.jsonl", '{"a":1}\n{"a":2}\n');
  put(data, "automations/history/threads-2026-10-12.jsonl", '{"a":3}\n');
  put(data, "automations/history/publisher-2026-10-11.jsonl", '{"old":1}\n');
  put(data, "automations/history/pipeline-2026-10-06.jsonl", '{"old":2}\n');
  put(data, "automations/history/notes.json", '{"notes":[]}');
  put(data, "longform/projects.json", '{"projects":[]}');
  put(data, "agents/runs.json", '{"runs":[]}');
  put(data, "title-log.jsonl", '{"t":1}\n');
  put(data, "publish-queue.log", "audit line\n");
  put(data, "clips/jobs.json", JSON.stringify({ jobs: "j".repeat(5000) }));
  put(data, "clips/sources/abc/meta.json", '{"id":"abc"}');
  put(data, "clips/sources/abc/transcript.json", '{"words":["a","b"]}');
  put(data, "clips/sources/abc/waveform.json", '{"peaks":[1,2]}');
  put(data, "snapshots/capital-command-2026-10-13T01-03-31-844Z.json", '{"app":true}');

  put(data, "clips/outputs/a.mp4", "video");
  put(data, "clips/outputs/b.mov", "video");
  put(data, "clips/outputs/c.wav", "audio");
  put(data, "clips/outputs/d.mp3", "audio");
  put(data, "carousel-images/e.png", "image");
  put(data, "carousel-images/f.jpg", "image");
  put(data, "carousel-images/g.webp", "image");
  put(data, "publish-queue.json.4242.1790854297264.tmp", "half written");
  put(data, "clips/jobs.json.9356.1782696255230.tmp", "half written");
  put(data, "automations/audit.log", "x".repeat(500));
  put(data, "analytics/huge-export.json", "x".repeat(2000));
  put(data, "clips/bin/whisper-models/Xenova/tokenizer.json", "{}");
  put(data, "backup-status.json", '{"at":"old","ok":true}');

  put(data, "publisher-tokens.json", '{"youtube":"SECRET-REFRESH-TOKEN"}');
  put(data, "credentials.json", '{"OPENAI_API_KEY":"SECRET-API-KEY"}');
  put(data, "voice/xai-oauth.json", '{"access":"SECRET-OAUTH"}');
  put(root, ".env", "OPENAI_API_KEY=SECRET-API-KEY\n");

  const dest = temp("dest");
  return { root, data, dest };
}

function readArchive(file: string) {
  const archive = openZip(readFileSync(file));
  const names = archive.entries.map((entry) => entry.name);
  const manifest = JSON.parse(archive.read("manifest.json").toString("utf8")) as BackupManifest;
  return { archive, names, manifest };
}

const nightly = new Date(2026, 9, 13, 3, 30, 0);

describe("what goes in the backup", () => {
  it("includes every json and jsonl state file under data/ and leaves media, temp files, big logs and secrets out", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { archive, names, manifest } = readArchive(result.path);
    const stateNames = names.filter((name) => name !== "manifest.json").sort();
    expect(stateNames).toEqual(
      [
        "data/agents/runs.json",
        "data/automations/control.json",
        "data/automations/history/notes.json",
        "data/automations/history/publisher-2026-10-13.jsonl",
        "data/automations/history/threads-2026-10-12.jsonl",
        "data/capital-command.json",
        "data/clips/jobs.json",
        "data/clips/sources/abc/meta.json",
        "data/longform/projects.json",
        "data/publish-queue.json",
        "data/publish-queue.log",
        "data/threads-queue.json",
        "data/threads-state.json",
        "data/title-log.jsonl"
      ].sort()
    );
    expect(archive.read("data/publish-queue.json").toString()).toBe('{"items":[1]}');
    expect(manifest.fileCount).toBe(stateNames.length);
  });

  it("keeps a core store even when it is over the size limit, and lists the optional files it skipped", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    const { names, manifest } = readArchive(result.path);

    expect(names).toContain("data/clips/jobs.json");
    expect(names).not.toContain("data/analytics/huge-export.json");
    expect(names).not.toContain("data/automations/audit.log");
    const skipped = Object.fromEntries(manifest.skipped.map((entry) => [entry.path, entry.reason]));
    expect(skipped["analytics/huge-export.json"]).toMatch(/over/i);
    expect(skipped["automations/audit.log"]).toMatch(/log over/i);
  });

  it("keeps a source's meta.json but not the transcripts and caches rebuilt from its video, and not the app's own snapshot copies", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    const { names, manifest } = readArchive(result.path);

    expect(names).toContain("data/clips/sources/abc/meta.json");
    expect(names).not.toContain("data/clips/sources/abc/transcript.json");
    expect(names).not.toContain("data/clips/sources/abc/waveform.json");
    expect(names.some((name) => name.startsWith("data/snapshots/"))).toBe(false);
    expect(manifest.skippedCounts.derived).toBe(2);
    const snapshots = manifest.skipped.find((entry) => entry.path === "snapshots/");
    expect(snapshots?.reason).toMatch(/copies/i);
  });

  it("never puts a secret in the zip and lists each one in the manifest", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    const { archive, names, manifest } = readArchive(result.path);

    expect(names.some((name) => /token|credential|oauth|\.env/i.test(name))).toBe(false);
    for (const entry of archive.entries) {
      expect(archive.read(entry.name).toString("latin1")).not.toContain("SECRET-");
    }
    const secretPaths = manifest.excludedSecrets.map((entry) => entry.path).sort();
    expect(secretPaths).toEqual([".env", "credentials.json", "publisher-tokens.json", "voice/xai-oauth.json"]);
    for (const entry of manifest.excludedSecrets) {
      expect(entry.reconnect.length).toBeGreaterThan(10);
      expect(entry.present).toBe(true);
    }
  });

  it("lists .env as a secret to reconnect even when the checkout has none", async () => {
    const { root, data, dest } = seed();
    rmSync(path.join(root, ".env"));
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    const env = readArchive(result.path).manifest.excludedSecrets.find((entry) => entry.path === ".env");
    expect(env?.present).toBe(false);
  });

  it("counts what it left out instead of listing thousands of media files", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    const { manifest } = readArchive(result.path);
    expect(manifest.skippedCounts.media).toBe(7);
    expect(manifest.skippedCounts.temporary).toBe(2);
    expect(manifest.skipped.some((entry) => entry.path.endsWith(".mp4"))).toBe(false);
  });

  it("backs up an app that has no data folder yet as an empty archive", async () => {
    const root = temp("empty");
    const dest = temp("dest");
    const result = await runStateBackup({ dataDir: path.join(root, "data"), rootDir: root, destDir: dest, now: nightly });
    expect(result.ok).toBe(true);
    if (result.ok) expect(readArchive(result.path).manifest.fileCount).toBe(0);
  });
});

describe("automation history journals", () => {
  it("keeps only today's and yesterday's journals and counts the older ones", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    const { names, manifest } = readArchive(result.path);

    const journals = names.filter((name) => name.includes("automations/history/") && name.endsWith(".jsonl")).sort();
    expect(journals).toEqual([
      "data/automations/history/publisher-2026-10-13.jsonl",
      "data/automations/history/threads-2026-10-12.jsonl"
    ]);
    expect(manifest.skippedCounts.history).toBe(2);
    expect(manifest.skipped.some((entry) => entry.path.includes("automations/history/"))).toBe(false);
    expect(manifest.limits.historyDays).toBe(2);
  });

  it("falls back to the modified time for a journal with no date in its name", async () => {
    const { root, data, dest } = seed();
    const recent = put(data, "automations/history/recent-export.jsonl", "{}\n");
    const stale = put(data, "automations/history/stale-export.jsonl", "{}\n");
    const hourAgo = new Date(nightly.getTime() - 3_600_000);
    const fiveDaysAgo = new Date(nightly.getTime() - 5 * 86_400_000);
    utimesSync(recent, hourAgo, hourAgo);
    utimesSync(stale, fiveDaysAgo, fiveDaysAgo);

    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    const { names, manifest } = readArchive(result.path);

    expect(names).toContain("data/automations/history/recent-export.jsonl");
    expect(names).not.toContain("data/automations/history/stale-export.jsonl");
    expect(manifest.skippedCounts.history).toBe(3);
  });

  it("can be told to keep more days", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({
      dataDir: data,
      rootDir: root,
      destDir: dest,
      now: nightly,
      limits: { ...LIMITS, historyDays: 3 }
    });
    if (!result.ok) throw new Error(result.error);
    const { names, manifest } = readArchive(result.path);
    expect(names).toContain("data/automations/history/publisher-2026-10-11.jsonl");
    expect(names).not.toContain("data/automations/history/pipeline-2026-10-06.jsonl");
    expect(manifest.skippedCounts.history).toBe(1);
  });

  it("leaves other files in the history folder alone", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    expect(readArchive(result.path).names).toContain("data/automations/history/notes.json");
  });
});

describe("how many days of history", () => {
  it("defaults to 2 and reads BACKUP_HISTORY_DAYS", () => {
    expect(historyDaysFromEnv({})).toBe(2);
    expect(historyDaysFromEnv({ BACKUP_HISTORY_DAYS: "1" })).toBe(1);
    expect(historyDaysFromEnv({ BACKUP_HISTORY_DAYS: " 7 " })).toBe(7);
  });

  it("ignores values that make no sense and caps the rest at 30", () => {
    for (const bad of ["0", "-3", "abc", "", "1.5"]) expect(historyDaysFromEnv({ BACKUP_HISTORY_DAYS: bad })).toBe(2);
    expect(historyDaysFromEnv({ BACKUP_HISTORY_DAYS: "100" })).toBe(30);
  });
});

describe("naming and retention", () => {
  it("names the file capital-command-state-YYYYMMDD-HHMM.zip and leaves no partial file behind", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    expect(path.basename(result.ok ? result.path : "")).toBe("capital-command-state-20261013-0330.zip");
    expect(readdirSync(dest)).toEqual(["capital-command-state-20261013-0330.zip"]);
  });

  it("keeps the newest 14 backups and removes the older ones, touching nothing else", async () => {
    const { root, data, dest } = seed();
    for (let day = 1; day <= 33; day += 1) {
      const stamp = `202609${String(day).padStart(2, "0")}-0330`;
      writeFileSync(path.join(dest, `capital-command-state-${stamp}.zip`), "old");
    }
    writeFileSync(path.join(dest, "notes.txt"), "mine");
    writeFileSync(path.join(dest, "capital-command-2026-09-01_0330.json"), "{}");

    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    expect(result.ok).toBe(true);

    const zips = readdirSync(dest).filter((name) => /^capital-command-state-\d{8}-\d{4}\.zip$/.test(name)).sort();
    expect(KEEP_BACKUPS).toBe(14);
    expect(zips).toHaveLength(14);
    expect(zips.at(-1)).toBe("capital-command-state-20261013-0330.zip");
    expect(zips[0]).toBe("capital-command-state-20260921-0330.zip");
    expect(readdirSync(dest)).toContain("notes.txt");
    expect(readdirSync(dest)).toContain("capital-command-2026-09-01_0330.json");
  });

  it("does not prune when the new backup failed to write", async () => {
    const { root, data, dest } = seed();
    for (let day = 1; day <= 31; day += 1) {
      writeFileSync(path.join(dest, `capital-command-state-202609${String(day).padStart(2, "0")}-0330.zip`), "old");
    }
    const blocked = path.join(dest, "capital-command-state-20261013-0330.zip");
    mkdirSync(blocked);
    writeFileSync(path.join(blocked, "keep"), "x");
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    expect(result.ok).toBe(false);
    expect(readdirSync(dest).filter((name) => name.endsWith(".zip"))).toHaveLength(32);
  });
});

describe("backup-status.json", () => {
  it("records time, path, size and ok after a good run", async () => {
    const { root, data, dest } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    if (!result.ok) throw new Error(result.error);
    const status = JSON.parse(readFileSync(path.join(data, "backup-status.json"), "utf8"));
    expect(status).toMatchObject({
      ok: true,
      at: nightly.toISOString(),
      path: result.path,
      bytes: statSync(result.path).size,
      lastSuccessAt: nightly.toISOString()
    });
    expect(status.fileCount).toBeGreaterThan(5);
    expect(readdirSync(data).some((name) => name.startsWith("backup-status.json.") && name.endsWith(".tmp"))).toBe(false);
  });

  it("records the reason after a failure and remembers the last good backup", async () => {
    const { root, data, dest } = seed();
    await runStateBackup({ dataDir: data, rootDir: root, destDir: dest, now: nightly, limits: LIMITS });
    const later = new Date(2026, 9, 14, 3, 30, 0);
    const result = await runStateBackup({ dataDir: data, rootDir: root, env: {}, driveCandidates: [], now: later });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/BACKUP_DRIVE_DIR/);

    expect(await readBackupStatus(data)).toMatchObject({
      ok: false,
      at: later.toISOString(),
      error: result.error,
      lastSuccessAt: nightly.toISOString()
    });
  });

  it("reads as null when no backup was ever attempted", async () => {
    expect(await readBackupStatus(temp("none"))).toBeNull();
  });

  it("reads as null rather than throwing when the file is unreadable", async () => {
    const data = temp("bad");
    writeFileSync(path.join(data, "backup-status.json"), "{not json");
    expect(await readBackupStatus(data)).toBeNull();
  });
});

describe("auto-detected folders", () => {
  const profile = path.join(tmpdir(), "capital-backup-profile");
  const consumer = path.join(tmpdir(), "Personal OneDrive");
  const profileOneDrive = path.join(profile, "OneDrive");
  const isOneDrive = (candidate: string) => /onedrive/i.test(candidate);

  it("checks every Google Drive location before any OneDrive one", () => {
    const candidates = defaultDriveCandidates({ USERPROFILE: profile, OneDrive: profileOneDrive, OneDriveConsumer: consumer });
    const firstOneDrive = candidates.findIndex(isOneDrive);

    expect(candidates[0]).toBe("G:\\My Drive");
    expect(candidates.slice(0, firstOneDrive)).toEqual(expect.arrayContaining([path.join(profile, "Google Drive"), path.join(profile, "My Drive"), "Z:\\My Drive"]));
    expect(candidates.slice(firstOneDrive).some((candidate) => /My Drive|Google Drive/.test(candidate))).toBe(false);
  });

  it("tries %OneDrive% then %OneDriveConsumer% then the profile OneDrive folder, without repeating one", () => {
    expect(
      defaultDriveCandidates({ USERPROFILE: profile, OneDrive: profileOneDrive, OneDriveConsumer: consumer }).filter(isOneDrive)
    ).toEqual([profileOneDrive, consumer]);

    expect(defaultDriveCandidates({ USERPROFILE: profile, OneDrive: "E:\\Work OneDrive" }).filter(isOneDrive)).toEqual([
      "E:\\Work OneDrive",
      profileOneDrive
    ]);

    expect(
      defaultDriveCandidates({ USERPROFILE: profile, OneDrive: profileOneDrive, OneDriveConsumer: profileOneDrive }).filter(isOneDrive)
    ).toEqual([profileOneDrive]);
  });

  it("skips OneDrive variables that are unset or blank", () => {
    expect(defaultDriveCandidates({ USERPROFILE: profile, OneDrive: "  ", OneDriveConsumer: undefined }).filter(isOneDrive)).toEqual([
      profileOneDrive
    ]);
  });

  it("puts the backup in a CoLateral Marketing Backups folder inside OneDrive", () => {
    const oneDrive = temp("onedrive");
    const candidates = defaultDriveCandidates({ USERPROFILE: path.join(tmpdir(), "no-such-profile-xyz"), OneDrive: oneDrive }).filter(
      (candidate) => candidate === oneDrive
    );
    expect(resolveBackupDir({ env: {}, candidates })).toEqual({ dir: path.join(oneDrive, BACKUP_FOLDER_NAME), source: "auto-detected" });
  });
});

describe("where the backup goes", () => {
  it("uses a CoLateral Marketing Backups folder inside BACKUP_DRIVE_DIR", () => {
    const drive = temp("drive");
    const found = resolveBackupDir({ env: { BACKUP_DRIVE_DIR: drive }, candidates: [] });
    expect(found).toEqual({ dir: path.join(drive, BACKUP_FOLDER_NAME), source: "BACKUP_DRIVE_DIR" });
    expect(BACKUP_FOLDER_NAME).toBe("CoLateral Marketing Backups");
  });

  it("does not nest the folder when BACKUP_DRIVE_DIR already names it", () => {
    const drive = path.join(temp("drive"), BACKUP_FOLDER_NAME);
    mkdirSync(drive);
    expect(resolveBackupDir({ env: { BACKUP_DRIVE_DIR: drive }, candidates: [] })?.dir).toBe(drive);
  });

  it("prefers BACKUP_DRIVE_DIR over CLIPS_DRIVE_DIR and over auto-detection", () => {
    const backup = temp("backup");
    const clips = temp("clips");
    const auto = temp("auto");
    expect(resolveBackupDir({ env: { BACKUP_DRIVE_DIR: backup, CLIPS_DRIVE_DIR: clips }, candidates: [auto] })?.source).toBe("BACKUP_DRIVE_DIR");
    expect(resolveBackupDir({ env: { CLIPS_DRIVE_DIR: clips }, candidates: [auto] })?.source).toBe("CLIPS_DRIVE_DIR");
  });

  it("auto-detects the first Google Drive folder that exists", () => {
    const missing = path.join(tmpdir(), "definitely-not-here-xyz");
    const mine = temp("mydrive");
    const other = temp("other");
    const found = resolveBackupDir({ env: {}, candidates: [missing, mine, other] });
    expect(found).toEqual({ dir: path.join(mine, BACKUP_FOLDER_NAME), source: "auto-detected" });
  });

  it("finds nothing when no drive folder exists", () => {
    expect(resolveBackupDir({ env: {}, candidates: [path.join(tmpdir(), "definitely-not-here-xyz")] })).toBeNull();
  });

  it("an explicit folder is used exactly as given", () => {
    const dest = temp("exact");
    expect(resolveBackupDir({ explicit: dest, env: { BACKUP_DRIVE_DIR: temp("x") }, candidates: [] })).toEqual({
      dir: dest,
      source: "argument"
    });
  });

  it("fails with a clear message when BACKUP_DRIVE_DIR points at a folder that is not there", async () => {
    const { root, data } = seed();
    const missing = path.join(tmpdir(), "drive-not-mounted-xyz");
    const result = await runStateBackup({
      dataDir: data,
      rootDir: root,
      env: { BACKUP_DRIVE_DIR: missing },
      driveCandidates: [],
      now: nightly
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(missing);
    expect(existsSync(missing)).toBe(false);
  });

  it("fails with instructions when there is no destination at all", async () => {
    const { root, data } = seed();
    const result = await runStateBackup({ dataDir: data, rootDir: root, env: {}, driveCandidates: [], now: nightly });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/BACKUP_DRIVE_DIR/);
      expect(result.error).toMatch(/Google Drive/);
      expect(result.error).toMatch(/OneDrive/);
    }
  });

  it("writes into the auto-detected folder", async () => {
    const { root, data } = seed();
    const drive = temp("drive");
    const result = await runStateBackup({
      dataDir: data,
      rootDir: root,
      env: {},
      driveCandidates: [drive],
      now: nightly,
      limits: LIMITS
    });
    expect(result.ok).toBe(true);
    expect(readdirSync(path.join(drive, BACKUP_FOLDER_NAME))).toEqual(["capital-command-state-20261013-0330.zip"]);
  });
});
