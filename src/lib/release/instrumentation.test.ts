import { afterEach, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  runtime: vi.fn(), credentials: vi.fn(), description: vi.fn(), heartbeat: vi.fn(), analytics: vi.fn()
}));
vi.mock("@/lib/release/runtime", () => ({ releaseRuntime: services.runtime }));
vi.mock("@/lib/publisher/credentials", () => ({ applyStoredCredentials: services.credentials }));
vi.mock("@/lib/publisher/standingDescription", () => ({ refreshClipDescription: services.description }));
vi.mock("@/lib/pipeline/heartbeat", () => ({ startPipelineHeartbeat: services.heartbeat }));
vi.mock("@/lib/analytics/schedule", () => ({ startAnalyticsSync: services.analytics }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("does not load live settings, start the pipeline or sync analytics in a production build worker", { timeout: 20_000 }, async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  const { register } = await import("@/instrumentation");
  await register();
  for (const service of Object.values(services)) expect(service).not.toHaveBeenCalled();
});

it("still initializes the runtime, settings, pipeline and analytics sync when the server starts", { timeout: 20_000 }, async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  const { register } = await import("@/instrumentation");
  await register();
  for (const service of Object.values(services)) expect(service).toHaveBeenCalledOnce();
});
