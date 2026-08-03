import { AppShell } from "@/components/layout/app-shell";
import { AgentCommandPage } from "@/components/agents/agent-command-page";

export default function AgentsPage() {
  return (
    <AppShell>
      <AgentCommandPage />
    </AppShell>
  );
}
