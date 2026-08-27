"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  CornerDownLeft,
  Loader2,
  Mic,
  Radio,
  SendHorizonal,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Square,
  Unlock,
  Volume2,
  VolumeX
} from "lucide-react";
import { toast } from "sonner";
import { BAR_STORAGE_KEY, READ_ONLY_GRANT, packBar, shieldView, unpackBar } from "@/lib/voice/bar";
import type { GrantView, SavedBar, TranscriptLine, TranscriptMessage } from "@/lib/voice/bar";
import { cn } from "@/lib/utils";

type Line = TranscriptLine;
type ToolRun = { name: string; result: { ok?: boolean; href?: string; label?: string } };

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Read on the client only. An update lands and `release-provider` reloads the
 * page under him mid-conversation, so what was said is kept out of component
 * state; the server is still asked whether the grant it names is real.
 */
function restoreBar(): SavedBar {
  if (typeof window === "undefined") return { lines: [], history: [], grantId: null };
  try {
    return unpackBar(window.sessionStorage.getItem(BAR_STORAGE_KEY));
  } catch {
    return { lines: [], history: [], grantId: null };
  }
}

/**
 * The orchestrator, on every screen. Type or say what you want done; it runs
 * the same allowlisted tools the agents page does, and when it opens a screen
 * this is what actually moves the browser — a tool can only say where to go.
 */
