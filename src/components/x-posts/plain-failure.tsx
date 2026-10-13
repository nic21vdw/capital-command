import Link from "next/link";
import { isConnectionProblem, plainReason } from "@/lib/automations/plain";
import { cn } from "@/lib/utils";

const RECONNECT = "reconnect in Settings";

/**
 * A Threads failure in the words Automations and the Master Calendar already
 * use ("Threads connection expired - reconnect in Settings"), never the
 * provider's own payload ("Threads API error (190): ..."). The reconnect
 * instruction is a link to Settings > Accounts when that is the fix. The raw
 * text stays one tap away: a tooltip on the line and a "Details" disclosure
 * (a tooltip alone does not exist on a phone).
 */
export function PlainFailure({
  raw,
  prefix,
  className
}: {
  raw: string;
  /** Leads the line ("Didn't post - "). */
  prefix?: string;
  className?: string;
}) {
  const text = raw.replace(/\s+/g, " ").trim();
  const reason = plainReason(text, "threads");
  const sentence = reason.charAt(0).toUpperCase() + reason.slice(1);
  const connection = isConnectionProblem(text, "threads");
  const at = connection ? sentence.indexOf(RECONNECT) : -1;
  const differs = sentence !== text;
  return (
    <span className={cn("block break-words", className)} title={differs ? text : undefined}>
      {prefix}
      {at >= 0 ? (
        <>
          {sentence.slice(0, at)}
          <Link href="/settings#accounts" className="font-medium underline underline-offset-2">
            {RECONNECT}
          </Link>
          {sentence.slice(at + RECONNECT.length)}
        </>
      ) : (
        sentence
      )}
      {differs ? (
        <details className="mt-0.5 text-[var(--muted-foreground)]">
          <summary className="cursor-pointer select-none">Details</summary>
          <span className="mt-0.5 block break-words">{text}</span>
        </details>
      ) : null}
    </span>
  );
}
