import { AppShell } from "@/components/layout/app-shell";
import { MasterCalendarPage } from "@/components/master-calendar/master-calendar-page";

export const metadata = {
  title: "Master Calendar | Nic Vandewetering",
  description:
    "Every distribution calendar in one place: scheduled shorts, carousels, X/Threads packs, FB/IG threads and long-form content by day, week or month."
};

export default function Page() {
  return (
    <AppShell>
      <MasterCalendarPage />
    </AppShell>
  );
}
