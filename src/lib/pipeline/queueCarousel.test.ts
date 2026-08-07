import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { planRunOutputs } from "@/lib/pipeline/queueOutputs";
import { defaultVideoStudio } from "@/lib/storage/schemas";
import { readAppData, writeAppData } from "@/lib/storage/store";

/**
 * The seam the plan sheet depends on: a run that produced a carousel has to
 * come back with real slide files, because nothing else in the app writes one.
 */
it("renders the run's deck and offers it as one picture post", async () => {
  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", "instagram,facebook");

  const data = await readAppData();
  await writeAppData({
    ...data,
    videoStudio: {
      ...defaultVideoStudio,
      ...data.videoStudio,
      carousels: [
        {
          id: "deck-x",
          title: "What one stream produces",
          sourceType: "longform",
          aspectRatio: "portrait",
          createdAt: "2026-08-06T12:00:00.000Z",
          slides: [
            { id: "a", heading: "One", body: "body" },
            { id: "b", heading: "Two", body: "body" }
          ]
        }
      ]
    }
  });

  await mkdir(dataPath("pipeline"), { recursive: true });
  await writeFile(
    path.join(dataPath("pipeline"), "runs.json"),
    JSON.stringify([
      {
        id: "run-x",
        name: "Thursday stream",
        status: "running",
        createdAt: "2026-08-06T12:00:00.000Z",
        updatedAt: "2026-08-06T12:00:00.000Z",
        steps: [],
        carouselId: "deck-x"
      }
    ])
  );

  const plan = await planRunOutputs("run-x");
  expect(plan?.candidates.map((c) => c.kind)).toEqual(["carousel"]);
  expect(plan?.candidates[0].imagePaths).toHaveLength(2);
});
