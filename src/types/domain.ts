export type AssetClass =
  | "Stocks"
  | "ETFs"
  | "Crypto"
  | "Cash"
  | "Bonds"
  | "Funds"
  | "REITs"
  | "Other";

export type AccountType =
  | "TFSA"
  | "RRSP"
  | "FHSA"
  | "Cash"
  | "Non-Registered"
  | "Crypto Wallet"
  | "Other";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution?: string;
  currency: string;
}

export interface Holding {
  id: string;
  ticker: string;
  name: string;
  assetClass: AssetClass;
  account: string;
  quantity: number;
  averageCost: number;
  currentPrice?: number;
  manualPrice?: number;
  dividendYield?: number;
  notes?: string;
  updatedAt: string;
}

export interface WatchlistItem {
  id: string;
  ticker: string;
  name: string;
  assetClass: AssetClass;
  currentPrice?: number;
  targetBuyPrice?: number;
  reason: string;
  riskRating: number;
  convictionRating: number;
  notes?: string;
  dateAdded: string;
}

export interface ResearchNote {
  id: string;
  title: string;
  relatedTicker?: string;
  thesis: string;
  bullCase: string;
  bearCase: string;
  keyRisks: string;
  valuationThoughts: string;
  sourceLinks: string[];
  tags: string[];
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  goalName: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
  monthlyContribution?: number;
  notes?: string;
}

export interface PriceData {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  lastUpdated: string;
  source: "alpha-vantage" | "mock" | "manual";
}

export interface HistoricalPricePoint {
  date: string;
  value: number;
}

export interface PortfolioSnapshot {
  date: string;
  totalValue: number;
}

export type ExpenseCategory =
  | "Hardware"
  | "AI Subscription"
  | "Cloud"
  | "Software"
  | "Peripherals"
  | "Other";

export type ExpenseFrequency = "one-time" | "monthly" | "yearly";

