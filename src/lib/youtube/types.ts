import type { ContentItem, ContentPlatform } from "@/types/domain";

// How the Studio numbers were sourced. "tracked" means derived from the data the
// user enters in Nic Vandewetering; "live" means pulled from the YouTube API. The UI
// keys off this so the same screen works before and after a real connection exists.
export type StudioSource = "live" | "tracked";

// Mirrors the visibility states YouTube Studio shows in its content table.
export type StudioVisibility = "Public" | "Scheduled" | "Draft";

export type Performance = "top" | "under" | "normal";

export interface StudioVideoRow {
  id: string;
  title: string;
  type: ContentItem["type"];
  visibility: StudioVisibility;
  restriction: string;
  publishDate?: string;
  views: number;
  likes: number;
  comments: number;
  watchHours: number;
  revenue: number;
  // (likes + comments) / views, 0 when there are no views yet.
  engagementRate: number;
  thumbnailUrl: string | null;
  url?: string;
  performance: Performance;
  performanceReason?: string;
}

export interface MonetizationReadiness {
  monetized: boolean;
  eligible: boolean;
  subscribers: number;
  subscriberTarget: number;
  subscriberPct: number;
  subscribersRemaining: number;
  watchHours: number;
  watchHourTarget: number;
  watchHourPct: number;
  watchHoursRemaining: number;
  bottleneck: "subscribers" | "watchHours" | "none";
  // Cadence-based projection. Null when there isn't enough published history to estimate.
  uploadsPerMonth: number | null;
  avgWatchHoursPerUpload: number | null;
  monthsToWatchHours: number | null;
  projectedWatchHourDate: string | null;
}

export interface StudioInsights {
  medianViews: number;
  topPerformers: StudioVideoRow[];
  underPerformers: StudioVideoRow[];
}

export interface StudioOverview {
  channelName: string;
  platform: ContentPlatform;
  subscribers: number;
  totalViews: number;
  watchHours: number;
  publishedCount: number;
  revenueThisMonth: number;
  rows: StudioVideoRow[];
  monetization: MonetizationReadiness;
  insights: StudioInsights;
  source: StudioSource;
}
