import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus", ".webm"]);

const MIME_BY_EXTENSION = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".opus": "audio/opus",
  ".webm": "audio/webm"
};

const ILLEGAL_NAME_CHARS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

const repoRoot = process.env.CC_REPO_ROOT || process.cwd();
const appUrl = (process.env.CC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const libraryDir = process.env.MUSIC_LIBRARY_DIR || path.join(os.homedir(), "Music", "Capital Command");
const dropInDir = path.join(libraryDir, "Drop-in");
const importedDir = path.join(dropInDir, "imported");
const manifestFile = path.join(libraryDir, ".exported.json");

function safeFileName(name) {
  const kept = [...name].filter((char) => !ILLEGAL_NAME_CHARS.has(char) && char.charCodeAt(0) > 31);
  return kept.join("").replace(/\s+/g, " ").trim();
}

async function readManifest() {
  try {
    const parsed = JSON.parse(await readFile(manifestFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function fetchLibrary() {
  const res = await fetch(`${appUrl}/api/longform/music`);
  if (!res.ok) throw new Error(`The app answered HTTP ${res.status} — is it running at ${appUrl}?`);
  const body = await res.json();
  return Array.isArray(body.tracks) ? body.tracks : [];
}

function folderFor(track) {
  const origin = track.origin;
  if (!origin) return "Uploaded";
  if (origin.provider === "fal") {
    return path.join("Generated", safeFileName(origin.modelLabel || origin.modelId || "fal"));
  }
  return safeFileName(origin.provider) || "Uploaded";
}

async function claimName(dir, base, extension, taken) {
  let candidate = `${base}${extension}`;
  let counter = 2;
  while (taken.has(path.join(dir, candidate).toLowerCase()) || (await exists(path.join(dir, candidate)))) {
    candidate = `${base} (${counter})${extension}`;
    counter += 1;
  }
  taken.add(path.join(dir, candidate).toLowerCase());
  return candidate;
}

async function exportLibrary() {
  const tracks = await fetchLibrary();
  const manifest = await readManifest();
  const taken = new Set();
  let written = 0;
  let skipped = 0;

  for (const track of tracks) {
    const source = path.join(repoRoot, "data", "longform", "music", track.id, track.storedName);
    if (!(await exists(source))) {
      console.log(`missing on disk, skipped: ${track.fileName}`);
      continue;
    }
    const recorded = manifest[track.id];
    if (recorded && (await exists(path.join(libraryDir, recorded)))) {
      taken.add(path.join(libraryDir, recorded).toLowerCase());
      skipped += 1;
      continue;
    }

    const targetDir = path.join(libraryDir, folderFor(track));
    await mkdir(targetDir, { recursive: true });
    const extension = path.extname(track.storedName) || path.extname(track.fileName) || ".mp3";
    const base = safeFileName(path.basename(track.fileName, path.extname(track.fileName))) || track.id;
    const name = await claimName(targetDir, base, extension, taken);
    await copyFile(source, path.join(targetDir, name));
    manifest[track.id] = path.relative(libraryDir, path.join(targetDir, name));
    written += 1;
    console.log(`exported ${manifest[track.id]}`);
  }

  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`export: ${written} new, ${skipped} already there — ${libraryDir}`);
}

async function importDropIn() {
  await mkdir(dropInDir, { recursive: true });
  const entries = await readdir(dropInDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name);

  if (files.length === 0) {
    console.log(`import: nothing waiting in ${dropInDir}`);
    return;
  }

  await mkdir(importedDir, { recursive: true });
  for (const name of files) {
    const source = path.join(dropInDir, name);
    const extension = path.extname(name).toLowerCase();
    const res = await fetch(`${appUrl}/api/longform/music?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": MIME_BY_EXTENSION[extension] || "audio/mpeg" },
      body: Readable.toWeb(createReadStream(source)),
      duplex: "half"
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.track) {
      console.log(`failed: ${name} — ${body?.error ?? `HTTP ${res.status}`}`);
      continue;
    }
    await rename(source, path.join(importedDir, name));
    console.log(`imported ${name} -> library track ${body.track.id}`);
  }
}

const command = process.argv[2] || "sync";
if (!["export", "import", "sync"].includes(command)) {
  console.error("usage: node scripts/music-library.mjs [export|import|sync]");
  process.exit(1);
}

await mkdir(libraryDir, { recursive: true });
if (command === "import" || command === "sync") await importDropIn();
if (command === "export" || command === "sync") await exportLibrary();
