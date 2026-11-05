import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "colateral-marketing";

export const OWNER_ONLY_PATHS = [
  ".github",
  ".claude",
  "AGENTS.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  "LOCAL_SETUP.md",
  "PRIVACY.md",
  "TERMS.md",
  "README.md",
  "docs",
  "site",
  "qa",
  "samples",
  "video",
  "remotion",
  "remotion.config.ts",
  "signal-free-ai-builds",
  "Capital Command.bat",
  "CoLateral Marketing.bat",
  "Update CoLateral Marketing.bat",
  "update-capital-command.bat",
  "start-capital-command.bat",
  "launch-colateral-command-dashboard.bat",
  "launch-remotion-studio.bat",
  "backup-to-drive.bat",
  "scripts/update-app.ps1",
  "scripts/update-timing.ps1",
  "scripts/dev-worktree.ps1",
  "scripts/backup-runner.ps1",
  "scripts/register-backup-task.ps1",
  "scripts/backup-state.ts",
  "scripts/restore-state.ts",
  "scripts/tap-sweep.cjs",
  "scripts/marketing-package.mjs",
  "scripts/marketing-package.d.mts",
  "src/app/finance",
  "src/app/holdings",
  "src/app/watchlist",
  "src/app/goals",
  "src/app/presentation",
  "src/app/api/finance",
  "src/app/api/market",
  "src/app/api/presentation",
  "src/components/finance/billing-metric-card.tsx",
  "src/components/finance/billing-section.tsx",
  "src/components/finance/expense-section.tsx",
  "src/components/finance/finance-page.tsx",
  "src/components/finance/finances-page.tsx",
  "src/components/holdings",
  "src/components/watchlist",
  "src/components/goals",
  "src/remotion",
  "src/lib/remotion",
  "src/lib/brand/prompt-parity.before.json"
];

export const SHIPPED_DOCS = ["docs/LINKEDIN_SETUP.md", "docs/INSTAGRAM_SETUP.md"];

export const OWNER_ONLY_FILE_PATTERNS = [/\.test\.(ts|tsx|mjs|cjs|js)$/, /(^|\/)tiktok[^/]*\.txt$/i, /(^|\/)__snapshots__\//];

export const SHIPPED_ROUTE_DIRS_ABSENT = [
  "src/app/finance",
  "src/app/holdings",
  "src/app/watchlist",
  "src/app/goals",
  "src/app/presentation",
  "src/app/api/finance",
  "src/app/api/market"
];

export const LEAK_TERMS = [
  /vandewetering/i,
  /nic21vdw/i,
  /\bnic21\b/i,
  /poopchairs/i,
  /wealthsimple/i,
  /questrade/i,
  /\bEQ Bank\b/i,
  /nicer\s+car/i,
  /C:\\+Users\\+nic/i,
  /GitOrigin/,
  /OneDrive\\+CoLateral/i
];

export const SECRET_PATTERNS = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/,
  /\bxai-[A-Za-z0-9]{40,}/,
  /\bEAA[A-Za-z0-9]{60,}/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bya29\.[0-9A-Za-z_-]{40,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".txt", ".css", ".html", ".svg", ".yml", ".yaml",
  ".ps1", ".bat", ".cmd", ".sh", ".py", ".env", ".example", ".toml", ".xml", ".csv", ""
]);

const EDITION_SOURCE = "src/lib/edition.ts";
const EDITION_OWNER_LINE = 'export const EDITION = "owner" as Edition;';
const EDITION_PUBLIC_LINE = 'export const EDITION = "public" as Edition;';
const IDENTITY_SOURCE = "src/lib/brand/owner-identity.ts";
const IDENTITY_PUBLIC_SOURCE = "src/lib/brand/owner-identity.public.ts";

function extensionOf(file) {
  const base = file.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export function walkFiles(root, skip = new Set(["node_modules", ".next", ".git"])) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(root);
  return out.sort();
}

export function isOwnerOnly(file) {
  if (SHIPPED_DOCS.includes(file)) return false;
  if (OWNER_ONLY_PATHS.some((path) => file === path || file.startsWith(`${path}/`))) return true;
  return OWNER_ONLY_FILE_PATTERNS.some((pattern) => pattern.test(file));
}

