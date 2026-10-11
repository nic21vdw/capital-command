"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, AtSign, Check, ChevronDown, Copy, Database, ExternalLink, Music2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PlatformIcon, type PlatformIconKey } from "@/components/ui/platform-icon";
import { CONNECTIONS, type Connection, type ConnectionField } from "@/lib/publisher/connections";
import {
  clearConnectFailure,
  explainConnectError,
  readConnectFailures,
  rememberConnectFailure,
  type ConnectFailures
} from "@/lib/publisher/connectErrors";
import {
  YOUTUBE_CONSOLE_STEPS,
  YOUTUBE_CONSOLE_URL,
  YOUTUBE_WHY,
  buildGetStarted,
  connectionProgress,
  connectionStatus,
  redirectUriNote,
  requiredFields,
  splitConsoleStep,
  walkthroughShowsRedirectUri,
  youtubeChecklist,
  type ConnectionProgress,
  type YoutubeChecklist
} from "@/lib/publisher/getStarted";

type ConnectionState = {
  present: Record<string, boolean>;
  /** Where each credential's value comes from: Settings, or .env (which wins). */
  sources?: Record<string, "env" | "saved" | null>;
  connected: Record<string, boolean>;
  /** The redirect URI to register in each provider's console. */
  redirectUris?: Record<string, string>;
};

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "text-[#ff6262] bg-[#ff0000]/15",
  tiktok: "text-[#4ce2de] bg-[#25f4ee]/15",
  spotify: "text-[#75dc91] bg-[#1db954]/15",
  instagram: "text-[#f58fbd] bg-[#e1306c]/15",
  facebook: "text-[#7fb4ff] bg-[#1877f2]/15",
  threads: "text-white bg-white/10",
  "media-hosting": "text-[#9fd3ff] bg-[#4f9bff]/15"
};

