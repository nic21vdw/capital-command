import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { UploadingCenterPage } from "@/components/uploading-center/uploading-center-page";

export const metadata = { title: "Uploading Center | CoLateral Marketing" };

export default function Page() {
  return (
    <AppShell frame>
      <Suspense fallback={null}>
        <UploadingCenterPage />
      </Suspense>
    </AppShell>
  );
}
