export function AppFooter() {
  return (
    <footer className="mt-10 flex flex-col gap-1.5 border-t border-white/8 pt-6 text-sm text-[var(--muted-foreground)] sm:flex-row sm:items-baseline sm:justify-between">
      <span className="font-medium text-white/80">Capital Command — one stream in, every format out.</span>
      <span className="text-xs">Stream clips are generated locally and saved on this computer for review, editing, and export.</span>
    </footer>
  );
}