function ConnectionIcon({ id }: { id: string }) {
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${PLATFORM_COLORS[id]}`}>
      {id === "spotify" ? <Music2 className="h-5 w-5" aria-hidden="true" /> :
        id === "media-hosting" ? <Database className="h-5 w-5" aria-hidden="true" /> :
        id === "threads" ? <AtSign className="h-5 w-5" aria-hidden="true" /> :
          <PlatformIcon platform={id as PlatformIconKey} className="h-5 w-5" />}
    </span>
  );
}

/**
 * The exact redirect URI to register on the provider's OAuth client. A mismatch
 * is the usual first failure, and it is reported on Google's, TikTok's or
 * Spotify's own page, where this app cannot explain it - so it is said here.
 */
function RedirectUri({ connection, uri }: { connection: Connection; uri: string }) {
  // Rendered only once a row is open, which is after mount, so the address bar
  // is safe to read here.
  const note = redirectUriNote(connection.id, uri, typeof window === "undefined" ? null : window.location.origin);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      toast.success("Redirect URI copied.");
    } catch {
      toast.error("Could not copy. Select the address and copy it by hand.");
    }
  };
  return (
    <div className="mb-4 rounded-lg border border-[var(--border)] bg-black/20 p-3 text-xs text-[var(--muted-foreground)]">
      <p className="font-medium text-white/90">
        Register this redirect URI{connection.clientType ? <> on a <span className="text-white">{connection.clientType}</span> client</> : null}
        {" "}in the {connection.id === "youtube" ? "Google Cloud" : connection.label} console
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-white/10 px-2 py-1 text-white">{uri}</code>
        <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
        </button>
      </div>
      {note ? <p className="mt-2">{note}</p> : null}
      {connection.redirectNote ? <p className="mt-2">{connection.redirectNote}</p> : null}
    </div>
  );
}

/**
 * Step 1 of the YouTube checklist, opened: the Google Cloud console in plain
 * sub-steps, and the redirect URI to paste into the client. The address is the
 * one GET /api/connections computes from the request origin - the same helper
 * the start route sends to Google - so it is copied from there, not rebuilt
 * from the address bar.
 */
function YoutubeConsoleSteps({ redirectUri }: { redirectUri: string | undefined }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [details, setDetails] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const copy = async () => {
    if (!redirectUri) return;
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(redirectUri);
    } catch {
      next = "failed";
    }
    setCopied(next);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied("idle"), 2500);
  };

  // Only the redirect note that matters here: the address bar says 127.0.0.1
  // while the app sends localhost, which would look like a typo otherwise.
  const note = redirectUri
    ? redirectUriNote("youtube", redirectUri, typeof window === "undefined" ? null : window.location.origin)
    : null;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-[var(--border)] bg-black/20 p-3 sm:space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-xs leading-snug text-[var(--muted-foreground)] marker:text-white/60 sm:space-y-1.5">
        {YOUTUBE_CONSOLE_STEPS.map((text) => {
          // On a phone only each step's first sentence shows until "Show details".
          const { lead, rest } = splitConsoleStep(text);
          return (
            <li key={text}>
              {lead}
              {rest ? <span className={cn(!details && "max-sm:hidden")}> {rest}</span> : null}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => setDetails((open) => !open)}
        aria-expanded={details}
        className="-mt-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline max-sm:min-h-10 sm:hidden"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", details && "rotate-180")} aria-hidden="true" />
        {details ? "Hide details" : "Show details"}
      </button>
      <div>
        <p className="text-xs font-medium text-white/90">Redirect URI - add it exactly as written</p>
        <code className="mt-1 block break-all rounded bg-white/10 px-2 py-1.5 text-xs text-white">{redirectUri ?? "Loading..."}</code>
        {note ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{note}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void copy()} disabled={!redirectUri} aria-live="polite">
          {copied === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied === "copied" ? "Copied" : copied === "failed" ? "Could not copy - select it above" : "Copy redirect URI"}
        </Button>
        <a
          href={YOUTUBE_CONSOLE_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-[var(--accent)] hover:underline"
        >
          Open Google Cloud console <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

/**
 * How far along setup is: "N of M connected" across the rows below, and the
 * four YouTube steps inline until YouTube is signed in. The rows below already
 * carry each platform's own status, so this strip does not repeat them.
 */
function GetStartedStrip({ checklist, progress, headline, setUp, known, redirectUri, onOpen }: {
  checklist: YoutubeChecklist;
  progress: ConnectionProgress;
  headline: string;
  setUp: boolean;
  /** What is saved has been read; until then there is no progress to show. */
  known: boolean;
  /** The YouTube redirect URI the server sends, once the state has loaded. */
  redirectUri: string | undefined;
  onOpen: (id: string) => void;
}) {
  return (
    <section aria-labelledby="get-started-title" className="mt-5 rounded-xl border border-[var(--border)] bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="get-started-title" className="flex items-center gap-2 text-sm font-semibold text-white">
          {setUp ? <Check className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" /> : null}
          {setUp ? "You're set up" : "Get started"}
        </h3>
        <p className="text-sm font-medium text-white" aria-live="polite">{progress.line}</p>
      </div>
      <div
        role="progressbar"
        aria-label="Accounts connected"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.connected}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
      >
        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(progress.connected / progress.total) * 100}%` }} />
      </div>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{headline}</p>

      {checklist.complete || !known ? null : (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
            YouTube setup - {checklist.done} of {checklist.total} done
          </p>
          <p className="mt-2 text-sm text-white/90">{YOUTUBE_WHY}</p>
          <ol className="mt-3 space-y-2">
            {checklist.steps.map((step, index) => (
              <li key={step.id} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                    step.done
                      ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-200"
                      : step.current
                        ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)]"
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${step.done ? "text-[var(--muted-foreground)] line-through decoration-white/30" : "font-medium text-white"}`}>
                    {step.label}
                    <span className="sr-only">{step.done ? " - done" : step.current ? " - next" : " - to do"}</span>
                  </p>
                  {step.current ? <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{step.detail}</p> : null}
                  {step.current && step.id === "create-client" ? <YoutubeConsoleSteps redirectUri={redirectUri} /> : null}
                </div>
              </li>
            ))}
          </ol>
          <Button className="mt-3" variant="secondary" onClick={() => onOpen("youtube")}>
            Open YouTube setup
          </Button>
        </div>
      )}
    </section>
  );
}

/** One failed sign-in, kept in the platform's row until dismissed or a later sign-in works. */
function FailureNote({ connection, raw, onDismiss }: { connection: Connection; raw: string; onDismiss: () => void }) {
  const { summary, fix, kind } = explainConnectError(raw, connection.id);
  return (
    <div role="alert" className="flex items-start gap-3 border-t border-amber-300/20 bg-amber-300/10 px-4 py-3 text-xs text-amber-100 sm:pl-[4.5rem]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-amber-50">{summary}</p>
        <p className="mt-0.5">{fix}</p>
        {kind === "unknown" ? null : <p className="mt-1 break-words text-amber-100/70">{connection.label} reported: {raw}</p>}
      </div>
      <button type="button" onClick={onDismiss} aria-label={`Dismiss the ${connection.label} sign-in message`} className="shrink-0 rounded p-1 text-amber-100/80 hover:bg-white/10 hover:text-white">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** One credential input: masked, never showing the saved value, and honest about where it lives. */
function FieldInput({
  field,
  state,
  drafts,
  setDrafts
}: {
  field: ConnectionField;
  state: ConnectionState;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const present = Boolean(state.present[field.name]);
  const source = state.sources?.[field.name] ?? null;
  // .env is read on every start and wins over anything saved here, so editing or
  // removing it from Settings would look like it worked and then revert.
  const fromEnv = present && source === "env";
  return (
    <label className="block text-xs text-[var(--muted-foreground)]">
      <span className="mb-1 block font-medium text-white/90">{field.label}</span>
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        disabled={fromEnv}
        value={drafts[field.name] ?? ""}
        placeholder={fromEnv ? "Set in .env" : present ? "Saved" : "Enter value"}
        onChange={(event) => setDrafts((current) => ({ ...current, [field.name]: event.target.value }))}
      />
      {field.hint ? <span className="mt-1 block">{field.hint}</span> : null}
      {fromEnv ? (
        <span className="mt-1 block text-amber-200/90">Set in .env - edit it there.</span>
      ) : present ? (
        <>
          {source === "saved" ? <span className="mt-1 block">Saved in Settings.</span> : null}
          <button type="button" className="mt-1 text-[var(--accent)] hover:underline" onClick={() => setDrafts((current) => ({ ...current, [field.name]: "" }))}>
            {field.name in drafts && !drafts[field.name] ? "Will remove when saved" : "Remove saved value"}
          </button>
        </>
      ) : null}
    </label>
  );
}

export function ConnectionsSettings() {
  const [state, setState] = useState<ConnectionState>({ present: {}, connected: {} });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [failures, setFailures] = useState<ConnectFailures>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections");
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as ConnectionState;
      setState(next);
      setLoadFailed(false);
      // A platform that is connected has nothing left to warn about.
      for (const [id, isConnected] of Object.entries(next.connected)) {
        if (isConnected) clearConnectFailure(id);
      }
      setFailures(readConnectFailures());
    } catch {
      setLoadFailed(true);
      toast.error("Could not check account setup.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // The sign-in routes send a failed start here with connect_error (and which
  // platform) in the URL, the way the callbacks do for the screens they land
  // on. Say it in plain words once as a toast, keep it in the platform's row
  // until it is dismissed, open that row, and clear it from the address.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setFailures(readConnectFailures());
        const params = new URLSearchParams(window.location.search);
        const failure = params.get("connect_error");
        if (!failure) return;
        const platform = params.get("connect");
        const known = platform && CONNECTIONS.some((connection) => connection.id === platform) ? platform : null;
        // The message itself is the page's inline banner and toast
        // (useOAuthLanding in SettingsPage); this keeps the row and the address.
        if (known) {
          setExpanded(known);
          setFailures(rememberConnectFailure(known, failure));
        }
        window.history.replaceState({}, "", `${window.location.pathname}#accounts`);
        document.getElementById("accounts")?.scrollIntoView();
      } catch {
        // The toast is a courtesy; the row still shows what is missing.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Arriving on #accounts (the sidebar's Connect accounts, a toast action, a
  // link from another screen) means "set something up", so open the first
  // platform that has nothing yet - YouTube, when nothing is - rather than
  // leaving a column of closed rows to choose from. A row named by ?connect=
  // already opened itself above and wins.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!loaded || loadFailed) return;
    const openFirstUnset = () => {
      if (window.location.hash !== "#accounts") return;
      const first = CONNECTIONS.find((connection) => connectionStatus(connection, state, { loaded, loadFailed }) === "Not set up");
      if (first) setExpanded((current) => current ?? first.id);
    };
    const timer = window.setTimeout(() => {
      if (autoOpened.current) return;
      autoOpened.current = true;
      openFirstUnset();
    }, 0);
    window.addEventListener("hashchange", openFirstUnset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", openFirstUnset);
    };
  }, [loaded, loadFailed, state]);

  const dismissFailure = (id: string) => setFailures(clearConnectFailure(id));

  const openRow = (id: string) => {
    setExpanded(id);
    window.setTimeout(() => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`connection-row-${id}`)?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }, 0);
  };

  const save = async (connection: Connection) => {
    const values: Record<string, string> = {};
    for (const field of connection.fields) {
      if (field.name in drafts) values[field.name] = drafts[field.name];
    }
    if (!Object.keys(values).length) return;

    setSaving(connection.id);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      const body = (await response.json()) as ConnectionState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? String(response.status));
      setState({ present: body.present, sources: body.sources, connected: body.connected, redirectUris: body.redirectUris });
      setDrafts((current) => {
        const next = { ...current };
        for (const field of connection.fields) delete next[field.name];
        return next;
      });
      setFailures(clearConnectFailure(connection.id));
      toast.success(
        connection.oauth
          ? state.connected[connection.id] ? "Credentials saved." : "Credentials saved. Sign in to finish connecting."
          : "Saved, but not verified: nothing here checks it until a post goes out."
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save credentials.");
    } finally {
      setSaving(null);
    }
  };

  const phase = { loaded, loadFailed };
  const getStarted = buildGetStarted(state, phase);
  const checklist = youtubeChecklist(state, phase);
  const progress = connectionProgress(state, phase);
  const walkthroughOpen = walkthroughShowsRedirectUri(checklist, loaded && !loadFailed);

  return (
    <Card id="accounts" className="scroll-mt-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
          <AtSign className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">Accounts</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Choose a platform to connect or update. Credentials stay on this machine and are never displayed again.
          </p>
        </div>
      </div>

      <GetStartedStrip
        checklist={checklist}
        progress={progress}
        headline={getStarted.headline}
        setUp={getStarted.setUp}
        known={loaded && !loadFailed}
        redirectUri={state.redirectUris?.youtube}
        onOpen={openRow}
      />

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
        {CONNECTIONS.map((connection) => {
          const ready = requiredFields(connection).every((field) => state.present[field.name]);
          const connected = ready && state.connected[connection.id];
          const open = expanded === connection.id;
          const dirty = connection.fields.some((field) => field.name in drafts);
          // A pasted token is only a token: nothing here proves it works, so a
          // platform with no sign-in never turns green on save.
          const status = connectionStatus(connection, state, { loaded, loadFailed });
          // The YouTube walkthrough above already shows its address while step 1
          // is current; the card repeats it only once that walkthrough has moved on.
          const redirectUri =
            connection.oauth && !(connection.id === "youtube" && walkthroughOpen) ? state.redirectUris?.[connection.id] : undefined;
          // One pill on every width: a phone used to get blue text that read as a link.
          const statusPill = connected ? "bg-emerald-400/10 text-emerald-200" : "bg-white/5 text-[var(--muted-foreground)]";

          return (
            <div key={connection.id} id={`connection-row-${connection.id}`} className="scroll-mt-6 border-b border-[var(--border)] last:border-b-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`connection-${connection.id}`}
                onClick={() => setExpanded(open ? null : connection.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
              >
                <ConnectionIcon id={connection.id} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{connection.label}</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">{connection.purpose}</span>
                  <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium sm:hidden ${statusPill}`}>{status}</span>
                </span>
                <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${statusPill}`}>
                  {status}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>

              {failures[connection.id] && !connected ? (
                <FailureNote connection={connection} raw={failures[connection.id].raw} onDismiss={() => dismissFailure(connection.id)} />
              ) : null}

              {open ? (
                <div id={`connection-${connection.id}`} className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-5 sm:pl-[4.5rem]">
                  <p className="mb-4 text-sm text-[var(--muted-foreground)]">
                    {connected ? "Account signed in. Update credentials here only if they change." :
                      ready && connection.oauth ? "Credentials are saved. Sign in to finish connecting this account." :
                        connection.oauth ? "Add your app credentials, save them, then sign in." :
                          ready ? "Credentials are saved but not verified: this app cannot test them until a post goes out." :
                            "Add the credentials for this account and save them."}
                  </p>
                  {redirectUri ? <RedirectUri connection={connection} uri={redirectUri} /> : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {requiredFields(connection).map((field) => (
                      <FieldInput key={field.name} field={field} state={state} drafts={drafts} setDrafts={setDrafts} />
                    ))}
                  </div>
                  {connection.fields.some((field) => field.optional) ? (
                    <details className="mt-4 text-sm text-[var(--muted-foreground)]">
                      <summary className="cursor-pointer text-white/90">Optional fields</summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {connection.fields.filter((field) => field.optional).map((field) => (
                          <FieldInput key={field.name} field={field} state={state} drafts={drafts} setDrafts={setDrafts} />
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {connection.manualNote ? <p className="mt-4 text-xs text-amber-200/90">{connection.manualNote}</p> : null}
                  {connection.notes?.map((note) => (
                    <p key={note} className="mt-2 text-xs text-[var(--muted-foreground)]">{note}</p>
                  ))}
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button onClick={() => void save(connection)} disabled={!dirty || saving === connection.id}>
                      {saving === connection.id ? "Saving..." : "Save credentials"}
                    </Button>
                    {connection.oauth && ready ? (
                      <a href={connection.oauth.href} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                        {connected ? "Reconnect" : connection.oauth.label}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                    {connection.console ? (
                      <a href={connection.console} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-2 text-xs text-[var(--accent)] hover:underline">
                        Find credentials <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                    {connection.more ? (
                      <Link href={connection.more.href} className="inline-flex items-center gap-1 px-2 py-2 text-xs text-[var(--accent)] hover:underline">
                        {connection.more.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
