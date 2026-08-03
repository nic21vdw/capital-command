import { listRuns } from "@/lib/pipeline/runs";
import { readAppData } from "@/lib/storage/store";

export async function sourceflowContext(): Promise<string> {
  const [data, pipelineRuns] = await Promise.all([readAppData(), listRuns()]);
  const contentByStatus = data.contentItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  const recentContent = data.contentItems.slice(0, 12).map((item) => ({
    title: item.title,
    type: item.type,
    platform: item.platform,
    status: item.status,
    publishDate: item.publishDate ?? null
  }));
  const recentRuns = pipelineRuns.slice(0, 10).map((run) => ({
    id: run.id,
    name: run.name,
    status: run.status,
    createdAt: run.createdAt
  }));
  const studio = data.videoStudio;
  return JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      creator: data.creatorProfile?.channelName || data.settings.profile?.displayName || "Nic",
      contentByStatus,
      recentContent,
      pipelineRuns: recentRuns,
      studio: {
        ideas: studio?.ideas?.length ?? 0,
        scripts: studio?.scripts?.length ?? 0
      },
      safety: {
        publishingRequiresHumanApproval: true,
        agentMutationsAreProposalsUntilApproved: true
      }
    },
    null,
    2
  );
}
