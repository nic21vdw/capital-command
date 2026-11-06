import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workload = path.join(here, "workload.ts");
const PAGE = 4096;

function parseArgs(argv) {
  const options = { trees: [], runs: 3, scenarios: ["longform-export", "clip-job", "short-export", "youtube-upload"], out: "bench-results", topic: [1230, 1320], clips: 3, shortStart: 1320 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--tree") { const [name, dir] = value.split("="); options.trees.push({ name, dir: path.resolve(dir) }); i += 1; }
    else if (flag === "--source") { options.source = path.resolve(value); i += 1; }
    else if (flag === "--runs") { options.runs = Number(value); i += 1; }
    else if (flag === "--scenarios") { options.scenarios = value.split(","); i += 1; }
    else if (flag === "--out") { options.out = path.resolve(value); i += 1; }
    else if (flag === "--topic") { options.topic = value.split(",").map(Number); i += 1; }
    else if (flag === "--short-start") { options.shortStart = Number(value); i += 1; }
    else if (flag === "--clips") { options.clips = Number(value); i += 1; }
    else if (flag === "--upload-file") { options.uploadFile = path.resolve(value); i += 1; }
  }
  if (options.trees.length === 0 || !options.source) {
    throw new Error("usage: node scripts/bench/run.mjs --tree main=<dir> --tree branch=<dir> --source <video> [--runs 3] [--scenarios a,b] [--out dir]");
  }
  return options;
}

function readStat(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = text.lastIndexOf(")");
    const comm = text.slice(text.indexOf("(") + 1, close);
    const fields = text.slice(close + 2).split(" ");
    return { comm, rssBytes: Number(fields[21]) * PAGE };
  } catch {
    return null;
  }
}

function readArgs(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).slice(1).join(" ").slice(0, 4000);
  } catch {
    return "";
  }
}

function children(pid) {
  const found = [];
  try {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      const text = readFileSync(`/proc/${pid}/task/${tid}/children`, "utf8").trim();
      if (text) found.push(...text.split(" ").map(Number));
    }
  } catch {
    return found;
  }
  return found;
}

function sampleTree(root) {
  const stack = [root];
  let total = 0;
  let node = 0;
  const ffmpeg = [];
  while (stack.length) {
    const pid = stack.pop();
    const info = readStat(pid);
    if (!info) continue;
    total += info.rssBytes;
    if (info.comm === "ffmpeg") ffmpeg.push({ pid, rssBytes: info.rssBytes });
    else if (info.comm.startsWith("node") || info.comm === "MainThread") node = Math.max(node, info.rssBytes);
    stack.push(...children(pid));
  }
  return { total, node, ffmpeg };
}

function runMeasured(tree, env, args, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const tsx = path.join(tree.dir, "node_modules", ".bin", "tsx");
    const started = process.hrtime.bigint();
    const child = spawn(tsx, [workload, ...args], { cwd: tree.dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-20000); });
    let peak = 0;
    let peakNode = 0;
    let maxConcurrentFfmpeg = 0;
    const ffmpegPeaks = new Map();
    const timer = setInterval(() => {
      const sample = sampleTree(child.pid);
      peak = Math.max(peak, sample.total);
      peakNode = Math.max(peakNode, sample.node);
      maxConcurrentFfmpeg = Math.max(maxConcurrentFfmpeg, sample.ffmpeg.length);
      for (const { pid, rssBytes } of sample.ffmpeg) {
        const seen = ffmpegPeaks.get(pid);
        if (!seen) ffmpegPeaks.set(pid, { rssBytes, args: readArgs(pid) });
        else seen.rssBytes = Math.max(seen.rssBytes, rssBytes);
      }
    }, intervalMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearInterval(timer);
      const wallSec = Number(process.hrtime.bigint() - started) / 1e9;
      const line = stdout.split("\n").find((entry) => entry.startsWith("BENCH_RESULT "));
      if (code !== 0 || !line) {
        reject(new Error(`${args[0]} on ${tree.name} exited ${code}: ${stderr.slice(-3000)}`));
        return;
      }
      const result = JSON.parse(line.slice("BENCH_RESULT ".length));
      const heaviest = [...ffmpegPeaks.values()].sort((a, b) => b.rssBytes - a.rssBytes)[0];
      resolve({
        wallSec,
        peakRssMb: peak / 2 ** 20,
        peakNodeRssMb: peakNode / 2 ** 20,
        ffmpegProcesses: result.spawned?.ffmpeg ?? ffmpegPeaks.size,
        ffmpegProcessesSampled: ffmpegPeaks.size,
        heaviestFfmpeg: heaviest ? { peakRssMb: heaviest.rssBytes / 2 ** 20, args: heaviest.args } : null,
        maxConcurrentFfmpeg,
        result
      });
    });
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

