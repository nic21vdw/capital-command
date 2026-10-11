// Leaf module: the words for turning on "Auto-book overnight streams", shared by
// Automations and Settings so the two places can never describe it differently.

export const OVERNIGHT_CONFIRM_TITLE = "Turn on auto-booking?";

/** Read before the switch goes on. This is the only thing between one click and unreviewed posts. */
export const OVERNIGHT_CONFIRM_TEXT =
  "Overnight streams will be booked into the publish and Threads queues automatically; posts go out at their slots with copy you haven't reviewed. You can stop any run from its Scheduler row.";

/** The one line that sits under the toggle, on or off. */
export function overnightConsequence(on: boolean): string {
  return on
    ? "On: finished overnight streams are booked without review, and the posts go out at their slots."
    : "Off: finished overnight streams stop at ready to schedule until you book them.";
}
