import type { CarouselSlide } from "@/types/domain";

/**
 * Manually authored proof, not model output and not a claimed customer result.
 * Exact source material: CoLateral-AI/apps/web/scripts/home-workspace-scenes.mjs
 * lines 73-92. That file calls its project invented and its agent replies staged.
 * The existing real canvas capture supplies context for slide 2 only.
 */
export const carouselEditorialExample = {
  title: "One launch brief, one useful post",
  source: {
    file: "CoLateral-AI/apps/web/scripts/home-workspace-scenes.mjs:73-92",
    disclosure: "Authored example from a real canvas capture with an invented project and staged agent conversations. No model or publishing action was run.",
    quotes: {
      setting: "Presentations, spreadsheets and documents, each connected to an agent. Bring the whole project into view.",
      story: "Help creative teams turn scattered ideas into a shared plan. Keep the first experience simple and the next step clear.",
      audience: "Small product studios bringing their next idea to market. All figures in the forecast are invented demo assumptions.",
      next: "Review the deck, check the forecast and test the first-run experience. Share the draft for feedback."
    },
    imageSha256: "41e5c5a91ae794177540973e74f7e519ce8284b166016976a01d976d8a8b808b"
  },
  slideEvidence: ["authored brief-to-post example", "setting + audience", "exact story + audience quotes", "exact audience qualification", "suggested instruction from story + audience + next", "authored draft from story + audience + next", "quoted source/draft comparison", "editorial payoff from the demonstrated comparison"],
  slides: [
    { id: "proof-1", heading: "One **Launch Brief**. A Post You Can Use.", body: "An authored example from a staged canvas demo. Follow the source through to the draft." },
    { id: "proof-2", heading: "The **Launch Brief** Is The Source", body: "Real canvas, invented launch project. The document is the source for this post; the forecast beside it is context." },
    { id: "proof-3", heading: "**Source Quote**: Audience And Idea", body: "Audience: “**Small product studios**”. Idea: “turn **scattered ideas** into a **shared plan**.”" },
    { id: "proof-4", heading: "The **Source Limit** Is Explicit", body: "“All figures in the forecast are **invented demo assumptions**.” That rules out a claim about customer performance." },
    { id: "proof-5", heading: "The Instruction Has **A Stopping Point**", body: "Suggested instruction: Draft a short post for small product studios. Use the brief's shared-plan idea and clear next step. Leave demo figures out. Show the draft for review." },
    { id: "proof-6", heading: "Here Is **The Authored Draft**", body: "Small product studio? Turn scattered ideas into a **shared launch plan**. Review the deck, check the forecast and make the **next step clear**." },
    { id: "proof-7", heading: "Check **Source Against Draft**", body: "Audience: source “**Small product studios**” / draft “Small product studio?” Idea: source “**shared plan**” / draft “shared launch plan”. Figures: **omitted**." },
    { id: "proof-8", heading: "Start With **One Brief**. Finish With A Post.", body: "Keep the audience and next step. Leave invented results out. Check the draft against the brief, then decide what to share. Try CoLateral." }
  ] satisfies CarouselSlide[]
};
