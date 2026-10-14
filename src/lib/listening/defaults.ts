import type { KeywordGroup } from "@/lib/listening/model";

export const DEFAULT_KEYWORD_GROUPS: KeywordGroup[] = [
  {
    id: "brand",
    name: "CoLateral",
    intent: "brand",
    terms: ["colateralai", "CoLateral AI", "CoLateral Marketing"]
  },
  {
    id: "competitors",
    name: "Structural software",
    intent: "competitor",
    terms: ["ETABS", "SAP2000", "RISA", "Tekla", "Revit"]
  },
  {
    id: "structural-ai",
    name: "Structural engineering AI",
    intent: "pain",
    terms: ["structural engineering AI", "AI structural design", "AI for structural engineers"]
  },
  {
    id: "pain",
    name: "Juggling agents",
    intent: "pain",
    terms: [
      "multiple claude code",
      "claude code worktrees",
      "run codex and claude",
      "too many terminals ai agents",
      "parallel ai coding agents"
    ]
  },
  {
    id: "comparison",
    name: "Looking for an alternative",
    intent: "comparison",
    terms: ["cursor alternative", "conductor app claude", "warp alternative", "claude code gui"]
  },
  {
    id: "pricing",
    name: "Subscription fatigue",
    intent: "pricing",
    terms: ["ai tool subscription fatigue", "one-time license ai"]
  }
];
