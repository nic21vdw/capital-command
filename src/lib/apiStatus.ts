import { bookingBlockers, publishingEnabled } from "@/lib/publisher/enabled";

/**
 * What the shell needs to know about the SERVER's configuration rather than its
 * data. Every response that can change it carries it, because the alternative —
 * re-reading `/api/bootstrap` after a mutation — refetches the whole document
 * to learn one boolean, and leaving it out is why the Settings publishing
 * switch sprang back to its old position until the next reload.
 */
export function readApiStatus() {
  return {
    hasAlphaVantageKey: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
    publishingEnabled: publishingEnabled(),
    bookingBlockers: bookingBlockers()
  };
}
