import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unavailableWorkspace } from "@/lib/integrations/marketing/contract";
import { GET } from "./workspace/route";
import { POST } from "./operations/route";

describe("disabled marketing connection", () => {
  it("returns a no-store capability response without loading the live ledger", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(unavailableWorkspace());
  });
  it("refuses every operation without a dispatch or false execution claim", async () => {
    const response = POST();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ executed: false, error: { code: "connection_unavailable" } });
  });
  it("keeps the reserved routes free of side-effectful stores, flags and runners", () => {
    for (const file of ["workspace/route.ts", "operations/route.ts"]) {
      const source = readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/(?:from\s+["'][^"']*(?:pipeline\/runs|clipping\/jobs|publisher\/(?:queue|enqueue|runner))|process\.env|fetch\s*\(|readFile)/);
    }
  });
});
