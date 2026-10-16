import { describe, expect, it } from "vitest";
import { buildCarouselEvidence } from "@/lib/carousels/evidence";

describe("original carousel source evidence", () => {
  it("keeps a late qualification when a pasted source exceeds the budget", () => {
    const evidence = JSON.parse(buildCarouselEvidence({ sourceText: `Opening claim. ${"Background detail. ".repeat(2000)}The forecast figures are invented assumptions.` }));
    expect(evidence.source).toContain("Opening claim.");
    expect(evidence.source).toContain("The forecast figures are invented assumptions.");
    expect(evidence.source.length).toBeLessThanOrEqual(12000);
    expect(evidence.sourceTruncated).toBe(true);
  });

  it("retains a chosen cue even when the broad transcript digest skips it", () => {
    const transcript = Array.from({ length: 500 }, (_, i) => ({ start: i * 30, end: i * 30 + 10, text: `Moment ${i}: ${"ordinary source context ".repeat(8)}` }));
    transcript[1].text = "The selected forecast is a demonstration, not a measured customer result.";
    const evidence = JSON.parse(buildCarouselEvidence({ transcript, atSeconds: [null, 35] }));
    expect(evidence.source).not.toContain("selected forecast");
    expect(evidence.chosenMoments).toEqual([expect.objectContaining({ slide: 2, atSeconds: 35 })]);
    expect(evidence.chosenMoments[0].text).toContain("[00:30] The selected forecast is a demonstration");
  });

  it("does not turn absent evidence or invalid anchors into source facts", () => {
    expect(buildCarouselEvidence()).toContain("draft alone is not evidence");
    expect(buildCarouselEvidence({ title: "A confident title" })).toContain("Original source unavailable");
    const evidence = JSON.parse(buildCarouselEvidence({ sourceText: "A supplied example.", atSeconds: [NaN, -1, Infinity] }));
    expect(evidence.chosenMoments).toBeUndefined();
  });

  it("carries the supplied photo descriptions without claiming to have seen them", () => {
    const evidence = JSON.parse(buildCarouselEvidence({ imageNotes: "Photo 1 is the real canvas with a staged demo brief." }));
    expect(evidence.suppliedPhotoDescriptions).toContain("staged demo brief");
  });

  it("reserves a dense neighborhood's budget for the exact anchor and its qualification", () => {
    const transcript = Array.from({ length: 31 }, (_, i) => ({ start: i, end: i + 1, text: `Neighbor ${i}: ${"incidental context ".repeat(18)}` }));
    transcript[15].text = "The export completed, but this is only a demo and has not been published.";
    transcript.push({ start: 1000, end: 1001, text: "Far later: " + "irrelevant context ".repeat(300) });
    const evidence = JSON.parse(buildCarouselEvidence({ transcript, atSeconds: [15.5] }));
    const [moment] = evidence.chosenMoments;
    expect(evidence.source).not.toContain("has not been published");
    expect(moment.text).toContain("[00:15] The export completed, but this is only a demo and has not been published.");
    expect(moment.text.indexOf("has not been published")).toBeLessThan(moment.text.indexOf("Nearby context:"));
    expect(moment.text.length).toBeLessThanOrEqual(1600);
    expect(moment).toMatchObject({ anchorMatched: true, anchorTruncated: false, contextTruncated: true, sourceCheckRequired: true });
  });

  it("strictly bounds a broad digest even when one sampled cue is oversized", () => {
    const transcript = [{ start: 0, end: 100, text: `Opening. ${"x".repeat(25000)} Closing qualification.` }];
    const evidence = JSON.parse(buildCarouselEvidence({ transcript }));
    expect(evidence.source.length).toBeLessThanOrEqual(12000);
    expect(evidence.source).toContain("Opening.");
    expect(evidence.source).toContain("Closing qualification.");
    expect(evidence.sourceTruncated).toBe(true);
    expect(evidence.uncertainty).toContain("not complete source verification");
  });

  it("strictly caps a digest with uneven sampled cue lengths", () => {
    const transcript = Array.from({ length: 12 }, (_, i) => ({ start: i * 10, end: i * 10 + 9, text: i === 3 ? `Long sampled cue. ${"x".repeat(26000)} Its closing limit.` : `Short cue ${i}.` }));
    const evidence = JSON.parse(buildCarouselEvidence({ transcript, atSeconds: [35] }));
    expect(evidence.source.length).toBeLessThanOrEqual(12000);
    expect(evidence.sourceTruncated).toBe(true);
    expect(evidence.chosenMoments[0]).toMatchObject({ anchorMatched: true, anchorTruncated: true, sourceCheckRequired: true });
    expect(evidence.chosenMoments[0].text.length).toBeLessThanOrEqual(1600);
  });

  it("marks an oversized anchor as incomplete instead of implying its missing qualification was checked", () => {
    const transcript = [{ start: 0, end: 100, text: `${"before ".repeat(2000)}THIS MIDDLE QUALIFICATION IS UNSEEN${" after".repeat(2000)}` }];
    const { chosenMoments: [moment] } = JSON.parse(buildCarouselEvidence({ transcript, atSeconds: [50] }));
    expect(moment.text.length).toBeLessThanOrEqual(1600);
    expect(moment.text).not.toContain("THIS MIDDLE QUALIFICATION IS UNSEEN");
    expect(moment.text).toContain("source text omitted");
    expect(moment).toMatchObject({ anchorMatched: true, anchorTruncated: true, sourceCheckRequired: true });
    expect(moment.uncertainty).toContain("may contain a qualification");
  });

  it("does not present a nearby cue across a transcript gap as the selected moment", () => {
    const transcript = [{ start: 0, end: 5, text: "The fix is still planned." }, { start: 15, end: 20, text: "The demo is open." }];
    const { chosenMoments: [moment] } = JSON.parse(buildCarouselEvidence({ transcript, atSeconds: [10] }));
    expect(moment).toMatchObject({ anchorMatched: false, sourceCheckRequired: true });
    expect(moment.text).toContain("Nearby context is not anchor evidence");
    expect(moment.text).toContain("The fix is still planned.");
    expect(moment.text.length).toBeLessThanOrEqual(1600);
  });

  it("keeps the total moment budget when only a small context fragment would fit", () => {
    for (let length = 1460; length <= 1560; length += 1) {
      const transcript = [{ start: 0, end: 10, text: "anchor ".padEnd(length, "x") }, { start: 10, end: 20, text: "nearby ".repeat(400) }];
      const { chosenMoments: [moment] } = JSON.parse(buildCarouselEvidence({ transcript, atSeconds: [5] }));
      expect(moment.text.length).toBeLessThanOrEqual(1600);
      expect(moment.anchorMatched).toBe(true);
      expect(moment.sourceCheckRequired).toBe(true);
    }
  });
});
