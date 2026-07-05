import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { UploadingCenterPage } from "@/components/uploading-center/uploading-center-page";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <UploadingCenterPage />
      </Suspense>
    </AppShell>
  );
}
