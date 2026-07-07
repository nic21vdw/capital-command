# Animated video segments (instead of slideshows)

This is the plain-English guide to making **dynamic animated clips** you record
your commentary over — title cards, animated bullet points, counting stats —
instead of static PowerPoint slides. It costs **$0 in API fees**: the animations
are written as code (by you, or by Claude Code), and rendered on your own PC.

## The one decision: where does this live?

You asked whether to build this into the CoLateral dashboard or just feed ideas
to Claude Code. **Recommendation: feed ideas to Claude Code, render locally,
drop the result into your editors.** Here's why:

- **$0 and no new plumbing.** Claude Code writes the animation code inside your
  existing session — no metered API key, no per-render cost. Building a renderer
  *into* the Next.js dashboard would mean maintaining a whole video engine for
  no real gain.
- **It matches what you already do.** You already launch the dashboard with a
  double-click `.bat`. This adds one more double-click launcher for the
  animation studio. Same muscle memory.
- **The output is just MP4 files.** They import straight into your existing
  Long-Form and Clips editors, exactly like your recorded footage.

So the flow is: **idea → Claude Code builds segments → render → drop into editor
→ record your voice over it → publish** (through your existing Uploading Center).

## What tool is this?

[**Remotion**](https://www.remotion.dev) — it turns code into real MP4 videos on
your machine. It's **free for you** as a solo creator (free for teams of 3 or
fewer; [license](https://www.remotion.dev/docs/license)). Everything is already
scaffolded in the `remotion/` folder of this repo with three ready-made,
on-brand animations.

> Note: your earlier chat mentioned "HyperFrames" (HeyGen's HTML-to-video tool,
> Apache-2.0). It's real and also good. We went with Remotion because it's the
> most mature, has official Claude Code support, and is free for a solo creator.
> The workflow below is identical either way; you're not locked in.

## First-time setup (do this once)

1. Install **Node.js** (LTS) from <https://nodejs.org> if you haven't already —
   the dashboard uses it too.
2. Double-click **`launch-remotion-studio.bat`** in the project folder.
   - The first run installs the animation building blocks (a few minutes).
   - Then your browser opens **Remotion Studio** — a preview window where you
     can scrub through each animation and edit its text live.
3. That's it. Later launches skip the install and open instantly.

## The everyday workflow

### 1. Have an idea
Generate it however you already do (Claude chat, your idea backlog). Example:
*"Why compounding beats intensity for content creators."*

### 2. Ask Claude Code to build the segments
In Claude Code, in this project, say:

> `/animate-video` Build segments for a video about why compounding beats
> intensity. Intro title card, one section with 3 bullet points, and a stat
> card showing "$1,240 MRR". Use the lime theme.

Claude will write/reuse the animations and **render MP4 files** into
`remotion/out/` — one per beat, named `01-intro.mp4`, `02-...`, etc. It reports
back each file with a suggested voice-over cue.

### 3. Preview (optional)
Double-click `launch-remotion-studio.bat` to scrub the animations and tweak any
wording before/after rendering.

### 4. Record + assemble
Open `/longform` (Long-Form Editor) or `/editor` (Clips Editor) in the
dashboard. Add the MP4s to the timeline between/over your talking-head footage,
record your commentary, trim to taste.

### 5. Publish
Send it through the **Uploading Center** you already use — YouTube, TikTok,
Instagram, Facebook on your schedule.

## The three ready-made animations

| Composition    | What it does                                  | Good for                        |
| -------------- | --------------------------------------------- | ------------------------------- |
| `TitleCard`    | Accent bar wipes in, title springs up         | Video openers, section titles   |
| `BulletReveal` | Points slide in **one at a time** (not all)   | Talking through a list of ideas |
| `StatCounter`  | A big number counts up from zero              | Landing a revenue/metric beat   |

All are 1080p, 30fps, and themed to match the dashboard (lime, violet, ocean,
sunset, rose, mono). Claude fills them with your words per video. Need something
new — an animated diagram, a chart — just ask; Claude adds a new composition
next to these and reuses it forever after.

## Manually rendering one (if you ever want to, without Claude)

From a command prompt in the project folder:

```bash
cd remotion
npx remotion render src/index.ts TitleCard out/intro.mp4 \
  --props "{\"title\":\"How I automate content\",\"subtitle\":\"Built with CoLateral\",\"theme\":\"lime\",\"durationInFrames\":120}"
```

Swap `TitleCard` for `BulletReveal` or `StatCounter` and adjust the props. But
99% of the time you'll just let `/animate-video` do it.

## Why this compounds

Every video you make, Claude reuses and extends these building blocks. Your
per-video effort goes *down* while your library grows. Once you have an audience,
that same library — and the system itself — becomes the raw material for a
course. Build the pipeline first; the course rides on top of it later.
