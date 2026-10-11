import { describe, expect, it } from "vitest";
import { OVERNIGHT_CONFIRM_TEXT, overnightConsequence } from "@/lib/automations/overnight";

describe("overnight auto-booking wording", () => {
  it("says what turning it on does, in the words the confirm dialog shows", () => {
    expect(OVERNIGHT_CONFIRM_TEXT).toBe(
      "Overnight streams will be booked into the publish and Threads queues automatically; posts go out at their slots with copy you haven't reviewed. You can stop any run from its Scheduler row."
    );
  });

  it("gives a one-line consequence for each state", () => {
    expect(overnightConsequence(true)).toMatch(/without review/);
    expect(overnightConsequence(false)).toMatch(/ready to schedule/);
  });
});
