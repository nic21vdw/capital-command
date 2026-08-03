"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, BadgeCheck, LogIn, Mic, PhoneOff, Radio, Send, ShieldCheck, Unlock, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createPlaybackQueue, startMicCapture } from "@/lib/voice/audio";
import type { MicCapture, PlaybackQueue } from "@/lib/voice/audio";
import { createVoiceClient } from "@/lib/voice/client";
import type { VoiceSessionPayload, VoiceStatus } from "@/lib/voice/client";

type SubscriptionStatus = { signedIn: boolean; email: string; via: string; message: string };
type ProviderInfo = {
  id: string;
  label: string;
  model: string;
  voices: string[];
  defaultVoice: string;
  configured: boolean;
  billing: "subscription" | "api-key" | "none";
  subscription: SubscriptionStatus | null;
};
type DeviceLogin = { deviceCode: string; userCode: string; verificationUriComplete: string; interval: number };
type Line = { id: string; role: "user" | "assistant"; text: string };
type ToolLine = { id: string; name: string; ok: boolean; detail: string };

type VoiceClient = ReturnType<typeof createVoiceClient>;

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "Off",
  connecting: "Connecting",
  live: "Listening for you",
  listening: "Hearing you",
  thinking: "Working"
};

function toolDetail(result: unknown): { ok: boolean; detail: string } {
  const value = result as { ok?: boolean; error?: string; note?: string } | null;
  if (!value || typeof value !== "object") return { ok: false, detail: "no result" };
  if (value.ok === false) return { ok: false, detail: value.error ?? "failed" };
  return { ok: true, detail: value.note ?? "done" };
}

