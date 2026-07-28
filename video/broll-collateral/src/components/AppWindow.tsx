import React from "react";
import { theme, fontFamily } from "../theme";
import { Bar, Card, Chip, Glyph, GlyphKind, hexA, Kicker, Text } from "./ui";

/**
 * A CoLateral Command "screenshot".
 *
 * The B-roll clips need product footage to float around, and a real PNG would
 * be stale the day the UI changes — so the screens are drawn as components
 * instead. Every window renders at a fixed {@link WINDOW} design size and is
 * scaled by whatever is flying it around, which keeps type and spacing crisp at
 * any depth. The chrome, the sidebar groups (Plan / Create / Distribute) and
 * the nav labels mirror `src/components/layout/app-shell.tsx`.
 */
export const WINDOW = { width: 1280, height: 820 } as const;

export type ScreenVariant =
  | "pipeline"
  | "clips"
  | "calendar"
  | "analytics"
  | "editor"
  | "ideas";

const SCREENS: Record<ScreenVariant, { title: string; kicker: string; nav: string; accent: string }> = {
  pipeline: { title: "Stream Pipeline", kicker: "Distribute", nav: "Stream Pipeline", accent: theme.accent },
  clips: { title: "Clip Generator", kicker: "Create", nav: "Clip Generator", accent: theme.violet },
  calendar: { title: "Master Calendar", kicker: "Distribute", nav: "Master Calendar", accent: theme.mint },
  analytics: { title: "Outlier Radar", kicker: "Plan", nav: "Outlier Radar", accent: theme.cyan },
  editor: { title: "Clip Editor", kicker: "Create", nav: "Clip Editor", accent: theme.amber },
  ideas: { title: "Idea Lab", kicker: "Plan", nav: "Idea Lab", accent: theme.pink },
};

export const AppWindow: React.FC<{
  variant: ScreenVariant;
  /** 0 → 1 progress driving the in-screen animation (bars filling, rows landing). */
  progress?: number;
  /** Draw the macOS-style title bar. Off for the phone frame. */
  chrome?: boolean;
}> = ({ variant, progress = 1, chrome = true }) => {
  const screen = SCREENS[variant];
  return (
    <div
      style={{
        width: WINDOW.width,
        height: WINDOW.height,
        borderRadius: 22,
        overflow: "hidden",
        background: theme.bg,
        border: `1px solid ${theme.borderStrong}`,
        display: "flex",
        flexDirection: "column",
        fontFamily,
      }}
    >
      {chrome && <TitleBar title={screen.title} />}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar active={screen.nav} activeGroup={screen.kicker} accent={screen.accent} />
        <div style={{ flex: 1, minWidth: 0, background: theme.bg, padding: 26, display: "flex", flexDirection: "column", gap: 18 }}>
          <Header title={screen.title} kicker={screen.kicker} accent={screen.accent} />
          <Body variant={variant} progress={progress} accent={screen.accent} />
        </div>
      </div>
    </div>
  );
};

