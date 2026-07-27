import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

// Entry point auto-detected by the Remotion CLI (`npx remotion preview`,
// `npx remotion render <CompId>`).
registerRoot(RemotionRoot);
