import { describe, expect, it } from "vitest";
import { base64FromBuffer, bufferFromBase64, encodeCaptureChunk, floatToPcm16, pcm16ToFloat, peakLevel, resampleMono } from "@/lib/voice/pcm";
import { buildSubprotocols, getVoiceProvider, realtimeSocketUrl } from "@/lib/voice/providers";
import { buildSessionUpdate, issueGrant, readGrant, readMintedSecret, revokeGrant } from "@/lib/voice/session";
import { VOICE_TOOLS, runVoiceTool, voiceToolDefinitions } from "@/lib/voice/tools";

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

  it("refuses a tool it does not have", async () => {
    const result = await runVoiceTool("publish_everything", {}, { allowActions: true });
    expect(result.ok).toBe(false);
  });
});
