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
