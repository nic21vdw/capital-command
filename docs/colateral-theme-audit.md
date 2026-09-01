# Wearing CoLateral's look: the page-by-page audit

Capital Command is served from its own checkout and framed by an iframe inside
CoLateral's Command Centre card. Two applications sit edge to edge on one
screen, so anything this app decides for itself — a colour, a typeface, an
elevation — reads as a seam if it does not match what CoLateral decided.

`dff5efa` brought the palette across: CoLateral Dark and Office Blue are
presets, CoLateral Dark is the default and the pre-paint fallback, and the
values are CoLateral's own, copied from `src/styles/themes.css` in that repo.
This pass finished the job — the typeface, the elevations the palette could not
reach, and a walk through every route the app serves.

## What the palette could not fix on its own

**The typeface.** CoLateral serves Inter from its own repository, deliberately:
its desktop build has to work on a site with no connection, so the brand face
cannot come from a CDN. This app asked for `ui-sans-serif, system-ui` and got
Segoe UI on this machine — a different face, one panel away from Inter, at the
same size. The same `InterVariable.woff2` now ships in `public/fonts/` (SIL
Open Font License v1.1, licence beside it), is preloaded from the root layout,
and `--font-ui` / `--font-mono` carry CoLateral's exact stacks. Form controls
are opted in explicitly, because they do not inherit a family. Tables and
numeric inputs take tabular figures the way CoLateral's do, so a column of
counts stops jittering as it updates.

`--font-ui` lives on `html` rather than in `:root`'s block on purpose: a theme
does not choose the typeface, and `themes.test.ts` holds every preset to
exactly the properties `:root` declares.

**Elevation.** Six pieces of chrome carried their own shadow as a literal
`rgba(0, 0, 0, …)` — the search bar on the home screen, the carousels dropdown,
both modal shells, and the primary button. On a dark theme they were invisible
as a mistake. On Office Blue and the other light presets they painted a heavy
black bloom on a near-white surface, which is exactly the "this is a different
app" tell the rebrand was meant to remove. Themes now declare `--shadow-pop`
and `--shadow-modal` alongside `--shadow`, tinted with each palette's own ink,
and those six sites use them.

## The routes, walked

Every route was requested against a running sandbox server. Twenty-five pages
answer 200; ten are redirect stubs that land on their replacement; nothing
404s that anything links to.

| Route | Verdict |
|---|---|
| `/`, `/pipeline` | 200. Deliberately headerless — the screen opens as one search bar (`08181bf`), so the missing `PageHeader` is the design, not a gap. Its two hand-rolled shadows now use the tokens. |
| `/longform` | 200. Clean. Hex values in it are caption colours the user picks, not chrome. |
| `/clips` | 200. Clean. |
| `/editor` | 200. Its hardcoded shadows sit on the fixed-black video stage, where they are correct; left alone. |
| `/carousels` | 200. Dropdown and both modal shells moved onto `--shadow-pop` / `--shadow-modal`. |
| `/podcast` | 200. Clean. |
| `/x-posts` | 200. Clean. |
| `/facebook` | 200. The post previews mimic a real Facebook card on a fixed black ground, so their text must stay literally white — under a light theme `text-white` resolves to near-black ink and the preview went unreadable. All three now say `#fff` and mean it. |
| `/launch` | 200. Its eyebrow said "Distribute" while the sidebar files it under step 2; it now says "Step 2 · Formats" like its seven siblings. |
| `/uploading-center` | 200. The "Draft" chip was the one chip painted `text-gray-300`, which washed out on the light presets; it takes `--muted-foreground` now. |
| `/distribution` | 200. Clean. |
| `/master-calendar` | 200. Clean. |
| `/day-summary` | 200. Clean. |
| `/agents` | 200. The voice picker's `<option>` hardcoded a near-black background and stayed dark inside a light theme; it takes `--panel`. |
| `/ideas` | 200. Titled "Keyword Research" while the sidebar said "Idea Lab". Now both say Idea Lab. |
| `/scripts` | 200. Titled "Script Studio" while the sidebar said "Scripts". Now both say Scripts. |
| `/outliers` | 200. Clean. |
| `/presentation` | 200. Hand-rolls its header to show the open deck's name rather than the page's; that is the screen working as intended and was left. |
| `/voiceover` | 200. Clean. |
| `/music` | 200. Clean. |
| `/execution` | 200 — but nothing linked to it. A fully built screen (recurring goals, streaks, carry-forward debt) reachable only by typing the address. It is in the sidebar now, under the studio tools. |
| `/finance` | 200. Gated on the personal-dashboard switch; shows a header only in the off state, tabs in the on state. Left as it is — the tabs carry their own headers and changing it touches five screens. |
| `/settings` | 200. Clean. |
| `/creator`, `/notes`, `/thumbnails`, `/youtube` | 307 to `/clips`, as intended. |
| `/goals`, `/holdings`, `/insights`, `/watchlist` | 307 into `/finance`'s tabs, as intended. |

No dead controls were found on any page. Every `disabled` is driven by a real
busy or validity state, no handler is empty or logs and returns, there is no
`href="#"`, and no "coming soon" markers survive in the UI. No personal name is
used as the product's name anywhere in the chrome — `dff5efa` cleared that, and
the remaining occurrences are test fixtures and a prompt instruction telling
the model to spell the name correctly in a transcript.

## Rules this pass leaves behind

- **`text-white` is not white.** `--color-white` is remapped per theme, so
  those utilities are the right choice on themed surfaces and the wrong choice
  on a surface that is black in every theme. On a fixed-black mock — a video
  stage, a post preview — write `#fff`.
- **Never write a shadow inline.** `--shadow`, `--shadow-pop` and
  `--shadow-modal` exist so elevation follows the palette. A literal
  `rgba(0, 0, 0, …)` looks fine in the theme you were testing and wrong in the
  other eight.
- **A page's title is the sidebar's label.** They are read a second apart.
- **A screen with no way in does not exist.** If it is worth building, it is in
  the nav or behind a switch that puts it there.
- **Status colours stay raw.** Amber, emerald, red and sky mean warning,
  success, failure and pending. The light presets already remap those shades
  for contrast; that is the seam to use, not a new token.

## What is still separate

`site/style.css` is the standalone marketing site under `site/`, not the app,
and it carries its own colours. It is never framed by CoLateral, so it was out
of this pass.
