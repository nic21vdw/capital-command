import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWorkflowJson, workflowLoadMessage } from "./workflow-resource";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("workflow data recovery", () => {
  it("keeps a real empty library distinct from an unavailable library", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ jobs: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadWorkflowJson("/api/clips", "jobs")).rejects.toThrow(
      "HTTP 503",
    );
    await expect(loadWorkflowJson("/api/clips", "jobs")).resolves.toEqual({
      jobs: [],
    });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: "no-store" });
  });

  it("reports HTML error pages and wrong-shaped JSON rather than returning no clips", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>temporarily unavailable</html>"),
      )
      .mockResolvedValueOnce(Response.json({ error: "unavailable" }))
      .mockResolvedValueOnce(Response.json({ jobs: {} }))
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadWorkflowJson("/api/clips", "jobs")).rejects.toThrow(
      "unreadable response",
    );
    await expect(loadWorkflowJson("/api/clips", "jobs")).rejects.toThrow(
      "incomplete workflow data",
    );
    await expect(loadWorkflowJson("/api/clips", "jobs")).rejects.toThrow(
      "incomplete workflow data",
    );
    await expect(loadWorkflowJson("/api/publish/overview")).rejects.toThrow(
      "incomplete workflow data",
    );
  });

  it("cancels a delayed read when the calendar navigates away", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const request = loadWorkflowJson(
      "/api/master-calendar",
      "events",
      controller.signal,
    );
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("bounds a stalled read and gives a retryable timeout explanation", async () => {
    const timeoutController = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutController.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      ),
    );
    const request = loadWorkflowJson("/api/pipeline", "runs");
    timeoutController.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
    expect(workflowLoadMessage(timeoutController.signal.reason)).toContain(
      "timed out",
    );
  });

  it("preserves timeout classification if response-body reading stalls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.reject(new DOMException("Timed out", "TimeoutError")),
      }),
    );
    await expect(
      loadWorkflowJson("/api/pipeline", "runs"),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(workflowLoadMessage(new TypeError("Failed to fetch"))).toContain(
      "could not be reached",
    );
  });
});
