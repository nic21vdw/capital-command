import type { XPostFormat } from "@/types/domain";

/**
 * Built-in idea library for the X/Threads daily planner. Used as the fallback
 * when ANTHROPIC_API_KEY isn't configured (or the AI call fails) so the tool
 * still produces a full, on-brand pack every day. Entries are written in the
 * positioning-brief voice: structural EIT building CoLateral AI, focused on
 * verification, judgment, and professional AI workflows — without pitching
 * CoLateral in every post.
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
    threadsVariant: "Everyone measures how fast AI generates. Almost nobody measures how fast a qualified human can verify the output. The second number is the one that decides whether the first one matters."
  },
  {
    format: "contrarian",
    topic: "code is getting cheap",
    text: "Unpopular take from someone who writes code with agents daily: the cheaper code gets, the more expensive good problem definition becomes. Most teams are staffed for the old ratio.",
    threadsVariant: "Code generation keeps getting cheaper. Problem definition keeps getting more valuable. Most orgs still hire like it's the other way around."
  },
  {
    format: "observation",
    topic: "agents and review load",
    text: "Ran multiple coding agents in parallel this week. Output went up 4x. My review load went up more than 4x, because the diffs no longer shared context. Parallelism is free; coherence isn't.",
    threadsVariant: "Parallel agents multiply output, but they multiply review load faster — each diff loses shared context. The coordination tax is real and nobody prices it in."
  },
  {
    format: "insight",
    topic: "vertical AI",
    text: "AI tools win in regulated industries when they understand the review process, not just the calculation. Anyone can compute a moment. The product is knowing who has to sign off on it and what they need to see.",
    threadsVariant: "In regulated industries, the calculation is commodity. The moat is modeling the review process — who signs, what they check, what evidence they need in front of them."
  },
  {
    format: "story",
    topic: "assumptions in engineering AI",
    text: "A structural model is only as good as its assumptions, and the failure mode of AI in engineering is that it buries them. I've started forcing every AI-generated calc to print its assumptions first. Review time dropped by half.",
    threadsVariant: "Small habit that changed my AI workflow: every generated calc has to state its assumptions before its results. Buried assumptions are where engineering AI quietly goes wrong."
  },
  {
    format: "framework",
    topic: "trust boundaries for agents",
    text: "My rule for agent autonomy: an agent can act alone anywhere a mistake is cheap to detect and cheap to reverse. Everything else gets a human gate. Simple test, and it kills most of the 'full autonomy' debate.",
    threadsVariant: "Where should agents act alone? My test: is a mistake cheap to detect AND cheap to reverse? Yes to both — automate it. Either no — put a human gate in front of it."
  },
  {
    format: "question",
    topic: "judgment as the bottleneck",
    text: "Genuine question for people shipping with coding agents: what's your actual bottleneck now? Mine stopped being code months ago. It's deciding what's worth building and verifying what came back.",
    threadsVariant: "For those building with coding agents daily — what's your real bottleneck now? Mine is no longer writing code. It's choosing what to build and checking what I get back."
  },
  {
    format: "insight",
    topic: "harness over model",
    text: "The model is 20% of an AI product in a professional domain. The other 80% is the harness: constraints, assumptions, traceability, and a verification path a reviewer will actually accept.",
    threadsVariant: "Professional-grade AI products are mostly not the model. They're the harness around it — constraints, traceability, and a verification path a real reviewer will sign off on."
  },
  {
    format: "observation",
    topic: "vibe coding maturity",
    text: "Vibe coding got me a working prototype in a weekend. Getting that prototype to something I'd let a colleague depend on took three weeks of tests, edge cases, and tearing out clever code. Both phases were necessary. Only one was fun.",
    threadsVariant: "Weekend: vibe-coded a working prototype. Next three weeks: tests, edge cases, deleting clever code so a colleague could depend on it. The gap between demo and dependable is the actual work."
  },
  {
    format: "contrarian",
    topic: "output metrics",
    text: "Lines of AI-generated code is a vanity metric. Unvalidated output is inventory, not progress — and inventory you can't inspect quickly is a liability, not an asset.",
    threadsVariant: "AI output you haven't validated isn't progress, it's inventory. And inventory you can't inspect quickly is a liability sitting on your balance sheet."
  },
  {
    format: "insight",
    topic: "traceability",
    text: "Engineers don't fear AI because it's wrong sometimes. They fear it because when it's wrong, there's no trail explaining why it decided what it decided. Traceability is a feature you design in, not a disclaimer you bolt on.",
    threadsVariant: "The scary part of AI in engineering isn't occasional wrongness — it's wrongness with no decision trail. Traceability has to be designed in from day one, not disclaimed at the end."
  },
  {
    format: "story",
    topic: "building without a software team",
    text: "I'm a structural EIT building production software with AI agents and no dev team. The surprise isn't that it's possible. It's that the hard parts are the same ones real software teams have: scope, review, and knowing when to stop.",
    threadsVariant: "Building real software solo with AI agents, as a structural engineer. The surprise: the hard parts aren't technical. They're scope, review discipline, and knowing when to stop — same as any software team."
  },
  {
    format: "framework",
    topic: "acceptance criteria for agents",
    text: "Before handing work to an agent, write the acceptance test first — even two sentences. If you can't state what 'done and correct' looks like, the agent can't hit it and you can't check it. Most 'AI failed' stories start here.",
    threadsVariant: "Rule that fixed most of my agent failures: write the acceptance criteria before the prompt. If you can't define done-and-correct in two sentences, no agent can hit it and no reviewer can verify it."
  },
  {
    format: "observation",
    topic: "context engineering",
    text: "Watching people blame the model for failures that are really context failures. Same model, same task: curated context succeeds, dumped context fails. Context engineering is unglamorous and it's most of the job.",
    threadsVariant: "Most 'the model failed' cases I see are context failures. Same model, same task — curated context wins, dumped context loses. Unsexy, but context engineering is the job now."
  },
  {
    format: "question",
    topic: "AI in professional workflows",
    text: "If an AI tool produced a result that a professional had to legally sign off on, what would it need to show them? That question generates a better product spec than any feature brainstorm I've run.",
    threadsVariant: "Product exercise: your AI's output needs a professional's legal signature. What does the screen have to show them? Answering that honestly writes your spec for you."
  },
  {
    format: "insight",
    topic: "uncertainty exposure",
    text: "A professional-grade AI system should get more visibly uncertain as inputs leave its validated envelope. Confidence that doesn't degrade with distance from known territory isn't confidence — it's a hazard.",
    threadsVariant: "Trustworthy AI in engineering has one defining behavior: its confidence visibly degrades outside its validated envelope. Uniform confidence everywhere is a warning sign, not a feature."
  },
  {
    format: "contrarian",
    topic: "prototypes vs production",
    text: "Hot take: the gap between an AI demo and a production system hasn't shrunk with better models. It's grown — because demos got easier faster than verification did.",
    threadsVariant: "Better models made demos easier much faster than they made verification easier. So the demo-to-production gap is wider now than it was two years ago, not narrower."
  },
  {
    format: "story",
    topic: "review discipline",
    text: "Caught an agent-written function this week that passed every test and was still wrong — it optimized a quantity we never actually constrain in practice. Tests check what you thought of. Review catches what you didn't.",
    threadsVariant: "An agent shipped me code that passed every test and was still wrong — it optimized something we never constrain in the real world. Tests cover what you anticipated. Review exists for what you didn't."
  },
  {
    format: "framework",
    topic: "responsibility boundaries",
    text: "Every AI workflow needs one sentence answered in writing: when this output is wrong, who owns it? If the answer is unclear, you don't have a workflow — you have a liability with a UI.",
    threadsVariant: "One-sentence audit for any AI workflow: when the output is wrong, who owns it? No clear answer means it's not a workflow yet, it's a liability with a nice interface."
  },
  {
    format: "observation",
    topic: "agentic engineering practice",
    text: "Six months of agentic engineering taught me to spend my effort at the edges: sharper problem statements going in, harder verification coming out. The middle — the generation — needs me less every month.",
    threadsVariant: "Where I actually spend effort after six months with agents: the edges. Sharper problem statements in, harder verification out. The middle keeps needing me less."
  },
  {
    format: "insight",
    topic: "small tools, deep workflow",
    text: "The best vertical AI products I've seen are embarrassingly narrow. They do one workflow completely — intake to review to sign-off — instead of ten workflows at demo depth.",
    threadsVariant: "Winning vertical AI pattern: embarrassingly narrow. One workflow done completely, intake through sign-off, beats ten workflows at demo depth every time."
  },
  {
    format: "question",
    topic: "engineers learning AI tooling",
    text: "For engineers in traditional disciplines: what finally made AI tools click for you? For me it was treating the agent like a fast junior with no memory — great output if the handoff is great, chaos otherwise.",
    threadsVariant: "Engineers from traditional fields: what made AI tooling click for you? My unlock was treating agents like fast juniors with amnesia — the handoff quality is everything."
  },
  {
    format: "contrarian",
    topic: "moats in AI",
    text: "Your prompt isn't a moat. Your model choice isn't a moat. The verification workflow your customers' regulators already trust? That's starting to look like one.",
    threadsVariant: "Prompts aren't moats. Model choice isn't a moat. A verification workflow that your customers' regulators already accept — that's the closest thing to a moat I've seen in vertical AI."
  },
  {
    format: "story",
    topic: "documentation as leverage",
    text: "Started making my agents write the decision log before the code: what was assumed, what was rejected, why. The code quality didn't change much. My ability to review it changed completely.",
    threadsVariant: "New habit: agents write the decision log first — assumptions, rejected options, reasoning — then the code. Code quality barely moved. Review speed doubled."
  },
  {
    format: "insight",
    topic: "human review scaling",
    text: "Teams adopting agents discover a new law: review capacity is fixed while generation capacity is elastic. Every process improvement that matters from here is really a review-throughput improvement.",
    threadsVariant: "Generation capacity is now elastic. Review capacity is still fixed — it's people. Every AI process win that actually matters is secretly a review-throughput win."
  },
  {
    format: "observation",
    topic: "engineering culture and AI",
    text: "Structural engineering solved 'unreliable individual output' a century ago: independent checks, sealed drawings, defined responsibility. AI software is slowly reinventing that system and calling it novel.",
    threadsVariant: "Fun pattern: AI software is reinventing what structural engineering formalized a century ago — independent checking, sealed responsibility, documented assumptions. The playbook already exists."
  },
  {
    format: "framework",
    topic: "when to automate",
    text: "Three questions before automating any professional task: Can we detect a bad output? Can we afford the worst plausible one? Does a human still learn enough to stay competent at checking? Two yeses isn't enough.",
    threadsVariant: "Before automating a professional task, ask: can we detect a bad output, can we survive the worst one, and does the human stay sharp enough to keep checking? All three or don't."
  },
  {
    format: "insight",
    topic: "specification is the work",
    text: "Writing software with agents made one thing obvious: the specification was always the hard part. We just couldn't see it before, because typing the code hid the thinking time.",
    threadsVariant: "Agents didn't remove the hard part of software. They revealed it. Specification was always the work — typing code just used to camouflage the thinking."
  },
  {
    format: "question",
    topic: "verification tooling gap",
    text: "We have a thousand tools for generating code with AI and maybe five serious ones for verifying it. Where's the disproportionate effort going, and why isn't it the other way around?",
    threadsVariant: "Rough count: a thousand AI code-generation tools, five serious verification tools. That ratio is backwards relative to where the bottleneck actually is. Why?"
  },
  {
    format: "observation",
    topic: "shipping cadence",
    text: "Shipping something small every day with agents beats shipping something big every month — not for the output, but because daily contact keeps your judgment about the tools current. The tools change monthly; stale judgment is expensive.",
    threadsVariant: "Why I ship daily with agents even when small: the tools change monthly, and daily contact is what keeps your judgment about them current. Stale judgment costs more than slow output."
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
