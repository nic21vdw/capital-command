import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ClipEditorPage } from "@/components/editor/clip-editor-page";
import { StoryEditorPage } from "@/components/editor/story-editor-page";

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
      <div className="mb-3 flex justify-end">
        <Link href="/editor?mode=story" className="text-sm text-[var(--muted-foreground)] hover:text-white">
          Story edits (long-form)
        </Link>
      </div>
      <Suspense fallback={null}>
        <ClipEditorPage />
      </Suspense>
    </AppShell>
  );
}