export function findLeaks(file, text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of LEAK_TERMS) {
      if (pattern.test(line)) problems.push({ file, line: index + 1, kind: "identity", match: pattern.source });
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(line)) problems.push({ file, line: index + 1, kind: "secret", match: pattern.source });
    }
  });
  return problems;
}

export function auditPackage(root) {
  const problems = [];
  const files = walkFiles(root);
  for (const file of files) {
    const base = file.split("/").pop() ?? "";
    if (/^\.env($|\.)/.test(base) && base !== ".env.example") {
      problems.push({ file, line: 0, kind: "secret", match: "an .env file" });
    }
    if (file.startsWith("data/") && file !== "data/.gitkeep") {
      problems.push({ file, line: 0, kind: "data", match: "app data" });
    }
    if (isOwnerOnly(file)) problems.push({ file, line: 0, kind: "owner-only", match: "owner-only file" });
    if (!TEXT_EXTENSIONS.has(extensionOf(file))) continue;
    if (statSync(join(root, file)).size > 8_000_000) continue;
    const raw = readFileSync(join(root, file));
    if (raw.includes(0)) continue;
    problems.push(...findLeaks(file, raw.toString("utf8")));
  }
  for (const dir of SHIPPED_ROUTE_DIRS_ABSENT) {
    if (existsSync(join(root, dir))) problems.push({ file: dir, line: 0, kind: "owner-only", match: "personal route" });
  }
  const edition = existsSync(join(root, EDITION_SOURCE)) ? readFileSync(join(root, EDITION_SOURCE), "utf8") : "";
  if (!edition.includes(EDITION_PUBLIC_LINE)) {
    problems.push({ file: EDITION_SOURCE, line: 0, kind: "edition", match: "not the public edition" });
  }
  return problems;
}

