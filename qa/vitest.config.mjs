import path from "node:path";
import ts from "typescript";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: false,
  plugins: [{
    name: "isolated-typescript-transpile",
    enforce: "pre",
    transform(code, id) {
      if (!/\.[cm]?tsx?(?:\?|$)/.test(id) || id.includes("node_modules")) return null;
      const result = ts.transpileModule(code, {
        fileName: id.split("?")[0],
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
          sourceMap: true,
          esModuleInterop: true
        }
      });
      return { code: result.outputText, map: result.sourceMapText };
    }
  }],
  resolve: { preserveSymlinks: true, alias: { "@": path.resolve(process.cwd(), "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: [path.resolve(process.cwd(), "vitest.setup.ts")],
    pool: "threads",
    maxWorkers: 1,
    deps: { optimizer: { ssr: { enabled: false }, web: { enabled: false } } }
  }
});
