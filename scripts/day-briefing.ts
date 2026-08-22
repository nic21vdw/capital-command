import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

/**
 * Builds a shareable briefing for one posting day: every piece going out, the
 * frame it starts on, where it lands and in what state, plus what is blocked.
 *
 * Reads the queues straight off disk so it can be pointed at the production
 * data folder from a sandbox without importing the app.
 *
 *   npx tsx scripts/day-briefing.ts [--date 2026-08-23] [--data <dir>] [--out <file.html>]
 */

const ZONE = "America/Toronto";

type PlatformState = { status?: string; attempts?: number; error?: string };

type QueueItem = {
  id: string;
  title: string;
  caption?: string;
  publishAt: string;
  clipPath?: string;
  imagePaths?: string[];
  mediaKind?: string;
  jobId?: string;
  platforms?: Record<string, PlatformState>;
};

type ThreadItem = {
  id: string;
  text: string;
  topic?: string;
  format?: string;
  publishAt: string;
  status?: string;
};

type Piece = {
  item: QueueItem;
  time: string;
  minutes: number;
  kind: "short" | "carousel" | "long";
  slides: number;
  mediaPath?: string;
  thumb?: string;
  missing: boolean;
  siblings: string[];
};

const NETWORKS = [
  { id: "youtube", label: "YouTube" },
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "facebook", label: "Facebook" }
];

const LIVE = new Set(["published", "posted", "live", "done", "complete", "completed"]);
const BOOKED = new Set(["scheduled", "queued", "uploaded", "processing"]);
const BROKEN = new Set(["failed", "error"]);

function args() {
  const map = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg.startsWith("--")) continue;
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      map.set(arg.slice(2), next);
      i += 1;
    } else {
      map.set(arg.slice(2), "true");
    }
  }
  return map;
}

function dayKeyOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(iso));
}

function clockOf(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
    .format(new Date(iso))
    .replace(/ /g, " ");
}

