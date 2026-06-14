import type { ExecutionGoal } from "@/types/domain";

/**
 * Definition of a default goal, before timestamps/ids are attached. `dailyTarget`
 * is only meaningful for daily goals; `weeklyTarget` is always the baseline
 * weekly requirement and is derived as `dailyTarget * 7` for daily goals.
 */
type DefaultGoal = Pick<
  ExecutionGoal,
  "title" | "description" | "category" | "frequency" | "dailyTarget" | "weeklyTarget" | "icon"
>;

const DEFAULT_GOALS: DefaultGoal[] = [
  // X / Twitter
  {
    title: "Original post",
    description: "One original post per day that says something worth reading.",
    category: "X / Twitter",
    frequency: "daily",
    dailyTarget: 1,
    weeklyTarget: 7,
    icon: "Twitter"
  },
  {
    title: "Thoughtful replies",
    description: "Three considered replies per day — add signal, not noise.",
    category: "X / Twitter",
    frequency: "daily",
    dailyTarget: 3,
    weeklyTarget: 21,
    icon: "MessageCircle"
  },
  // Reddit
  {
    title: "Helpful comments",
    description: "Useful participation that genuinely helps the thread, not low-effort engagement.",
    category: "Reddit",
    frequency: "weekly",
    dailyTarget: 0,
    weeklyTarget: 3,
    icon: "MessageSquare"
  },
  {
    title: "Original post",
    description: "One substantive original Reddit post per week.",
    category: "Reddit",
    frequency: "weekly",
    dailyTarget: 0,
    weeklyTarget: 1,
    icon: "FileText"
  },
  // YouTube
  {
    title: "Livestreams",
    description: "Five livestreams per week.",
    category: "YouTube",
    frequency: "weekly",
    dailyTarget: 0,
    weeklyTarget: 5,
    icon: "Radio"
  },
  {
    title: "Long-form uploads",
    description: "Two long-form uploads per week.",
    category: "YouTube",
    frequency: "weekly",
    dailyTarget: 0,
    weeklyTarget: 2,
    icon: "Youtube"
  },
  {
    title: "Shorts",
    description: "Seven YouTube Shorts per week.",
    category: "YouTube",
    frequency: "weekly",
    dailyTarget: 0,
    weeklyTarget: 7,
    icon: "Film"
  },
  {
    title: "Comments",
    description: "Three YouTube comments per day on relevant channels.",
    category: "YouTube",
    frequency: "daily",
    dailyTarget: 3,
    weeklyTarget: 21,
    icon: "MessagesSquare"
  },
  // CoLateral
  {
    title: "Development sessions",
    description: "Five focused work sessions per week that create measurable progress on CoLateral.",
    category: "CoLateral",
    frequency: "weekly",
    dailyTarget: 0,
    weeklyTarget: 5,
    icon: "Code"
  },
  // Structural Engineering
  {
    title: "Educational posts",
    description: "Two educational structural-engineering posts, tutorials, or technical explanations per week.",
    category: "Structural Engineering",
    frequency: "weekly",
    dailyTarget: 0,
    weeklyTarget: 2,
    icon: "Ruler"
  },
  // Community & Networking
  {
    title: "Genuine conversations",
    description:
      "Three genuine conversations per week with creators, engineers, potential CoLateral users, collaborators, or other relevant people.",
    category: "Community & Networking",
    frequency: "weekly",
    dailyTarget: 0,
    weeklyTarget: 3,
    icon: "Users"
  }
];

/** Build the seed set of default goals with stable ids and timestamps. */
export function buildDefaultExecutionGoals(now: string): ExecutionGoal[] {
  return DEFAULT_GOALS.map((goal, index) => ({
    id: `xgoal-default-${index + 1}`,
    title: goal.title,
    description: goal.description,
    category: goal.category,
    frequency: goal.frequency,
    dailyTarget: goal.dailyTarget,
    weeklyTarget: goal.weeklyTarget,
    icon: goal.icon,
    displayOrder: index,
    active: true,
    createdAt: now,
    updatedAt: now
  }));
}
