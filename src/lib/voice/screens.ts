export type Screen = {
  id: string;
  href: string;
  label: string;
  /** What the screen is for, so the model picks the right one from a phrase. */
  purpose: string;
  /** Hidden from the command bar until that setting is on, like the sidebar item. */
  needs?: "personalDashboard";
};

export const SCREENS: Screen[] = [
  { id: "dashboard", href: "/", label: "Stream Pipeline (home)", purpose: "the home screen: the Stream Pipeline, what is in flight and what is due" },
  { id: "pipeline", href: "/pipeline", label: "Stream Pipeline", purpose: "one stream in, every format out; where runs live" },
  { id: "longform", href: "/longform", label: "Long-Form Video", purpose: "the long-form edit and its topic segments" },
  { id: "clips", href: "/clips", label: "Short Clips", purpose: "the clip generator and finished shorts" },
  { id: "editor", href: "/editor", label: "Clip Editor", purpose: "editing a single clip: cuts, captions, overlays" },
  { id: "carousels", href: "/carousels", label: "Carousels & Images", purpose: "carousel decks and image posts" },
  { id: "podcast", href: "/podcast", label: "Podcast / Spotify", purpose: "the long-form edit as audio, delivered to Spotify by RSS" },
  { id: "x-posts", href: "/x-posts", label: "Threads Autopilot", purpose: "the daily Threads posts, their schedule, and the X wording to copy" },
  { id: "facebook", href: "/facebook", label: "FB / IG Post Library", purpose: "Facebook and Instagram hook-and-comment-thread posts" },
  { id: "distribution", href: "/distribution", label: "Distribution Centre", purpose: "the publish queue and what is scheduled" },
  { id: "uploading-center", href: "/uploading-center", label: "Uploading Center", purpose: "connected channels and uploads" },
  { id: "automations", href: "/automations", label: "Automations", purpose: "background workers: pause or resume posting, last runs, what still goes live" },
  { id: "master-calendar", href: "/master-calendar", label: "Master Calendar", purpose: "the content calendar" },
  { id: "day-summary", href: "/day-summary", label: "Day Summary", purpose: "one day's output as a briefing" },
  { id: "performance", href: "/performance", label: "Performance", purpose: "how each published post performed: views, engagement and trend per platform, read back every 6 hours" },
  { id: "agents", href: "/agents", label: "Sourceflow Agents", purpose: "agent team settings and approvals" },
  { id: "ideas", href: "/ideas", label: "Idea Lab", purpose: "content ideas" },
  { id: "scripts", href: "/scripts", label: "Scripts", purpose: "written scripts" },
  { id: "music", href: "/music", label: "Music Studio", purpose: "background music" },
  { id: "voiceover", href: "/voiceover", label: "Voiceover", purpose: "generated voiceover" },
  { id: "outliers", href: "/outliers", label: "Outlier Radar", purpose: "competitor and outlier research" },
  { id: "inbox", href: "/inbox", label: "Inbox", purpose: "comments and replies on published posts from YouTube, Instagram, Facebook and Threads, with drafted replies to approve" },
  { id: "listening", href: "/listening", label: "Listening", purpose: "public threads where someone describes the problem CoLateral solves, to mark replied or ignored" },
  { id: "outreach", href: "/outreach", label: "Outreach", purpose: "the creators, newsletters and podcasts to offer CoLateral to, and who is due a follow-up" },
  { id: "execution", href: "/execution", label: "Execution", purpose: "recurring content, networking and build goals" },
  { id: "launch", href: "/launch", label: "Launch Pad", purpose: "Product Hunt launch planning" },
  { id: "presentation", href: "/presentation", label: "Segment Deck", purpose: "motion video segments" },
  { id: "finance", href: "/finance", label: "Personal Finance", purpose: "personal finance screens", needs: "personalDashboard" },
  { id: "settings", href: "/settings", label: "Settings", purpose: "app settings" }
];

/** The screens the command bar may open, given the settings the sidebar also reads. */
export function visibleScreens(options: { personalDashboard?: boolean } = {}): Screen[] {
  return SCREENS.filter((screen) => screen.needs !== "personalDashboard" || options.personalDashboard === true);
}

export function findScreen(target: string, options: { personalDashboard?: boolean } = {}): Screen | null {
  const value = target.trim().toLowerCase();
  if (!value) return null;
  const screens = visibleScreens(options);
  return (
    screens.find((screen) => screen.id === value) ??
    screens.find((screen) => screen.href === value || screen.href === `/${value}`) ??
    screens.find((screen) => screen.label.toLowerCase() === value) ??
    screens.find((screen) => screen.label.toLowerCase().includes(value)) ??
    screens.find((screen) => value.includes(screen.id)) ??
    null
  );
}

/** Screens a run can be opened on, with the run pre-selected. */
export function screenHref(screen: Screen, runId?: string): string {
  if (!runId) return screen.href;
  if (screen.id === "pipeline") return `/pipeline?run=${encodeURIComponent(runId)}`;
  return screen.href;
}
