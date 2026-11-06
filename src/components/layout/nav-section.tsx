"use client";

import { createContext, useContext } from "react";

export const NavSectionContext = createContext<string | undefined>(undefined);

export function useNavSection(): string | undefined {
  return useContext(NavSectionContext);
}
