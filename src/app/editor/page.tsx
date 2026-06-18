import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ClipEditorPage } from "@/components/editor/clip-editor-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <ClipEditorPage />
      </Suspense>
    </AppShell>
  );
}
