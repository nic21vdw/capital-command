import { describe, expect, it } from "vitest";
import { base64FromBuffer, bufferFromBase64, encodeCaptureChunk, floatToPcm16, pcm16ToFloat, peakLevel, resampleMono } from "@/lib/voice/pcm";
import { buildSubprotocols, getVoiceProvider, realtimeSocketUrl } from "@/lib/voice/providers";
import { packBar, shieldView, unpackBar } from "@/lib/voice/bar";
import { buildSessionUpdate, describeGrant, issueGrant, readGrant, readMintedSecret, revokeGrant } from "@/lib/voice/session";
import { OVERRIDABLE_SKIPS, VOICE_TOOLS, describeSkips, runReferenceFrom, runVoiceTool, toolDestination, voiceToolDefinitions } from "@/lib/voice/tools";
import type { ScanCandidate } from "@/lib/ingest/types";
import { jwtExpiryMs, normalizeXaiSession, xaiSessionUsable } from "@/lib/voice/xaiAuth";

describe("pcm", () => {
  it("round-trips samples through pcm16 and base64", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const restored = pcm16ToFloat(bufferFromBase64(base64FromBuffer(floatToPcm16(samples))));
    expect(restored.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i += 1) expect(restored[i]).toBeCloseTo(samples[i], 3);
  });

  it("keeps a full-scale peak at full scale instead of wrapping it", () => {
    const view = new DataView(floatToPcm16(new Float32Array([1])));
    expect(view.getInt16(0, true)).toBe(32767);
  });

  it("resamples to the wire rate", () => {
    expect(resampleMono(new Float32Array(960), 48000, 24000).length).toBe(480);
    expect(encodeCaptureChunk(new Float32Array(480), 24000).length).toBeGreaterThan(0);
  });

  it("reports the peak level", () => {
    expect(peakLevel(new Float32Array([0.1, -0.9, 0.2]))).toBeCloseTo(0.9, 5);
    expect(peakLevel(new Float32Array([4]))).toBe(1);
  });
});

describe("providers", () => {
  it("carries the credential in the subprotocol, per vendor", () => {
    expect(buildSubprotocols(getVoiceProvider("openai"), "ek_123")).toEqual(["realtime", "openai-insecure-api-key.ek_123"]);
    expect(buildSubprotocols(getVoiceProvider("xai"), "cs_123")).toEqual(["xai-client-secret.cs_123"]);
  });

  it("pins the model in the socket url", () => {
    expect(realtimeSocketUrl(getVoiceProvider("openai"), "gpt-realtime-2.1")).toContain("?model=gpt-realtime-2.1");
  });

  it("falls back to the default provider for an unknown id", () => {
    expect(getVoiceProvider("nonsense").id).toBe("openai");
  });
});

describe("session", () => {
  it("nests voice and turn detection the way each vendor expects", () => {
    const openai = buildSessionUpdate({ provider: getVoiceProvider("openai"), instructions: "hi", voice: "cedar", allowActions: false })
      .session as Record<string, Record<string, Record<string, unknown>>>;
    expect(openai.audio.output.voice).toBe("cedar");
    expect(openai.audio.input.turn_detection).toBeTruthy();

    const xai = buildSessionUpdate({ provider: getVoiceProvider("xai"), instructions: "hi", voice: "eve", allowActions: false })
      .session as Record<string, unknown>;
    expect(xai.voice).toBe("eve");
    expect(xai.turn_detection).toBeTruthy();
  });

  it("reads a minted secret out of any shape a vendor has shipped", () => {
    expect(readMintedSecret({ value: "a" })).toBe("a");
    expect(readMintedSecret({ client_secret: { value: "b" } })).toBe("b");
    expect(readMintedSecret({ client_secret: "c" })).toBe("c");
    expect(() => readMintedSecret({})).toThrow();
  });

  it("issues and revokes grants", () => {
    const grant = issueGrant(true);
    expect(readGrant(grant.id)?.allowActions).toBe(true);
    revokeGrant(grant.id);
    expect(readGrant(grant.id)).toBeNull();
    expect(readGrant(undefined)).toBeNull();
  });

  it("calls a grant that was asked for and is gone expired, and never echoes the id", () => {
    const grant = issueGrant(true);
    const armed = describeGrant(grant.id, readGrant(grant.id));
    expect(armed).toEqual({ armed: true, expired: false, expiresAt: grant.expiresAt });
    expect(JSON.stringify(armed)).not.toContain(grant.id);

    revokeGrant(grant.id);
    expect(describeGrant(grant.id, readGrant(grant.id))).toEqual({ armed: false, expired: true, expiresAt: null });
    expect(describeGrant(undefined, null)).toEqual({ armed: false, expired: false, expiresAt: null });

    const readOnly = issueGrant(false);
    expect(describeGrant(readOnly.id, readGrant(readOnly.id))).toEqual({ armed: false, expired: false, expiresAt: null });
  });
});

