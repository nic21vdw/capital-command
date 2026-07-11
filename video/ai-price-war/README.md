# AI Price War — B-roll graphics + production notes

Remotion insert graphics for the **AI Price War** news video (Grok 4.5 /
GPT-5.6 / Claude limit reset, July 2026). Landscape **1920×1080 @ 30fps**,
~20s of reusable B-roll. Signal palette — same colours as
`signal-free-ai-builds`, re-declared in `src/theme.ts` so this package is
standalone.

## Run it

From inside this folder (`video/ai-price-war/`):

```bash
npm install            # first time only
npx remotion preview   # opens Remotion Studio with every composition
```

## Compositions

| Composition ID | Frames | VO timing | What it is |
|---|---|---|---|
| `AIPriceWar`    | 600 | —         | Full 20s block, scenes back-to-back |
| `TimelineScene` | 150 | 0:00–0:05 | Three dated news cards + connector line |
| `PriceWarScene` | 210 | 0:05–0:12 | "$2 vs $10" fracture with shake + glow |
| `PlayersScene`  | 240 | 0:12–0:20 | Logo-mark triangle + green Grok reveal |

Render individual inserts for compositing:

```bash
npx remotion render TimelineScene out/timeline.mp4
npx remotion render PriceWarScene out/price-war.mp4
npx remotion render PlayersScene  out/players.mp4
```

The marks in `PlayersScene` are **abstract geometric placeholders**, not real
brand logos — swap the SVG internals in `src/scenes/PlayersScene.tsx` for
licensed art before publishing if you want the real marks.

---

## Production notes

### Thesis / spine

Not "3 news items" — **"the AI race just turned into a price war, and here's
where each player is betting."** Grok 4.5 (Jul 8) and GPT-5.6 (Jul 9) both
lead with token efficiency and low price; Anthropic reset Claude limits the
same day as a competitive response; Fable 5 sits at the premium end at
$10/$50 per Mtok.

### Title options

1. The AI Price War Just Started (Grok 4.5, GPT-5.6, Claude)
2. Grok Is Suddenly a Real Threat. Here's What Nobody's Saying.
3. 3 AI Launches in 48 Hours. One Winner You Didn't Expect.
4. Why Claude Just Panicked and Reset Everyone's Limits
5. The Token Wars Are Here (And Anthropic Is Losing the Cheap Fight)
6. Grok 4.5 vs GPT-5.6 vs Claude: The Real Story Is Price

Pick 2 or 5 for the through-line, 4 for the curiosity-gap CTR play.

### Hook (cold open)

> "In the last 48 hours, 3 AI companies made 3 completely different bets. And
> the one everyone slept on just quietly became the most dangerous player in
> the room."

Alt, punchier:

> "Two new frontier models dropped in 48 hours, Claude panic-reset everyone's
> limits, and the real story isn't the models. It's the price."

### Thumbnail prompt (image-gen)

> Cinematic YouTube thumbnail, 16:9. Near-black background (#0B0B0D) with a
> subtle warm orange-red glow from the lower left. Three glowing logos
> arranged as a tension triangle: a stylized X/Grok mark, an OpenAI-style
> knot mark, and an Anthropic-style Claude burst, each rimmed in warm
> orange-red light, slightly clashing like they are about to collide. Between
> them, a large bold sans-serif price tag graphic reading "$2 vs $10" in
> bright yellow, cracked down the middle like a fracture. Thin green upward
> arrow accent on the Grok side to signal a reveal. High contrast, dramatic
> rim lighting, moody, premium tech aesthetic, no faces, lots of negative
> space on the right third for a talking-head cutout. Sharp, clean, no
> clutter.

### Script outline

**Cold open / hook (0:00–0:15)** — the 48-hour timeline (Grok 4.5 Jul 8,
GPT-5.6 Jul 9, Claude reset Jul 9); thesis: this stopped being a capability
race and became a price/efficiency race. *(TimelineScene + PriceWarScene.)*

**Story 1 · Grok 4.5, the sleeper (0:15–1:30)** — xAI went public, acquired
Cursor, trained Grok 4.5 jointly on real Cursor session data; $2/M input,
$6/M output, ~4.2× fewer output tokens than Opus 4.8 on SWE-Bench Pro. Take:
xAI is now a real builder — the Cursor data moat plus the
SpaceX/Tesla/Neuralink engineering feedback loop is a data source no one else
has. Credibility caveat, said out loud: it lands 4th on the Artificial
Analysis Intelligence Index and wins on price-per-task, not raw ceiling.

**Story 2 · GPT-5.6 and the Codex merge (1:30–3:00)** — GPT-5.6 GA across
ChatGPT/Work/Codex/API, three tiers (Sol, Terra, Luna; Luna $1/$6); Codex
merges into one ChatGPT desktop app. Take: sad — Codex felt like a dedicated
dev surface, now it's one bucket. **Accuracy flag:** the shared consumption
pool is Work + Codex + ChatGPT for Excel + Workspace Agents — plain Chat is
NOT confirmed to draw from the Codex pool, so play the "texting eats my
Codex quota" bit as a fear/joke about bundling, not a hard technical claim.
Bigger point: OpenAI is going for the super-app; the moat shifts from
"smartest model" to "agent closest to your work".

**Story 3 · Claude resets limits (3:00–4:00)** — same day as GPT-5.6 GA,
Anthropic reset 5-hour and weekly limits for all users. Frame it as a
competitive reflex. Fable 5 at $10/$50 per Mtok is the premium end — that's a
real strategic position, but the market question is now "how value-friendly
can you be", and Grok and Luna just sharpened it.

**Close (4:00–end)** — one line each: Grok = sleeper to watch; OpenAI =
super-app bet; Anthropic = premium bet defended with limit resets.
Prediction: the next 12 months are won on cost-per-task, not benchmark
ceiling. CTA.

### Shot-by-shot, first 30 seconds

| Time | Visual | Audio / VO |
|---|---|---|
| 0:00–0:03 | Tight talking-head, near-black bg, orange-red rim light. No intro card. | Hook line, first sentence. |
| 0:03–0:07 | **`TimelineScene`** full-screen: 3 dated cards slide in. | "In 48 hours: 2 new frontier models and a panic reset." |
| 0:07–0:12 | Back to camera, lean-in; green underline animates under "dangerous". | "…the most dangerous player in the room." |
| 0:12–0:18 | **`PriceWarScene`**: "$2 vs $10" fractures on screen. | "Because this stopped being about who's smartest." |
| 0:18–0:24 | Half-frame talking head, thesis lower-third. | "It's now about who's cheapest per token." |
| 0:24–0:30 | **`PlayersScene`**: 3-logo triangle, hold on Grok + green arrow. | "So let's start with the one nobody's talking about. Grok." |