export function trimPackageScripts(pkg, root) {
  const scripts = {};
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    const referenced = [...String(command).matchAll(/(?:^|[\s"'\\/.])((?:scripts|src)[\\/][^\s"']+)/g)].map((match) =>
      match[1].replaceAll("\\", "/")
    );
    if (/powershell|\.ps1/.test(command) && referenced.length === 0) continue;
    if (referenced.every((path) => existsSync(join(root, path)))) scripts[name] = command;
  }
  return { ...pkg, name: PACKAGE_NAME, private: true, scripts };
}

export const START_BAT = [
  "@echo off",
  "title CoLateral Marketing",
  'cd /d "%~dp0"',
  "where node >nul 2>nul",
  "if errorlevel 1 (",
  "  echo CoLateral Marketing needs Node.js 20 or newer. Install it from https://nodejs.org and run this again.",
  "  pause",
  "  exit /b 1",
  ")",
  'if not exist ".env" copy ".env.example" ".env" >nul',
  'if not exist "node_modules" (',
  "  echo Installing CoLateral Marketing. This happens once and takes a few minutes.",
  "  call npm ci --no-audit --no-fund",
  "  if errorlevel 1 ( pause & exit /b 1 )",
  ")",
  'if not exist ".next\\BUILD_ID" (',
  "  echo Building CoLateral Marketing. This happens once and can take several minutes.",
  "  call npm run build",
  "  if errorlevel 1 ( pause & exit /b 1 )",
  ")",
  "echo CoLateral Marketing is running at http://127.0.0.1:3000. Open the Marketing card in CoLateral, or that address in a browser.",
  "echo Close this window to stop it.",
  "call npm start",
  ""
].join("\r\n");

export const START_SH = [
  "#!/usr/bin/env sh",
  "set -e",
  'cd "$(dirname "$0")"',
  'command -v node >/dev/null 2>&1 || { echo "CoLateral Marketing needs Node.js 20 or newer: https://nodejs.org"; exit 1; }',
  "[ -f .env ] || cp .env.example .env",
  "[ -d node_modules ] || npm ci --no-audit --no-fund",
  "[ -f .next/BUILD_ID ] || npm run build",
  'echo "CoLateral Marketing is running at http://127.0.0.1:3000"',
  "exec npm start",
  ""
].join("\n");

export const README = [
  "CoLateral Marketing",
  "===================",
  "",
  "Turn a stream or a video into long-form edits, short clips, carousels, podcast",
  "episodes and posts, then schedule them from one place. It runs on your own",
  "computer at http://127.0.0.1:3000, and the Marketing card in CoLateral opens it.",
  "",
  "Start it",
  "  Windows: double-click \"Start CoLateral Marketing.bat\".",
  "  macOS / Linux: run ./start.sh",
  "",
  "The first start installs and builds the app, which takes a few minutes. You need",
  "Node.js 20 or newer (https://nodejs.org).",
  "",
  "Your data and keys",
  "  Everything the app makes stays in the data folder next to this file. API keys",
  "  go in .env (created from .env.example on first start) and never leave your",
  "  computer. Nothing posts until you connect an account in Settings and switch",
  "  posting on.",
  ""
].join("\n");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32", windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

export function stagePackage({ repo, out, ref = "HEAD" }) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const tarball = `${out}.tar`;
  execFileSync("git", ["-C", repo, "archive", "--format=tar", "-o", tarball, ref]);
  execFileSync("tar", ["-xf", tarball, "-C", out]);
  rmSync(tarball, { force: true });

  for (const file of walkFiles(out)) {
    if (isOwnerOnly(file)) rmSync(join(out, file), { force: true });
  }
  for (const path of OWNER_ONLY_PATHS.filter((path) => !SHIPPED_DOCS.some((doc) => doc.startsWith(`${path}/`)))) {
    rmSync(join(out, path), { recursive: true, force: true });
  }

  const editionFile = join(out, EDITION_SOURCE);
  const edition = readFileSync(editionFile, "utf8");
  if (!edition.includes(EDITION_OWNER_LINE)) throw new Error(`${EDITION_SOURCE} no longer has the line the packager switches.`);
  writeFileSync(editionFile, edition.replace(EDITION_OWNER_LINE, EDITION_PUBLIC_LINE));
  copyFileSync(join(out, IDENTITY_PUBLIC_SOURCE), join(out, IDENTITY_SOURCE));
  rmSync(join(out, IDENTITY_PUBLIC_SOURCE), { force: true });

  const pkgFile = join(out, "package.json");
  const pkg = trimPackageScripts(JSON.parse(readFileSync(pkgFile, "utf8")), out);
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

  rmSync(join(out, "data"), { recursive: true, force: true });
  mkdirSync(join(out, "data"), { recursive: true });
  writeFileSync(join(out, "data", ".gitkeep"), "");
  writeFileSync(join(out, "Start CoLateral Marketing.bat"), START_BAT);
  writeFileSync(join(out, "start.sh"), START_SH, { mode: 0o755 });
  writeFileSync(join(out, "README.txt"), README);
  return auditPackage(out);
}

function parseArgs(argv) {
  const args = { build: false, zip: false, ref: "HEAD", out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--build") args.build = true;
    else if (arg === "--zip") args.zip = true;
    else if (arg === "--ref") args.ref = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
}

function zipPackage(out) {
  const zip = `${out}.zip`;
  rmSync(zip, { force: true });
  const parent = dirname(out);
  const name = out.split(/[\\/]/).pop();
  if (process.platform === "win32") {
    run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}'`], parent);
  } else {
    run("zip", ["-qr", zip, name, "-x", `${name}/node_modules/*`, `${name}/.next/cache/*`], parent);
  }
  return zip;
}

function main() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.out ?? join(repo, "dist", PACKAGE_NAME));
  const problems = stagePackage({ repo, out, ref: args.ref });
  if (problems.length > 0) {
    console.error(`Refusing to package: ${problems.length} problem(s) in ${out}`);
    for (const problem of problems.slice(0, 50)) {
      console.error(`  ${problem.kind}: ${problem.file}${problem.line ? `:${problem.line}` : ""} (${problem.match})`);
    }
    process.exit(1);
  }
  console.log(`Staged the public edition at ${out}; no owner data, credentials or personal routes found.`);
  if (args.build) {
    run("npm", ["ci", "--no-audit", "--no-fund"], out);
    run("npm", ["run", "build"], out);
    const after = auditPackage(out);
    if (after.length > 0) {
      console.error(`The build left ${after.length} problem(s) behind.`);
      process.exit(1);
    }
    console.log("Built the public edition.");
  }
  if (args.zip) {
    if (args.build) rmSync(join(out, "node_modules"), { recursive: true, force: true });
    if (args.build) rmSync(join(out, ".next", "cache"), { recursive: true, force: true });
    console.log(`Wrote ${zipPackage(out)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