export function VoiceConsole({ onWorkStarted }: { onWorkStarted?: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState("openai");
  const [voice, setVoice] = useState("");
  const [allowActions, setAllowActions] = useState(true);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [toolLines, setToolLines] = useState<ToolLine[]>([]);
  const [typed, setTyped] = useState("");
  const [starting, setStarting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLogin | null>(null);
  const [session, setSession] = useState<VoiceSessionPayload | null>(null);

  const clientRef = useRef<VoiceClient | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playbackRef = useRef<PlaybackQueue | null>(null);
  const partialRef = useRef<{ user: string | null; assistant: string | null }>({ user: null, assistant: null });

  const loadProviders = useCallback(async () => {
    const response = await fetch("/api/voice/session", { cache: "no-store" });
    const data = (await response.json()) as { providers?: ProviderInfo[] };
    const list = data.providers ?? [];
    setProviders(list);
    const preferred =
      list.find((item) => item.billing === "subscription") ?? list.find((item) => item.configured) ?? list[0];
    if (preferred) {
      setProviderId(preferred.id);
      setVoice(preferred.defaultVoice);
    }
    return list;
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadProviders().catch(() => setProviders([])));
  }, [loadProviders]);

  async function connectSubscription(action: "import" | "start") {
    setConnecting(true);
    try {
      const response = await fetch("/api/voice/xai-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = (await response.json()) as Partial<DeviceLogin> & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not connect the Grok subscription.");
      if (action === "import") {
        await loadProviders();
        toast.success("Grok subscription connected.");
        return;
      }
      const login = data as DeviceLogin;
      setDeviceLogin(login);
      window.open(login.verificationUriComplete, "_blank", "noopener");
      void pollSubscription(login);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not connect the Grok subscription.");
    } finally {
      setConnecting(false);
    }
  }

  async function pollSubscription(login: DeviceLogin) {
    const deadline = Date.now() + 30 * 60 * 1000;
    let wait = Math.max(2, login.interval) * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      const response = await fetch("/api/voice/xai-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll", deviceCode: login.deviceCode })
      });
      const data = (await response.json()) as { pending?: boolean; slowDown?: boolean; error?: string };
      if (!response.ok) {
        setDeviceLogin(null);
        toast.error(data.error ?? "The sign-in failed.");
        return;
      }
      if (!data.pending) {
        setDeviceLogin(null);
        await loadProviders();
        toast.success("Grok subscription connected. Voice runs on it now.");
        return;
      }
      if (data.slowDown) wait += 5000;
    }
    setDeviceLogin(null);
    toast.error("The sign-in timed out. Start it again.");
  }

  async function disconnectSubscription() {
    await fetch("/api/voice/xai-auth", { method: "DELETE" }).catch(() => {});
    await loadProviders().catch(() => {});
  }

  const stop = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    playbackRef.current?.close();
    playbackRef.current = null;
    clientRef.current?.close();
    clientRef.current = null;
    const grantId = session?.grantId;
    if (grantId) void fetch(`/api/voice/session?grantId=${encodeURIComponent(grantId)}`, { method: "DELETE" }).catch(() => {});
    setSession(null);
    setStatus("idle");
    setLevel(0);
    setSpeaking(false);
  }, [session?.grantId]);

  useEffect(() => () => stop(), [stop]);

  const pushLine = (role: "user" | "assistant", text: string, final: boolean) => {
    const value = text.trim();
    if (!value) return;
    setLines((current) => {
      const partialId = partialRef.current[role];
      const next = partialId ? current.map((line) => (line.id === partialId ? { ...line, text: value } : line)) : [...current, { id: crypto.randomUUID(), role, text: value }];
      partialRef.current[role] = final ? null : partialId ?? next[next.length - 1].id;
      return next.slice(-40);
    });
  };

  async function start() {
    if (starting || clientRef.current) return;
    setStarting(true);
    try {
      const response = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, voice: voice || undefined, allowActions })
      });
      const payload = (await response.json()) as VoiceSessionPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not start the voice session.");

      const playback = createPlaybackQueue({ onSpeakingChange: setSpeaking });
      await playback.resume();
      playbackRef.current = playback;

      const client = createVoiceClient(payload, {
        onStatus: setStatus,
        onTranscript: (entry) => pushLine(entry.role, entry.text, entry.final),
        onAudio: (chunk) => void playback.push(chunk),
        onInterrupt: () => playback.cancel(),
        onToolEvent: (event) => {
          const { ok, detail } = toolDetail(event.result);
          setToolLines((current) => [{ id: crypto.randomUUID(), name: event.name, ok, detail }, ...current].slice(0, 12));
          if (ok && event.name !== "sourceflow_state") onWorkStarted?.();
        },
        onError: (message) => toast.error(message)
      });
      clientRef.current = client;
      client.connect();
      setSession(payload);

      micRef.current = await startMicCapture({
        onChunk: (chunk) => client.sendAudio(chunk),
        onLevel: setLevel
      });
    } catch (error) {
      stop();
      toast.error(error instanceof Error ? error.message : "Could not start the voice session.");
    } finally {
      setStarting(false);
    }
  }

  const currentProvider = providers.find((item) => item.id === providerId);
  const subscription = providers.find((item) => item.id === "xai")?.subscription ?? null;
  const live = Boolean(session);

  return (
    <Card className={cn("relative overflow-hidden", live && "border-[var(--accent)]/50")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AudioLines className={cn("h-4 w-4", live ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]")} />
          <h2 className="font-semibold text-white">Live voice</h2>
          <Badge className={cn(live ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "")}>{STATUS_LABEL[status]}</Badge>
          {speaking ? <Badge className="border-blue-400/30 bg-blue-400/10 text-blue-200">Speaking</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          {live ? (
            <Button variant="danger" onClick={stop}>
              <PhoneOff className="mr-2 h-4 w-4" /> End session
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={starting || !currentProvider?.configured}>
              <Mic className="mr-2 h-4 w-4" /> {starting ? "Starting" : "Start talking"}
            </Button>
          )}
        </div>
      </div>

      {!live ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            {providers.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setProviderId(item.id);
                  setVoice(item.defaultVoice);
                }}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition",
                  providerId === item.id ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-white/[0.03] hover:border-[var(--border-strong)]"
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-white">
                  {item.label}
                  <span className={cn("h-2 w-2 rounded-full", item.configured ? "bg-emerald-400" : "bg-amber-400")} />
                </span>
                <span className="mt-1 block truncate text-xs text-[var(--muted-foreground)]">{item.model}</span>
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Voice
              <select
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white"
              >
                {(currentProvider?.voices ?? []).map((name) => (
                  <option key={name} value={name} className="bg-[#12141c]">
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setAllowActions((value) => !value)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border p-3 text-left transition",
                allowActions ? "border-amber-400/40 bg-amber-400/10" : "border-[var(--border)] bg-white/[0.03]"
              )}
            >
              {allowActions ? <Unlock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />}
              <span className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                <span className="block text-sm font-medium text-white">{allowActions ? "Actions armed" : "Read-only"}</span>
                {allowActions
                  ? "It can scan the channel, put streams through the pipeline and start an agent team. It still cannot publish, schedule, delete or touch a token."
                  : "It can read the workspace and report. The tools that start work are not loaded into the session."}
              </span>
            </button>
            {providerId === "xai" ? (
              <div
                className={cn(
                  "rounded-lg border p-3",
                  subscription?.signedIn ? "border-emerald-400/30 bg-emerald-400/10" : "border-[var(--border)] bg-white/[0.03]"
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-white">
                  <BadgeCheck className={cn("h-4 w-4", subscription?.signedIn ? "text-emerald-300" : "text-[var(--muted-foreground)]")} />
                  SuperGrok / X Premium
                </span>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                  {subscription?.message ?? "Checking…"}
                </p>
                {deviceLogin ? (
                  <div className="mt-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-2.5">
                    <p className="text-xs text-[var(--muted-foreground)]">Approve this code at accounts.x.ai, then come back — it connects itself.</p>
                    <p className="mt-1 font-mono text-lg tracking-widest text-white">{deviceLogin.userCode}</p>
                    <a href={deviceLogin.verificationUriComplete} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[var(--accent)] underline">
                      Open the approval page
                    </a>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {subscription?.signedIn ? (
                      <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => void disconnectSubscription()}>
                        Disconnect
                      </Button>
                    ) : (
                      <>
                        <Button className="px-3 py-1.5 text-xs" disabled={connecting} onClick={() => void connectSubscription("start")}>
                          <LogIn className="mr-1.5 h-3.5 w-3.5" /> Sign in with SuperGrok
                        </Button>
                        {subscription?.via === "cli-available" ? (
                          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={connecting} onClick={() => void connectSubscription("import")}>
                            Use my Grok CLI sign-in
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : !currentProvider?.configured ? (
              <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-2.5 text-xs text-amber-100">
                OpenAI has no subscription route — ChatGPT Plus does not cover the realtime API, so this one needs pay-as-you-go credit and `OPENAI_API_KEY` in .env. Use Grok Voice to run on a subscription instead.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-75" style={{ width: `${Math.round(Math.min(1, level * 1.6) * 100)}%` }} />
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {lines.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">Say something — try &ldquo;check my channel for anything new&rdquo;.</p>
            ) : (
              lines.map((line) => (
                <div
                  key={line.id}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm leading-relaxed",
                    line.role === "user" ? "bg-white/[0.04] text-white" : "border border-[var(--accent)]/25 bg-[var(--accent)]/8 text-white/90"
                  )}
                >
                  {line.text}
                </div>
              ))
            )}
          </div>

          {toolLines.length ? (
            <div className="space-y-1 rounded-lg border border-[var(--border)] bg-white/[0.02] p-2.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <Wrench className="h-3.5 w-3.5" /> Tools it used
              </span>
              {toolLines.map((line) => (
                <div key={line.id} className="flex items-start gap-2 text-xs">
                  <Radio className={cn("mt-0.5 h-3 w-3 shrink-0", line.ok ? "text-emerald-300" : "text-red-300")} />
                  <span className="text-white">{line.name.replaceAll("_", " ")}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--muted-foreground)]">{line.detail}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                clientRef.current?.sendText(typed);
                setTyped("");
              }}
              placeholder="Or type a turn"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-[var(--muted-foreground)]"
            />
            <Button
              variant="secondary"
              onClick={() => {
                clientRef.current?.sendText(typed);
                setTyped("");
              }}
              disabled={!typed.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {session?.allowActions
              ? "Armed: it can start a channel scan, a pipeline run or an agent team. Publishing, scheduling, deletes and tokens are not tools it has."
              : "Read-only session."}
          </p>
        </div>
      )}
    </Card>
  );
}
