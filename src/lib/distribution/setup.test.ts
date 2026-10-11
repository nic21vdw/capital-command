import { describe, expect, it } from "vitest";
import type { AutomationCard } from "@/lib/automations/types";
import { setupNeed } from "@/lib/distribution/setup";

const card = (id: AutomationCard["id"], blockers: string[], paused = false) =>
  ({ id, blockers, paused }) as AutomationCard;

describe("setupNeed", () => {
  const ready = { configuredPlatforms: ["youtube", "instagram", "facebook"], publishEnabled: true };

  it("is null when every account behind the format is connected", () => {
    expect(setupNeed("shorts", ready)).toBeNull();
    expect(setupNeed("carousel", ready)).toBeNull();
  });

  it("names the unconnected platforms and points at Settings", () => {
    const need = setupNeed("carousel", { ...ready, configuredPlatforms: [] });
    expect(need).toMatchObject({ reason: "Instagram and Facebook aren't connected", href: "/settings" });
    expect(setupNeed("longform", { ...ready, configuredPlatforms: ["instagram"] })?.reason).toBe("YouTube isn't connected");
  });

  it("says so when posting is switched off", () => {
    expect(setupNeed("longform", { ...ready, publishEnabled: false })?.reason).toBe("posting is switched off");
  });

  it("reads podcast and Threads from their Automations card, ignoring what a sandbox cannot see", () => {
    const cards = [card("podcast", ["The storage bucket is not connected yet. Add the endpoint, bucket and access keys under Media hosting in Settings > Accounts."]), card("threads", ["This page can't read the Windows task, so it can't tell whether the runner is installed."])];
    expect(setupNeed("audio", { ...ready, cards: [card("podcast", ["The show needs a valid email address  -  Spotify sends the ownership verification there."])] })).toMatchObject({ href: "/automations" });
    expect(setupNeed("text", { ...ready, cards })).toBeNull();
    expect(setupNeed("text", { ...ready, cards: [card("threads", ["No Threads account is connected."], true)] })).toBeNull();
  });

  it("links to Settings > Accounts when that is where the fix is, so text and link agree", () => {
    const threads = setupNeed("text", {
      ...ready,
      cards: [card("threads", ["No Threads account is connected  -  add the access token in Settings > Accounts."])]
    });
    expect(threads).toEqual({ reason: "No Threads account is connected", href: "/settings#accounts", hrefLabel: "Settings > Accounts" });
    const podcast = setupNeed("audio", {
      ...ready,
      cards: [card("podcast", ["The storage bucket is not connected yet. Add the endpoint, bucket and access keys under Media hosting in Settings > Accounts."])]
    });
    expect(podcast).toMatchObject({ href: "/settings#accounts", hrefLabel: "Settings > Accounts" });
    expect(podcast?.reason).toBe("The storage bucket is not connected yet");
  });

  it("never calls a format blocked on a guess", () => {
    expect(setupNeed("audio", ready)).toBeNull();
    expect(setupNeed("audio", { ...ready, cards: null })).toBeNull();
  });
});
