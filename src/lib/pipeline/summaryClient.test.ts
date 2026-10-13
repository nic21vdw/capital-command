import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared pipeline summary read", () => {
  it("shares an active request but allows a fresh read after timeout", async () => {
    vi.resetModules();
    let reject!: (error: Error) => void;
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise<Response>((_resolve, fail) => { reject = fail; });
    });
    const timeout = vi.fn(() => new AbortController().signal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(timeout);
    vi.stubGlobal("fetch", fetchMock);
    const { readPipelineSummary } = await import("./summaryClient");
    const first = readPipelineSummary();
    expect(readPipelineSummary()).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(signal).toBeDefined();
    reject(new DOMException("Timed out", "TimeoutError"));
    expect(await first).toBeNull();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ needsAttention: 2 })));
    expect(await readPipelineSummary()).toEqual({ needsAttention: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("releases the request slot after HTTP and JSON failures", async () => {
    vi.resetModules();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("offline", { status: 503 }))
      .mockResolvedValueOnce(new Response("not json"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ streams: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const { readPipelineSummary } = await import("./summaryClient");
    expect(await readPipelineSummary()).toBeNull();
    expect(await readPipelineSummary()).toBeNull();
    expect(await readPipelineSummary()).toEqual({ streams: [] });
  });
});
