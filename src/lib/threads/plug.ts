import { THREADS_TEXT_LIMIT, type ThreadsConfig } from "@/lib/threads/config";
import { threadsReplyUrl } from "@/lib/threads/reply-attribution";

// The parent stays a thought in Nic's voice. The self-reply adds a relevant way
// into the project, without claiming the parent was made with CoLateral or
// promising that an unfinished feature is ready. Every angle has several
// complete invitations rather than one sales line with a swapped noun.
const REPLY_LINES = {
  workspace: [
    "See the workspace I use for agents, files and ideas. CoLateral puts them on one project canvas:",
    "Take a look at CoLateral's project canvas if your agents and files need a shared home:",
    "Want a look inside my workspace? See how CoLateral keeps agents, files and ideas together:",
    "Explore CoLateral, my agent development environment: a workspace for agents, files and ideas:",
    "See how CoLateral's canvas keeps agents and project context in the same workspace:",
    "Explore CoLateral's project canvas for a closer look at how I bring agents and tools together:"
  ],
  "custom-tools": [
    "Got a tool idea? Explore CoLateral and start with a tool for the work you repeat:",
    "Build your own tools around the way you work. Take a look at CoLateral:",
    "See the workspace I'm using to bring custom tools, agents and project files together: CoLateral:",
    "Your next useful tool can start with one repetitive task. Explore CoLateral:",
    "Take a look at CoLateral if you'd like to build a tool around your own process:",
    "Explore CoLateral's project canvas for the files, ideas and agents behind your next tool:"
  ],
  agents: [
    "Explore CoLateral's shared canvas for AI agents, files and project ideas:",
    "See the CoLateral workspace I use to keep agent work and project context together:",
    "Want to see how I organize agent work? Take a look at CoLateral's project canvas:",
    "Give your next agent experiment a project home. Explore CoLateral's canvas:",
    "Take a look at CoLateral if you'd like to bring agents and project files into one workspace:",
    "See how CoLateral puts agents, files and ideas together on one project canvas:"
  ],
  engineering: [
    "Explore CoLateral Engineering for a closer look at the tools I'm building for engineering work:",
    "See the workspace I use to keep engineering tool ideas, agents and files together: CoLateral:",
    "Got an engineering task you'd like to make less repetitive? Take a look at CoLateral's tools and canvas:",
    "Bring your next engineering tool idea to CoLateral. Explore the workspace here:",
    "See how CoLateral puts files, tool ideas and agents on one canvas for engineering projects:",
    "Explore the engineering side of CoLateral, the workspace I build alongside my day job:"
  ],
  marketing: [
    "See the wider CoLateral workspace behind my marketing-tool experiments:",
    "Got a content-tool idea you actually need? Explore CoLateral's canvas for agents, files and ideas:",
    "Take a look at CoLateral if you'd like to build your own tools around making content:",
    "My content workflow keeps giving me tool ideas. See the CoLateral workspace I'm building around them:",
    "Explore CoLateral for a look at how I bring content-tool ideas and agents into one workspace:",
    "See the wider project alongside my CoLateral Marketing experiments, including the canvas for agents and files:"
  ],
  games: [
    "Explore the CoLateral Arcade if games are your favourite kind of building experiment:",
    "Take a look at the games side of CoLateral, alongside the canvas for agents and tools:",
    "See the Arcade side of CoLateral, where I build and try out game ideas:",
    "If making games is your idea of a good side quest, take a look at CoLateral:",
    "CoLateral has a playful side too. Take a look at the Arcade:",
    "See the game experiments I'm building around CoLateral:"
  ],
  "build-in-public": [
    "See the CoLateral workspace behind my build updates, with agents, files and ideas on one canvas:",
    "If you've got a project of your own, explore CoLateral's canvas for agents and files:",
    "Take a look inside CoLateral, the desktop workspace I keep building live:",
    "See where my tool and workspace experiments are heading. Explore CoLateral:",
    "Bring a project idea to CoLateral. Take a look at the canvas for agents, files and tools:",
    "Curious what all these builds are turning into? Explore CoLateral:"
  ],
  general: [
    "Alongside these thoughts, I build CoLateral. See the canvas where agents, files and ideas share a project:",
    "For context on what I build alongside these posts, explore CoLateral's workspace for agents and tools:",
    "If you're curious about my own project, take a look at CoLateral's canvas for agents, files and ideas:",
    "A little context on the builder behind these posts: see the CoLateral workspace I'm building:",
    "My ongoing project is CoLateral. Explore the desktop workspace for agents, files and ideas:",
    "For a look at what I'm building between these posts, explore CoLateral and its shared project canvas:"
  ]
} as const;

