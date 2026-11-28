import type { AnalyticsPlatform } from "@/lib/analytics/types";

export type WinnerPlatform = AnalyticsPlatform | "x";

export type WinnerMetric = "views" | "engagements";

export type WinnerEvidence = {
  platform: WinnerPlatform;
  postId: string;
  metric: WinnerMetric;
  value: number;
  median: number;
  ratio: number;
  ageDays: number;
  peers: number;
};

export type Winner = {
  ideaId: string;
  title: string;
  caption: string;
  publishedAt: string;
  evidence: WinnerEvidence[];
  bestRatio: number;
};

export type ExternalPost = {
  platform: "x";
  id: string;
  text: string;
  postedAt: string;
  views: number;
  likes?: number;
  replies?: number;
  reposts?: number;
};

export type ShortScript = {
  hook: string;
  lines: string[];
  cta: string;
  headlines: string[];
  broll: string[];
};

export type RetestPlan = {
  from: string;
  by: string;
  hook: string;
  note: string;
};

export type Remix = {
  angle: string;
  short: ShortScript;
  threads: string;
  tweet: string;
  retest: RetestPlan;
  flags: string[];
};

export type WinnerEntry = Winner & {
  detectedAt: string;
  remix: Remix | null;
  remixError?: string;
  status: "drafted" | "approved" | "skipped";
};

export type WinnersStore = {
  version: 1;
  winners: Record<string, WinnerEntry>;
  lastScanAt: string | null;
};
