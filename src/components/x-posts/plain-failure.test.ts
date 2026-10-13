import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlainFailure } from "@/components/x-posts/plain-failure";

// vitest transpiles the component with the classic JSX runtime, which looks React up globally.
(globalThis as { React?: typeof React }).React = React;

describe("a Threads failure on the Autopilot board", () => {
  it("says a dead token in plain words, links to Settings and keeps the raw text in details", () => {
    const raw = "Threads API error (190): the access token has expired. Reconnect the account in Settings, then retry.";
    const html = renderToStaticMarkup(createElement(PlainFailure, { raw, prefix: "Didn't post — " }));
    expect(html).toContain("Didn&#x27;t post — Threads connection expired - ");
    expect(html).toContain('href="/settings#accounts"');
    expect(html).toContain(">reconnect in Settings</a>");
    expect(html).toContain("<details");
    expect(html).toContain(`title="${raw.replace(/'/g, "&#x27;")}"`);
    // The provider wording is only inside the disclosure and the tooltip.
    expect(html.replace(/<details.*<\/details>/, "").replace(/title="[^"]*"/, "")).not.toContain("API error");
  });

  it("does not repeat a short reason as a detail", () => {
    const html = renderToStaticMarkup(createElement(PlainFailure, { raw: "Owner email is missing." }));
    expect(html).toContain("Owner email is missing.");
    expect(html).not.toContain("<details");
  });
});