export function CommandBar() {
  const router = useRouter();
  const [restored] = useState(restoreBar);
  const [value, setValue] = useState("");
  const [lines, setLines] = useState<Line[]>(restored.lines);
  const [queued, setQueued] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [grant, setGrant] = useState<GrantView>(READ_ONLY_GRANT);
  const [grantId, setGrantId] = useState<string | null>(restored.grantId);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<TranscriptMessage[]>(restored.history);

  const shield = shieldView(grant);

  // The grant the tools actually check lives on the server and lapses after an
  // hour. Anything that hears back from the server says so here, so the bar
  // never claims a power it no longer has.
  const applyGrant = useCallback((view: GrantView | undefined) => {
    if (!view) return;
    setGrant(view);
    if (!view.armed) setGrantId(null);
  }, []);

  const checkGrant = useCallback(async () => {
    if (!grantId) return;
    try {
      const response = await fetch(`/api/voice/ask?grantId=${encodeURIComponent(grantId)}`);
      const data = (await response.json()) as { grant?: GrantView };
      applyGrant(data.grant);
    } catch {
      // A failed check is not evidence the grant lapsed; leave the bar as it is.
    }
  }, [applyGrant, grantId]);

  useEffect(() => {
    queueMicrotask(() => void checkGrant());
    const onFocus = () => void checkGrant();
    const onVisible = () => document.visibilityState === "visible" && void checkGrant();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkGrant]);

  // Nothing has to be in focus for an hour to pass, so the bar expires itself
  // on the server's clock rather than waiting to be asked.
  useEffect(() => {
    if (!grant.armed || !grant.expiresAt) return;
    const timer = window.setTimeout(
      () => setGrant({ armed: false, expired: true, expiresAt: null }),
      Math.max(0, grant.expiresAt - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [grant.armed, grant.expiresAt]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(BAR_STORAGE_KEY, packBar({ lines, history: historyRef.current, grantId }));
    } catch {
      // Private mode or a full quota — losing the transcript is not worth a throw.
    }
  }, [lines, grantId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      recognitionRef.current?.abort();
      abortRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!speakReplies || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const plain = text.replace(/[#*_`>[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 2400);
      if (plain) window.speechSynthesis.speak(new SpeechSynthesisUtterance(plain));
    },
    [speakReplies]
  );

  const send = useCallback(
    async (utterance: string) => {
      const text = utterance.trim();
      if (!text) return;
      setValue("");
      setOpen(true);
      setLines((current) => [...current, { id: crypto.randomUUID(), role: "user" as const, text, tools: [] }].slice(-30));
      setThinking(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch("/api/voice/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ utterance: text, grantId: grantId ?? undefined, history: historyRef.current.slice(-6) })
        });
        const data = (await response.json()) as { reply?: string; toolRuns?: ToolRun[]; error?: string; grant?: GrantView };
        if (data.grant) {
          applyGrant(data.grant);
          if (data.grant.expired) toast.warning("Arming had lapsed, so that ran read-only. Click Arming expired to arm it again.");
        }
        if (!response.ok || !data.reply) throw new Error(data.error ?? "No answer came back.");

        const runs = data.toolRuns ?? [];
        // A tool can only name a destination; moving the browser is the bar's
        // job, and doing it here is what makes "show me the carousels" open the
        // carousels instead of describing them.
        const trip = runs.find((run) => run.result?.ok && typeof run.result.href === "string");
        if (trip?.result.href) router.push(trip.result.href);

        setLines((current) =>
          [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              text: data.reply!,
              tools: runs.map((run) => run.name),
              opened: trip?.result.label
            }
          ].slice(-30)
        );
        historyRef.current = [
          ...historyRef.current,
          { role: "user" as const, content: text },
          { role: "assistant" as const, content: data.reply }
        ].slice(-6);
        speak(data.reply);
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          setLines((current) => [...current, { id: crypto.randomUUID(), role: "assistant" as const, text: "Stopped.", tools: [] }].slice(-30));
        } else {
          toast.error(error instanceof Error ? error.message : "That command failed.");
        }
      } finally {
        abortRef.current = null;
        setThinking(false);
      }
    },
    [applyGrant, grantId, router, speak]
  );

  // A queued line goes the moment the current one lands, so you can keep
  // talking while it works instead of waiting for the reply.
  useEffect(() => {
    if (thinking || !queued.length) return;
    queueMicrotask(() => {
      setQueued((current) => current.slice(1));
      void send(queued[0]);
    });
  }, [thinking, queued, send]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (thinking) {
      setQueued((current) => [...current, trimmed]);
      setValue("");
      return;
    }
    void send(trimmed);
  };

  const stop = () => {
    abortRef.current?.abort();
    window.speechSynthesis?.cancel();
    setQueued([]);
  };

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      toast.error("This browser has no speech recognition. Type it instead.");
      return;
    }
    window.speechSynthesis?.cancel();
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-CA";
    let final = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) final = `${final} ${result[0].transcript}`.trim();
        else interim += result[0].transcript;
      }
      setValue(`${final}${interim ? ` ${interim}` : ""}`.trim());
    };
    recognition.onend = () => {
      setListening(false);
      if (final.trim()) submit(final);
    };
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setSpeakReplies(true);
  };

  async function toggleActions() {
    if (grant.armed) {
      setGrant(READ_ONLY_GRANT);
      setGrantId(null);
      return;
    }
    const response = await fetch("/api/voice/ask", { method: "PUT" });
    const data = (await response.json()) as { grantId?: string; expiresAt?: number };
    if (!data.grantId) {
      toast.error("Could not arm actions.");
      return;
    }
    setGrantId(data.grantId);
    setGrant({ armed: true, expired: false, expiresAt: data.expiresAt ?? null });
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto w-full max-w-3xl">
        {open && lines.length ? (
          <div className="mb-2 max-h-[45vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)]/95 p-3 shadow-2xl backdrop-blur">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mb-2 flex w-full items-center justify-end gap-1 text-xs text-[var(--muted-foreground)] hover:text-white"
            >
              <ChevronDown className="h-3.5 w-3.5" /> hide
            </button>
            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.id}>
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm leading-relaxed",
                      line.role === "user"
                        ? "bg-white/[0.04] text-white"
                        : "border border-[var(--accent)]/25 bg-[var(--accent)]/8 text-white/90"
                    )}
                  >
                    {line.text}
                  </div>
                  {line.opened || line.tools.length ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 px-1">
                      {line.opened ? (
                        <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[11px] text-[var(--accent)]">
                          opened {line.opened}
                        </span>
                      ) : null}
                      {line.tools.map((tool, index) => (
                        <span key={`${line.id}-${index}`} className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                          <Radio className="h-3 w-3 text-emerald-300" />
                          {tool.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {queued.map((text, index) => (
                <div key={`queued-${index}`} className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{text}</span>
                  <button
                    type="button"
                    onClick={() => setQueued((current) => current.filter((_, spot) => spot !== index))}
                    className="text-xs hover:text-white"
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-center gap-1.5 rounded-2xl border bg-[var(--panel)]/95 px-2 py-2 shadow-2xl backdrop-blur transition sm:gap-2 sm:px-3",
            listening ? "border-red-400/60" : "border-[var(--border)]"
          )}
        >
          {listening ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-400" />
            </span>
          ) : (
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          )}
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => lines.length && setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit(value);
              }
            }}
            placeholder={
              listening
                ? "Listening — speak now"
                : thinking
                  ? "Working — type to queue the next one"
                  : "Tell it what to do — show me the carousels"
            }
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[var(--muted-foreground)]"
          />

          <button
            type="button"
            onClick={() => void toggleActions()}
            title={shield.title}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition",
              shield.tone === "armed" && "border-amber-400/40 bg-amber-400/10 text-amber-200",
              shield.tone === "expired" && "border-red-400/50 bg-red-400/10 text-red-200 hover:bg-red-400/20",
              shield.tone === "read-only" && "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
            )}
            aria-label={shield.label}
          >
            {shield.tone === "armed" ? (
              <Unlock className="h-3.5 w-3.5" />
            ) : shield.tone === "expired" ? (
              <ShieldAlert className="h-3.5 w-3.5" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{shield.label}</span>
          </button>

          <button
            type="button"
            onClick={() => setSpeakReplies((current) => !current)}
            title={speakReplies ? "Answers are read out loud" : "Answers are silent"}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white sm:flex"
          >
            {speakReplies ? <Volume2 className="h-4 w-4 text-[var(--accent)]" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={toggleListening}
            title={listening ? "Listening — click to stop" : "Speak a command"}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition",
              listening
                ? "border-red-400/60 bg-red-400/15 text-red-200"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
            )}
          >
            <Mic className={cn("h-3.5 w-3.5", listening && "animate-pulse")} />
            <span className="hidden sm:inline">{listening ? "Listening" : "Speak"}</span>
          </button>

          {thinking ? (
            <button
              type="button"
              onClick={stop}
              title="Stop"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/40 bg-red-400/10 text-red-200 transition hover:bg-red-400/20"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit(value)}
              disabled={!value.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] transition disabled:opacity-40"
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          )}
        </div>

        {thinking ? (
          <p className="mt-1 flex items-center gap-1.5 px-2 text-[11px] text-[var(--muted-foreground)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working{queued.length ? ` · ${queued.length} queued` : ""} — press stop to cancel
          </p>
        ) : null}
      </div>
    </div>
  );
}