function decodedMd5(file, stream) {
  try {
    const out = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-map", `0:${stream}:0?`, "-f", "md5", "-"], { encoding: "utf8", maxBuffer: 1 << 20 });
    return out.trim().replace(/^MD5=/, "") || null;
  } catch {
    return null;
  }
}

function streamParams(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries",
    "stream=codec_name,profile,width,height,sample_aspect_ratio,pix_fmt,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels,duration,color_range,color_space:format=duration",
    "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(out);
}

function spawnSyncCapture(args) {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    child.on("close", () => resolve(stderr));
  });
}

async function compareOutputs(reference, candidate) {
  const [refHash, candHash] = await Promise.all([sha256File(reference), sha256File(candidate)]);
  const comparison = { referenceSha256: refHash, candidateSha256: candHash, byteIdentical: refHash === candHash };
  if (comparison.byteIdentical) return comparison;
  comparison.videoMd5 = [decodedMd5(reference, "v"), decodedMd5(candidate, "v")];
  comparison.audioMd5 = [decodedMd5(reference, "a"), decodedMd5(candidate, "a")];
  comparison.decodedVideoIdentical = comparison.videoMd5[0] !== null && comparison.videoMd5[0] === comparison.videoMd5[1];
  comparison.decodedAudioIdentical = comparison.audioMd5[0] === comparison.audioMd5[1];
  comparison.streams = [streamParams(reference), streamParams(candidate)];
  if (!comparison.decodedVideoIdentical) {
    const psnr = (await spawnSyncCapture(["-nostats", "-i", candidate, "-i", reference, "-lavfi", "[0:v][1:v]psnr", "-f", "null", "-"])).match(/average:([\d.]+|inf)/);
    const ssim = (await spawnSyncCapture(["-nostats", "-i", candidate, "-i", reference, "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-"])).match(/All:([\d.]+)/);
    comparison.psnrDb = psnr ? psnr[1] : null;
    comparison.ssim = ssim ? Number(ssim[1]) : null;
  }
  return comparison;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function startMock() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, "mock-youtube.mjs"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/MOCK_READY (\d+)/);
      if (match) resolve({ child, base: `http://127.0.0.1:${match[1]}` });
    });
    child.on("error", reject);
  });
}

