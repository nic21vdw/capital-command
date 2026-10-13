import { AppShell } from "@/components/layout/app-shell";
import { AutomationsPage } from "@/components/automations/automations-page";

export const metadata = { title: "Automations | CoLateral Marketing" };

export default function Page() {
  return <AppShell><AutomationsPage /></AppShell>;
}
