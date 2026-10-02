/** Read workflow data without mistaking an unavailable server for an empty library. */
export async function loadWorkflowJson<T>(
  url: string,
  collectionKey?: string,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(url, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok)
    throw new Error(`The server returned HTTP ${response.status}.`);
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    )
      throw error;
    throw new Error("The server returned an unreadable response.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (collectionKey &&
      !Array.isArray((value as Record<string, unknown>)[collectionKey]))
  ) {
    throw new Error("The server returned incomplete workflow data.");
  }
  return value as T;
}

export function workflowLoadMessage(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError")
    return "The request timed out. Check your connection and try again.";
  if (error instanceof TypeError)
    return "CoLateral could not be reached. Check your connection and try again.";
  return error instanceof Error
    ? error.message
    : "The data could not be loaded. Try again.";
}
