import path from "node:path";
import { defineConfig } from "vitest/config";

const CANVAS_SPECS = [
  "src/lib/carousels/pdf.test.ts",
  "src/lib/carousels/renderDeck.test.ts",
  "src/lib/pipeline/visual-ad-render.test.ts"
];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    maxWorkers: 1,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/node_modules/**", ...CANVAS_SPECS],
          pool: "threads"
        }
      },
      {
        extends: true,
        test: {
          name: "canvas",
          include: CANVAS_SPECS,
          pool: "forks"
        }
      }
    ]
  }
});
