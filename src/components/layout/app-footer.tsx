/**
 * Drawn from the first paint. The footer is the last thing in the column, so
 * while a screen is still filling in it would sit near the top and then be
 * thrown off the bottom. `AppShell` stops that from the other side: the page
 * wrapper is at least one viewport tall, so the footer starts below the fold
 * and a growing page pushes it further down without anything visible moving.
 */
export function AppFooter() {
  return (
    <footer className="mt-10 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted-foreground)]">
      CoLateral Marketing runs on this computer. Keep it open for scheduled posts to go out.
    </footer>
  );
}
