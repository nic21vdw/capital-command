import type { XPostFormat } from "@/types/domain";

/**
 * Built-in idea library for the Threads daily planner. Used as the fallback
 * when ANTHROPIC_API_KEY isn't configured (or the AI call fails) so the tool
 * still produces a full, on-brand pack every day. Entries are written in the
 * positioning-brief voice: structural EIT building CoLateral AI, focused on
 * verification, judgment, and professional AI workflows — without pitching
 * CoLateral in every post.
 *
 * Every entry holds the same two versions the generator writes, to the same
 * contract (see generator.ts): `text` is the punchy one, 150-260 characters,
 * and `threadsVariant` is the warm retelling at 300-450, clearly longer and
 * reworded from its first words on. Two connected accounts post one version
 * each, so a variant that merely pads its punchy twin puts near-identical
 * wording on both feeds — which is the mirrored-spam read the pair exists to
 * avoid. A fallback pack has to hold that line too.
 */

export interface LibraryPost {
  format: XPostFormat;
  topic: string;
  text: string;
  threadsVariant: string;
}

export interface LibraryReply {
  scenario: string;
  text: string;
}

export const POST_LIBRARY: LibraryPost[] = [
  {
    format: "insight",
    topic: "verification over volume",
    text: "The bottleneck in AI-assisted engineering isn't generation speed. It's how fast a qualified human can verify the output. Optimize the review loop and the generation speed actually starts to matter.",
    threadsVariant: "Everyone benchmarks how fast their AI generates. Almost nobody measures how fast a qualified human can verify what came back. The second number is the one that decides whether the first one means anything, because output nobody has checked isn't finished work, it's a queue. Once I started treating review throughput as the real constraint, generation speed finally began to pay off."
  },
  {
    format: "contrarian",
    topic: "code is getting cheap",
    text: "Unpopular take from someone who writes code with agents daily: the cheaper code gets, the more expensive good problem definition becomes. Most teams are staffed for the old ratio.",
    threadsVariant: "Writing code with agents every day has changed how I think about staffing. The cheaper generation gets, the more expensive a clear problem definition becomes, because an agent will happily build the wrong thing perfectly. Most teams are still organised for the old ratio: plenty of hands to produce, almost nobody whose actual job is deciding what should exist in the first place."
  },
  {
    format: "observation",
    topic: "agents and review load",
    text: "Ran multiple coding agents in parallel this week. Output went up 4x. My review load went up more than 4x, because the diffs no longer shared context. Parallelism is free; coherence isn't.",
    threadsVariant: "Ran several coding agents in parallel this week and the output climbed sharply. My review load climbed faster, because the diffs no longer shared any context with each other. Each one was sensible on its own and the set was inconsistent. Parallelism is essentially free; coherence isn't, and nobody prices the coordination tax until they are already paying it."
  },
  {
    format: "insight",
    topic: "vertical AI",
    text: "AI tools win in regulated industries when they understand the review process, not just the calculation. Anyone can compute a moment. The product is knowing who has to sign off on it and what they need to see.",
    threadsVariant: "In a regulated industry the calculation itself is a commodity. Any competent tool can compute a moment. What is hard to copy is the review process around it: who signs, what they check before they sign, and what evidence has to be in front of them when they do. Build for the sign-off and the arithmetic becomes a detail rather than the product."
  },
  {
    format: "story",
    topic: "assumptions in engineering AI",
    text: "A structural model is only as good as its assumptions, and the failure mode of AI in engineering is that it buries them. I've started forcing every AI-generated calc to print its assumptions first. Review time dropped by half.",
    threadsVariant: "A structural model is only ever as good as its assumptions, and the specific failure mode of AI in engineering is that it buries them under an answer that looks finished. So I started forcing every generated calc to state its assumptions before its results. The numbers didn't improve. My ability to check them in a single pass did, and review time dropped by half."
  },
  {
    format: "framework",
    topic: "trust boundaries for agents",
    text: "My rule for agent autonomy: an agent can act alone anywhere a mistake is cheap to detect and cheap to reverse. Everything else gets a human gate. Simple test, and it kills most of the 'full autonomy' debate.",
    threadsVariant: "My whole rule for agent autonomy fits in one test: is a mistake cheap to detect, and cheap to reverse? Where both hold, let the agent act alone. You will catch and undo the misses for less than the supervision would have cost. Where either fails, put a human gate in front of it. That one question settles most of the full-autonomy argument before it starts."
  },
  {
    format: "question",
    topic: "judgment as the bottleneck",
    text: "Genuine question for people shipping with coding agents: what's your actual bottleneck now? Mine stopped being code months ago. It's deciding what's worth building and verifying what came back.",
    threadsVariant: "Genuine question for anyone shipping with coding agents daily: what is your actual bottleneck now? Mine stopped being code months ago. It is deciding what is worth building in the first place, and then verifying what came back well enough that I would stand behind it. Curious whether that is where everyone else has landed, or whether generation still binds for you."
  },
  {
    format: "insight",
    topic: "harness over model",
    text: "The model is 20% of an AI product in a professional domain. The other 80% is the harness: constraints, assumptions, traceability, and a verification path a reviewer will actually accept.",
    threadsVariant: "In a professional domain the model is a fifth of the product at most. The rest is the harness around it: the constraints it has to respect, the assumptions it has to declare, the trail it leaves behind, and a verification path a reviewer will actually accept. Swap the model and the product survives. Remove the harness and there is nothing left to sign."
  },
  {
    format: "observation",
    topic: "vibe coding maturity",
    text: "Vibe coding got me a working prototype in a weekend. Getting that prototype to something I'd let a colleague depend on took three weeks of tests, edge cases, and tearing out clever code. Both phases were necessary. Only one was fun.",
    threadsVariant: "Vibe coding got me a working prototype over a weekend. Turning that prototype into something I would let a colleague depend on took three more weeks of tests, edge cases, and tearing out code that was clever rather than clear. Both phases were necessary and only one was fun. The distance between a demo and something dependable is where the engineering actually lives."
  },
  {
    format: "contrarian",
    topic: "output metrics",
    text: "Lines of AI-generated code is a vanity metric. Unvalidated output is inventory, not progress — and inventory you can't inspect quickly is a liability, not an asset.",
    threadsVariant: "Counting the lines your AI wrote is a vanity metric. Output you haven't validated isn't progress, it is inventory, and inventory you cannot inspect quickly is a liability rather than an asset. The number worth reporting is how much of it a qualified reviewer has accepted, because that is the only part anyone can safely build on top of."
  },
  {
    format: "insight",
    topic: "traceability",
    text: "Engineers don't fear AI because it's wrong sometimes. They fear it because when it's wrong, there's no trail explaining why it decided what it decided. Traceability is a feature you design in, not a disclaimer you bolt on.",
    threadsVariant: "Engineers are not afraid of AI because it is occasionally wrong. Every tool they use is occasionally wrong. They are afraid because when it is wrong there is no trail explaining how it got there, nothing to inspect, correct or defend afterwards. Traceability is something you design into the system on day one, not a disclaimer you attach to the output at the end."
  },
  {
    format: "story",
    topic: "building without a software team",
    text: "I'm a structural EIT building production software with AI agents and no dev team. The surprise isn't that it's possible. It's that the hard parts are the same ones real software teams have: scope, review, and knowing when to stop.",
    threadsVariant: "I am a structural EIT building production software with AI agents and no development team behind me. The surprise isn't that it is possible. It is that the hard parts turned out to be the same ones real software teams wrestle with: scope, review discipline, and knowing when a thing is finished. None of those got easier just because the code got cheap."
  },
  {
    format: "framework",
    topic: "acceptance criteria for agents",
    text: "Before handing work to an agent, write the acceptance test first — even two sentences. If you can't state what 'done and correct' looks like, the agent can't hit it and you can't check it. Most 'AI failed' stories start here.",
    threadsVariant: "The habit that fixed most of my agent failures: write the acceptance test before the prompt, even if it is only two sentences. If you cannot state what done and correct looks like, the agent has nothing to aim at and you have nothing to check against. Most of the AI-failed stories I hear start exactly there, with a standard that was never written down."
  },
  {
    format: "observation",
    topic: "context engineering",
    text: "Watching people blame the model for failures that are really context failures. Same model, same task: curated context succeeds, dumped context fails. Context engineering is unglamorous and it's most of the job.",
    threadsVariant: "A lot of what gets reported as the model failing is really the context failing. Same model, same task: curate what goes in and it succeeds, dump everything in and it doesn't. Choosing what the model should and should not see is unglamorous work with no demo value, and it is most of the job now. Nobody is going to make a launch video about it."
  },
  {
    format: "question",
    topic: "AI in professional workflows",
    text: "If an AI tool produced a result that a professional had to legally sign off on, what would it need to show them? That question generates a better product spec than any feature brainstorm I've run.",
    threadsVariant: "A product exercise that keeps paying off: assume your AI's output has to be signed by a professional who is personally liable for it. What does the screen have to show them before they will sign? Answer that honestly and you have written a better spec than any feature brainstorm will produce, because you started from what makes the output usable at all."
  },
  {
    format: "insight",
    topic: "uncertainty exposure",
    text: "A professional-grade AI system should get more visibly uncertain as inputs leave its validated envelope. Confidence that doesn't degrade with distance from known territory isn't confidence — it's a hazard.",
    threadsVariant: "Trustworthy engineering AI has one defining behaviour: it gets visibly less certain as its inputs drift away from the territory it was validated on. Confidence that stays flat however far you push it isn't confidence, it is a hazard: the system has no way to tell you it is out of its depth. Degrading honestly at the edges is a design requirement, not a polish item."
  },
  {
    format: "contrarian",
    topic: "prototypes vs production",
    text: "Hot take: the gap between an AI demo and a production system hasn't shrunk with better models. It's grown — because demos got easier faster than verification did.",
    threadsVariant: "The gap between an AI demo and a production system hasn't shrunk as models improved. It has grown. Better models made demos dramatically easier while verification got easier much more slowly, so the distance between what you can show and what you can responsibly ship is wider now than it was two years ago. Each release widens it again."
  },
  {
    format: "story",
    topic: "review discipline",
    text: "Caught an agent-written function this week that passed every test and was still wrong — it optimized a quantity we never actually constrain in practice. Tests check what you thought of. Review catches what you didn't.",
    threadsVariant: "An agent handed me a function this week that passed the entire suite and was still wrong: it optimised a quantity we never constrain in practice. Nothing in those tests could have caught it, because tests only cover what somebody already thought of. Review exists for everything nobody thought of, which is why it is the wrong step to compress."
  },
  {
    format: "framework",
    topic: "responsibility boundaries",
    text: "Every AI workflow needs one sentence answered in writing: when this output is wrong, who owns it? If the answer is unclear, you don't have a workflow — you have a liability with a UI.",
    threadsVariant: "There is one sentence every AI workflow has to answer in writing before it ships: when this output is wrong, who owns it? Not who operates the tool, who owns the consequence. If nobody can answer without hedging, what you have isn't a workflow, it is a liability with a good interface, and it stays one until somebody's name is attached to the result."
  },
  {
    format: "observation",
    topic: "agentic engineering practice",
    text: "Six months of agentic engineering taught me to spend my effort at the edges: sharper problem statements going in, harder verification coming out. The middle — the generation — needs me less every month.",
    threadsVariant: "Six months of working this way taught me to spend my effort at the two edges: a sharper problem statement going in, harder verification coming out. The middle, the generation itself, asks less of me every month. What still needs judgment is exactly what was always hard about engineering. The work moved outward rather than disappearing."
  },
  {
    format: "insight",
    topic: "small tools, deep workflow",
    text: "The best vertical AI products I've seen are embarrassingly narrow. They do one workflow completely — intake to review to sign-off — instead of ten workflows at demo depth.",
    threadsVariant: "The best vertical AI products I have seen are embarrassingly narrow. They take one workflow and do the whole of it, intake through review to sign-off, rather than ten workflows at demo depth. Narrow reads as unambitious in a pitch, and it is the only shape that survives contact with people who have to answer for the output."
  },
  {
    format: "question",
    topic: "engineers learning AI tooling",
    text: "For engineers in traditional disciplines: what finally made AI tools click for you? For me it was treating the agent like a fast junior with no memory — great output if the handoff is great, chaos otherwise.",
    threadsVariant: "For engineers coming from traditional disciplines: what finally made these tools click for you? The unlock for me was treating the agent as a very fast junior with no memory between sessions. Brief it properly and the output is genuinely good. Assume it remembers yesterday and you get chaos. Nearly everything came down to the quality of the handoff."
  },
  {
    format: "contrarian",
    topic: "moats in AI",
    text: "Your prompt isn't a moat. Your model choice isn't a moat. The verification workflow your customers' regulators already trust? That's starting to look like one.",
    threadsVariant: "Your prompt isn't a moat; anyone can rewrite it in an afternoon. Your model choice isn't one either, since it will change in a few months whether you want it to or not. A verification workflow that your customers' regulators already accept is slow to build, slow to copy and hard to argue with. That is the closest thing to defensible I have seen in vertical AI."
  },
  {
    format: "story",
    topic: "documentation as leverage",
    text: "Started making my agents write the decision log before the code: what was assumed, what was rejected, why. The code quality didn't change much. My ability to review it changed completely.",
    threadsVariant: "I started making my agents write the decision log before the code: what they assumed, what they rejected, and why. The code itself didn't get noticeably better. My ability to review it changed completely, because I could read the reasoning instead of reconstructing it from a diff. Writing the thinking down turned out to be the cheap half of the work."
  },
  {
    format: "insight",
    topic: "human review scaling",
    text: "Teams adopting agents discover a new law: review capacity is fixed while generation capacity is elastic. Every process improvement that matters from here is really a review-throughput improvement.",
    threadsVariant: "Teams adopting agents run into the same law: generation capacity is elastic and review capacity isn't, because review is people. You can double output this afternoon. You cannot double judgment. From here almost every process improvement that genuinely matters is a review-throughput improvement wearing a different name."
  },
  {
    format: "observation",
    topic: "engineering culture and AI",
    text: "Structural engineering solved 'unreliable individual output' a century ago: independent checks, sealed drawings, defined responsibility. AI software is slowly reinventing that system and calling it novel.",
    threadsVariant: "Structural engineering solved unreliable individual output about a century ago, and the solution was not better individuals: independent checks, sealed drawings, documented assumptions, and a name attached to the responsibility. AI software is slowly reinventing that same system and describing it as novel. The playbook exists, just not in software vocabulary."
  },
  {
    format: "framework",
    topic: "when to automate",
    text: "Three questions before automating any professional task: Can we detect a bad output? Can we afford the worst plausible one? Does a human still learn enough to stay competent at checking? Two yeses isn't enough.",
    threadsVariant: "Three questions before automating a professional task. Can we detect a bad output? Can we afford the worst plausible one? And does the human stay involved enough to remain competent at checking it? Two yeses is not a pass. The third question is the one people skip, and it is the one that bills you a year later when nobody can catch the tool any more."
  },
  {
    format: "insight",
    topic: "specification is the work",
    text: "Writing software with agents made one thing obvious: the specification was always the hard part. We just couldn't see it before, because typing the code hid the thinking time.",
    threadsVariant: "Building software with agents made something obvious that was always true: the specification was the hard part all along. Typing the code took long enough to hide the thinking inside it, so the thinking never got measured separately. Take the typing away and a vague idea has nowhere left to hide. Agents didn't remove the difficulty, they exposed where it lives."
  },
  {
    format: "question",
    topic: "verification tooling gap",
    text: "We have a thousand tools for generating code with AI and maybe five serious ones for verifying it. Where's the disproportionate effort going, and why isn't it the other way around?",
    threadsVariant: "By rough count there are a thousand tools for generating code with AI and maybe five serious ones for verifying it. That ratio is backwards relative to where the bottleneck sits, and not because verification is solved. It is because generation demos well and review doesn't. Whoever closes that asymmetry is sitting on a real business."
  },
  {
    format: "observation",
    topic: "shipping cadence",
    text: "Shipping something small every day with agents beats shipping something big every month — not for the output, but because daily contact keeps your judgment about the tools current. The tools change monthly; stale judgment is expensive.",
    threadsVariant: "There is a reason I ship daily with agents even when the change is tiny, and it isn't the output. Daily contact is what keeps your judgment about the tools current: they change monthly, and an opinion formed in spring is stale by summer. Stale judgment about your own tools costs more than a slower release schedule ever will."
  }
];