export interface Expense {
  id: string;
  name: string;
  vendor?: string;
  category: ExpenseCategory;
  frequency: ExpenseFrequency;
  amount: number;
  currency: "CAD" | "USD";
  date: string;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ThemePreset = "slate" | "midnight" | "graphite" | "forest" | "dracula" | "paper" | "arctic";

export interface UserProfile {
  /** Display name shown in the profile bar. */
  displayName?: string;
  /** Avatar image stored as a data URL. */
  avatar?: string;
}

export interface Settings {
  currency: "CAD" | "USD";
  /** Active full theme preset (sets background, surfaces, text, and accent together). */
  themePreset?: ThemePreset;
  profile?: UserProfile;
}

export type ContentType = "Video" | "Short" | "Stream" | "Podcast";

export type ContentPlatform = "YouTube" | "Twitch" | "TikTok" | "Instagram" | "Other";

export type ContentStatus = "Idea" | "Scripting" | "Recording" | "Editing" | "Scheduled" | "Published";

export interface ContentItem {
  id: string;
  title: string;
  type: ContentType;
  platform: ContentPlatform;
  status: ContentStatus;
  publishDate?: string;
  url?: string;
  views?: number;
  likes?: number;
  comments?: number;
  watchHours?: number;
  revenue?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorProfile {
  channelName: string;
  platform: ContentPlatform;
  subscribers: number;
  totalViews: number;
  watchHours: number;
  monetized: boolean;
  subscriberGoal: number;
  monthlyRevenueGoal: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Execution dashboard (recurring brand-building accountability)
// ---------------------------------------------------------------------------

export type ExecutionCategory =
  | "X / Twitter"
  | "Reddit"
  | "YouTube"
  | "CoLateral"
  | "Structural Engineering"
  | "Community & Networking";

export type ExecutionFrequency = "daily" | "weekly";

/**
 * A recurring goal. `weeklyTarget` is always the baseline weekly requirement;
 * for daily goals it is derived as `dailyTarget * 7` so that all debt and
 * reconciliation math can operate on a single weekly granularity.
 */
export interface ExecutionGoal {
  id: string;
  title: string;
  description?: string;
  category: ExecutionCategory;
  frequency: ExecutionFrequency;
  /** Per-day target for daily goals; 0 for weekly goals. */
  dailyTarget: number;
  /** Baseline weekly requirement. Daily goals: dailyTarget * 7. */
  weeklyTarget: number;
  /** lucide-react icon key (resolved via the execution icon registry). */
  icon: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

/** An immutable record of a single manual completion (event-sourced). */
export interface ExecutionCompletion {
  id: string;
  goalId: string;
  /** Local YYYY-MM-DD the work counts toward. */
  date: string;
  /** ISO timestamp of when it was logged. */
  timestamp: string;
  quantity: number;
  source: "manual";
  note?: string;
  createdAt: string;
}

/** A finalized weekly snapshot for a goal. Frozen once the week ends. */
export interface ExecutionPeriod {
  id: string;
  goalId: string;
  weekStart: string;
  weekEnd: string;
  baseline: number;
  startingDebt: number;
  effectiveRequired: number;
  completed: number;
  baselineCompleted: number;
  debtPaid: number;
  newDebt: number;
  endingDebt: number;
  overachievement: number;
  successful: boolean;
  finalized: boolean;
  finalizedAt?: string;
}

/** A single debt ledger entry. Repayments are applied oldest-first. */
export interface ExecutionDebtEntry {
  id: string;
  goalId: string;
  originWeekStart: string;
  originalQuantity: number;
  remainingQuantity: number;
  repaidQuantity: number;
  createdAt: string;
  fullyRepaidAt?: string;
}

export type XActivityType = "reply" | "post";

export interface XActivity {
  id: string;
  type: XActivityType;
  date: string; // YYYY-MM-DD (local day the activity happened)
  account?: string; // for replies: the handle replied to
  topic: string;
  text: string; // the exact reply or post text
  engagement?: string;
  createdAt: string;
}

export interface XStrategy {
  brief: string; // positioning / voice / strategy (markdown)
  dailyReplyTarget: number; // minimum quality replies per day
  dailyPostTarget: number; // minimum original posts per day
  activities: XActivity[];
}

export interface SavedThumbnailTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Optional independent height scale (proportional when omitted). */
  scaleY?: number;
  /** Layer opacity 0..1 (fully opaque when omitted). */
  opacity?: number;
}

export interface SavedThumbnailTreatment {
  cutout: boolean;
  flip: boolean;
  stroke: number;
  strokeColor: string;
  glow: number;
  shadow: boolean;
  backlight: boolean;
  saturate: number;
  contrast: number;
  brightness: number;
}

export interface SavedThumbnailImage {
  id: string;
  name: string;
  /** PNG data URL of the (possibly cut-out) image. */
  src: string;
  transform: SavedThumbnailTransform;
  treatment: SavedThumbnailTreatment;
  locked?: boolean;
  lockAspect?: boolean;
}

export interface SavedThumbnailSticker {
  id: string;
  type: "circle" | "arrow" | "emoji" | "badge";
  x: number;
  y: number;
  scale: number;
  rotation: number;
  color: string;
  text: string;
}

export interface SavedThumbnail {
  id: string;
  name: string;
  /** Small JPEG data URL used for the gallery card. */
  preview: string;
  title: string;
  overlayText: string;
  style: string;
  paletteIndex: number;
  intensity: "subtle" | "balanced" | "bold";
  emphasis: "outline" | "highlight-bar" | "boxed" | "clean";
  position: "left" | "bottom-left" | "center";
  size: "small" | "medium" | "large";
  uppercase: boolean;
  fontId: string;
  textColor: string;
  highlightColor: string;
  textTransform: SavedThumbnailTransform;
  manualLayout: boolean;
  exportScale: number;
  exportWidth?: number;
  exportHeight?: number;
  images: SavedThumbnailImage[];
  stickers: SavedThumbnailSticker[];
  createdAt: string;
  updatedAt: string;
}

// ----- Clip Editor -----
// A non-destructive editing project layered on top of a rendered clip. The
// source clip file is never modified; everything below is an instruction set
// that the preview renders live and the export pipeline bakes into a new file.

/** One spoken word with its own start/end (where the source provides it). */
export interface CaptionWord {
  text: string;
  /** Seconds, relative to the clip. */
  start: number;
  end: number;
}

/** A phrase-level caption segment. */
export interface CaptionSegment {
  id: string;
  /** Seconds, relative to the clip. */
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
  /** Disabled segments are kept but neither shown nor burned in. */
  enabled: boolean;
}

export type CaptionPosition = "top" | "middle" | "bottom" | "lower-third";
export type CaptionAlignment = "left" | "center" | "right";
export type CaptionAnimation = "none" | "fade" | "pop" | "karaoke";

export interface CaptionStyle {
  fontFamily: string;
  /** Font size as a fraction of output height (keeps it readable at any size). */
  fontScale: number;
  fontWeight: number;
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  outlineWidth: number;
  shadow: number;
  position: CaptionPosition;
  alignment: CaptionAlignment;
  maxWordsPerCaption: number;
  wordsPerLine: number;
  animation: CaptionAnimation;
  uppercase: boolean;
  /**
   * Free placement set by dragging the caption on the preview: normalized
   * 0..1 center of the caption block. When both are set they override
   * `position`; clearing them returns the caption to the preset slot.
   */
  offsetX?: number;
  offsetY?: number;
}

export type CaptionPresetId = "minimal" | "bold-shorts" | "highlight-word" | "lower-third" | "colateral-purple";

export type OverlayKind = "text" | "image" | "logo" | "watermark";

export interface Overlay {
  id: string;
  kind: OverlayKind;
  /** Text content for text overlays. */
  text?: string;
  /** Data URL for image/logo/watermark overlays. */
  src?: string;
  /** Center position, normalized 0..1 of the frame. */
  x: number;
  y: number;
  /** Scale relative to a default size (1 = default). */
  scale: number;
  rotation: number;
  opacity: number;
  /** Stacking order; higher renders on top. */
  z: number;
  locked: boolean;
  /** Visible window in clip-seconds. */
  start: number;
  end: number;
  // Text styling (ignored for image overlays).
  color?: string;
  background?: string;
  fontFamily?: string;
  fontWeight?: number;
  align?: CaptionAlignment;
}

export interface ClipAudio {
  /** 0 = mute, 1 = unchanged, up to 2 = +6 dB. */
  clipVolume: number;
  fadeIn: number;
  fadeOut: number;
  /** Optional background music as a data URL. */
  musicSrc?: string;
  musicName?: string;
  musicVolume: number;
}

export type AspectRatioId = "9:16" | "16:9" | "1:1" | "4:5" | "custom";

export interface ReframeTransform {
  /** Zoom of the source inside the frame (1 = fit). */
  scale: number;
  /** Pan, normalized -1..1 of the spare space. */
  offsetX: number;
  offsetY: number;
}

export type ClipCompositionMode =
  | "center-blur"
  | "crop-fill"
  | "stacked-split"
  | "stacked-split-flip"
  | "screen-lead"
  | "face-lead"
  | "fit";

export type ExportPresetId = "shorts" | "longform" | "square" | "portrait" | "custom";
export type ExportQuality = "high" | "medium" | "low";
export type ExportFormat = "mp4" | "webm";

export interface ClipExportSettings {
  preset: ExportPresetId;
  width: number;
  height: number;
  fps: number;
  quality: ExportQuality;
  format: ExportFormat;
  burnCaptions: boolean;
  separateSubtitle: boolean;
  watermark: boolean;
  filename: string;
}

export type SuggestionStatus = "pending" | "approved" | "rejected";

export interface AISuggestion {
  id: string;
  /** Seconds, relative to the clip. */
  start: number;
  end: number;
  score: number;
  rationale: string;
  status: SuggestionStatus;
  addedToTimeline: boolean;
}

export interface ClipProject {
  id: string;
  name: string;
  /** The clip job this project was created from. */
  jobId: string;
  /** Rendered base clip filename inside the job's output dir. */
  sourceFile: string;
  sourceUrl: string;
  baseDurationSec: number;
  baseWidth: number;
  baseHeight: number;
  /** Where this clip sits inside the source VOD (for caption offset/suggestions). */
  clipStart: number;
  clipEnd: number;
  /** Non-destructive trim points inside the rendered clip. */
  trimStart: number;
  trimEnd: number;
  /** Short generated/editorial title for this clip. */
  title: string;
  aspectRatio: AspectRatioId;
  /** How the 16:9 source master is composed inside the chosen output frame. */
  compositionMode: ClipCompositionMode;
  reframe: ReframeTransform;
  /**
   * Where the face camera sits inside the source frame (normalized). Used by
   * the split/lead layouts; defaults to the top-right streamer camera spot.
   */
  faceSource?: RegionRect;
  captions: CaptionSegment[];
  captionStyle: CaptionStyle;
  captionsVisible: boolean;
  highlightCurrentWord: boolean;
  overlays: Overlay[];
  audio: ClipAudio;
  exportSettings: ClipExportSettings;
  suggestions: AISuggestion[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Video Clip Creator (non-destructive timeline editor)
// ---------------------------------------------------------------------------

export type AspectPreset = "9:16" | "16:9" | "1:1" | "4:5" | "custom";
export type FramingMode = "fit" | "fill" | "crop";

export interface RegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClipFraming {
  mode: FramingMode;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  srcRect: RegionRect;
}

export interface CameraOverlay {
  enabled: boolean;
  srcRect: RegionRect;
  destRect: RegionRect;
  radius: number;
}

export interface ClipBackground {
  type: "blur" | "color";
  color: string;
}

export interface VideoClip {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  volume: number;
  muted: boolean;
  speed: number;
  fadeIn: number;
  fadeOut: number;
  background: ClipBackground;
  layoutPreset: string;
  camera: CameraOverlay;
  /** Framing keyed by aspect-ratio id, so switching ratios is lossless. */
  framing: Record<string, ClipFraming>;
}

export interface VideoSource {
  id: string;
  kind: "upload" | "url";
  fileName: string;
  url?: string;
  mime: string;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sizeBytes: number;
}

export interface AspectRatio {
  preset: AspectPreset;
  w: number;
  h: number;
}

export interface VideoProject {
  id: string;
  name: string;
  source: VideoSource | null;
  aspect: AspectRatio;
  exportPreset: string;
  clips: VideoClip[];
  createdAt: string;
  updatedAt: string;
}

export interface AppData {
  holdings: Holding[];
  watchlist: WatchlistItem[];
  researchNotes: ResearchNote[];
  goals: Goal[];
  accounts: Account[];
  portfolioSnapshots: PortfolioSnapshot[];
  expenses: Expense[];
  contentItems: ContentItem[];
  creatorProfile: CreatorProfile;
  xStrategy: XStrategy;
  settings: Settings;
  executionGoals: ExecutionGoal[];
  executionCompletions: ExecutionCompletion[];
  executionPeriods: ExecutionPeriod[];
  executionDebt: ExecutionDebtEntry[];
  /** ISO timestamp recorded the first time default goals were seeded. */
  executionSeededAt?: string;
  savedThumbnails: SavedThumbnail[];
  clipProjects: ClipProject[];
  videoProjects: VideoProject[];
  /** Reusable brand images (logo/watermark) shared across all clip projects. */
  brandAssets?: BrandAssets;
}

export interface BrandAssets {
  /** Data URL of the default logo image. */
  logoSrc?: string;
  /** Data URL of the default watermark image. */
  watermarkSrc?: string;
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface BillingMetric {
  amount: number;
  previousAmount: number;
  changePercent: number;
  trend: TrendPoint[];
}

export interface PaymentBreakdownItem {
  label: string;
  amount: number;
  color: string;
}

export interface BillingOverview {
  source: "stripe" | "mock";
  currency: "CAD" | "USD";
  updatedAt: string;
  grossVolume: BillingMetric;
  netVolume: BillingMetric;
  mrr: BillingMetric;
  mrrGrowthRate: BillingMetric;
  activeSubscribers: BillingMetric;
  churnRate: BillingMetric;
  paymentBreakdown: PaymentBreakdownItem[];
  disputes: number;
  highRiskPayments: number;
}
