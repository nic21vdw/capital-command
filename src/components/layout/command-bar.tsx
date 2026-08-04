"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Mic, MicOff, Radio, SendHorizonal, ShieldCheck, Sparkles, Unlock, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Line = { id: string; role: "user" | "assistant"; text: string; tools: string[] };

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

const EXAMPLES = [
  "check my channel for anything new",
  "take the newest stream through the pipeline",
  "what is my pipeline working on?"
];

/**
 * The orchestrator, on every screen. Type or say what you want done; it runs
 * the same allowlisted tools the voice console does and answers here.
 */
export function CommandBar() {
  const [value, setValue] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [allowActions, setAllowActions] = useState(false);
  const [grantId, setGrantId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

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
      if (!text || thinking) return;
      setValue("");
      setOpen(true);
      setLines((current) => [...current, { id: crypto.randomUUID(), role: "user" as const, text, tools: [] }].slice(-20));
      setThinking(true);
      try {
        const response = await fetch("/api/voice/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ utterance: text, grantId: grantId ?? undefined, history: historyRef.current.slice(-6) })
        });
        const data = (await response.json()) as {
          reply?: string;
          toolRuns?: Array<{ name: string }>;
          error?: string;
        };
        if (!response.ok || !data.reply) throw new Error(data.error ?? "No answer came back.");
        setLines((current) =>
          [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              text: data.reply!,
              tools: (data.toolRuns ?? []).map((run) => run.name)
            }
          ].slice(-20)
        );
        historyRef.current = [
          ...historyRef.current,
          { role: "user" as const, content: text },
          { role: "assistant" as const, content: data.reply }
        ].slice(-6);
        speak(data.reply);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That command failed.");
      } finally {
        setThinking(false);
      }
    },
    [grantId, speak, thinking]
  );

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
      if (final.trim()) void send(final);
    };
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setSpeakReplies(true);
  };

  async function toggleActions() {
    if (allowActions) {
      setAllowActions(false);
      setGrantId(null);
      return;
    }
    const response = await fetch("/api/voice/ask", { method: "PUT" });
    const data = (await response.json()) as { grantId?: string };
    if (!data.grantId) {
      toast.error("Could not arm actions.");
      return;
    }
    setGrantId(data.grantId);
    setAllowActions(true);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3">
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
                  {line.tools.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5 px-1">
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
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-center gap-2 rounded-2xl border bg-[var(--panel)]/95 px-3 py-2 shadow-2xl backdrop-blur transition",
            listening ? "border-[var(--accent)]" : "border-[var(--border)]"
          )}
        >
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => lines.length && setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void send(value);
              }
            }}
            placeholder={listening ? "Listening…" : `Tell it what to do — ${EXAMPLES[0]}`}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[var(--muted-foreground)]"
          />

          <button
            type="button"
            onClick={() => void toggleActions()}
            title={allowActions ? "Actions armed — it can start work" : "Read-only — click to let it start work"}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition",
              allowActions
                ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
            )}
          >
            {allowActions ? <Unlock className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => setSpeakReplies((current) => !current)}
            title={speakReplies ? "Answers are spoken" : "Answers are silent"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] transition hover:text-white"
          >
            {speakReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={toggleListening}
            title="Speak a command"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition",
              listening ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
            )}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => void send(value)}
            disabled={!value.trim() || thinking}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-contrast)] transition disabled:opacity-40"
          >
            {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
