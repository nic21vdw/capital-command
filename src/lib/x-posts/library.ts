import type { XPostFormat } from "@/types/domain";

/**
 * Built-in idea library for the Threads daily planner. Used as the fallback
 * when ANTHROPIC_API_KEY isn't configured (or the AI call fails) so the tool
 * still produces a full, on-brand pack every day. Entries are written the way
 * the prompt asks for them: one thought, short, plain enough for someone
 * outside engineering, and open enough that a reader has something to say
 * back.
 *
 * Every entry holds the same two versions the generator writes, to the same
 * contract (see generator.ts): `text` is the short one, around 70-150
 * characters, and `threadsVariant` gives the same thought one more beat at
 * 180-280, clearly longer and reworded from its first words on. Two connected accounts post one version
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
    topic: "checking is the slow part",
    text: "A machine can write a week of work in an hour. It still takes me a week to check it. Nobody posts about that half.",
    threadsVariant: "Everyone shares the hour it took to build the thing. Nobody shares the week of reading that came after, because a person still has to go through all of it and reading did not get faster this year. My output went up. My evenings did not."
  },
  {
    format: "contrarian",
    topic: "deciding is the expensive part",
    text: "The code is the cheap part now. Deciding what to build is the expensive part, and most teams are staffed the other way round.",
    threadsVariant: "An agent will build the wrong thing beautifully and never once ask why. That is the bit people miss. Making software got cheap this year, deciding what should exist did not, and most teams still have ten people building and nobody whose job is to say no."
  },
  {
    format: "observation",
    topic: "running agents in parallel",
    text: "Ran four coding agents at once this week. Four times the code. About six times the reading.",
    threadsVariant: "Four at once sounded great until the diffs landed. Each one was sensible on its own and none of them knew what the others had done, so I spent the afternoon making them agree with each other. Running them in parallel is free. The agreeing is not."
  },
  {
    format: "insight",
    topic: "who signs it off",
    text: "Any tool can do the maths. The hard part is knowing who signs it off and what they want to see first.",
    threadsVariant: "The maths was never the moat. What is hard is everything around it: who signs, what they check before they sign, and what has to be in front of them when they do. Build for the person signing and the calculation turns into a detail."
  },
  {
    format: "story",
    topic: "make it show its assumptions",
    text: "I make every AI answer list what it assumed at the top. Checking it went from an hour to twenty minutes.",
    threadsVariant: "Smallest change I made all year. Every answer has to open with what it assumed, before any of the working. Now I argue with the assumptions instead of hunting for them buried on page three. An hour of checking turned into about twenty minutes."
  },
  {
    format: "framework",
    topic: "what agents are allowed to touch",
    text: "My agents can write anything. They cannot send anything. That one line is most of my safety setup.",
    threadsVariant: "People expect something clever here and it is not clever at all. Anything reversible is theirs. Anything that leaves the building, a post, an email, a delete, needs me. I have never once regretted the line being in that exact place."
  },
  {
    format: "insight",
    topic: "knowing which answer is wrong",
    text: "Nobody is paying me for typing anymore. They are paying me for knowing which answer is quietly wrong.",
    threadsVariant: "Typing was never really the job, it just looked like the job. Now a machine does that part, and what is left is spotting which of the four confident answers in front of you is wrong. That did not get cheaper. It got harder to fake."
  },
  {
    format: "contrarian",
    topic: "it is not the model",
    text: "Same model, two setups. One gives me junk. One gives me work I can use. It was never the model.",
    threadsVariant: "Two people run the same thing and get completely different results, then argue about which model is best. It is almost never the model. It is what you gave it, what it could actually see, and whether anything checks the answer before you do."
  },
  {
    format: "observation",
    topic: "the bill for vibe coding",
    text: "Vibe coding is fine until someone has to fix it at 11pm. Usually that someone is me, three weeks later.",
    threadsVariant: "Nothing against it, I do it constantly. The bill just arrives later than the fun does. Something breaks on a Tuesday night and whoever opens the file has no idea why any of it is shaped like that, and most of the time that person is me."
  },
  {
    format: "contrarian",
    topic: "counting the wrong thing",
    text: "Lines of code was always a silly number. Now it is free to fake and people still put it in updates.",
    threadsVariant: "A machine can produce ten thousand lines before lunch, so the number means even less than it used to, and I keep seeing it in weekly updates like it is an achievement. Better question, and nobody enjoys it: how much of that has anyone read."
  },
  {
    format: "insight",
    topic: "where did this come from",
    text: "If you cannot say where a number came from, it is not a result. It is a guess with good formatting.",
    threadsVariant: "In my job a number with no source is worth nothing no matter how tidy it looks, and AI is very good at tidy. So the first thing I ask anything it hands me is where this came from. If there is no answer it goes in the bin, however right it looks."
  },
  {
    format: "story",
    topic: "building without a dev team",
    text: "One engineer, no dev team, and I shipped a real app this year. Five years ago that was a fantasy.",
    threadsVariant: "No funding, no cofounder, no software people. Just someone who used to wait a year for a tool and now builds it in a weekend. I am not saying it is easy. I am saying the wall that used to stop people like me is gone, and it went pretty quietly."
  },
  {
    format: "framework",
    topic: "say what done looks like",
    text: "Half my bad results were me being vague. The agent did exactly what I asked. I asked badly.",
    threadsVariant: "I blamed the model for a while, then started reading my own requests back the next morning. Most of them would have confused a person too. Now I write down what finished looks like before anything starts, and a lot of that problem went away."
  },
  {
    format: "insight",
    topic: "it can only use what it sees",
    text: "An agent that cannot see your project is guessing politely. Most bad answers are missing information.",
    threadsVariant: "When I get a bad answer it is usually not because the thing is stupid. It is because I asked about something it could not see, so it guessed, and a polite guess looks exactly like a real answer. Now I check what it had in front of it first."
  },
  {
    format: "insight",
    topic: "fast is not the product",
    text: "In serious work nobody wants a faster answer. They want one somebody is willing to put their name on.",
    threadsVariant: "This is the gap a lot of AI products never cross. In my industry an answer nobody will sign is worth exactly nothing, however quickly it arrived. Speed is what makes the demo look good. Someone signing it is the actual product."
  },
  {
    format: "observation",
    topic: "tools that admit doubt",
    text: "I trust a tool more when it tells me it is unsure. Certainty about everything is a warning sign.",
    threadsVariant: "The ones I keep using are the ones that flinch sometimes. If it sounds equally confident about every answer then I am doing all the sorting myself, which is the work I wanted help with. I would rather it hesitate and be right about when."
  },
  {
    format: "story",
    topic: "the demo took an afternoon",
    text: "The demo took an afternoon. Making it not embarrassing took two months. That ratio surprises people.",
    threadsVariant: "First version of my app looked finished on day one, which was misleading. Two months went into the parts nobody films: what happens when it fails, when the file is weird, when someone does something nobody planned for. That is most of the job."
  },
  {
    format: "contrarian",
    topic: "approving what you did not read",
    text: "If you approve a change you did not read, you did not save time. You moved it to future you.",
    threadsVariant: "Skimming a diff and clicking approve feels like speed. It is a loan, and future you pays it back at a horrible hour, usually while working out why a thing that never worked has been live for a month. The interest on that is brutal."
  },
  {
    format: "insight",
    topic: "my name is on it",
    text: "When it goes wrong, nobody accepts that the model wrote it. My name is on the drawing either way.",
    threadsVariant: "People ask if I worry about AI taking my job. What I actually think about is that when something fails the model is not in the room and I am. That does not change based on how the work got made, which is either terrifying or clarifying."
  },
  {
    format: "framework",
    topic: "what to hand over",
    text: "Getting good at this is not prompt tricks. It is knowing what to hand over and what to keep.",
    threadsVariant: "There is no secret phrase. The people getting real work out of these tools are just good at deciding what to give away and what to hold on to, and every one of them figured that out by handing over the wrong things first."
  },
  {
    format: "observation",
    topic: "the forty line tool",
    text: "The software I use most is forty lines long. Nobody would pay for it. It saves me an hour a day.",
    threadsVariant: "It does one boring thing I used to do by hand every morning and it will never be a product. An hour a day, out of forty lines. Most of the value in this stuff is that small and that unglamorous, which is why so little of it gets talked about."
  },
  {
    format: "insight",
    topic: "who actually gets good at this",
    text: "The people pulling ahead with AI are not the technical ones. They are the ones who came back after a bad answer.",
    threadsVariant: "I keep watching who gets good at this and it is not who I expected. Almost everyone tries it, gets something rubbish, and quietly decides it is overhyped. The ones who came back the next day anyway are miles ahead now. That is the filter."
  },
  {
    format: "contrarian",
    topic: "what cannot be copied",
    text: "Anyone can wrap a model in a weekend. Nobody can copy twenty years of knowing what actually matters.",
    threadsVariant: "So the wrapper is not the thing worth protecting. What is hard to copy is knowing which corners of a job are fine to cut and which ones quietly cause a failure two years later. You only get that by having done the job, badly, at some point."
  },
  {
    format: "story",
    topic: "docs written for a machine",
    text: "I started writing notes for the AI, not for people. Turns out the people needed them too.",
    threadsVariant: "The agents kept getting lost in my own projects, so I finally wrote down how the thing works. Now new work starts faster, and so do I after two weeks away. Wrote it for a machine. Should have written it years ago for me."
  },
  {
    format: "insight",
    topic: "checking does not scale",
    text: "You can double the code overnight. You cannot double the number of people able to check it.",
    threadsVariant: "Making things scales instantly now and checking them does not, because checking needs someone who knows what wrong looks like in your field. That is the whole squeeze. Everybody is racing to produce more and nobody is asking who reads it."
  },
  {
    format: "observation",
    topic: "teams that talk about failures",
    text: "The teams doing well with AI talk about where it failed last week. The quiet ones are pretending.",
    threadsVariant: "Best signal I have found. If a team only ever shares wins, either they are barely using it or nobody there feels safe saying it did not work. The ones swapping stories about what went sideways on Tuesday are actually learning something."
  },
  {
    format: "framework",
    topic: "do it by hand three times",
    text: "If I have not done it by hand three times, I do not automate it. I do not know what it is yet.",
    threadsVariant: "First time you learn the thing. Second time you hit the edge case. Third time you finally see what changes between runs. Automate before that and you build a very efficient machine for doing the wrong job, which is worse than doing it by hand."
  },
  {
    format: "insight",
    topic: "the deciding takes the week",
    text: "Most of my day is not building. It is working out what I am actually asking for.",
    threadsVariant: "Someone asked what the work looks like now. Mostly deciding. Writing down what the thing should do, arguing with myself, cutting half of it. The building takes an hour. Working out what to build takes the rest of the week, and it always did."
  },
  {
    format: "observation",
    topic: "nobody is building the checking tools",
    text: "A hundred tools that write code for you. Almost none that help you work out if it is right.",
    threadsVariant: "Another one launches every week and they all do the same half of the job. I can count on one hand the ones that help with whether the result is correct, which is where all the time goes now. Someone is going to make a lot of money there."
  },
  {
    format: "story",
    topic: "shipping something every day",
    text: "Putting something out every day changed what I build. You stop planning things you never finish.",
    threadsVariant: "Since I started shipping daily the work changed shape on its own. Big plans die quietly because they never fit inside a day, and what survives is small stuff that actually lands. I get more done and plan less, which is not the trade I expected."
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
