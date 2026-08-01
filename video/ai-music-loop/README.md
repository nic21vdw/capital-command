# House playlist visualizer

Audio-reactive 1080p Remotion visual driven by the Suno stream playlist tracks.

Bars, rings, light rays, and glow all follow the real track waveform — not fake sine waves. Audio is embedded in the render.

## Setup

Tracks are expected at `public/tracks` (junction to your Downloads playlist folder).

## Preview

```bash
npm install
npm run preview
```

Open `AiMusicTrack` (single song) or `AiMusicPlaylist` (multi-song).

## Render one track (with music)

```bash
npx remotion render src/index.ts AiMusicTrack out/track.mp4 --props="{\"trackIndex\":3}"
```

## Render a slice of the playlist

Full playlist is ~259 minutes. Sample the first three tracks:

```bash
npx remotion render src/index.ts AiMusicPlaylist out/sample.mp4 --props="{\"fromTrack\":0,\"trackCount\":3}"
```

Full playlist:

```bash
npx remotion render src/index.ts AiMusicPlaylist out/full.mp4 --props="{\"fromTrack\":0}"
```
