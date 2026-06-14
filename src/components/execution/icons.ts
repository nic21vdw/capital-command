import {
  Archive,
  Code,
  FileText,
  Film,
  GraduationCap,
  Hammer,
  Lightbulb,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Mic,
  PenLine,
  Radio,
  Ruler,
  Sparkles,
  Target,
  Twitter,
  Users,
  Video,
  Wrench,
  Youtube,
  type LucideIcon
} from "lucide-react";

/**
 * Registry mapping a stable icon key (stored on a goal) to a lucide component.
 * Keeping this explicit means a goal's stored icon string is always resolvable
 * and unknown values fall back gracefully instead of crashing the render.
 */
export const EXECUTION_ICONS: Record<string, LucideIcon> = {
  Twitter,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  FileText,
  Radio,
  Youtube,
  Film,
  Video,
  Code,
  Ruler,
  Users,
  GraduationCap,
  Hammer,
  Wrench,
  Mic,
  PenLine,
  Lightbulb,
  Sparkles,
  Archive,
  Target
};

/** Icon options offered in the goal editor. */
export const EXECUTION_ICON_KEYS = Object.keys(EXECUTION_ICONS);

export function resolveExecutionIcon(key: string): LucideIcon {
  return EXECUTION_ICONS[key] ?? Target;
}
