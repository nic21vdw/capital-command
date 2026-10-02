/** Accessing the storage property itself can throw in private/embedded browsers. */
export function browserStorage(area: "sessionStorage" | "localStorage"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window[area];
  } catch {
    return null;
  }
}
