import { PERSONAL_ROUTE_PATHS } from "./personal-routes";

export type Edition = "owner" | "public";

export const EDITION = "owner" as Edition;

export const OWNER_ONLY_ROUTE_PATHS: readonly string[] = [...PERSONAL_ROUTE_PATHS, "/presentation", "/listening", "/outreach"];

export function isPublicEdition(edition: Edition = EDITION): boolean {
  return edition === "public";
}

export function isRouteShipped(path: string, edition: Edition = EDITION): boolean {
  if (!isPublicEdition(edition)) return true;
  const clean = String(path || "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return !OWNER_ONLY_ROUTE_PATHS.includes(clean);
}