type ReplyAngle = keyof typeof REPLY_LINES;
type ReplyOrigin = "autopilot" | "pipeline";

// Match subjects rather than brand mentions. A generic observation still gets
// a truthful project introduction; it never invents a connection to that topic.
const CONTEXTS: ReadonlyArray<{ angle: ReplyAngle; pattern: RegExp }> = [
  { angle: "engineering", pattern: /\b(?:engineer(?:s|ing)?|structural|revit|etabs|sap2000|beam(?:s)?|column(?:s)?|slab(?:s)?|footing(?:s)?|hollowcore|joist(?:s)?|masonry|concrete|steel|cad|bim)\b/i },
  { angle: "games", pattern: /\b(?:game(?:s|play)?|gaming|arcade|multiplayer|battle royale|warzone|nick ops|claude of duty|shrek|mortal kombat|guitar hero|player(?:s)?|character(?:s)?|cutscene(?:s)?)\b/i },
  { angle: "marketing", pattern: /\b(?:marketing|content|creator(?:s)?|social media|threads|youtube|instagram|tiktok|shorts|livestream(?:s|ing)?|audience|thumbnail(?:s)?|post(?:s|ing)?|carousel(?:s)?|caption(?:s)?|newsletter(?:s)?)\b/i },
  { angle: "workspace", pattern: /\b(?:workspace(?:s)?|ade|agent development environment|ide|canvas|terminal(?:s)?|dashboard(?:s)?|browser(?:s)?)\b/i },
  { angle: "custom-tools", pattern: /\b(?:custom|tool(?:s|ing)?|workflow(?:s)?|automation(?:s)?|automate(?:d|s)?|spreadsheet(?:s)?|script(?:s|ing)?|plugin(?:s)?|extension(?:s)?|module(?:s)?|add-on(?:s)?)\b/i },
  { angle: "agents", pattern: /\b(?:agent(?:s|ic)?|orchestrat(?:e|es|ing|ion|or)|claude|chatgpt|gemini|codex|ai|llm(?:s)?|prompt(?:s|ing)?)\b/i },
  { angle: "build-in-public", pattern: /\b(?:co-?lateral|build(?:s|ing)?|built|coding|code|ship(?:s|ped|ping)?|launch(?:es|ed|ing)?|develop(?:ment|er(?:s)?|ing)?|release(?:s|d)?|prototype(?:s)?|side project|startup)\b/i }
];

const MENTIONS_COLATERAL = /\bco-?lateral\b/i;

function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mentionsColateral(text: string): boolean {
  return MENTIONS_COLATERAL.test(text);
}

export function plugReplyFor(
  text: string,
  seed: string,
  config: ThreadsConfig,
  origin: ReplyOrigin = "autopilot"
): string | undefined {
  const parent = text.trim();
  if (!config.plugReplies || !parent) return undefined;

  const angle = CONTEXTS.find((context) => context.pattern.test(parent))?.angle ?? "general";
  const url = threadsReplyUrl(config.plugUrl, { angle, origin });
  if (!url) return undefined;

  const lines = REPLY_LINES[angle];
  const line = lines[hash32(`${seed}:${parent}`) % lines.length];
  const full = `${line}\n${url}`;
  if (full.length <= THREADS_TEXT_LIMIT) return full;

  // Never truncate a URL, its query parameters or attribution. An unusually
  // long configured destination gets a shorter invitation, or no reply when
  // even a readable brand label and the complete link cannot fit.
  const compact = `Explore CoLateral:\n${url}`;
  if (compact.length <= THREADS_TEXT_LIMIT) return compact;
  const minimal = `CoLateral:\n${url}`;
  return minimal.length <= THREADS_TEXT_LIMIT ? minimal : undefined;
}
