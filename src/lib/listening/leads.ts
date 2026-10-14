import type { ListeningResult, ListeningSource } from "@/lib/listening/model";

export const HIGH_LEAD_SCORE = 70;

export interface LeadSummary {
  newLeads: number;
  leads: { id: string; title: string; source: ListeningSource; score: number; url: string }[];
}

export function isHighLead(result: Pick<ListeningResult, "category" | "score" | "status">): boolean {
  return result.category === "lead" && result.score >= HIGH_LEAD_SCORE && result.status === "new";
}

export function leadSummary(results: ListeningResult[], limit = 50): LeadSummary {
  const leads = results.filter(isHighLead).sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
  return {
    newLeads: leads.length,
    leads: leads.slice(0, limit).map(({ id, title, source, score, url }) => ({ id, title, source, score, url }))
  };
}
