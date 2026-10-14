import type { InboxPlatform } from "@/lib/inbox/types";

export const REPLY_LIMITS: Record<InboxPlatform, number> = {
  youtube: 1000,
  instagram: 2200,
  facebook: 1000,
  threads: 500
};