describe("command bar state", () => {
  it("shows expired arming as its own state, not as read-only and not as can act", () => {
    expect(shieldView({ armed: true, expired: false }).label).toBe("Can act");
    expect(shieldView({ armed: false, expired: false }).label).toBe("Read-only");
    const expired = shieldView({ armed: false, expired: true });
    expect(expired.tone).toBe("expired");
    expect(expired.label).not.toBe("Read-only");
  });

  it("carries the transcript through a reload and survives a corrupt blob", () => {
    const packed = packBar({
      lines: [{ id: "a", role: "user", text: "start the pipeline", tools: [], opened: "Stream Pipeline" }],
      history: [{ role: "user", content: "start the pipeline" }],
      grantId: "voice-grant-1"
    });
    const restored = unpackBar(packed);
    expect(restored.lines[0]).toEqual({ id: "a", role: "user", text: "start the pipeline", tools: [], opened: "Stream Pipeline" });
    expect(restored.history).toEqual([{ role: "user", content: "start the pipeline" }]);
    expect(restored.grantId).toBe("voice-grant-1");

    expect(unpackBar("{not json").lines).toEqual([]);
    expect(unpackBar(null)).toEqual({ lines: [], history: [], grantId: null });
    expect(unpackBar(JSON.stringify({ lines: [{ role: "wizard", text: "x" }, null] })).lines).toEqual([]);
  });

  it("keeps only the last few lines so a long day does not grow without bound", () => {
    const lines = Array.from({ length: 40 }, (_, index) => ({
      id: `line-${index}`,
      role: "user" as const,
      text: `line ${index}`,
      tools: []
    }));
    const restored = unpackBar(packBar({ lines, history: [], grantId: null }));
    expect(restored.lines.length).toBeLessThan(lines.length);
    expect(restored.lines[restored.lines.length - 1].text).toBe("line 39");
  });
});

