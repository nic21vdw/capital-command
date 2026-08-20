import { config } from "dotenv";
config({ path: path.join(process.cwd(), ".env"), quiet: true });
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFfmpeg } from "@/lib/clipping/ffmpeg";
import { readSourceMeta, sourceFilePath } from "@/lib/clipping/sources";

const W = 256, H = 144;

type Metrics = { axis: number; diag: number; flat: number };

function metrics(g: Uint8Array): Metrics {
  let axis = 0, diag = 0, flat = 0, total = 0;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const gx = Math.abs(g[i + 1] - g[i - 1]);
      const gy = Math.abs(g[i + W] - g[i - W]);
      const mag = gx + gy;
      total += 1;
      if (mag < 6) { flat += 1; continue; }
      const strong = Math.max(gx, gy), weak = Math.min(gx, gy);
      if (strong > 18 && weak < strong * 0.25) axis += 1;
      else diag += 1;
    }
  }
  return { axis: axis / total, diag: diag / total, flat: flat / total };
}

async function sample(sourceId: string, label: string) {
  const meta = await readSourceMeta(sourceId);
  if (!meta) return console.log(label, "no meta");
  const dir = await mkdtemp(path.join(tmpdir(), "cal-"));
  const rows: Metrics[] = [];
  for (let k = 1; k <= 9; k += 1) {
    const out = path.join(dir, `${k}.gray`);
    try {
      await runFfmpeg(["-hide_banner","-loglevel","error","-ss",String(meta.durationSec*k/10),"-i",sourceFilePath(meta),
        "-frames:v","1","-vf",`scale=${W}:${H},format=gray`,"-f","rawvideo","-pix_fmt","gray","-y",out]);
      const b = await readFile(out);
      if (b.length >= W*H) rows.push(metrics(new Uint8Array(b)));
    } catch {}
  }
  await rm(dir, { recursive: true, force: true });
  const avg = (pick: (row: Metrics) => number) => rows.reduce((sum, row) => sum + pick(row), 0) / (rows.length || 1);
  console.log(
    label.padEnd(34),
    "n=" + rows.length,
    "axis=" + avg((row) => row.axis).toFixed(4),
    "flat=" + avg((row) => row.flat).toFixed(4),
    "diag=" + avg((row) => row.diag).toFixed(4)
  );
}

async function main() {
  const pairs = process.argv.slice(2);
  for (const pair of pairs) {
    const [id, ...label] = pair.split(":");
    await sample(id, label.join(":"));
  }
}
main();