const TitleBar: React.FC<{ title: string }> = ({ title }) => (
  <div
    style={{
      height: 46,
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "0 18px",
      background: theme.panel,
      borderBottom: `1px solid ${theme.border}`,
    }}
  >
    {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
      <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
    ))}
    <div
      style={{
        marginLeft: 18,
        flex: 1,
        maxWidth: 460,
        height: 26,
        borderRadius: 8,
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text size={12} color={theme.muted}>
        colateral.command / {title.toLowerCase().replace(/\s+/g, "-")}
      </Text>
    </div>
  </div>
);

const NAV_GROUPS: { label: string; items: { label: string; icon: GlyphKind }[] }[] = [
  { label: "Plan", items: [{ label: "Idea Lab", icon: "bulb" }, { label: "Scripts", icon: "film" }, { label: "Outlier Radar", icon: "chart" }] },
  {
    label: "Create",
    items: [
      { label: "Long-Form Editor", icon: "film" },
      { label: "Clip Generator", icon: "wand" },
      { label: "Clip Editor", icon: "layers" },
      { label: "Voiceover", icon: "mic" },
    ],
  },
  {
    label: "Distribute",
    items: [
      { label: "Stream Pipeline", icon: "rocket" },
      { label: "Master Calendar", icon: "calendar" },
      { label: "Uploading Center", icon: "upload" },
      { label: "Carousels", icon: "sparkle" },
    ],
  },
];

const Sidebar: React.FC<{ active: string; activeGroup: string; accent: string }> = ({ active, accent }) => (
  <div
    style={{
      width: 232,
      flexShrink: 0,
      background: theme.panel,
      borderRight: `1px solid ${theme.border}`,
      padding: "20px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 18,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px" }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${theme.brandLight}, ${theme.violet})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          color: "#fff",
        }}
      >
        NV
      </div>
      <div>
        <Text size={13} weight={600}>
          CoLateral
        </Text>
        <Text size={10} color={theme.muted}>
          Command Center
        </Text>
      </div>
    </div>

    {NAV_GROUPS.map((group) => (
      <div key={group.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ padding: "0 8px 6px" }}>
          <Kicker size={9}>{group.label}</Kicker>
        </div>
        {group.items.map((item) => {
          const on = item.label === active;
          return (
            <div
              key={item.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 8px",
                borderRadius: 9,
                background: on ? hexA(accent, 0.14) : "transparent",
                border: `1px solid ${on ? hexA(accent, 0.32) : "transparent"}`,
              }}
            >
              <Glyph kind={item.icon} size={14} color={on ? accent : theme.muted} />
              <Text size={12} weight={on ? 600 : 500} color={on ? theme.text : theme.muted}>
                {item.label}
              </Text>
            </div>
          );
        })}
      </div>
    ))}
  </div>
);

const Header: React.FC<{ title: string; kicker: string; accent: string }> = ({ title, kicker, accent }) => (
  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
    <div>
      <Kicker color={accent}>{kicker}</Kicker>
      <Text size={26} weight={650} style={{ marginTop: 5 }}>
        {title}
      </Text>
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      <Chip label="Auto-run" color={theme.muted} />
      <Chip label="Publish" color={accent} solid />
    </div>
  </div>
);

const Body: React.FC<{ variant: ScreenVariant; progress: number; accent: string }> = ({ variant, progress, accent }) => {
  if (variant === "pipeline") return <PipelineBody progress={progress} accent={accent} />;
  if (variant === "clips") return <ClipsBody progress={progress} accent={accent} />;
  if (variant === "calendar") return <CalendarBody progress={progress} accent={accent} />;
  if (variant === "analytics") return <AnalyticsBody progress={progress} accent={accent} />;
  if (variant === "editor") return <EditorBody progress={progress} accent={accent} />;
  return <IdeasBody progress={progress} accent={accent} />;
};

/* ---------------------------------------------------------------- screens */

const STAGES = [
  { name: "Ingest", detail: "stream.mp4 · 1:42:08", done: 1 },
  { name: "Long-form edit", detail: "silence trimmed · 58 cuts", done: 1 },
  { name: "Shorts", detail: "12 clips scored", done: 1 },
  { name: "Carousels + posts", detail: "8 images · 14 posts", done: 0.6 },
  { name: "Scheduler", detail: "queued to 5 channels", done: 0.2 },
];

const PipelineBody: React.FC<{ progress: number; accent: string }> = ({ progress, accent }) => (
  <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minHeight: 0 }}>
    {STAGES.map((stage, i) => {
      const local = clamp01(progress * STAGES.length - i);
      const fill = Math.min(local, stage.done);
      const complete = fill >= stage.done && stage.done === 1;
      return (
        <Card key={stage.name} style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, opacity: 0.35 + 0.65 * clamp01(local * 3) }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: complete ? hexA(theme.mint, 0.16) : hexA(accent, 0.14),
              border: `1px solid ${complete ? hexA(theme.mint, 0.4) : hexA(accent, 0.32)}`,
            }}
          >
            <Glyph kind={complete ? "check" : "play"} size={15} color={complete ? theme.mint : accent} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text size={14} weight={600}>
              {stage.name}
            </Text>
            <Text size={11} color={theme.muted} style={{ marginTop: 3 }}>
              {stage.detail}
            </Text>
            <div style={{ marginTop: 9, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${fill * 100}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: complete ? theme.mint : `linear-gradient(90deg, ${accent}, ${theme.violet})`,
                }}
              />
            </div>
          </div>
          <Chip label={complete ? "Done" : fill > 0 ? "Running" : "Queued"} color={complete ? theme.mint : fill > 0 ? accent : theme.muted} size={11} />
        </Card>
      );
    })}
  </div>
);