function minutesOf(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

function tomorrowKey(): string {
  const now = new Date(Date.now() + 86_400_000);
  return dayKeyOf(now.toISOString());
}

function longDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function relativeLabel(key: string, todayKey: string): string {
  const day = 86_400_000;
  const [y, m, d] = key.split("-").map(Number);
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const diff = (Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / day;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}

function stateOf(status?: string): "live" | "booked" | "broken" | "waiting" {
  const value = (status ?? "").toLowerCase();
  if (LIVE.has(value)) return "live";
  if (BROKEN.has(value)) return "broken";
  if (BOOKED.has(value)) return "booked";
  return "waiting";
}

function kindOf(item: QueueItem): "short" | "carousel" | "long" {
  if (item.mediaKind === "image" || (item.imagePaths?.length ?? 0) > 0) return "carousel";
  if (item.clipPath?.includes("longform")) return "long";
  return "short";
}

function mediaOf(item: QueueItem, root: string): string | undefined {
  const raw = item.imagePaths?.[0] ?? item.clipPath;
  if (!raw) return undefined;
  const normalised = raw.replace(/\\/g, path.sep).replace(/\//g, path.sep);
  return path.isAbsolute(normalised) ? normalised : path.join(root, normalised);
}

function thumbnail(source: string, kind: string, scratch: string, index: number): string | undefined {
  if (!ffmpegPath || !existsSync(source)) return undefined;
  const out = path.join(scratch, `thumb-${index}.jpg`);
  const seek = kind === "carousel" ? [] : ["-ss", "1.2"];
  try {
    execFileSync(ffmpegPath, [...seek, "-i", source, "-frames:v", "1", "-vf", "scale=220:-2", "-q:v", 6, "-y", out].map(String), {
      stdio: "ignore",
      timeout: 60_000
    });
  } catch {
    return undefined;
  }
  if (!existsSync(out)) return undefined;
  return `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slideCount(item: QueueItem, root: string): number {
  if (kindOf(item) !== "carousel") return 0;
  if (item.imagePaths?.length) return item.imagePaths.length;
  const first = mediaOf(item, root);
  if (!first) return 0;
  const dir = path.dirname(first);
  let count = 0;
  for (let i = 1; i <= 20; i += 1) {
    if (existsSync(path.join(dir, `slide-${String(i).padStart(2, "0")}.jpg`))) count += 1;
  }
  return count;
}

function main() {
  const flags = args();
  const dataDir = path.resolve(flags.get("data") ?? path.join(process.cwd(), "data"));
  const root = path.dirname(dataDir);
  const dateKey = flags.get("date") ?? tomorrowKey();
  const todayKey = dayKeyOf(new Date().toISOString());
  const outPath = path.resolve(flags.get("out") ?? path.join(process.cwd(), `day-briefing-${dateKey}.html`));

  const queue: QueueItem[] = JSON.parse(readFileSync(path.join(dataDir, "publish-queue.json"), "utf8"));
  const threadsPath = path.join(dataDir, "threads-queue.json");
  const threads: ThreadItem[] = existsSync(threadsPath) ? JSON.parse(readFileSync(threadsPath, "utf8")) : [];

  const dayItems = queue
    .filter((item) => dayKeyOf(item.publishAt) === dateKey)
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt));

  const byClip = new Map<string, QueueItem[]>();
  for (const item of queue) {
    const clip = item.clipPath ?? item.imagePaths?.[0];
    if (!clip) continue;
    const list = byClip.get(clip) ?? [];
    list.push(item);
    byClip.set(clip, list);
  }

  const scratch = mkdtempSync(path.join(tmpdir(), "day-briefing-"));
  const pieces: Piece[] = dayItems.map((item, index) => {
    const kind = kindOf(item);
    const mediaPath = mediaOf(item, root);
    const clip = item.clipPath ?? item.imagePaths?.[0];
    const siblings = (clip ? byClip.get(clip) ?? [] : [])
      .filter((other) => other.id !== item.id && dayKeyOf(other.publishAt) === dateKey)
      .map((other) => clockOf(other.publishAt));
    return {
      item,
      time: clockOf(item.publishAt),
      minutes: minutesOf(item.publishAt),
      kind,
      slides: slideCount(item, root),
      mediaPath,
      thumb: mediaPath ? thumbnail(mediaPath, kind, scratch, index) : undefined,
      missing: !mediaPath || !existsSync(mediaPath),
      siblings
    };
  });
  rmSync(scratch, { recursive: true, force: true });

  const networkCounts = new Map<string, { live: number; booked: number; waiting: number; broken: number }>();
  for (const network of NETWORKS) networkCounts.set(network.id, { live: 0, booked: 0, waiting: 0, broken: 0 });
  let posts = 0;
  for (const piece of pieces) {
    for (const [id, state] of Object.entries(piece.item.platforms ?? {})) {
      const bucket = networkCounts.get(id);
      if (!bucket) continue;
      bucket[stateOf(state.status)] += 1;
      posts += 1;
    }
  }

  const blocked = pieces.filter(
    (piece) =>
      piece.missing ||
      Object.values(piece.item.platforms ?? {}).some((state) => stateOf(state.status) === "broken")
  );

  const dayThreads = threads.filter((thread) => dayKeyOf(thread.publishAt) === dateKey);
  const html = render({
    dateKey,
    todayKey,
    pieces,
    posts,
    networkCounts,
    blocked,
    dayThreads,
    dataDir
  });
  writeFileSync(outPath, html, "utf8");
  console.log(`${pieces.length} pieces, ${posts} posts, ${dayThreads.length} threads -> ${outPath}`);
}

type RenderInput = {
  dateKey: string;
  todayKey: string;
  pieces: Piece[];
  posts: number;
  networkCounts: Map<string, { live: number; booked: number; waiting: number; broken: number }>;
  blocked: Piece[];
  dayThreads: ThreadItem[];
  dataDir: string;
};

function stateLabel(state: string): string {
  if (state === "live") return "Posted";
  if (state === "booked") return "Scheduled";
  if (state === "broken") return "Failed";
  return "Waiting";
}

function render(input: RenderInput): string {
  const { dateKey, todayKey, pieces, posts, networkCounts, blocked, dayThreads } = input;
  const shorts = pieces.filter((piece) => piece.kind === "short").length;
  const carousels = pieces.filter((piece) => piece.kind === "carousel").length;
  const longs = pieces.filter((piece) => piece.kind === "long").length;
  const first = pieces[0]?.time ?? "—";
  const last = pieces[pieces.length - 1]?.time ?? "—";
  const totals = { live: 0, booked: 0, waiting: 0, broken: 0 };
  for (const bucket of networkCounts.values()) {
    totals.live += bucket.live;
    totals.booked += bucket.booked;
    totals.waiting += bucket.waiting;
    totals.broken += bucket.broken;
  }

  const rows = pieces
    .map((piece) => {
      const chips = NETWORKS.filter((network) => piece.item.platforms?.[network.id])
        .map((network) => {
          const state = stateOf(piece.item.platforms?.[network.id]?.status);
          return `<span class="chip chip--${state}">${network.label}<em>${stateLabel(state)}</em></span>`;
        })
        .join("");
      const badge =
        piece.kind === "carousel"
          ? `<span class="badge badge--carousel">Carousel${piece.slides ? ` · ${piece.slides} slides` : ""}</span>`
          : piece.kind === "long"
            ? `<span class="badge badge--long">Long-form</span>`
            : `<span class="badge badge--short">Short</span>`;
      const thumb = piece.thumb
        ? `<img src="${piece.thumb}" alt="" loading="lazy">`
        : `<span class="thumb__missing">no file</span>`;
      const sibling = piece.siblings.length
        ? `<p class="note">Same clip carries the ${escapeHtml(piece.siblings.join(" and "))} slot too — one piece split across networks, not a gap</p>`
        : "";
      const missing = piece.missing
        ? `<p class="note note--warn">File not on disk: ${escapeHtml(piece.mediaPath ?? "unknown path")}</p>`
        : "";
      return `<article class="slot${piece.kind === "carousel" ? " slot--carousel" : ""}">
        <div class="slot__time"><time>${piece.time}</time></div>
        <div class="slot__thumb">${thumb}</div>
        <div class="slot__body">
          ${badge}
          <h3>${escapeHtml(piece.item.title)}</h3>
          <div class="chips">${chips || '<span class="chip chip--waiting">no network<em>unrouted</em></span>'}</div>
          ${sibling}
          ${missing}
        </div>
      </article>`;
    })
    .join("\n");

  const networkRows = NETWORKS.map((network) => {
    const bucket = networkCounts.get(network.id)!;
    const total = bucket.live + bucket.booked + bucket.waiting + bucket.broken;
    const width = (value: number) => (total ? (value / total) * 100 : 0);
    return `<tr>
      <th scope="row">${network.label}</th>
      <td class="num">${total}</td>
      <td class="bar">
        <span class="bar__seg bar__seg--live" style="width:${width(bucket.live)}%"></span>
        <span class="bar__seg bar__seg--booked" style="width:${width(bucket.booked)}%"></span>
        <span class="bar__seg bar__seg--waiting" style="width:${width(bucket.waiting)}%"></span>
        <span class="bar__seg bar__seg--broken" style="width:${width(bucket.broken)}%"></span>
      </td>
      <td class="num">${bucket.live}</td>
      <td class="num">${bucket.booked}</td>
      <td class="num">${bucket.waiting}</td>
    </tr>`;
  }).join("\n");

  const threadsBlock = dayThreads.length
    ? `<ul class="threads">${dayThreads
        .slice(0, 6)
        .map(
          (thread) =>
            `<li><span class="threads__time">${clockOf(thread.publishAt)}</span><p>${escapeHtml(
              thread.text.slice(0, 190)
            )}${thread.text.length > 190 ? "…" : ""}</p></li>`
        )
        .join("")}${
        dayThreads.length > 6 ? `<li class="threads__more">+ ${dayThreads.length - 6} more written for the day</li>` : ""
      }</ul>`
    : `<p class="empty">Nothing written yet — the Threads planner fills this day's 24 slots on its nightly run.</p>`;

  const blockedBlock = blocked.length
    ? `<ul class="blocked">${blocked
        .map(
          (piece) =>
            `<li><strong>${piece.time}</strong> ${escapeHtml(piece.item.title)} — ${
              piece.missing ? "media file missing on disk" : "a network reported a failure"
            }</li>`
        )
        .join("")}</ul>`
    : `<p class="clear">Every piece has its file and no network has reported a failure.</p>`;

  return `<title>Day ${dateKey.slice(5)} Rundown</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Public+Sans:wght@400;500;600&display=swap">
<style>
:root {
  --ground: #f6f5f2;
  --panel: #ffffff;
  --edge: #ddd9d0;
  --ink: #1b1a17;
  --ink-soft: #5f5b52;
  --ink-faint: #8d887d;
  --accent: #b8451f;
  --live: #2f6b46;
  --booked: #2b5c8a;
  --waiting: #a08a3c;
  --broken: #a32b25;
  --shadow: 0 1px 2px rgba(27, 26, 23, 0.06), 0 8px 24px rgba(27, 26, 23, 0.05);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #14140f;
    --panel: #1d1d18;
    --edge: #33322b;
    --ink: #f2efe7;
    --ink-soft: #b3ada0;
    --ink-faint: #837e73;
    --accent: #e2703f;
    --live: #63b183;
    --booked: #6ea6d8;
    --waiting: #d6b862;
    --broken: #e0736c;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 30px rgba(0, 0, 0, 0.35);
  }
}
:root[data-theme="dark"] {
  --ground: #14140f;
  --panel: #1d1d18;
  --edge: #33322b;
  --ink: #f2efe7;
  --ink-soft: #b3ada0;
  --ink-faint: #837e73;
  --accent: #e2703f;
  --live: #63b183;
  --booked: #6ea6d8;
  --waiting: #d6b862;
  --broken: #e0736c;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 30px rgba(0, 0, 0, 0.35);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: "Public Sans", ui-sans-serif, system-ui, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 980px; margin: 0 auto; padding: 48px 24px 96px; display: flex; flex-direction: column; gap: 40px; }
.masthead { display: flex; flex-direction: column; gap: 10px; border-bottom: 2px solid var(--ink); padding-bottom: 20px; }
.eyebrow {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent);
}
h1 { font-family: "Archivo", system-ui, sans-serif; font-size: clamp(34px, 6vw, 52px); font-weight: 700; margin: 0; letter-spacing: -0.02em; text-wrap: balance; }
.masthead p { margin: 0; color: var(--ink-soft); max-width: 62ch; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.stat { background: var(--panel); border: 1px solid var(--edge); border-radius: 4px; padding: 16px 18px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 4px; }
.stat__value { font-family: "Archivo", sans-serif; font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
.stat__label { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); }
.stat__detail { font-size: 13px; color: var(--ink-soft); }
section { display: flex; flex-direction: column; gap: 16px; }
h2 { font-family: "Archivo", sans-serif; font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; margin: 0; color: var(--ink-soft); border-bottom: 1px solid var(--edge); padding-bottom: 8px; }
.rundown { display: flex; flex-direction: column; gap: 10px; }
.slot { display: grid; grid-template-columns: 88px 76px 1fr; gap: 16px; align-items: start; background: var(--panel); border: 1px solid var(--edge); border-left: 3px solid var(--ink-faint); border-radius: 4px; padding: 14px 16px; box-shadow: var(--shadow); }
.slot--carousel { border-left-color: var(--accent); }
.slot__time time { font-family: "IBM Plex Mono", monospace; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.slot__thumb { position: relative; width: 76px; aspect-ratio: 9 / 16; border-radius: 3px; overflow: hidden; background: var(--ground); border: 1px solid var(--edge); display: grid; place-items: center; }
.slot__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.slot--carousel .slot__thumb { box-shadow: 3px 3px 0 0 var(--panel), 4px 4px 0 1px var(--edge); }
.thumb__missing { font-family: "IBM Plex Mono", monospace; font-size: 10px; color: var(--ink-faint); text-align: center; }
.slot__body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.slot__body h3 { font-family: "Archivo", sans-serif; font-size: 17px; font-weight: 600; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
.badge { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); }
.badge--carousel { color: var(--accent); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: baseline; gap: 6px; font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 999px; border: 1px solid currentColor; }
.chip em { font-family: "IBM Plex Mono", monospace; font-style: normal; font-size: 10px; font-weight: 400; opacity: 0.85; }
.chip--live { color: var(--live); }
.chip--booked { color: var(--booked); }
.chip--waiting { color: var(--waiting); }
.chip--broken { color: var(--broken); }
.note { margin: 0; font-size: 12px; color: var(--ink-faint); }
.note--warn { color: var(--broken); }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--edge); }
thead th { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); font-weight: 500; }
tbody th { font-family: "Archivo", sans-serif; font-weight: 600; }
.num { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; text-align: right; width: 64px; }
.bar { min-width: 180px; }
.bar__seg { display: inline-block; height: 10px; vertical-align: middle; }
.bar__seg--live { background: var(--live); }
.bar__seg--booked { background: var(--booked); }
.bar__seg--waiting { background: var(--waiting); }
.bar__seg--broken { background: var(--broken); }
.threads { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.threads li { display: grid; grid-template-columns: 88px 1fr; gap: 16px; align-items: baseline; }
.threads__time { font-family: "IBM Plex Mono", monospace; font-size: 13px; font-variant-numeric: tabular-nums; color: var(--ink-faint); }
.threads p { margin: 0; font-size: 14px; color: var(--ink-soft); max-width: 62ch; }
.threads__more { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--ink-faint); display: block; }
.blocked { margin: 0; padding-left: 18px; color: var(--broken); font-size: 14px; display: flex; flex-direction: column; gap: 6px; }
.clear, .empty { margin: 0; font-size: 14px; color: var(--ink-soft); }
footer { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: var(--ink-faint); border-top: 1px solid var(--edge); padding-top: 16px; }
@media (max-width: 620px) {
  .slot { grid-template-columns: 64px 1fr; }
  .slot__thumb { grid-row: 2; }
  .slot__body { grid-column: 2; }
  .threads li { grid-template-columns: 1fr; gap: 2px; }
}
</style>
<div class="wrap">
  <header class="masthead">
    <span class="eyebrow">${relativeLabel(dateKey, todayKey)} · ${ZONE.replace("America/", "")}</span>
    <h1>${longDate(dateKey)}</h1>
    <p>${pieces.length} pieces go out across ${posts} network posts, from ${first} to ${last}. Every frame below is cut from the file that will actually be uploaded.</p>
  </header>

  <div class="stats">
    <div class="stat"><span class="stat__value">${pieces.length}</span><span class="stat__label">Pieces</span><span class="stat__detail">${shorts} shorts · ${carousels} carousels${longs ? ` · ${longs} long-form` : ""}</span></div>
    <div class="stat"><span class="stat__value">${posts}</span><span class="stat__label">Network posts</span><span class="stat__detail">${totals.live} posted · ${totals.booked} scheduled · ${totals.waiting} waiting</span></div>
    <div class="stat"><span class="stat__value">${first}</span><span class="stat__label">First slot</span><span class="stat__detail">last at ${last}</span></div>
    <div class="stat"><span class="stat__value">${dayThreads.length}</span><span class="stat__label">Threads posts</span><span class="stat__detail">${dayThreads.filter((t) => (t.status ?? "") === "published").length} already out</span></div>
  </div>

  <section>
    <h2>The rundown</h2>
    <div class="rundown">
${rows || '<p class="empty">Nothing is booked for this day.</p>'}
    </div>
  </section>

  <section>
    <h2>Where it lands</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th scope="col">Network</th><th scope="col" class="num">Posts</th><th scope="col">State</th><th scope="col" class="num">Out</th><th scope="col" class="num">Sched</th><th scope="col" class="num">Wait</th></tr></thead>
        <tbody>
${networkRows}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Threads</h2>
    ${threadsBlock}
  </section>

  <section>
    <h2>Needs a look</h2>
    ${blockedBlock}
  </section>

  <footer>Built from data/publish-queue.json and data/threads-queue.json · times in ${ZONE}</footer>
</div>`;
}

main();
