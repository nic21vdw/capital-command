import { afterEach, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  runtime: vi.fn(), credentials: vi.fn(), description: vi.fn(), heartbeat: vi.fn()
}));
vi.mock("@/lib/release/runtime", () => ({ releaseRuntime: services.runtime }));
vi.mock("@/lib/publisher/credentials", () => ({ applyStoredCredentials: services.credentials }));
vi.mock("@/lib/publisher/standingDescription", () => ({ refreshClipDescription: services.description }));
vi.mock("@/lib/pipeline/heartbeat", () => ({ startPipelineHeartbeat: services.heartbeat }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("does not load live settings or start the pipeline in a production build worker", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  const { register } = await import("@/instrumentation");
  await register();
  for (const service of Object.values(services)) expect(service).not.toHaveBeenCalled();
});

it("still initializes the runtime, settings and pipeline when the server starts", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  const { register } = await import("@/instrumentation");
  await register();
  for (const service of Object.values(services)) expect(service).toHaveBeenCalledOnce();
});
