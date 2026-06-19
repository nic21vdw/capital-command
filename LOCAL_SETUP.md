# Running Nic Vandewetering locally on your PC

This guide gets Nic Vandewetering running on your own Windows computer so you can
open it in your browser, always loaded with the latest changes from the cloud.

## How it works (the short version)

The cloud and your PC don't talk to each other directly — **GitHub is the
middleman**:

1. When work is done in the cloud, the changes are pushed to GitHub and merged
   into the `main` branch.
2. On your PC, you double-click **`start-capital-command.bat`**. It pulls the
   latest `main` from GitHub, installs anything new, starts the app, and opens
   your browser.

So every time you launch the `.bat` file, you get the most up-to-date version of
everything.

> Note: changes only land on your PC *when you run the launcher*. It refreshes
> on launch — it isn't a live, always-on sync. To get the newest changes, just
> double-click the `.bat` again.

---

## One-time setup

You only need to do this once.

### 1. Install Git for Windows
Download and install from <https://git-scm.com/download/win> (accept the
defaults). This lets your PC download code from GitHub.

### 2. Install Node.js
Download and install the **LTS** version from <https://nodejs.org> (accept the
defaults). This runs the app.

### 3. Download (clone) the repository
Pick a folder where you want the project to live (for example, your Documents
folder). Open it, type `cmd` in the address bar of File Explorer, and press
Enter to open a command prompt there. Then run:

```bat
git clone https://github.com/nic21vdw/capital-command.git
```

This creates a `capital-command` folder containing everything, including the
`start-capital-command.bat` launcher.

---

## Everyday use

1. Open the `capital-command` folder.
2. Double-click **`start-capital-command.bat`**.
3. Wait for the browser to open at <http://localhost:3000>.
4. Keep the black launcher window open while you use the app. Close it when
   you're done (this stops the local server).

That's it. Each launch automatically grabs the latest changes first.

---

## Troubleshooting

- **"Git is not installed" / "Node.js is not installed"** — finish the one-time
  setup steps above, then run the launcher again.
- **The browser opens before the app is ready** — give it a few seconds and
  refresh the page; the first launch takes longer while it builds.
- **Port already in use** — another app (or a previous run) is using port 3000.
  Close the old launcher window, then start again.
- **Nothing happens / it closes instantly** — make sure you double-clicked the
  `.bat` from inside the cloned `capital-command` folder, not a copy somewhere
  else.

---

## Creator tools (Thumbnail Generator & Clipping Agent)

Both tools live in the sidebar and work out of the box:

- **Thumbnail Generator** runs entirely in your browser — no setup needed.
- **Clipping Agent** turns a livestream VOD into ready-to-post shorts, with
  **no uploads and no API keys**. Paste a **YouTube or Twitch VOD link** and it:
  1. Downloads just the audio (so even a 90-minute stream is fast and never
     needs the whole multi-GB file).
  2. Finds the strongest moments by audio energy.
  3. Downloads only those ranges and renders each as a **9:16 vertical short**
     (Shorts/Reels/TikTok).

  Processing happens locally with FFmpeg — a static build is installed
  automatically with `npm install` (the launcher does this for you). The first
  time you use a link, the app downloads a small `yt-dlp` helper into
  `data\clips\bin\` automatically. Generated clips are stored under
  `data\clips\outputs\` and stay on your PC.

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
   Desktop uploads them to the cloud automatically. The Clipping Agent shows a
   "Saved to Google Drive" confirmation on each finished job.

Leave `CLIPS_DRIVE_DIR` blank to keep clips only under `data\clips\outputs\`.

---

## A note on your local data

Your local app data (`data\capital-command.json`), installed packages
(`node_modules`), and your `.env` settings stay on your PC and are **not**
overwritten when the launcher updates the code, so your settings and data are
preserved across updates.