const CLIP_TITLES = [
  "This one prompt replaced my whole workflow",
  "Why your AI agent keeps forgetting",
  "Claude just made my SaaS build 4x faster",
  "The vibe coding mistake everyone makes",
  "I automated my entire content pipeline",
  "Stop paying for tools that do this free",
];

const ClipsBody: React.FC<{ progress: number; accent: string }> = ({ progress, accent }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, flex: 1, minHeight: 0 }}>
    {CLIP_TITLES.map((title, i) => {
      const local = clamp01(progress * (CLIP_TITLES.length + 2) - i);
      const score = 72 + ((i * 7) % 26);
      return (
        <Card
          key={title}
          style={{
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 9,
            opacity: local,
            transform: `translateY(${(1 - local) * 18}px) scale(${0.94 + 0.06 * local})`,
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: 10,
              background: `linear-gradient(150deg, ${hexA(accent, 0.35)}, ${hexA(theme.brand, 0.12)})`,
              border: `1px solid ${theme.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                background: "rgba(255,255,255,0.16)",
                border: "1px solid rgba(255,255,255,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Glyph kind="play" size={15} color="#fff" />
            </div>
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              <Chip label={`${score}`} color={score > 90 ? theme.mint : theme.text} size={10} />
            </div>
          </div>
          <Text size={11} weight={600} style={{ lineHeight: 1.3 }}>
            {title}
          </Text>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Bar w={26} h={5} color={hexA(accent, 0.5)} />
            <Text size={9} color={theme.muted}>
              0:3{i} · 9:16
            </Text>
          </div>
        </Card>
      );
    })}
  </div>
);

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_COLORS = [theme.accent, theme.violet, theme.mint, theme.amber, theme.pink];

const CalendarBody: React.FC<{ progress: number; accent: string }> = ({ progress }) => (
  <Card style={{ flex: 1, minHeight: 0, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
      {DAYS.map((d) => (
        <Kicker key={d} size={10}>
          {d}
        </Kicker>
      ))}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, flex: 1, minHeight: 0 }}>
      {Array.from({ length: 28 }, (_, i) => {
        // Deterministic "schedule": a couple of posts on most days.
        const count = [0, 1, 2, 1, 3, 2, 0, 1, 2, 2, 1, 3, 1, 2][i % 14] ?? 0;
        const local = clamp01(progress * 34 - i);
        return (
          <div
            key={i}
            style={{
              borderRadius: 9,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              padding: 6,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <Text size={9} color={theme.muted}>
              {i + 1}
            </Text>
            {Array.from({ length: count }, (_, k) => {
              const c = SLOT_COLORS[(i + k) % SLOT_COLORS.length];
              return (
                <div
                  key={k}
                  style={{
                    height: 12,
                    borderRadius: 4,
                    background: hexA(c, 0.28),
                    borderLeft: `2px solid ${c}`,
                    opacity: local,
                    transform: `scaleX(${0.4 + 0.6 * local})`,
                    transformOrigin: "left center",
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  </Card>
);

const AnalyticsBody: React.FC<{ progress: number; accent: string }> = ({ progress, accent }) => {
  const bars = [34, 52, 41, 68, 57, 83, 72, 96, 88, 74, 91, 100];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[
          { label: "Views (28d)", value: "1.84M", delta: "+62%" },
          { label: "Outliers", value: "17", delta: "+5" },
          { label: "Clips shipped", value: "128", delta: "+31" },
          { label: "Watch time", value: "9.4k h", delta: "+18%" },
        ].map((s) => (
          <Card key={s.label} style={{ padding: 13 }}>
            <Kicker size={9}>{s.label}</Kicker>
            <Text size={22} weight={650} style={{ marginTop: 6 }}>
              {s.value}
            </Text>
            <Text size={10} color={theme.mint} style={{ marginTop: 3 }}>
              ▲ {s.delta}
            </Text>
          </Card>
        ))}
      </div>
      <Card style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <Kicker size={10}>Outlier score vs channel baseline</Kicker>
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "flex-end", gap: 10 }}>
          {bars.map((h, i) => {
            const local = clamp01(progress * (bars.length + 4) - i);
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${h * local}%`,
                  borderRadius: "6px 6px 3px 3px",
                  background:
                    h > 85
                      ? `linear-gradient(180deg, ${theme.mint}, ${hexA(theme.mint, 0.25)})`
                      : `linear-gradient(180deg, ${accent}, ${hexA(accent, 0.18)})`,
                }}
              />
            );
          })}
        </div>
      </Card>
    </div>
  );
};

