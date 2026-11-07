import { createJsonStore } from "@/lib/storage/json-store";
import { EMPTY_X_DRAFTS, xDraftsStateSchema } from "@/lib/x-drafts/types";

export const xDraftsStore = createJsonStore("x-drafts.json", xDraftsStateSchema, EMPTY_X_DRAFTS);
