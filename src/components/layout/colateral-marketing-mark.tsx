import { cn } from "@/lib/utils";

const BEAMY_PIXELS: Array<[string, string]> = [
  ["var(--beamy-mark-hi,#5eb2f2)", "M8 18h2v1h-2z"],
  ["var(--beamy-mark-body,#0078d4)", "M6 19h3v2h-3z"],
  ["var(--beamy-mark-hi,#5eb2f2)", "M6 19h3v1h-3z"],
  ["var(--beamy-mark-body,#0078d4)", "M22 18h2v1h-2zM23 19h3v2h-3z"],
  ["var(--beamy-mark-shadow,#005a9e)", "M23 20h3v1h-3z"],
  ["var(--beamy-mark-body,#0078d4)", "M6 12h20v3h-20zM10 15h12v9h-12zM6 24h20v2h-20z"],
  ["var(--beamy-mark-hi,#5eb2f2)", "M6 12h20v1h-20zM10 15h1v9h-1zM6 24h20v1h-20z"],
  ["var(--beamy-mark-shadow,#005a9e)", "M21 15h1v9h-1zM25 12h1v3h-1zM6 25h20v1h-20zM11 26h3v1h-3zM10 27h3v1h-3zM18 26h3v1h-3zM19 27h3v1h-3z"],
  ["var(--beamy-mark-hat,#ffffff)", "M13 6h6v1h-6zM12 7h8v1h-8zM11 8h10v1h-10zM11 9h10v1h-10zM11 10h10v1h-10z"],
  ["var(--beamy-mark-hatsh,#a8c4de)", "M18 6h1v1h-1zM19 7h1v1h-1zM20 8h1v3h-1z"],
  ["var(--beamy-mark-hat,#ffffff)", "M9 11h14v1h-14z"],
  ["var(--beamy-mark-hatsh,#a8c4de)", "M9 12h14v1h-14z"],
  ["var(--beamy-mark-ink,#102a43)", "M13 17h2v2h-2zM17 17h2v2h-2zM13 20h1v1h-1zM18 20h1v1h-1zM14 21h4v1h-4z"]
];

export function BeamBuddyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className={cn("h-5 w-5 shrink-0", className)}>
      <rect width="40" height="40" rx="9" fill="var(--beamy-mark-plate,rgba(0,120,212,.14))" />
      <g transform="translate(20 20) scale(1.65) translate(-16 -17)" shapeRendering="crispEdges">
        {BEAMY_PIXELS.map(([fill, d], index) => (
          <path key={index} fill={fill} d={d} />
        ))}
      </g>
    </svg>
  );
}

export function ColateralMarketingMark({
  collapsed = false,
  className
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("colateral-marketing-mark inline-flex items-center gap-2", className)} aria-label="CoLateral Marketing">
      <BeamBuddyMark className="h-6 w-6" />
      <span className={cn("text-[15px] font-extrabold tracking-[-0.04em] text-[var(--foreground)]", collapsed && "sr-only")}>
        Co<span className="text-[var(--accent)]">Lateral</span>
        <span className="ml-1.5 font-semibold tracking-[-0.02em] text-[var(--muted-foreground)]">Marketing</span>
      </span>
    </span>
  );
}
