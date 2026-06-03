"use client";

import Link from "next/link";
import { useAppData } from "@/components/providers/app-provider";

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProfileBar() {
  const { data } = useAppData();
  const profile = data.settings.profile;
  const displayName = profile?.displayName?.trim();
  const avatar = profile?.avatar;
  const initials = displayName ? initialsFrom(displayName) : "";

  return (
    <div className="mb-4 flex justify-end">
      <Link
        href="/settings"
        aria-label="Open profile settings"
        className="flex items-center gap-3 rounded-full border border-white/10 bg-[var(--panel)] py-1.5 pl-1.5 pr-4 shadow-lg backdrop-blur-sm transition hover:border-white/20"
      >
        <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[var(--accent)] text-sm font-semibold text-[var(--accent-contrast)]">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            initials || "?"
          )}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-medium text-white">{displayName || "Set up profile"}</span>
          <span className="text-xs text-[var(--muted-foreground)]">{displayName ? "View settings" : "Add your name & photo"}</span>
        </span>
      </Link>
    </div>
  );
}
