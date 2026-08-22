import { AtSign, Clapperboard, Facebook, Instagram, Youtube } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { CALENDAR_SOURCE_BY_ID, type CalendarSourceId } from "@/lib/master-calendar/types";
import { cn } from "@/lib/utils";

/** Icon components accept the same className/style lucide icons do. */
type IconComponent = ComponentType<{ className?: string; style?: CSSProperties }>;

/** The Threads @ mark — lucide has no Threads logo, and @ is what the app uses. */
function ThreadsLogo({ className, style }: { className?: string; style?: CSSProperties }) {
  return <AtSign className={className} style={style} aria-hidden="true" />;
}

/**
 * Each calendar source's platform logo, tinted with its source colour so the
 * calendar reads by brand (YouTube, Instagram, Threads, Facebook) instead of by an
 * anonymous coloured dot. Long-form has no single social logo, so it uses a
 * clapperboard to stand in for tracked video content.
 */
export const SOURCE_ICONS: Record<CalendarSourceId, IconComponent> = {
  shorts: Youtube,
  carousels: Instagram,
  "queued-carousels": Instagram,
  x: ThreadsLogo,
  fb: Facebook,
  content: Clapperboard
};

/** The logo icon for a source, tinted with its brand colour. */
export function SourceIcon({ source, className }: { source: CalendarSourceId; className?: string }) {
  const Icon = SOURCE_ICONS[source];
  return <Icon className={cn("shrink-0", className)} style={{ color: CALENDAR_SOURCE_BY_ID[source].color }} />;
}
