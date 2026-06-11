"use client";

import { Quote as QuoteIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Card } from "@/components/ui/card";
import { getQuoteOfTheDay } from "@/lib/quotes";

const subscribe = () => () => {};
const getServerSnapshot = () => null;

export function QuoteOfTheDayCard() {
  // Resolve the quote on the client so the selection uses the viewer's local
  // calendar day; the server snapshot is null to avoid a hydration mismatch.
  // getQuoteOfTheDay returns a stable reference per day, so it's a valid snapshot.
  const quote = useSyncExternalStore(subscribe, getQuoteOfTheDay, getServerSnapshot);

  return (
    <Card className="bg-[linear-gradient(135deg,var(--card-from),var(--card-to))]">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl border border-white/8 bg-black/20 p-3 text-[var(--accent)]">
          <QuoteIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Quote of the day
          </p>
          {quote ? (
            <>
              <p className="mt-2 text-lg font-medium leading-snug text-white">“{quote.text}”</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">— {quote.author}</p>
            </>
          ) : (
            <div className="mt-2 h-12" aria-hidden />
          )}
        </div>
      </div>
    </Card>
  );
}
