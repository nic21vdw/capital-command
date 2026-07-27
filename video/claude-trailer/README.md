# claude-trailer

A 20-second 16:9 (1920×1080 @ 30fps) Remotion trailer about Claude, designed
as an animated bed for a voiceover about Claude tackling the hardest tasks.
Uses the official Anthropic palette (terracotta `#D97757` on near-black
`#141413`, ivory type) and the real Claude starburst mark — every logo on
screen is in motion (spin-up reveal, drifting spark field, spinning card
icons, comet sweep, heartbeat pulse).

Scenes: LogoReveal (4s) → HardestProblems (4.7s) → Capabilities (5.3s) →
Momentum (3s) → EndCard (3s). Capability claims reflect Anthropic's 2026
lineup: 1M-token context, adaptive thinking, Claude Code agent teams.

```bash
npm install
npm run preview   # Remotion Studio
npm run render    # out/claude-trailer.mp4
```

Also wired into the app's Segment Deck at `/presentation` (project
"Claude Trailer" in `src/app/presentation/deck.tsx`).
