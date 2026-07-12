# Vibe Coding: First Steps — Series + Ep. 1 short

A vertical (1080×1920) short that explains **how to start vibe coding in the
simplest possible terms**, built in [Remotion](https://www.remotion.dev/) with
the **"Signal"** theme (warm orange-red on near-black, same palette as
`signal-free-ai-builds` and `ai-price-war`, re-declared in `src/theme.ts` so
this package is standalone).

It rides the "explain it in the dumbest terms" tier-list trend:

> Gemini → **bad**. ChatGPT → **okay**. Claude → **good**. Buy the $20 account →
> **good**. By the way, you don't need to code → **good**.

One idea per beat, one word per verdict. No jargon, no setup, no "it depends."
The whole point is that a total beginner can watch it once and know exactly what
to do next.

## Run it

From inside this folder (`video/vibe-coding-first-steps/`):

```bash
npm install            # first time only
npm run preview        # opens Remotion Studio on the composition

# Render the short + a poster frame
npm run render         # → out/vibe-coding-first-steps.mp4
npm run still          # → out/poster.png (frame 150, mid tier-list)
```

On a machine without a bundled Chromium, Remotion downloads its own. In this
repo's build environment, render with the pre-installed Playwright Chromium via
`--browser-executable=/opt/pw-browsers/chromium`.

## Composition

| Composition ID | Frames | Length | What it is |
|---|---|---|---|
| `VibeCodingFirstSteps` | 660 | 22s | Full short, all scenes back-to-back |

Scene map (see `src/Video.tsx`):

| Time | Scene | Beat |
|---|---|---|
| 0:00–0:03 | `ColdOpenTitle` | "How to start vibe coding — in the simplest terms" |
| 0:03–0:10 | `TierList` | Gemini **BAD** · ChatGPT **OKAY** · Claude **GOOD** |
| 0:10–0:14 | `TheMove` | "Buy the $20 account" → **GOOD** |
| 0:14–0:18 | `ByTheWay` | "You don't need to know how to code" → **GOOD** |
| 0:18–0:22 | `EndCard` | "That's step 1" → next: your first prompt |

## Reusable pieces

- **`theme.ts`** — Signal palette + a `toneColor()` helper mapping
  `bad`/`okay`/`good` to red/yellow/green. Change colours once, everywhere
  updates.
- **`VerdictStamp`** — the one-word rubber-stamp verdict ("BAD"/"OKAY"/"GOOD")
  with an overshoot bounce. It's the running gag of the format; reuse it in
  every future episode.
- **`TierRow`** — name slides in, verdict stamps a beat later, tinted accent
  bar. Feed it any `{ name, verdict, tone }` to build a new tier list.
- **`GlowBackground`** — shared looping glow, reused on the open and end card.

---

## The series idea

**"Vibe Coding: First Steps"** — a run of ~30-second shorts that each answer
*one* beginner question in the same dumbed-down, one-verdict-per-line format.
The format is the brand: name a thing, stamp a verdict, move on. Every episode
ends by teeing up the next question, so the series is a ladder a complete
beginner can climb without ever feeling lost.

Rules that keep it simple (and keep it a series, not one video):

- **One question per short.** If it needs a second question, it's episode 2.
- **One verdict per line.** Bad / okay / good. No nuance on screen — nuance
  goes in the caption or the pinned comment.
- **Always end on the next step**, so the playlist auto-pulls the viewer forward.

### Episode ladder

| # | Question the short answers | The one-word spine |
|---|---|---|
| **1** | **Which AI should I even use?** *(this short)* | Gemini bad · ChatGPT okay · Claude good · $20 good · no-code good |
| 2 | What do I actually type first? | "Describe what you want, in plain English" → good |
| 3 | What's the $20 account really get me? | more messages · better model · the good stuff → good |
| 4 | Where do I put the code it gives me? | one tool to install → paste → run → good |
| 5 | It broke. Now what? | copy the red error → paste it back → "fix this" → good |
| 6 | How do I not lose my work? | save early · one folder · ask it to explain → good |
| 7 | When is vibe coding the *wrong* tool? | throwaway good · learning good · bank app… bad |

Episodes 2–7 each reuse `VerdictStamp` + `TierRow`, so they're mostly a script
and a new list — the motion system is already built here.

## Script — Episode 1 (this short)

Tight, ~22s, direct-to-camera or voiceover over the animation. `[STAMP]` marks
where the on-screen verdict lands.

> **How to start vibe coding. In the simplest terms.**
>
> Which AI do you use?
>
> Gemini? …Bad. `[STAMP BAD]`
> ChatGPT? …Okay. `[STAMP OKAY]`
> Claude? …Good. `[STAMP GOOD]`
>
> Buy the twenty-dollar account. …Good. `[STAMP GOOD]`
>
> By the way — you don't need to know how to code. …Good. `[STAMP GOOD]`
>
> That's step one. Next one: what you actually type first. Follow.

**Say-it-out-loud notes**

- Land each verdict flat and confident — the comedy is the certainty, not a
  wink. The animation already overshoots; the read should be deadpan.
- "Buy the $20 account" is deliberately the whole strategy for a beginner: one
  paid plan removes the "which free tier, which limit" paralysis. Keep it that
  blunt on screen; the *why* lives in the caption.
- The "by the way" is the relief beat, not a catch — it's the line that gives a
  non-coder permission to start.

## Honesty / caption layer

The on-screen format is intentionally over-simplified — put the fair version in
the caption + pinned comment so the short stays punchy but not misleading:

- "Gemini/ChatGPT/Claude" is *for coding specifically, today* — all three are
  capable; the ranking is a beginner's default, not a benchmark.
- The "$20 account" line is generic on purpose (a paid tier of whatever
  assistant you pick), not an ad for one product.
- "You don't need to code" means you can start without knowing a language — you
  still learn as you go, and you should read what it writes.

## Title options

1. How to start vibe coding (in the simplest terms)
2. Vibe coding for total beginners — step 1
3. Which AI should you use to vibe code? (dead simple)
4. You don't need to code to start coding. Here's step 1.
5. The dumbest-possible guide to vibe coding: part 1

Use 1 or 3 for the through-line, 4 for the curiosity-gap CTR play.

## Thumbnail prompt (image-gen)

> Vertical 9:16 YouTube Short thumbnail. Near-black background (#0f0f0f) with a
> soft warm orange-red glow from the lower left. A clean vertical tier list of
> three rows, big bold rounded sans-serif: "GEMINI" with a red **BAD** stamp,
> "CHATGPT" with a yellow **OKAY** stamp, "CLAUDE" with a green **GOOD** stamp,
> each verdict in a rounded outlined box tilted slightly like a rubber stamp.
> Top text "VIBE CODING" in huge white letters, small tag "in the simplest
> terms" in orange under it. High contrast, premium, no faces, generous
> negative space on the right for a talking-head cutout. Sharp, clean, no
> clutter.
