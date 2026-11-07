import { z } from "zod";

export const X_DRAFT_STATUSES = ["new", "posted-x", "dismissed"] as const;
export type XDraftStatus = (typeof X_DRAFT_STATUSES)[number];

export const xDraftSchema = z.object({
  id: z.string(),
  batchDate: z.string(),
  slot: z.number().int(),
  time: z.string(),
  topic: z.string(),
  text: z.string(),
  reply: z.string().optional(),
  status: z.enum(X_DRAFT_STATUSES),
  postedXAt: z.string().optional(),
  dismissedAt: z.string().optional(),
  threadsItemId: z.string().optional(),
  threadsAt: z.string().optional(),
  threadsNote: z.string().optional(),
  createdAt: z.string()
});

export type XDraft = z.infer<typeof xDraftSchema>;

export const xDraftsStateSchema = z.object({
  version: z.literal(1),
  drafts: z.array(xDraftSchema),
  phoneKey: z.string().optional(),
  phonePage: z
    .object({ url: z.string().optional(), at: z.string(), error: z.string().optional() })
    .optional(),
  lastWrite: z
    .object({ at: z.string(), date: z.string(), created: z.number(), error: z.string().optional() })
    .optional()
});

export type XDraftsState = z.infer<typeof xDraftsStateSchema>;

export const EMPTY_X_DRAFTS: XDraftsState = { version: 1, drafts: [] };
