import { describe, expect, it } from "vitest";
import { CONNECTION_FIELD_NAMES } from "@/lib/publisher/connections";
import { SERVICES, SERVICE_FIELD_NAMES, accountSetupHref, serviceReady, serviceSetupHref } from "./services";

describe("AI and services setup", () => {
  it("names each credential once across accounts and services", () => {
    const all = [...CONNECTION_FIELD_NAMES, ...SERVICE_FIELD_NAMES];
    expect(new Set(all).size).toBe(all.length);
  });

  it("covers the keys the needs-setup screens point at", () => {
    expect(SERVICE_FIELD_NAMES).toEqual(expect.arrayContaining(["FAL_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "OPENAI_API_KEY", "XAI_API_KEY", "PRODUCT_HUNT_TOKEN"]));
  });

  it("needs every required field and treats an optional-only service as ready", () => {
    const elevenlabs = SERVICES.find((service) => service.id === "elevenlabs")!;
    expect(serviceReady(elevenlabs, { ELEVENLABS_API_KEY: true })).toBe(false);
    expect(serviceReady(elevenlabs, { ELEVENLABS_API_KEY: true, ELEVENLABS_VOICE_ID: true })).toBe(true);
    expect(serviceReady(SERVICES.find((service) => service.id === "ai-writing")!, {})).toBe(true);
  });

  it("links to the row that fixes it", () => {
    expect(serviceSetupHref("fal")).toBe("/settings?service=fal#services");
    expect(accountSetupHref("threads")).toBe("/settings?connect=threads#accounts");
    expect(accountSetupHref()).toBe("/settings#accounts");
  });
});
