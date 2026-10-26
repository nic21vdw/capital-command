export interface PersonalNavItem {
  href: string;
  label: string;
}

export const PERSONAL_GROUP_LABEL = "Personal";

export const PERSONAL_NAV: PersonalNavItem[] = [{ href: "/finance", label: "Personal Finance" }];

export const PERSONAL_ROUTE_PATHS: readonly string[] = ["/finance", "/holdings", "/watchlist", "/goals"];

export function isPersonalRoute(path: string): boolean {
  const clean = String(path || "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return PERSONAL_ROUTE_PATHS.includes(clean);
}