const EditorBody: React.FC<{ progress: number; accent: string }> = ({ progress, accent }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}>
    <div style={{ display: "flex", gap: 14, flex: 1, minHeight: 0 }}>
      <Card style={{ width: 250, display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
        <div
          style={{
            width: 128,
            height: "84%",
            borderRadius: 12,
            background: `linear-gradient(160deg, ${hexA(accent, 0.5)}, ${hexA(theme.violet, 0.2)})`,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 16,
          }}
        >
          <Text size={11} weight={700} style={{ textAlign: "center", padding: "0 10px" }}>
            THIS PROMPT CHANGED EVERYTHING
          </Text>
        </div>
      </Card>
      <Card style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 11 }}>
        <Kicker size={10}>Transcript</Kicker>
        {[92, 78, 96, 64, 88, 72, 84].map((w, i) => {
          const active = progress * 7 > i && progress * 7 < i + 1.4;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Text size={9} color={theme.faint} mono>
                0:{String(i * 7 + 4).padStart(2, "0")}
              </Text>
              <Bar w={`${w}%`} h={9} color={active ? hexA(accent, 0.7) : "rgba(255,255,255,0.11)"} />
            </div>
          );
        })}
      </Card>
    </div>
    <Card style={{ height: 130, padding: 12, display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[3, 2, 4, 1, 3, 2].map((flex, i) => (
          <div
            key={i}
            style={{
              flex,
              height: 34,
              borderRadius: 7,
              background: `linear-gradient(180deg, ${hexA(SLOT_COLORS[i % SLOT_COLORS.length], 0.45)}, ${hexA(
                SLOT_COLORS[i % SLOT_COLORS.length],
                0.16
              )})`,
              border: `1px solid ${hexA(SLOT_COLORS[i % SLOT_COLORS.length], 0.5)}`,
            }}
          />
        ))}
      </div>
      {/* waveform */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, height: 44 }}>
        {Array.from({ length: 96 }, (_, i) => {
          const h = 12 + 32 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23));
          return <div key={i} style={{ flex: 1, height: h, borderRadius: 1, background: hexA(theme.accentStrong, 0.5) }} />;
        })}
      </div>
      {/* playhead */}
      <div
        style={{
          position: "absolute",
          top: 6,
          bottom: 6,
          left: `${6 + progress * 88}%`,
          width: 2,
          background: "#fff",
          boxShadow: `0 0 12px 2px ${hexA("#ffffff", 0.6)}`,
        }}
      />
    </Card>
  </div>
);

const IDEAS = [
  { title: "The $20 account that outperforms a dev team", score: 94 },
  { title: "Every AI tool I stopped paying for", score: 88 },
  { title: "Building a SaaS in a weekend with agents", score: 86 },
  { title: "Why Claude beats ChatGPT for coding", score: 91 },
  { title: "Automate your content pipeline end to end", score: 79 },
];

const IdeasBody: React.FC<{ progress: number; accent: string }> = ({ progress, accent }) => (
  <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minHeight: 0 }}>
    {IDEAS.map((idea, i) => {
      const local = clamp01(progress * (IDEAS.length + 3) - i);
      return (
        <Card
          key={idea.title}
          accent={i === 0}
          style={{
            padding: 15,
            display: "flex",
            alignItems: "center",
            gap: 14,
            opacity: local,
            transform: `translateX(${(1 - local) * -22}px)`,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: hexA(idea.score > 90 ? theme.mint : accent, 0.15),
              border: `1px solid ${hexA(idea.score > 90 ? theme.mint : accent, 0.35)}`,
            }}
          >
            <Text size={15} weight={700} color={idea.score > 90 ? theme.mint : accent}>
              {idea.score}
            </Text>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text size={14} weight={600}>
              {idea.title}
            </Text>
            <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
              <Chip label="AI agents" color={theme.muted} size={10} />
              <Chip label="vibe coding" color={theme.muted} size={10} />
              <Chip label="building in public" color={theme.muted} size={10} />
            </div>
          </div>
          <Glyph kind="sparkle" size={16} color={accent} />
        </Card>
      );
    })}
  </div>
);

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
