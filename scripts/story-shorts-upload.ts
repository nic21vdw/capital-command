import { config } from "dotenv";
import path from "node:path";
config({ path: path.join(process.cwd(), ".env"), quiet: true });
import { projectFile, readJson, writeJson, exists } from "@/lib/story/store";
import { readBackVideo, studioLink, tokenFromFile, uploadStoryVideo, verifyPrivate } from "@/lib/story/youtube";
import { draftTitle } from "@/lib/story/publish";

type Clip = { id: string; title: string; description?: string; tags?: string[] };
type Uploaded = Record<string, { videoId: string; studio: string; privacyStatus: string; format: string }>;

async function main() {
  const id = process.argv[2];
  const tokensFile = process.argv[process.argv.indexOf("--tokens-file") + 1];
  const formats = (process.argv.includes("--formats") ? process.argv[process.argv.indexOf("--formats") + 1] : "9x16,16x9").split(",");
  const clips = (await readJson<Clip[]>(projectFile(id, "shorts", "clips.json"))) ?? [];
  const ledgerFile = projectFile(id, "shorts", "uploads.json");
  const ledger = (await readJson<Uploaded>(ledgerFile)) ?? {};
  const accessToken = tokenFromFile(tokensFile);

  for (const format of formats) {
    for (const clip of clips) {
      const key = `${clip.id}:${format}`;
      if (ledger[key]) continue;
      const file = projectFile(id, "shorts", clip.id, format === "9x16" ? `${clip.id}.mp4` : `${clip.id}-16x9.mp4`);
      if (!(await exists(file))) continue;
      const vertical = format === "9x16";
      const title = draftTitle(vertical ? `${clip.title} #Shorts` : clip.title);
      const description = [clip.description ?? clip.title, "", "Clipped from Day 61 of vibe coding until I can move out of my mom's basement.", "", "#vibecoding #buildinpublic #ai"].join("\n");
      try {
        const { videoId } = await uploadStoryVideo({
          file,
          title,
          description,
          tags: clip.tags ?? ["vibe coding", "build in public", "AI", "Claude"],
          categoryId: "28",
          language: "en",
          madeForKids: false,
          accessToken
        });
        const readback = await readBackVideo(videoId, accessToken);
        verifyPrivate(readback);
        ledger[key] = { videoId, studio: studioLink(videoId), privacyStatus: readback.privacyStatus, format };
        await writeJson(ledgerFile, ledger);
        console.log(`${key} -> ${videoId} (${readback.privacyStatus})`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`${key} failed: ${message.slice(0, 300)}`);
        if (/quota|uploadLimitExceeded|403/i.test(message)) {
          console.log("stopping: YouTube upload quota reached for today");
          return;
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
