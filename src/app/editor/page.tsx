import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ClipEditorPage } from "@/components/editor/clip-editor-page";
import { StoryEditorPage } from "@/components/editor/story-editor-page";

export const metadata = { title: "Clip Editor | CoLateral Marketing" };

export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  if (mode === "story") {
    return (
      <AppShell>
        <StoryEditorPage />
      </AppShell>
    );
  }
  return (
    <AppShell>
      <Suspense fallback={null}>
        <ClipEditorPage />
      </Suspense>
    </AppShell>
  );
}
