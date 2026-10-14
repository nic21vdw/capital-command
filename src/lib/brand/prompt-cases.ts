export type CapturedPrompt = { system: string; user: string };

export type PromptCase = {
  id: string;
  run: () => Promise<void>;
};

const SOURCE = {
  title: "Why my agents keep stepping on each other",
  topic: "running three agents on one canvas",
  spokenText:
    "So I had Claude Code and Codex both editing the same sheet and the second one just overwrote the first. That is when I started putting each agent on its own card."
};

const LONGFORM_PROJECT = {
  name: "Day 28 build session",
  durationSec: 600,
  transcript: [
    { start: 0, end: 20, text: "Tonight I am wiring up the approval list." },
    { start: 20, end: 55, text: "The runner skips held posts and never burns a retry." },
    { start: 55, end: 100, text: "Then we approve one and watch it go out." }
  ],
  segments: [{ id: "s1", start: 0, end: 600, enabled: true }],
  hook: { enabled: false, start: 0, end: 0 }
};

const STORY_MOMENT = {
  id: "m001",
  unitIds: ["u1"],
  start: 0,
  end: 30,
  text: "I needed the hold to skip without burning retries, but the runner counted every skip.",
  score: 0.9
};

export const PROMPT_CASES: PromptCase[] = [
  {
    id: "launch-copy",
    run: async () => {
      const { generateLaunchCopy } = await import("@/lib/launch/copy");
      await generateLaunchCopy({
        product: "CoLateral",
        productUrl: "https://colateralai.com",
        audience: "developers who run several AI agents",
        whatItDoes: "puts Claude Code, Codex and Gemini on one canvas",
        differentiator: "agents work inside your real files"
      });
    }
  },
  {
    id: "x-posts-daily-pack",
    run: async () => {
      const { generateDailyPack } = await import("@/lib/x-posts/generator");
      await generateDailyPack({
        brief: "Positioning brief: builders who use AI agents every day.",
        date: "2026-10-14",
        focus: "reviewing agent output",
        recentTopics: ["agent drift", "small tools"]
      });
    }
  },
  {
    id: "publisher-platform-copy",
    run: async () => {
      const { generatePlatformCopy } = await import("@/lib/publisher/ai-copy");
      for (const platform of ["youtube", "tiktok", "instagram", "facebook"] as const) {
        await generatePlatformCopy(SOURCE, platform, "America/Toronto");
      }
    }
  },
  {
    id: "publisher-clip-title",
    run: async () => {
      const { generateClipMetadata } = await import("@/lib/publisher/metadata");
      await generateClipMetadata({ streamTitle: "Day 28", topic: SOURCE.topic, spokenText: SOURCE.spokenText });
    }
  },
  {
    id: "clip-viral-titles",
    run: async () => {
      const { generateViralTitles } = await import("@/lib/clipping/titles");
      await generateViralTitles([{ id: "c1", transcript: SOURCE.spokenText }], { streamTitle: "Day 28", topic: SOURCE.topic });
    }
  },
  {
    id: "clip-hashtags",
    run: async () => {
      const { generateClipHashtags } = await import("@/lib/clipping/hashtags");
      await generateClipHashtags({ spokenText: SOURCE.spokenText, streamTitle: "Day 28", topic: SOURCE.topic, title: SOURCE.title });
    }
  },
  {
    id: "longform-metadata",
    run: async () => {
      const { generateLongformMetadata } = await import("@/lib/longform/metadata");
      await generateLongformMetadata(LONGFORM_PROJECT as never);
    }
  },
  {
    id: "longform-topics",
    run: async () => {
      const { generateTopicMetadata } = await import("@/lib/longform/topics");
      await generateTopicMetadata([{ id: "t1", minutes: 12, text: SOURCE.spokenText }], { streamTitle: "Day 28" });
    }
  },
  {
    id: "longform-thumbnail-hooks",
    run: async () => {
      const { thumbnailHooks } = await import("@/lib/longform/thumbnailHooks");
      await thumbnailHooks(LONGFORM_PROJECT as never, null);
    }
  },
  {
    id: "pipeline-posts",
    run: async () => {
      const { generatePipelinePosts } = await import("@/lib/pipeline/posts");
      await generatePipelinePosts({
        streamTitle: "Day 28",
        transcriptText: SOURCE.spokenText,
        clipHighlights: [{ title: "Two Agents One Sheet", quote: "the second one just overwrote the first" }]
      });
    }
  },
  {
    id: "studio-carousel",
    run: async () => {
      const { generateCarousel } = await import("@/lib/studio/carousel");
      await generateCarousel({
        title: SOURCE.title,
        sourceText: SOURCE.spokenText,
        slideCount: 6,
        sourceType: "manual",
        requireModel: true
      } as never);
    }
  },
  {
    id: "studio-ideas",
    run: async () => {
      const { generateIdeas } = await import("@/lib/studio/ideas");
      await generateIdeas({ seed: "AI agents", outlierTitles: ["I Let Five Agents Run My Day"], existingTitles: ["Vibe Coding a SaaS"] });
    }
  },
  {
    id: "studio-script",
    run: async () => {
      const { generateScript } = await import("@/lib/studio/scripts");
      await generateScript({ framework: "story", title: SOURCE.title, angle: "stakes first", keywords: ["agents", "canvas"], targetMinutes: 8 });
    }
  },
  {
    id: "story-copy",
    run: async () => {
      const { askCopy } = await import("@/lib/story/ai");
      await askCopy({
        title: "Day 28",
        outline: "hook, setup, payoff",
        chapterKeys: [{ key: "c1", summary: "the overwrite" }],
        transcript: SOURCE.spokenText
      });
    }
  },
  {
    id: "story-plan",
    run: async () => {
      const { askStory } = await import("@/lib/story/ai");
      await askStory({
        title: "Day 28",
        targetSec: 600,
        moments: [STORY_MOMENT] as never,
        units: new Map(),
        runtimeOf: () => 30
      });
    }
  },
  {
    id: "voice-console-armed",
    run: async () => {
      const { runVoiceTurn } = await import("@/lib/voice/textAgent");
      await runVoiceTurn({ utterance: "show me the pipeline", allowActions: true });
    }
  },
  {
    id: "voice-console-readonly",
    run: async () => {
      const { runVoiceTurn } = await import("@/lib/voice/textAgent");
      await runVoiceTurn({ utterance: "what is running", allowActions: false });
    }
  },
  {
    id: "voice-realtime-session",
    run: async () => {
      const { voiceInstructions } = await import("@/lib/voice/prompt");
      const { captureText } = await import("@/lib/brand/prompt-capture");
      captureText(await voiceInstructions(true));
      captureText(await voiceInstructions(false));
    }
  },
  {
    id: "outreach-thread-template",
    run: async () => {
      const { DEFAULT_THREAD_TEMPLATE } = await import("@/lib/outreach/model");
      const { captureText } = await import("@/lib/brand/prompt-capture");
      captureText(DEFAULT_THREAD_TEMPLATE);
    }
  },
  {
    id: "outreach-template",
    run: async () => {
      const { DEFAULT_OUTREACH_TEMPLATE } = await import("@/lib/outreach/model");
      const { captureText } = await import("@/lib/brand/prompt-capture");
      captureText(DEFAULT_OUTREACH_TEMPLATE);
    }
  }
];