export const REPLY_LIBRARY: LibraryReply[] = [
  {
    scenario: "Someone ships an impressive AI-built demo",
    text: "Impressive build. The question I'd love a follow-up post on: what did it take to verify it does the right thing outside the happy path? That's the part most demos never show and always dominates the timeline."
  },
  {
    scenario: "Hot take that AI will replace engineers",
    text: "It replaces the typing, not the accountability. Someone still has to define the problem, own the assumptions, and sign for the result when it's wrong. That role gets more valuable as output gets cheaper, not less."
  },
  {
    scenario: "Someone asks how to get started with Claude Code / coding agents",
    text: "Start with a task where you can verify the result quickly — a script you can run, a page you can see. The skill you're building isn't prompting, it's writing acceptance criteria and reviewing diffs fast."
  },
  {
    scenario: "Thread about agents producing huge amounts of code",
    text: "Volume is the easy axis now. The number I'd track is verified output per reviewer-hour — that's the constraint that decides whether 10x generation is 10x progress or 10x backlog."
  },
  {
    scenario: "Someone frustrated their agent keeps getting things wrong",
    text: "Worth checking whether it's a model problem or a handoff problem. When I state the acceptance criteria and constraints up front, failure rates drop dramatically. Agents fail loudest where the spec was silently missing."
  },
  {
    scenario: "Post about AI in regulated/professional industries",
    text: "The underrated hard part in regulated domains: the tool has to fit the review process, not just do the calculation. Whoever models the sign-off workflow — assumptions, traceability, responsibility — wins that vertical."
  },
  {
    scenario: "Debate about full agent autonomy",
    text: "The autonomy debate gets simpler with one test: is a mistake cheap to detect and cheap to reverse? Where both are true, autonomy is fine today. Where either fails, you want a human gate regardless of how good the model is."
  },
  {
    scenario: "Someone shares a vibe-coding success story",
    text: "The weekend-prototype phase is genuinely magical. The interesting part is what happened next — hardening it to something others can depend on is where I've found the real lessons (and most of the hours) live."
  },
  {
    scenario: "Post about prompt engineering tips",
    text: "The highest-leverage 'prompt technique' I know isn't phrasing — it's context selection. Same request with curated context beats a clever prompt with a context dump almost every time."
  },
  {
    scenario: "Someone claims a metric like '90% of our code is AI-written'",
    text: "The companion stat that would make this meaningful: what share of it was verified, and by what process? Unvalidated generation is inventory, not progress — the verification rate is the real headline."
  },
  {
    scenario: "Discussion about AI hallucinations in serious applications",
    text: "The failure that worries me more than hallucination is silent assumption-making. A wrong answer flagged as uncertain is manageable; a confident answer resting on a buried assumption is how professional workflows actually get burned."
  },
  {
    scenario: "Someone asks what skills matter in the AI era",
    text: "Problem definition and verification. Generation sits between them and it's the part getting automated. If you can state what 'correct' looks like and check it efficiently, every model improvement works for you."
  },
  {
    scenario: "Post about multi-agent / parallel agent workflows",
    text: "Parallel agents multiplied my output and my review load — the diffs stop sharing context, so coherence becomes the tax. Explicit design intent and acceptance criteria per agent was the only thing that kept it net positive."
  },
  {
    scenario: "Someone laments that software craftsmanship is dying",
    text: "The craft is relocating, not dying. Less of it in the keystrokes, more in problem framing, review judgment, and knowing what not to build. Those were always the scarce parts — they're just visible now."
  },
  {
    scenario: "Post comparing AI models or benchmarks",
    text: "Benchmarks tell you about the model; your harness decides the outcome. I've had the 'weaker' model win in practice because the workflow around it enforced assumptions and verification. The delta between models is smaller than the delta between harnesses."
  },
  {
    scenario: "Someone building a solo business with AI tools",
    text: "Building solo with agents here too. The counterintuitive lesson: the discipline a team would force on you — reviews, scope control, written decisions — you have to impose on yourself, or the speed just produces mess faster."
  },
  {
    scenario: "Post about AI making mistakes in production",
    text: "The instructive question after these incidents is rarely 'why was the model wrong' — it's 'why did the workflow have no cheap way to catch it.' Models will always have an error rate; systems decide whether it's survivable."
  },
  {
    scenario: "Someone asks whether non-developers can really build software now",
    text: "Yes, with an asterisk: building the first version is now accessible; owning it — debugging, verifying, deciding tradeoffs — still demands real judgment. Domain experts have an edge there people underestimate: they know what correct looks like."
  },
  {
    scenario: "Discussion about technical debt from AI code",
    text: "AI code debt has a specific flavor: it's coherent locally and inconsistent globally, because each generation lacked memory of the last. Conventions written down and enforced in review are the cheapest fix I've found."
  },
  {
    scenario: "Post about the future of professional engineering work",
    text: "Traditional engineering already solved unreliable output a century ago: independent checks, documented assumptions, defined responsibility. The disciplines that adapt fastest to AI will be the ones that recognize they already own the playbook."
  },
  {
    scenario: "Someone shows off automating their whole workflow",
    text: "Nice system. One thing worth stress-testing: when a step silently fails, how do you find out? Every automation I've kept long-term earned it by failing loudly, not by working impressively."
  },
  {
    scenario: "Post about context windows / long context",
    text: "Bigger windows raised the ceiling but didn't change the principle: relevance beats volume. A curated 10k of context still outperforms an indiscriminate 200k dump in my experience — attention is a budget whether or not the window fits."
  },
  {
    scenario: "Someone asks if they should learn to code in 2026",
    text: "Learn it — but the payoff changed. You're not learning to type syntax, you're learning to read systems, judge correctness, and direct tools that write the syntax for you. That literacy compounds with every model release."
  },
  {
    scenario: "Post about evaluation / evals for AI systems",
    text: "Evals are where AI products quietly become real. The teams I see succeed treat them like engineering acceptance tests: written before the feature, tied to actual failure costs, and owned by someone accountable for the result."
  },
  {
    scenario: "Founder describes struggling to sell AI into an old-school industry",
    text: "Selling into conservative industries usually stalls on trust mechanics, not features: show how your tool preserves their assumptions, exposes uncertainty, and fits their existing review chain. The buyer isn't resisting AI — they're protecting a sign-off they're liable for."
  },
  {
    scenario: "Someone posts about a big AI model release",
    text: "The capability jump is real, but the binding constraint for most teams hasn't moved: verifying output still costs human judgment. Each release widens the gap between what we can generate and what we can responsibly accept."
  },
  {
    scenario: "Post about developers reviewing AI code poorly / rubber-stamping",
    text: "Rubber-stamping is a workflow smell, not a character flaw — it means review is priced at zero in the process. Making verification a first-class task with time and credit attached fixes more than exhortations to 'review carefully' ever will."
  },
  {
    scenario: "Someone asks what to build as their first AI product",
    text: "Pick a workflow you personally know end-to-end, ideally one with a review or sign-off step others find tedious. Depth in one real workflow beats breadth every time — and your judgment about 'correct' is the actual product."
  }
];
