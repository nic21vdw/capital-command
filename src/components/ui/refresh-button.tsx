import type { ButtonHTMLAttributes } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RefreshButton({
  busy = false,
  label = "Refresh",
  disabled,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { busy?: boolean; label?: string }) {
  return (
    <Button variant="secondary" disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      <RefreshCw className={cn("mr-2 h-4 w-4", busy && "animate-spin")} aria-hidden="true" />
      {label}
    </Button>
  );
}
