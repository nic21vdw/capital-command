import { addDays, daysBetween } from "@/lib/execution/dates";
import type { LaunchPhase, LaunchPlan, LaunchPlanGroup, LaunchTask, LaunchTaskTemplate, ProductLaunch } from "@/lib/launch/types";

const PHASE_TITLES: Record<LaunchPhase, string> = {
  prep: "Two weeks out — build the assets",
  final: "Launch week — line everything up",
  "launch-day": "Launch day",
  after: "After the launch — bank the value"
};

const PHASE_ORDER: LaunchPhase[] = ["prep", "final", "launch-day", "after"];

/**
 * Product Hunt gives a product one shot at being featured, so the work that
 * decides the outcome all happens before launch day. The playbook is dated
 * backwards from the launch so the checklist is always "what is due now"
 * rather than a static wall of tasks.
 */
export const LAUNCH_PLAYBOOK: LaunchTaskTemplate[] = [
  {
    id: "ph-account-warm",
    label: "Warm up the Product Hunt account",
    detail:
      "Launching from a day-old account with no history reads as a drive-by. Upvote and comment thoughtfully on a few launches a day until launch — it also teaches you what the front page rewards.",
    phase: "prep",
    offsetDays: -14
  },
  {
    id: "ph-landing-ready",
    label: "Make the landing page survive a cold visitor",
    detail:
      "Product Hunt traffic bounces fast. Above the fold: what it is, who it is for, one screenshot, one action. No signup wall before the value is visible.",
    phase: "prep",
    offsetDays: -12
  },
  {
    id: "ph-analytics",
    label: "Add a tracked link and analytics goal",
    detail:
      "Use a ?ref=producthunt URL on the listing so the launch is attributable, and make sure signups fire a goal you can read the next morning.",
    phase: "prep",
    offsetDays: -12
  },
  {
    id: "ph-copy",
    label: "Write the listing copy",
    detail:
      "Name, 60-character tagline, description, topics, and the maker's first comment. Generate a draft in Launch Pad, then rewrite it in your own voice.",
    phase: "prep",
    offsetDays: -10
  },
  {
    id: "ph-gallery",
    label: "Build the gallery",
    detail:
      "One 1270x760 thumbnail plus 3-6 gallery images that read as a story, not a feature dump. First image does the work — most people never scroll.",
    phase: "prep",
    offsetDays: -9
  },
  {
    id: "ph-demo-video",
    label: "Cut a 30-60 second demo",
    detail:
      "No intro, no logo sting. Straight into the product doing the thing. This is a clip the Stream Pipeline can produce from a screen recording.",
    phase: "prep",
    offsetDays: -7
  },
  {
    id: "ph-content-plan",
    label: "Plan the launch as a content event",
    detail:
      "The launch is a story for the channel: a build-in-public video, the clips off it, a carousel, and the Threads posts. Put them on the Master Calendar now.",
    phase: "prep",
    offsetDays: -7
  },
  {
    id: "ph-audience-warning",
    label: "Tell your audience it is coming",
    detail:
      "A launch with no pre-warmed audience is a launch with no first hour. Trail it on the channel, in the newsletter, and to anyone who has used the product.",
    phase: "final",
    offsetDays: -5
  },
  {
    id: "ph-hunter",
    label: "Decide: self-hunt or find a hunter",
    detail:
      "Self-hunting is fine now and keeps the maker comment as yours. Only chase a hunter if they genuinely have a relevant audience.",
    phase: "final",
    offsetDays: -4
  },
  {
    id: "ph-schedule",
    label: "Schedule the launch for 12:01am PT",
    detail:
      "The day rolls over at midnight Pacific and ranking is cumulative, so anything later throws away hours. Product Hunt lets you schedule it in advance — do that, do not rely on being awake.",
    phase: "final",
    offsetDays: -3
  },
  {
    id: "ph-day-choice",
    label: "Sanity-check the day",
    detail:
      "Tuesday to Thursday is the most competitive; weekends are quieter but carry less downstream traffic. Check who else is scheduled if you can.",
    phase: "final",
    offsetDays: -3
  },
  {
    id: "ph-first-comment",
    label: "Finalise the maker comment",
    detail:
      "Why you built it, who it is for, what is deliberately missing, and one question that invites a reply. Paste it within minutes of going live.",
    phase: "final",
    offsetDays: -1
  },
  {
    id: "ph-go-live",
    label: "Confirm it is live and post the maker comment",
    detail: "Check the listing rendered correctly — gallery, links, topics — then post the first comment immediately.",
    phase: "launch-day",
    offsetDays: 0
  },
  {
    id: "ph-notify",
    label: "Tell everyone, without asking for upvotes",
    detail:
      "Asking for upvotes directly is against the rules and gets launches penalised. Share the link and let people decide.",
    phase: "launch-day",
    offsetDays: 0
  },
  {
    id: "ph-reply-all-day",
    label: "Reply to every comment, all day",
    detail:
      "Comment volume and maker responsiveness feed the ranking, and the comments are the best product feedback you will get in one sitting.",
    phase: "launch-day",
    offsetDays: 0
  },
  {
    id: "ph-capture-content",
    label: "Record the day for the channel",
    detail: "Screen recording, rank screenshots, the good comments. This is the raw material for the follow-up video.",
    phase: "launch-day",
    offsetDays: 0
  },
  {
    id: "ph-badge",
    label: "Put the badge on the landing page",
    detail: "The embed is a permanent, high-authority credibility marker even if the rank was modest.",
    phase: "after",
    offsetDays: 1
  },
  {
    id: "ph-thank-you",
    label: "Post the wrap-up comment",
    detail: "Thank the commenters, say what you are shipping from the feedback. Cheap, and it keeps the listing alive.",
    phase: "after",
    offsetDays: 1
  },
  {
    id: "ph-retro",
    label: "Write the numbers down",
    detail:
      "Votes, rank, visitors, signups, paying customers. Without this the next launch is guesswork — and the retro is itself a strong video.",
    phase: "after",
    offsetDays: 3
  },
  {
    id: "ph-repurpose",
    label: "Turn the launch into evergreen content",
    detail: "The retro video, the clips, the carousel, the written post-mortem. The launch day is 24 hours; the content is not.",
    phase: "after",
    offsetDays: 7
  }
];

export function buildLaunchPlan(launch: ProductLaunch, today: string): LaunchPlan {
  const done = new Set(launch.completedTasks);
  const tasks: LaunchTask[] = LAUNCH_PLAYBOOK.map((template) => {
    const dueDate = addDays(launch.launchDate, template.offsetDays);
    const isDone = done.has(template.id);
    return {
      ...template,
      dueDate,
      done: isDone,
      overdue: !isDone && daysBetween(dueDate, today) > 0
    };
  }).sort((a, b) => (a.dueDate === b.dueDate ? a.offsetDays - b.offsetDays : a.dueDate < b.dueDate ? -1 : 1));

  const groups: LaunchPlanGroup[] = PHASE_ORDER.map((phase) => ({
    phase,
    title: PHASE_TITLES[phase],
    tasks: tasks.filter((task) => task.phase === phase)
  })).filter((group) => group.tasks.length > 0);

  return {
    groups,
    total: tasks.length,
    completed: tasks.filter((task) => task.done).length,
    nextTask: tasks.find((task) => !task.done) ?? null,
    overdueCount: tasks.filter((task) => task.overdue).length,
    daysUntilLaunch: daysBetween(today, launch.launchDate)
  };
}

export function phaseTitle(phase: LaunchPhase) {
  return PHASE_TITLES[phase];
}
