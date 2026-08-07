export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startPipelineHeartbeat } = await import("@/lib/pipeline/heartbeat");
  startPipelineHeartbeat();
}