function benchEnv(dataDir) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
    CAPITAL_COMMAND_DATA_DIR: dataDir,
    CLIP_WRITER: "off",
    CAROUSEL_WRITER: "off",
    CLIP_FACE_FRAMING: "off",
    INBOX_SYNC_ENABLED: "false",
    ANALYTICS_SYNC: "off",
    RENDER_MIN_FREE_GB: "0",
    PUBLISH_TIMEZONE: "America/Toronto"
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.out, { recursive: true });
  const sourceId = "benchsource01";
  const uploadFile = options.uploadFile ?? options.source;
  const state = {};
  for (const tree of options.trees) {
    const dataDir = path.join(options.out, `data-${tree.name}`);
    await rm(dataDir, { recursive: true, force: true });
    await mkdir(dataDir, { recursive: true });
    const env = benchEnv(dataDir);
    await runMeasured(tree, env, ["register-source", options.source, sourceId]);
    state[tree.name] = { env, dataDir };
    if (options.scenarios.includes("longform-export")) {
      const prep = await runMeasured(tree, env, ["longform-prepare", sourceId, String(options.topic[0]), String(options.topic[1])]);
      state[tree.name].projectId = prep.result.projectId;
      state[tree.name].prepare = prep;
      console.log(`[${tree.name}] long-form analysis: ${prep.wallSec.toFixed(1)} s, peak ${prep.peakRssMb.toFixed(0)} MB`);
    }
  }
  let mock;
  if (options.scenarios.includes("youtube-upload")) mock = await startMock();
  const runs = [];
  try {
    for (const scenario of options.scenarios) {
      for (let attempt = 1; attempt <= options.runs; attempt += 1) {
        const order = attempt % 2 === 1 ? options.trees : [...options.trees].reverse();
        for (const tree of order) {
          const { env, projectId } = state[tree.name];
          const args =
            scenario === "longform-export" ? [scenario, projectId] :
            scenario === "clip-job" ? [scenario, sourceId, String(options.clips)] :
            scenario === "short-export" ? [scenario, sourceId, String(options.shortStart)] :
            [scenario, mock.base, uploadFile];
          const measured = await runMeasured(tree, env, args);
          runs.push({ scenario, tree: tree.name, attempt, ...measured });
          console.log(`[${tree.name}] ${scenario} #${attempt}: ${measured.wallSec.toFixed(1)} s, peak tree RSS ${measured.peakRssMb.toFixed(0)} MB (node ${measured.peakNodeRssMb.toFixed(0)} MB), ffmpeg ${measured.ffmpegProcesses}, heaviest ffmpeg ${measured.heaviestFfmpeg ? measured.heaviestFfmpeg.peakRssMb.toFixed(0) : 0} MB`);
        }
      }
    }
  } finally {
    mock?.child.kill();
  }

  const summary = [];
  const comparisons = {};
  for (const scenario of options.scenarios) {
    for (const tree of options.trees) {
      const mine = runs.filter((run) => run.scenario === scenario && run.tree === tree.name);
      summary.push({
        scenario,
        tree: tree.name,
        runs: mine.length,
        medianWallSec: median(mine.map((run) => run.wallSec)),
        medianPeakRssMb: median(mine.map((run) => run.peakRssMb)),
        medianPeakNodeRssMb: median(mine.map((run) => run.peakNodeRssMb)),
        ffmpegProcesses: median(mine.map((run) => run.ffmpegProcesses)),
        maxConcurrentFfmpeg: Math.max(...mine.map((run) => run.maxConcurrentFfmpeg))
      });
    }
    if (options.trees.length >= 2) {
      const [reference, candidate] = options.trees.map((tree) => runs.filter((run) => run.scenario === scenario && run.tree === tree.name).at(-1));
      if (scenario === "youtube-upload") {
        comparisons[scenario] = { reference: reference.result.received, candidate: candidate.result.received, fileSha256: await sha256File(uploadFile) };
      } else {
        const pairs = [];
        const refOut = reference.result.outputs ?? [];
        const candOut = candidate.result.outputs ?? [];
        for (let i = 0; i < Math.max(refOut.length, candOut.length); i += 1) {
          if (!refOut[i] || !candOut[i]) { pairs.push({ index: i, missing: true }); continue; }
          pairs.push({ index: i, file: path.basename(candOut[i]), ...(await compareOutputs(refOut[i], candOut[i])) });
        }
        const repeat = runs.filter((run) => run.scenario === scenario && run.tree === candidate.tree).map((run) => run.result.outputs?.[0]).filter(Boolean);
        const repeatHashes = await Promise.all(repeat.filter(existsSync).map(sha256File));
        comparisons[scenario] = { pairs, candidateRunsDeterministic: new Set(repeatHashes).size <= 1 };
      }
    }
  }

  const report = { at: new Date().toISOString(), host: { cpus: execFileSync("nproc", { encoding: "utf8" }).trim(), ffmpeg: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0] }, options: { ...options, trees: options.trees }, prepare: Object.fromEntries(Object.entries(state).map(([name, value]) => [name, value.prepare ? { wallSec: value.prepare.wallSec, peakRssMb: value.prepare.peakRssMb } : null])), summary, comparisons, runs };
  await writeFile(path.join(options.out, "results.json"), JSON.stringify(report, null, 2));
  const lines = ["| Scenario | Tree | Runs | Median wall (s) | Median peak tree RSS (MB) | Median peak Node RSS (MB) | ffmpeg processes | Max concurrent ffmpeg |", "|---|---|---|---|---|---|---|---|"];
  for (const row of summary) {
    lines.push(`| ${row.scenario} | ${row.tree} | ${row.runs} | ${row.medianWallSec.toFixed(1)} | ${row.medianPeakRssMb.toFixed(0)} | ${row.medianPeakNodeRssMb.toFixed(0)} | ${row.ffmpegProcesses} | ${row.maxConcurrentFfmpeg} |`);
  }
  await writeFile(path.join(options.out, "results.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  console.log(JSON.stringify(comparisons, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
