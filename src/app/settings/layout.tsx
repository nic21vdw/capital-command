import type { ReactNode } from "react";

// The settings page is a client component, which cannot export metadata itself.
export const metadata = { title: "Settings | CoLateral Marketing" };

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
