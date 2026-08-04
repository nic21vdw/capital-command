export type Screen = {
  id: string;
  href: string;
  label: string;
  /** What the screen is for, so the model picks the right one from a phrase. */
  purpose: string;
};

export const SCREENS: Screen[] = [
  { id: "dashboard", href: "/", label: "Dashboard", purpose: "the overview: what is in flight and what is due" },
  { id: "pipeline", href: "/pipeline", label: "Stream Pipeline", purpose: "one stream in, every format out; where runs live" },
  { id: "longform", href: "/longform", label: "Long-Form Video", purpose: "the long-form edit and its topic segments" },
  { id: "clips", href: "/clips", label: "Short Clips", purpose: "the clip generator and finished shorts" },
  { id: "editor", href: "/editor", label: "Clip Editor", purpose: "editing a single clip: cuts, captions, overlays" },
  { id: "carousels", href: "/carousels", label: "Carousels & Images", purpose: "carousel decks and image posts" },
  { id: "x-posts", href: "/x-posts", label: "X / Threads Posts", purpose: "text posts for X and Threads" },
  { id: "facebook", href: "/facebook", label: "FB / IG Threads", purpose: "Facebook and Instagram thread posts" },
  { id: "distribution", href: "/distribution", label: "Distribution Centre", purpose: "the publish queue and what is scheduled" },
  { id: "uploading-center", href: "/uploading-center", label: "Uploading Center", purpose: "connected channels and uploads" },
  { id: "master-calendar", href: "/master-calendar", label: "Master Calendar", purpose: "the content calendar" },
  { id: "agents", href: "/agents", label: "Sourceflow Agents", purpose: "agent team settings and approvals" },
  { id: "ideas", href: "/ideas", label: "Idea Lab", purpose: "content ideas" },
  { id: "scripts", href: "/scripts", label: "Scripts", purpose: "written scripts" },
  { id: "music", href: "/music", label: "Music Studio", purpose: "background music" },
  { id: "voiceover", href: "/voiceover", label: "Voiceover", purpose: "generated voiceover" },
  { id: "avatar", href: "/avatar", label: "Higgsfield Avatar", purpose: "avatar video" },
  { id: "outliers", href: "/outliers", label: "Outlier Radar", purpose: "competitor and outlier research" },
  { id: "launch", href: "/launch", label: "Launch Pad", purpose: "Product Hunt launch planning" },
  { id: "presentation", href: "/presentation", label: "Segment Deck", purpose: "motion video segments" },
  { id: "settings", href: "/settings", label: "Settings", purpose: "app settings" }
];

export function findScreen(target: string): Screen | null {
  const value = target.trim().toLowerCase();
  if (!value) return null;
  return (
    SCREENS.find((screen) => screen.id === value) ??
    SCREENS.find((screen) => screen.href === value || screen.href === `/${value}`) ??
    SCREENS.find((screen) => screen.label.toLowerCase() === value) ??
    SCREENS.find((screen) => screen.label.toLowerCase().includes(value)) ??
    SCREENS.find((screen) => value.includes(screen.id)) ??
    null
  );
}

/** Screens a run can be opened on, with the run pre-selected. */
export function screenHref(screen: Screen, runId?: string): string {
  if (!runId) return screen.href;
  if (screen.id === "pipeline") return `/pipeline?run=${encodeURIComponent(runId)}`;
  return screen.href;
}
