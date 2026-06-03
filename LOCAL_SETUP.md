# Running Capital Command locally on your PC

This guide gets Capital Command running on your own Windows computer so you can
open it in your browser, always loaded with the latest changes from the cloud.

## How it works (the short version)

The cloud and your PC don't talk to each other directly — **GitHub is the
middleman**:

1. When work is done in the cloud, the changes are pushed to GitHub and merged
   into the `main` branch.
2. On your PC, you double-click **`start-capital-command.bat`**. It downloads (or
   updates to) the latest `main` from GitHub, installs anything new, starts the
   app, and opens your browser.

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

> The launcher checks for both of these. If either is missing, it tells you and
> stops, so install them first.

---

## Getting the launcher

You only need the **`start-capital-command.bat`** file — it can download the rest
of the app for you. Pick whichever of these is easiest:

- **Easiest:** Save just the launcher. Open
  <https://raw.githubusercontent.com/nic21vdw/capital-command/main/start-capital-command.bat>,
  then press **Ctrl+S** to save it somewhere handy like your Desktop.
- **Or download the whole project:** On the GitHub page click the green
  **Code** button → **Download ZIP**, then **right-click the ZIP → Extract All**.
  (Important: extract it first — don't run the `.bat` from inside the ZIP.)
- **Or clone it** (if you're comfortable with a command prompt):
  ```bat
  cd %USERPROFILE%\Documents
  git clone https://github.com/nic21vdw/capital-command.git
  ```

However you got it, the launcher figures out the rest. If it's sitting on its own
(not inside a proper project folder), it downloads a fresh copy of the app into
`C:\Users\<you>\capital-command-app` and runs from there.

---

## Everyday use

1. Double-click **`start-capital-command.bat`**.
2. The first run takes a few minutes (it downloads the app and its
   dependencies). Later runs are quick.
3. Wait for the browser to open at <http://localhost:3000>.
4. Keep the black launcher window open while you use the app. Close it when
   you're done (this stops the local server).

That's it. Each launch automatically grabs the latest changes first.

---

## Troubleshooting

- **Nothing happens / the window flashes and closes** — usually one of:
  - You ran it from *inside* the downloaded ZIP. Extract the ZIP first
    (right-click → Extract All), then run the extracted `.bat`.
  - Windows blocked a file downloaded from the internet. Right-click the
    `.bat` → **Properties** → tick **Unblock** (if shown) → **OK**, then try
    again. If you see a blue "Windows protected your PC" box, click **More
    info** → **Run anyway**.
  - To see the actual message, open the folder, click the address bar, type
    `cmd`, press Enter, then type `start-capital-command.bat` — errors will
    stay on screen.
- **"Git is not installed" / "Node.js is not installed"** — finish the one-time
  setup steps above, then run the launcher again.
- **The browser opens before the app is ready** — give it a few seconds and
  refresh the page; the first launch takes longer while it builds.

---

## A note on your local data

Your local app data (`data\capital-command.json`), installed packages
(`node_modules`), and your `.env` settings stay on your PC and are **not**
overwritten when the launcher updates the code, so your settings and data are
preserved across updates.
