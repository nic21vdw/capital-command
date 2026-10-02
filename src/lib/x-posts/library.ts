import type { XPostFormat } from "@/types/domain";

/**
 * Offline Threads ideas use the same two-version contract as the AI planner:
 * a 70-150 character thought and a reworded 180-280 character version.
 * Concrete examples are suggestions, never invented anecdotes or launch claims.
 * Brand copy uses the shared desktop/project-canvas positioning; plans are
 * explicitly phrased as goals. Parent posts stand alone without a sales link.
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
    topic: "one useful tool",
    text: "A tiny tool that sorts one annoying file can be a better first AI project than a whole app. You can tell when it works.",
    threadsVariant:
      "Pick one file you keep cleaning up by hand. Ask an agent to handle that step, then compare its output with a copy you cleaned yourself. A small tool earns its place by getting a boring job right."
  },
  {
    format: "contrarian",
    topic: "what to build first",
    text: "Your first AI project can be the task you keep putting off. Nobody needs another dashboard they forget to open.",
    threadsVariant:
      "The best starting point might be the dull job already sitting on your desk. Renaming files, cleaning a table, finding a missing field. You know what a good result looks like before the agent writes anything."
  },
  {
    format: "observation",
    topic: "agents need separate jobs",
    text: "Two agents editing the same file is a meeting without an agenda. Give each one a separate job before you press go.",
    threadsVariant:
      "Running agents together works better when each has a clear patch of the project to own. One can build a screen while another checks a different part. Otherwise you spend the afternoon settling arguments between files."
  },
  {
    format: "framework",
    topic: "show the agent an example",
    text: "Give the agent one example of a good result and one that should fail. That explains more than another paragraph of instructions.",
    threadsVariant:
      "Before asking an agent to build something, show it an input and the result you expect. Add a bad input too. Now you have something concrete to check, and the agent has fewer gaps to fill with a guess."
  },
  {
    format: "question",
    topic: "a tool for your own job",
    text: "What boring task at your job would you turn into a button? The one you do every week is probably more useful than a big app idea.",
    threadsVariant:
      "Forget the startup idea for a second. Think about the task you repeat at work, the one that takes a few clicks and always feels longer than it should. If you could make one button for it, what would it do?"
  },
  {
    format: "insight",
    topic: "a source beside a number",
    text: "A number without its source is homework for the next person. Put the assumption beside the result while you still remember it.",
    threadsVariant:
      "Someone reviewing a calculation needs to know what went into it. Keep the input and its source beside the result, even when it feels obvious today. The confusing part usually arrives after you have moved to another project."
  },
  {
    format: "observation",
    topic: "a broken link breaks the pitch",
    text: "A good post can send someone to a bad first impression. Open the link on your phone before calling the campaign finished.",
    threadsVariant:
      "The caption can be great and the destination can still let it down. Try the link on a phone, see what loads first, and read the page as someone who has never heard of you. That is part of making the post."
  },
  {
    format: "contrarian",
    topic: "games need a first minute",
    text: "A game can look great in a screenshot and feel awful in the first minute. Start with moving, aiming and knowing what to do.",
    threadsVariant:
      "Before adding another map to a game, try the first minute with someone who has never played it. Watch where they get stuck. A clear start and controls that feel right give the rest of the game a chance."
  },
  {
    format: "framework",
    topic: "ask an agent to explain the change",
    text: "Ask the agent what changed and how it checked the result. A giant list of files is a pretty poor answer to either question.",
    threadsVariant:
      "When an agent finishes, ask for the behaviour it changed and the check that proved it. Then try that check yourself. Reading every file may still matter, but at least you know which claim you are trying to confirm."
  },
  {
    format: "question",
    topic: "the part that should stay manual",
    text: "Which part of your job would you keep doing yourself even if an agent could do it? That answer says a lot about what you value.",
    threadsVariant:
      "There is usually one part of a job people want to keep, even when the rest could be automated. Maybe it is choosing the idea, talking to a client, or making the final call. I am curious where that line sits for you."
  },
  {
    format: "insight",
    topic: "a useful caption explains the moment",
    text: "A clip needs enough context for someone who missed the stream. Explain what is happening before asking them to care about it.",
    threadsVariant:
      "People seeing a clip have not watched the hour before it. Give them the problem, the thing being tried, and a reason the result matters. The interesting moment still needs a small doorway for a new person to walk through."
  },
  {
    format: "observation",
    topic: "unfinished work can teach",
    text: "A failed attempt can make a useful post if you explain what you changed next. The error message on its own is just homework.",
    threadsVariant:
      "Showing work in public gets more interesting when people can follow the decision after something breaks. What did you check? What did you change? That is the part another builder can take back to their own project."
  },
  {
    format: "contrarian",
    topic: "knowing your field matters",
    text: "Knowing a job well is an advantage when building with AI. You can spot the answer that looks tidy but would annoy everyone using it.",
    threadsVariant:
      "An agent can build a clean screen for a job it does not understand. The person who does that job can spot the missing step immediately. That is a good reason to start with a problem from a field you actually know."
  },
  {
    format: "framework",
    topic: "use a copy for the first run",
    text: "Try a new automation on a copy of the file first. Undo is a nicer feature when you have not already needed it.",
    threadsVariant:
      "A first run should be easy to inspect and easy to undo. Use a spare file, keep the original, and compare the result before letting an automation loose on the whole folder. You get to learn without rebuilding your morning."
  },
  {
    format: "insight",
    topic: "preview before publish",
    text: "An automation that writes posts should let you read them before it publishes. Speed is less useful when the wrong sentence travels fast.",
    threadsVariant:
      "Writing and publishing are two different decisions. Let an automation prepare the post, then give yourself a clear place to check the wording and the destination. A fast draft should still leave room for a deliberate publish."
  },
  {
    format: "question",
    topic: "when the game feels good",
    text: "What makes you keep playing a small game: the controls, the challenge, or the friend who refuses to lose? I suspect the last one cheats.",
    threadsVariant:
      "Small games do not always need a huge world to keep people around. Sometimes the controls feel right, sometimes the next attempt looks possible, and sometimes your friend is still talking about the last round. Which gets you back?"
  },
  {
    format: "observation",
    topic: "small tools need clear inputs",
    text: "A custom tool should tell you what it needs before it gives an answer. Quietly choosing a missing input is a very expensive shortcut.",
    threadsVariant:
      "A missing input should be visible, whether you are building a calculator or a file sorter. Ask for what is missing, or show the assumption clearly. A neat answer becomes less useful when nobody knows what the tool quietly chose."
  },
  {
    format: "insight",
    topic: "give each project its own notes",
    text: "Leave the next person a note about why you chose that approach. That person might be you after a weekend.",
    threadsVariant:
      "A useful project note explains the decision, not just the file you touched. What was the problem? Why this approach? What still needs checking? A few plain lines can save someone from having to rediscover the whole argument."
  },
  {
    format: "contrarian",
    topic: "more features can hide the useful part",
    text: "Another feature can make a tool harder to understand. The thing people came for should still be obvious when they open it.",
    threadsVariant:
      "Before adding another button, watch someone try the task the tool was built for. If they cannot find it, more options will probably bury it further. A useful tool needs a clear first move more than a crowded menu."
  },
  {
    format: "framework",
    topic: "use one real example in a demo",
    text: "Show one task from start to finish in a demo. People can judge a finished example more easily than a tour of ten menus.",
    threadsVariant:
      "Pick an ordinary task for a demo and finish it on screen. Show the input, the decision, and the result. Someone watching can then decide whether it fits their day, instead of guessing what all the buttons might add up to."
  },
  {
    format: "question",
    topic: "a workspace should help you resume",
    text: "When you reopen a project, what tells you where to start? A list of files rarely explains the decision you were halfway through.",
    threadsVariant:
      "Coming back to a project should not mean rereading every chat. I would want the open question and the last decision beside the work. What do you look for first when you return to something you left unfinished?"
  },
  {
    format: "observation",
    topic: "mobile controls need a real phone",
    text: "A game working with a mouse tells you very little about playing it with two thumbs. Try the small screen before adding more buttons.",
    threadsVariant:
      "Touch controls take up some of the screen you are trying to see. Test a game on an actual phone and watch what your thumbs cover. A desktop layout squeezed smaller can hide exactly the thing a player needs to notice."
  },
  {
    format: "insight",
    topic: "make the mistake visible",
    text: "If an agent is waiting for an answer, make that obvious. A quiet pause can look exactly like work getting done.",
    threadsVariant:
      "The hard part of watching several agents is knowing which one needs you. A clear question or a visible pause helps more than another progress animation. Otherwise you can end up patiently watching something that has already stopped."
  },
  {
    format: "contrarian",
    topic: "boring automation earns trust",
    text: "The best automation may be the one you stop thinking about. It handles the boring part and tells you clearly when it cannot.",
    threadsVariant:
      "An automation earns trust over ordinary days. It gets the expected job done, keeps a record you can read, and tells you when something needs attention. The dramatic demo is fun, but the uneventful Tuesday matters too."
  },
  {
    format: "framework",
    topic: "name the missing piece",
    text: 'When an AI answer is wrong, point to the missing piece. "Try harder" leaves the agent guessing which part disappointed you.',
    threadsVariant:
      "A correction works better when it names the mismatch. The button should stay visible, the number needs a source, or the reply should answer this question. Give the agent something it can change and you can check afterwards."
  },
  {
    format: "question",
    topic: "a useful module starts with a job",
    text: "If you could add one tool to the workspace you already use, what would it do? Start with the job, then worry about the name.",
    threadsVariant:
      "Think of an add-on as a small job someone already wants done. Maybe it cleans up a file or makes a result easier to inspect. What would you add to your usual workspace so you could stay there a little longer?"
  },
  {
    format: "observation",
    topic: "do not turn every post into a pitch",
    text: "A post can teach something without ending in a sales line. Give people a useful thought and they have a reason to remember the builder.",
    threadsVariant:
      "If every post ends with the same pitch, people learn to skip the ending. Explain a real decision, share a useful check, or ask a question with room for different answers. Interest can start before anyone clicks a link."
  },
  {
    format: "insight",
    topic: "the first button decides a lot",
    text: 'The first button in a tool should answer "where do I start?" If it needs a tour, the screen still has work to do.',
    threadsVariant:
      "A new user brings none of the notes you had while building the tool. Put the first useful action where they can find it and explain what happens next. A clear start is part of the product, even when the rest already works."
  }
];

export const REPLY_LIBRARY: LibraryReply[] = [
  {
    scenario: "Someone shares an AI-built demo",
    text: "What happens when you give it a bad input? A follow-up showing that would help people judge whether it fits their own work."
  },
  {
    scenario: "Someone asks whether AI replaces engineers",
    text: "Someone still has to own the assumptions and the final decision. Faster calculations make that part of the job more visible."
  },
  {
    scenario: "Someone asks how to start with coding agents",
    text: "Pick a tiny task where you can tell whether the answer is right. Give the agent one example, then try its result on a copy of your file."
  },
  {
    scenario: "Someone runs several coding agents together",
    text: "Giving each agent a separate part to own helps. Otherwise the time saved writing code can turn into time spent making their changes agree."
  },
  {
    scenario: "An agent keeps missing the request",
    text: "Can you show it one example of the result you wanted? A concrete mismatch is easier to fix than asking it to be better."
  },
  {
    scenario: "Someone shows an AI tool for professional work",
    text: "I would want to see the inputs and assumptions beside the answer. The person reviewing it needs more than a result that looks tidy."
  },
  {
    scenario: "Someone discusses giving an agent full control",
    text: "How easy is it to catch a mistake and undo it? That would decide how much room I gave the agent on this task."
  },
  {
    scenario: "Someone builds their first app with AI",
    text: "The next useful test might be watching a new person try it. You already know what all the buttons mean, which makes some problems hard to notice."
  },
  {
    scenario: "Someone shares prompting advice",
    text: "An example of the expected output helps a lot. Add a bad input too, so the agent knows when it should stop and ask."
  },
  {
    scenario: "Someone measures success by lines of AI code",
    text: "I would also ask what changed for the person using it. A small useful change can be worth more than a very large diff."
  },
  {
    scenario: "Someone worries about hidden AI assumptions",
    text: "A missing input should show up as a question or a visible assumption. Quietly choosing one makes an answer hard to trust."
  },
  {
    scenario: "Someone asks which skills matter when building with AI",
    text: "Knowing what a good result looks like matters a lot. You can ask an agent for help with the build, but you still need a way to judge what comes back."
  },
  {
    scenario: "Someone asks how to divide work between agents",
    text: "Write down what each one owns and what it should leave alone. That gives you something concrete to check when the changes come back."
  },
  {
    scenario: "Someone says AI removes the craft of building",
    text: "There is still care in choosing the problem and checking the result. A tool doing the typing does not tell you which decisions were good."
  },
  {
    scenario: "Someone compares AI models",
    text: "Try them on the same small task with the same files. It is easier to judge a result you can inspect than a score from somebody else's test."
  },
  {
    scenario: "Someone builds a business on their own",
    text: "A note about why you chose an approach can save you from reopening the same argument next week. Working alone still needs a record of decisions."
  },
  {
    scenario: "Someone posts about an automation failure",
    text: "How did you find out it had failed? A clear warning and a way to undo the change can make the next run much less stressful."
  },
  {
    scenario: "Someone asks whether beginners can build useful tools",
    text: "A tool for a job you already know is a good place to start. You can spot what is missing and tell whether the result actually helps."
  },
  {
    scenario: "Someone is overwhelmed by AI-written changes",
    text: "Ask for a smaller change with one visible result. It is easier to review a finished job than a pile of improvements with no clear stopping point."
  },
  {
    scenario: "Someone shares a custom calculator",
    text: "Can you see where each input came from? Keeping the source near the number makes checking it a lot easier."
  },
  {
    scenario: "Someone automates a repetitive task",
    text: "Try a run on a copy and compare the result with one you did by hand. That catches misunderstandings before the automation touches everything."
  },
  {
    scenario: "Someone gives an agent a large amount of context",
    text: "Which parts does it actually need for this job? A few relevant files and a clear example can be easier to use than the whole history."
  },
  {
    scenario: "Someone asks whether learning to code still helps",
    text: "Being able to read what the agent changed helps you own the result. You do not need to type every line to benefit from understanding it."
  },
  {
    scenario: "Someone asks how to test an AI-built feature",
    text: "Write down one thing it should do and one thing it should refuse. Then try both from the screen or file a real user will touch."
  },
  {
    scenario: "Someone struggles to explain their tool",
    text: "Show one ordinary job from start to finish. People can decide whether that helps them more easily than they can decode a menu tour."
  },
  {
    scenario: "Someone announces a new AI model",
    text: "The interesting question for me is which real task gets easier to finish and check. A concrete before and after would make the change clearer."
  },
  {
    scenario: "Someone shows a game they are building",
    text: "Have you watched a new player try the first minute? The controls and knowing what to do next can matter before they notice the bigger world."
  },
  {
    scenario: "Someone asks what to build first",
    text: "Pick the boring task you already repeat. You know how it should work, and a small useful result gives you a reason to keep building."
  }
];

export const COLATERAL_LIBRARY: LibraryPost[] = [
  {
    format: "observation",
    topic: "CoLateral project canvas",
    text: "CoLateral puts agents, files and ideas on one project canvas. The useful part is being able to see what belongs together.",
    threadsVariant:
      "A project can spread across chats, files and half-written notes quickly. CoLateral brings those pieces onto one canvas, so the question becomes where each piece belongs instead of which window you left it in."
  },
  {
    format: "insight",
    topic: "CoLateral custom tool ideas",
    text: "A good custom tool starts with one annoying job. That is the kind of thing I want people building around CoLateral.",
    threadsVariant:
      "The tools I want people building around CoLateral start with a job they already understand. A file they keep cleaning, a result they keep checking, a tiny task repeated all week. It does not need to become a whole app."
  },
  {
    format: "question",
    topic: "CoLateral for creators",
    text: "Creators have drafts, clips and notes scattered everywhere. What would you put beside each other on a CoLateral project canvas?",
    threadsVariant:
      "If you make videos, there is usually more to a project than the final edit. Notes, titles, unfinished ideas, the thing you meant to look up. Which pieces would you want beside each other on a CoLateral canvas?"
  },
  {
    format: "story",
    topic: "CoLateral built in public",
    text: "I build CoLateral live with AI agents. Seeing the decision after a mistake is usually more useful than watching a clean demo.",
    threadsVariant:
      "Building CoLateral live means there is room to show the thinking around the work. When something does not behave as expected, the useful bit is the next question and the next check. A clean demo skips that part."
  },
  {
    format: "contrarian",
    topic: "CoLateral desktop workspace",
    text: "I'm building CoLateral as a desktop workspace. A project needs somewhere to live after the latest chat has scrolled away.",
    threadsVariant:
      "Chats are useful while you are asking a question. A bigger project also needs somewhere for its files and ideas to stay. That is the shape I am building around with CoLateral, a desktop workspace with one project canvas."
  },
  {
    format: "framework",
    topic: "CoLateral a small first project",
    text: "For a first CoLateral project, think small: one job, its files, and an agent helping with it. You need something you can check.",
    threadsVariant:
      "A first project does not have to fill the whole CoLateral canvas. Start with a task you know well and put its files and notes beside the agent helping with it. A clear result gives you something to judge before you add more."
  },
  {
    format: "observation",
    topic: "CoLateral agent workspace",
    text: "CoLateral is the workspace I'm building with the agents that help build it. The thing being tested is also the place I'm working.",
    threadsVariant:
      "Claude Code and Codex are part of how I build CoLateral live. That makes the workspace itself part of the work, rather than a screen I only open for a demo. A rough edge matters when it sits beside the job you are doing."
  },
  {
    format: "question",
    topic: "CoLateral for engineers",
    text: "For engineers using CoLateral, I want the source beside the number. What else would you need in front of you when reviewing a result?",
    threadsVariant:
      "The engineering side of CoLateral is about keeping work easy to inspect. A result needs its inputs and assumptions close by. When you review a calculation, which missing detail makes you stop and ask another question?"
  },
  {
    format: "insight",
    topic: "CoLateral one project at a time",
    text: "CoLateral is for developers, creators and engineers. Different jobs, same pile of files and ideas that need a place to live.",
    threadsVariant:
      "A developer, a creator and an engineer can have very different projects while sharing the same scattered desk. CoLateral is a desktop workspace for those people, with AI agents, files and ideas on one project canvas."
  },
  {
    format: "question",
    topic: "CoLateral next useful tool",
    text: "What is the one tool you wish lived beside your project? That is a more useful CoLateral question than how many tools fit on a canvas.",
    threadsVariant:
      "While building CoLateral, I care more about the job a tool would help with than the size of the menu. What do you keep opening somewhere else because it is missing from the place you are already working?"
  },
  {
    format: "contrarian",
    topic: "CoLateral useful before crowded",
    text: "I want CoLateral to feel useful before it feels busy. An empty canvas with a clear next step beats a screen full of mystery buttons.",
    threadsVariant:
      "A canvas can hold a lot without needing to show everything at once. With CoLateral, the goal is to make the next useful move clear. More room should help a project make sense, rather than give it more places to hide."
  },
  {
    format: "framework",
    topic: "CoLateral visible handoffs",
    text: 'An agent helping with a CoLateral project needs a clear job and a clear finish. "Make it better" leaves a lot of room for guessing.',
    threadsVariant:
      "For an agent working on a CoLateral project, I want the request and the result close together. What should change, what should stay, and how will we check it? Keeping the job clear matters before running more agents."
  },
  {
    format: "observation",
    topic: "CoLateral seeing the whole job",
    text: "The idea behind CoLateral is to see the whole project. A file on its own rarely explains why you were changing it.",
    threadsVariant:
      "A note explains a decision. A file holds the work. An agent helps move it along. CoLateral puts those pieces on one project canvas, where you can keep the reason for a change beside the thing you are changing."
  },
  {
    format: "question",
    topic: "CoLateral custom calculator idea",
    text: "What would your own calculator need to show before you trusted it? That is a question I keep coming back to while building CoLateral.",
    threadsVariant:
      "A custom calculator is only useful if you can judge its answer. I want CoLateral projects to keep that question visible: what went in, what was assumed, and what still needs a person to check? What would you look for first?"
  },
  {
    format: "insight",
    topic: "CoLateral small tools before big apps",
    text: "A tool for one awkward step can be worth building. CoLateral is the workspace I want around those small, useful projects.",
    threadsVariant:
      "You do not have to start with a business idea. Start with the task you are tired of doing by hand and work out what a good result looks like. CoLateral is the desktop workspace I am building around agents, files and ideas like those."
  },
  {
    format: "story",
    topic: "CoLateral decisions on stream",
    text: "Building CoLateral live is a chance to show why a change was made. The finished screen only tells you half the story.",
    threadsVariant:
      "The part I want people to see while I build CoLateral is the decision behind the screen. What was confusing? What should happen instead? That gives another builder something to use, even if their project looks nothing like mine."
  },
  {
    format: "question",
    topic: "CoLateral workspace for game ideas",
    text: "A game idea starts with notes and a lot of unfinished pieces. How would you lay those out on a CoLateral project canvas?",
    threadsVariant:
      "If you are building a game, there are ideas, files and questions long before there is a finished level. CoLateral puts agents, files and ideas on one canvas. What would you keep beside the part of the game you are working on?"
  },
  {
    format: "contrarian",
    topic: "CoLateral a canvas needs purpose",
    text: "The CoLateral canvas needs to help you find the next job. Making room for more stuff is only half of building a workspace.",
    threadsVariant:
      "An infinite canvas sounds great until you cannot remember where anything is. While building CoLateral, the question is how the layout helps you return to the work. More space is useful when a project still makes sense inside it."
  },
  {
    format: "framework",
    topic: "CoLateral notes beside agents",
    text: "A useful note beside a CoLateral agent explains the goal, not just the task. The agent still needs to know what a good result means.",
    threadsVariant:
      "Put the reason for the work beside the request. In a CoLateral project, that can be a note next to the agent and files: who is this for, what should it do, and what would make it wrong? Plain answers are enough to start."
  },
  {
    format: "insight",
    topic: "CoLateral show your workspace",
    text: "When I show CoLateral, I want to show a project getting worked on. The workspace makes more sense with a real job in it.",
    threadsVariant:
      "A tour of a blank workspace can leave people guessing what they would do there. CoLateral is easier to explain with agents, files and ideas laid out around a job. The project gives the canvas a reason to exist."
  },
  {
    format: "question",
    topic: "CoLateral marketing project ideas",
    text: "What part of making a post takes longer than people think? I'm building CoLateral for creators too, and the work starts before the caption.",
    threadsVariant:
      "Creators have a lot of decisions before a post goes out: which moment to use, what it means, what the audience needs to know. CoLateral is a workspace for creators as well as builders. Which part would you want help keeping track of?"
  },
  {
    format: "observation",
    topic: "CoLateral workspace versus answer",
    text: "CoLateral is built around a project canvas because work keeps going after an AI answer. There is still a file to change and a choice to make.",
    threadsVariant:
      "An AI answer can be the start of a task rather than the end. There may be files to inspect and another decision waiting. CoLateral is a desktop workspace where those pieces and the agents helping with them share a project canvas."
  },
  {
    format: "framework",
    topic: "CoLateral build something checkable",
    text: "If you are exploring CoLateral, bring a task you can judge. Your own idea of a good result is a useful place to start.",
    threadsVariant:
      "A project you know well makes it easier to judge what an agent gives you. That is a useful starting point for CoLateral: bring the files, keep your notes nearby, and work on a small result you can actually inspect."
  }
];
