# Running CoLateral Marketing on your PC

CoLateral Marketing runs on your own Windows computer. Its videos, saved settings, account credentials and publishing queues stay in that installation.

## One-time setup

Install [Git for Windows](https://git-scm.com/download/win) and [Node.js LTS](https://nodejs.org), then clone the [source repository](https://github.com/nic21vdw/capital-command) into an ordinary local folder outside OneDrive:

```bat
git clone https://github.com/nic21vdw/capital-command.git
```

Open that checkout and double-click **`CoLateral Marketing.bat`**. The launcher uses the existing production startup script, installs missing dependencies, builds when needed, waits for the server to be ready and opens the app in its own window at <http://127.0.0.1:3000>.

Run `npm run app:shortcut` from that production checkout to create the CoLateral Marketing Desktop and Start Menu shortcuts. Existing launchers and saved shortcuts remain compatible.

## Everyday use and updates

Open the app with the launcher or shortcut. Closing the app window leaves the server running so scheduled work can continue.

Finished source changes wait on `main`. They reach the running app when you choose **Check for updates**, then **Install and restart**. You can also double-click `Update CoLateral Marketing.bat`. Opening the app does not silently install every merged change.

Development belongs in a separate sandbox worktree on port 3100; the production checkout stays on `main`. Read `AGENTS.md` before starting another server, registering scheduled tasks, or touching live queues.

## Troubleshooting

- Extract downloaded ZIP files before running a launcher.
- If Windows blocks a downloaded file, open its Properties and use Unblock if available.
- If startup fails, the launcher keeps the error visible. Check `build.log` and the server logs in the installation.
- A server already listening on port 3000 is reused. Avoid manually starting a second server in the same installation.

## Creator tools (Thumbnail Generator & Clip Generator)

Both tools live in the sidebar and work out of the box:

- **Thumbnail Generator** runs entirely in your browser — no setup needed.
- **Clip Generator** turns a livestream VOD into ready-to-post shorts, with
  **no uploads needed**. Paste a **YouTube or Twitch VOD link** and it:
  1. Downloads just the audio (so even a 90-minute stream is fast and never
     needs the whole multi-GB file).
  2. Reads the **full transcript end-to-end** and picks the strongest
     self-contained moments from **anywhere in the stream** (not just the start).
     This uses Claude when `ANTHROPIC_API_KEY` is set in `.env`; without a key it
     falls back to whole-stream audio-energy analysis (still fully offline).
  3. Downloads only those ranges and renders each as a **9:16 vertical short**
     (Shorts/Reels/TikTok), rendering several clips in parallel so the whole
     job finishes much faster.

  Processing happens locally with FFmpeg — a static build is installed
  automatically with `npm install` (the launcher does this for you). The first
  time you use a link, the app downloads a small `yt-dlp` helper into
  `data\clips\bin\` automatically. Generated clips are stored under
  `data\clips\outputs\` and stay on your PC.

  **Uploaded video files are transcribed locally** with Whisper (no API key,
  no audio leaves your PC), so uploads get the same word-synced captions,
  auto-titles, and transcript-driven moment picking as VOD links. The first
  upload downloads the speech model (~150 MB) into `data\clips\bin\whisper-models\`
  and reuses it afterwards. To trade accuracy for speed, set
  `CLIPS_WHISPER_MODEL=Xenova/whisper-tiny.en` in `.env` (default:
  `Xenova/whisper-base.en`).

### Optional: auto-save clips to Google Drive (no API, no sign-in)

If you want every finished clip to also land in your Google Drive — organized
into `clipping agent\<stream title>\` — you don't need any API keys or OAuth.
You just let **Google Drive for Desktop** do the syncing:

1. Install **Google Drive for Desktop**
   (<https://www.google.com/drive/download/>) and sign in. It adds a folder on
   your PC (for example `G:\My Drive` on Windows) that mirrors your Drive.
2. In your `.env`, set `CLIPS_DRIVE_DIR` to a path inside that synced folder —
   the top of your Drive is fine:
   - Windows: `CLIPS_DRIVE_DIR=G:\My Drive`
   - macOS: `CLIPS_DRIVE_DIR=/Users/you/Library/CloudStorage/GoogleDrive-you@gmail.com/My Drive`
3. Restart the app. From then on, when a job finishes, its clips are copied to
   `<CLIPS_DRIVE_DIR>\clipping agent\<stream title>\` and Google Drive for
   Desktop uploads them to the cloud automatically. The Clip Generator shows a
   "Saved to Google Drive" confirmation on each finished job.

Leave `CLIPS_DRIVE_DIR` blank to keep clips only under `data\clips\outputs\`.

---

## A note on your local data

Your local app data (`data\capital-command.json`), installed packages
(`node_modules`), and your `.env` settings stay on your PC and are **not**
overwritten when the launcher updates the code, so your settings and data are
preserved across updates.

Under the hood there is **no database** — everything the dashboard remembers
(jobs, settings, tracked content, and so on) lives in that single
`data\capital-command.json` file. That makes backups easy: copy that one file
somewhere safe and you've saved everything.

---

## Backing up your data to Google Drive

Because all your data is one file, it's worth keeping a copy off your PC in case
the file is ever lost or corrupted. There's a one-click backup that drops a
timestamped snapshot into your Google Drive — **no API keys and no sign-in**, the
same way the optional clip-syncing works.

### One-time setup
1. Install **Google Drive for Desktop**
   (<https://www.google.com/drive/download/>) and sign in, if you haven't
   already. It adds a synced folder on your PC (for example `G:\My Drive`).
2. In your `.env`, set `BACKUP_DRIVE_DIR` to a path inside that synced folder:
   - Windows: `BACKUP_DRIVE_DIR=G:\My Drive`
   - (If you already set `CLIPS_DRIVE_DIR`, you can skip this — the backup reuses
     it automatically.)

### Each time you want a backup
Double-click **`backup-to-drive.bat`** (in the project folder, next to the
launcher). It copies your data to:

```
<your Drive folder>\Nic Vandewetering Backups\capital-command-<date>_<time>.json
```

Google Drive for Desktop then syncs that file to the cloud automatically. Do this
whenever you like — once a month is plenty. The most recent 24 snapshots are
kept and older ones are tidied up automatically.

> If you leave `BACKUP_DRIVE_DIR` (and `CLIPS_DRIVE_DIR`) blank, the backup still
> runs but saves into a local `backups\` folder inside the project — handy, but
> it stays on this PC only and isn't synced to the cloud.

### Restoring from a backup
To roll back to a saved snapshot, close the app, then copy the snapshot file from
your Drive folder back to `data\capital-command.json` (rename it to exactly
`capital-command.json`, replacing the current one). Start the app again and your
data is back to that point in time.

