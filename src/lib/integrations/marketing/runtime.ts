import { createMarketingHttpHandlers, type MarketingHttpDependencies } from "./http";
import { createMarketingResourceHandlers, type MarketingResourceService } from "./resources-http";

type Handlers = ReturnType<typeof createMarketingHttpHandlers> & ReturnType<typeof createMarketingResourceHandlers>;
type MarketingGlobal = typeof globalThis & { __ownerMarketingRuntime?: Handlers };
const state = globalThis as MarketingGlobal;

/**
 * Explicit in-process composition point, never an HTTP operation or env switch.
 * The owning service must supply verified authentication and an approved origin
 * policy. Installing a handler does not create a credential or publication grant.
 */
export function installMarketingRuntime(dependencies: MarketingHttpDependencies & { resources?: MarketingResourceService }): () => void {
  if (state.__ownerMarketingRuntime) throw new Error("A marketing runtime is already installed in this owner process.");
  const handlers = {
    ...createMarketingHttpHandlers(dependencies),
    ...createMarketingResourceHandlers({ authenticate: dependencies.authenticate, service: dependencies.resources ?? {} }),
  };
  state.__ownerMarketingRuntime = handlers;
  return () => { if (state.__ownerMarketingRuntime === handlers) delete state.__ownerMarketingRuntime; };
}

export function marketingRuntime(): Handlers | undefined { return state.__ownerMarketingRuntime; }
