import { existsSync } from "node:fs";
import path from "node:path";

export function captionFontsDir(): string | null {
  const dir = path.join(process.cwd(), "public", "fonts", "captions");
  return existsSync(dir) ? dir : null;
}

export function assFilter(assPath: string, escape: (p: string) => string): string {
  const fonts = captionFontsDir();
  return `ass='${escape(assPath)}'${fonts ? `:fontsdir='${escape(fonts)}'` : ""}`;
}
