import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadsRecoveryNotice } from "./connections-settings";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("Threads recovery guidance", () => {
  it("explains environment ownership and source replacement while paused", () => {
    const html = renderToStaticMarkup(React.createElement(ThreadsRecoveryNotice, {
      recovery: { control: "paused", tokenSource: "env", envOwnedFields: ["THREADS_ACCESS_TOKEN"] }
    }));
    expect(html).toContain("Settings cannot replace it");
    expect(html).toContain("restart the app while Threads stays paused");
    expect(html).toContain("server checks the saved pause again");
    expect(html).toContain("separately resuming");
    expect(html).toContain("cannot recall a provider request already in flight");
    expect(html).toContain('href="/automations"');
  });

  it.each([undefined, { control: "running" as const, tokenSource: null, envOwnedFields: [] }])("asks for a saved pause when its state is not paused: %j", (recovery) => {
    const html = renderToStaticMarkup(React.createElement(ThreadsRecoveryNotice, { recovery }));
    expect(html).toContain("Pause Threads in Automations before changing credentials");
    expect(html).not.toContain("Threads is paused");
  });

  it("shows unreadable controls as a blocker and never says they are paused", () => {
    const html = renderToStaticMarkup(React.createElement(ThreadsRecoveryNotice, {
      recovery: { control: "unreadable", tokenSource: "saved", envOwnedFields: [] }
    }));
    expect(html).toContain("Repair the automation controls before changing credentials");
    expect(html).not.toContain("Threads is paused");
    expect(html).toContain("Saving does not run or retry the queue");
  });
});
