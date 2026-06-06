# Capital Command

Capital Command is a personal investment dashboard MVP built with Next.js, TypeScript, Tailwind CSS, and a local JSON persistence layer. It is designed for personal tracking and organization, not financial advice or trading.

## Finance & Billing

The `/finance` route adds a Stripe-style billing dashboard plus a spend tracker:

- **Billing overview** — gross/net volume, MRR, MRR growth, active subscribers, churn, a payments breakdown bar, disputes, and high-risk payments. It reads live data from Stripe when `STRIPE_SECRET_KEY` is set (use a restricted, read-only key) and otherwise renders representative sample data so the UI always works.
- **AI & setup spending** — track one-time hardware (PC build, GPU, peripherals) and recurring AI/cloud subscriptions. Recurring costs are normalized to a monthly run rate (with simple USD↔CAD conversion) so you can see total invested, monthly burn, and annualized cost at a glance.
- **Themes** — six accent themes (Lime, Violet, Ocean, Sunset, Rose, Mono) plus light/dark mode, switchable from the Finance toolbar or Settings. Your choice persists locally and to app settings.

## Why this persistence choice

For Phase 1, the app uses a server-side JSON store instead of SQLite/Supabase/Convex. This keeps local setup to one command, avoids native database friction, and still gives us a clean repository abstraction that can be swapped for SQLite or a hosted backend later.

## Planned setup

1. Install dependencies with `pnpm install`
2. Start the app with `pnpm dev`

If you prefer npm:

1. `npm install`
2. `npm run dev`

## Local Command Dashboard Launcher

If you are not a developer and just want to open the Command Dashboard on your
own Windows PC, use the double-click launcher instead of typing commands.

### How to use the `.bat` file

1. Open the project folder in File Explorer.
2. Double-click **`launch-colateral-command-dashboard.bat`**.
3. A black Command Prompt window opens and sets everything up for you.
4. Your browser opens the dashboard at **<http://localhost:3000>**.
   (If it doesn't open on its own, type that address into your browser.)

The very first run installs the app's building blocks and can take a few
minutes. After that, launches are fast because that step is skipped.

### What command is being run behind the scenes

The launcher simply runs the project's normal startup steps for you:

- `npm install` — but **only the first time**, when the `node_modules` folder
  is missing. On later runs this is skipped.
- `npm run dev` — starts the local development server (Next.js) on port 3000.

That's the same thing a developer would type by hand; the `.bat` file just
remembers it for you.

### How to stop the server

The dashboard runs for as long as the black launcher window stays open. To
stop it, either:

- Press **Ctrl + C** inside that window, or
- Simply **close the window**.

Once it's stopped, <http://localhost:3000> will no longer load until you launch
it again.

### If the port is already in use

If you see a message like *"port 3000 is already in use"*, it usually means the
dashboard is already running in another window (or a previous run didn't fully
close). To fix it:

1. Find and close any older launcher / Command Prompt windows, then
   double-click the `.bat` again.
2. If that doesn't help, restart your PC to clear the leftover server, then
   launch again.

> Tip: there is also a `start-capital-command.bat` launcher. That one first
> downloads the latest version of the app from GitHub before starting. Use
> `launch-colateral-command-dashboard.bat` when you just want to run the copy
> already on your PC.

## Environment

Copy `.env.example` to `.env` and optionally set `ALPHA_VANTAGE_API_KEY`.

## Security notes

- API keys live only in environment variables.
- Market data requests go through server-side route handlers.
- The app falls back to mock data if Alpha Vantage is unavailable.
- Secrets are never rendered in the UI and should never be logged.
- For deployment, store env vars in your platform secret manager and keep server-side write access scoped to the app data directory only.

## Disclaimer

This app is for personal tracking and educational organization only. It does not provide financial, tax, legal, or investment advice.
