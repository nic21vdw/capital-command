import type { ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const LOADING_LABEL = "Loading…";

export function LoadingState({ label = LOADING_LABEL, className }: { label?: string; className?: string }) {
  return (
    <p role="status" className={cn("flex items-center gap-2 text-sm text-[var(--muted-foreground)]", className)}>
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      {label}
    </p>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  loading = false,
  loadingLabel,
  className
}: {
  icon: LucideIcon;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      {loading ? (
        <LoadingState label={loadingLabel} />
      ) : (
        <>
          <Icon className="h-8 w-8 text-[var(--accent)]" aria-hidden="true" />
          {title ? <p className="text-base font-semibold text-white">{title}</p> : null}
          {description ? <p className="max-w-md text-sm text-[var(--muted-foreground)]">{description}</p> : null}
          {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
        </>
      )}
    </Card>
  );
}