describe("voice tools", () => {
  it("only loads the state-changing tools into an armed session", () => {
    const readOnly = voiceToolDefinitions(false).map((tool) => tool.name);
    const armed = voiceToolDefinitions(true).map((tool) => tool.name);
    expect(readOnly).not.toContain("start_channel_ingest");
    expect(armed).toContain("start_channel_ingest");
    expect(armed.length).toBe(VOICE_TOOLS.length);
  });

  it("exposes nothing that publishes, schedules, deletes or touches a token", () => {
    const names = VOICE_TOOLS.map((tool) => tool.name).join(" ");
    expect(names).not.toMatch(/publish|schedule|delete|token/i);
  });

  it("refuses an action tool when the session is read-only", async () => {
    const result = await runVoiceTool("start_channel_ingest", {}, { allowActions: false });
    expect(result.ok).toBe(false);
  });

  it("keeps the tools that fix a run behind the same arming as the rest", async () => {
    expect(voiceToolDefinitions(false).map((tool) => tool.name)).not.toContain("retry_pipeline_stage");
    expect(voiceToolDefinitions(true).map((tool) => tool.name)).toContain("retry_pipeline_stage");
    expect((await runVoiceTool("retry_pipeline_stage", { stage: "longform" }, { allowActions: false })).ok).toBe(false);
    expect((await runVoiceTool("render_topic_segment", {}, { allowActions: false })).ok).toBe(false);
  });

  it("finds the run whichever way the model spells the argument", () => {
    expect(runReferenceFrom({ runName: "Day 28" }).name).toBe("Day 28");
    expect(runReferenceFrom({ name: "Day 28" }).name).toBe("Day 28");
    expect(runReferenceFrom({ title: " Day 28 " }).name).toBe("Day 28");
    expect(runReferenceFrom({ runId: "abc123" })).toEqual({ runId: "abc123", name: undefined });
    expect(runReferenceFrom({ runName: "" }).name).toBeUndefined();
  });

  it("sends every started job to a screen that can show it", () => {
    expect(toolDestination("pipeline", "run-7")).toEqual({ href: "/pipeline?run=run-7", label: "Stream Pipeline" });
    expect(toolDestination("agents")).toEqual({ href: "/agents", label: "Sourceflow Agents" });
    expect(toolDestination("nowhere-at-all").href).toBe("/");
  });

  it("hands a skipped upload back with its URL, and says which skips a person may overturn", () => {
    const upload = {
      videoId: "abc",
      title: "Day 31",
      publishedAt: "2026-08-05T12:00:00.000Z",
      durationSec: 4000,
      aspect: null,
      wasLiveStream: false,
      isLiveNow: false,
      privacyStatus: "public",
      url: "https://www.youtube.com/watch?v=abc"
    };
    const candidates: ScanCandidate[] = [
      { upload, decision: { action: "skip", reason: "not-a-live-stream" } },
      { upload: { ...upload, videoId: "own" }, decision: { action: "skip", reason: "published-by-distribution-centre" } },
      { upload: { ...upload, videoId: "new" }, decision: { action: "ingest", reason: "live-stream" } }
    ];
    const skips = describeSkips(candidates);
    expect(skips.map((skip) => skip.videoId)).toEqual(["abc", "own"]);
    expect(skips[0]).toMatchObject({ url: "https://www.youtube.com/watch?v=abc", overridable: true });
    expect(skips[1].overridable).toBe(false);
  });

  it("never offers to re-ingest this app's own uploads, its drafts or a real Short", () => {
    expect(OVERRIDABLE_SKIPS.has("published-by-distribution-centre")).toBe(false);
    expect(OVERRIDABLE_SKIPS.has("not-public")).toBe(false);
    expect(OVERRIDABLE_SKIPS.has("short-vertical")).toBe(false);
  });

  it("refuses a tool it does not have", async () => {
    const result = await runVoiceTool("publish_everything", {}, { allowActions: true });
    expect(result.ok).toBe(false);
  });
});

describe("xai subscription auth", () => {
  it("normalizes the Grok CLI's stored session shape", () => {
    const session = normalizeXaiSession(
      { key: "abc", refresh_token: "r1", expires_at: "2026-08-03T01:24:12.000Z", email: "nic@example.com" },
      "cli_import"
    );
    expect(session?.accessToken).toBe("abc");
    expect(session?.refreshToken).toBe("r1");
    expect(session?.email).toBe("nic@example.com");
    expect(session?.source).toBe("cli_import");
    expect(session?.expiresAt).toBe(Date.parse("2026-08-03T01:24:12.000Z"));
  });

  it("normalizes a device-code token response", () => {
    const session = normalizeXaiSession({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    expect(session?.source).toBe("device_code");
    expect(session?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("keeps nothing when there is no token at all", () => {
    expect(normalizeXaiSession({ email: "nic@example.com" })).toBeNull();
    expect(normalizeXaiSession(null)).toBeNull();
  });

  it("reads the expiry out of a JWT when the payload does not carry one", () => {
    const claim = Buffer.from(JSON.stringify({ exp: 1800000000 })).toString("base64url");
    expect(jwtExpiryMs(`header.${claim}.signature`)).toBe(1800000000000);
    expect(jwtExpiryMs("not-a-jwt")).toBe(0);
  });

  it("counts a session with a refresh token as still usable once the access token lapses", () => {
    const base = { accessToken: "a", email: "", source: "device_code" as const, obtainedAt: 0 };
    expect(xaiSessionUsable({ ...base, refreshToken: "r", expiresAt: 1 }, 1000)).toBe(true);
    expect(xaiSessionUsable({ ...base, refreshToken: "", expiresAt: 1 }, 1000)).toBe(false);
    expect(xaiSessionUsable(null)).toBe(false);
  });
});
