import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { BRAND_CHANNELS, DEFAULT_BRAND_KIT } from "@/lib/brand/defaults";

const SRC = path.join(process.cwd(), "src");

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
  return files;
}

const relative = (file: string) => path.relative(process.cwd(), file).replace(/\\/g, "/");

const isTest = (file: string) => /\.test\.tsx?$/.test(file) || /(^|\/)test-helpers\.ts$/.test(file);

type Source = { file: string; text: string; code: string; ast: ts.SourceFile };

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function withoutComments(text: string, ast: ts.SourceFile): string {
  const spans = new Map<number, number>();
  const note = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) spans.set(range.pos, range.end);
  };
  const visit = (node: ts.Node) => {
    if (node.kind !== ts.SyntaxKind.JsxText) {
      note(ts.getLeadingCommentRanges(text, node.getFullStart()));
      note(ts.getTrailingCommentRanges(text, node.getEnd()));
    }
    node.forEachChild(visit);
  };
  visit(ast);
  let out = "";
  let cursor = 0;
  for (const [pos, end] of [...spans.entries()].sort((a, b) => a[0] - b[0])) {
    if (pos < cursor) continue;
    out += text.slice(cursor, pos) + text.slice(pos, end).replace(/[^\n]/g, " ");
    cursor = end;
  }
  return out + text.slice(cursor);
}

const sources: Source[] = walk(SRC)
  .map((full) => {
    const file = relative(full);
    const text = readFileSync(full, "utf8");
    const ast = parse(file, text);
    return { file, text, code: withoutComments(text, ast), ast };
  })
  .filter(({ file }) => !file.startsWith("src/lib/brand/") && !isTest(file));

const IDENTITY = /nic\s+vandewetering|nicvandewetering|nic21vdw/i;

const IDENTITY_ALLOWED: Record<string, string> = {};

const BANNED_ENTRIES = [
  ...new Set(
    [
      ...DEFAULT_BRAND_KIT.voice.bannedPhrases,
      ...DEFAULT_BRAND_KIT.voice.claimTriggers,
      ...BRAND_CHANNELS.flatMap((channel) => DEFAULT_BRAND_KIT.channels[channel].avoid)
    ].map((entry) => entry.toLowerCase())
  )
];

const WINDOW = 8;
const THRESHOLD = 4;

const BANNED_LIST_ALLOWED: Record<string, string> = {
  "src/lib/storage/schemas.ts":
    "the default Threads positioning brief describes topics in industry jargon on purpose; the generator prompt tells the model not to lift its wording"
};

function phrasePattern(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu");
}

const BANNED_PATTERNS = BANNED_ENTRIES.map((entry) => ({ entry, pattern: phrasePattern(entry) }));

function bannedListHits(code: string): number[] {
  const lines = code.split("\n");
  const hits: number[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    const window = lines.slice(start, start + WINDOW).join("\n");
    const found = BANNED_PATTERNS.filter(({ pattern }) => pattern.test(window)).length;
    if (found >= THRESHOLD) {
      hits.push(start + 1);
      start += WINDOW - 1;
    }
  }
  return hits;
}

const NAME_IN_STRING = /\bNic\b/;

const NAME_ALLOWED: Record<string, string> = {};

function stringsIn(ast: ts.SourceFile): Array<{ text: string; line: number }> {
  const found: Array<{ text: string; line: number }> = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push({ text: node.text, line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    node.forEachChild(visit);
  };
  visit(ast);
  return found;
}

const NAME_SCOPES = ["src/lib/", "src/app/api/"];

const ANALYSIS_ONLY: Record<string, string> = {
  "src/lib/clipping/virality.ts#refineClipVirality": "scores candidate clips; the model's reply is a number, never published copy",
  "src/lib/clipping/transcript-select.ts#selectByTranscript": "picks moments in a transcript; the reply is timestamps and scores",
  "src/lib/youtube/competitor-insights.ts#generateCompetitorInsights": "analyses other channels for the owner to read; nothing it writes is posted",
  "src/lib/music/brief.ts#writeSongBrief": "writes a Suno brief; the output is an audio prompt, not brand copy",
  "src/lib/master-calendar/planner.ts#generateCalendarPlan": "suggests which idea goes in which gap; schedule entries, not copy",
  "src/lib/voice/textAgent.ts#runVoiceTurn": "its system prompt is built by voiceInstructions, which includes the kit block",
  "src/lib/longform/highlights.ts#askEditor": "chooses which passages of a stream make the edit; the reply is passage ids, and it reads the kit context directly",
  "src/lib/listening/classify.ts#ask": "sorts public posts into lead, mention, competitor or noise; the reply is labels and scores, and its product line comes from the kit",
  "src/lib/story/ai.ts#askStory": "plans the edit of a stream from its own moments; the reply is moment ids and quotes copied from the transcript"
};

const DIRECT_CALLERS_ALLOWED: Record<string, string> = {
  "src/lib/agents/provider.ts": "transport for the operator agent team; its replies only propose actions that need approval and are never published copy",
  "src/lib/longform/vision-review.ts": "judges whether a frame of the stream is usable; the reply is a verdict, nothing is published",
  "src/lib/voice/providers.ts": "builds the realtime session config; the instructions it sends come from voiceInstructions, which includes the kit block"
};

const DIRECT_CALLER = /@anthropic-ai\/sdk|from "openai"|api\.openai\.com|api\.anthropic\.com|api\.x\.ai|generativelanguage\.googleapis|\/chat\/completions|\/v1\/responses/;

const NO_RULES_PASS: Record<string, string> = {
  "src/lib/studio/scripts.ts": "a spoken script is read aloud, so the channel is exempt from rewriting",
  "src/lib/voice/prompt.ts": "instructions for the voice console, not published copy",
  "src/lib/clipping/hashtags.ts": "returns tags that are normalised and capped by the kit's hashtag policy, not prose",
  "src/lib/x-posts/generator.ts": "every post and reply is built through humanize in x-posts/voice.ts, which applies the kit rules"
};

function enclosingFunctionName(node: ts.Node): string {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.getText();
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent)) {
      return current.parent.name.getText();
    }
  }
  return "<module>";
}

function declarations(ast: ts.SourceFile): Map<string, ts.Node> {
  const found = new Map<string, ts.Node>();
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) found.set(node.name.getText(), node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) found.set(node.name.text, node.initializer);
    node.forEachChild(visit);
  };
  visit(ast);
  return found;
}

function namesIn(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isIdentifier(child)) names.push(child.text);
    child.forEachChild(visit);
  };
  visit(node);
  return names;
}

function reachesBlock(node: ts.Node, known: Map<string, ts.Node>, seen = new Set<string>(), depth = 0): boolean {
  if (/\bbrandPromptBlock\(/.test(node.getText())) return true;
  if (depth >= 3) return false;
  for (const name of namesIn(node)) {
    const declaration = known.get(name);
    if (!declaration || seen.has(name)) continue;
    seen.add(name);
    if (reachesBlock(declaration, known, seen, depth + 1)) return true;
  }
  return false;
}

type CallSite = { file: string; fn: string; key: string; line: number; withBlock: boolean };

function aiCallSites(source: Source): CallSite[] {
  const known = declarations(source.ast);
  const sites: CallSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "runAi") {
      const fn = enclosingFunctionName(node);
      sites.push({
        file: source.file,
        fn,
        key: `${source.file}#${fn}`,
        line: source.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        withBlock: node.arguments.some((argument) => reachesBlock(argument, known))
      });
    }
    node.forEachChild(visit);
  };
  visit(source.ast);
  return sites;
}

describe("nothing outside src/lib/brand hand-copies the brand", () => {
  it("scans real files", () => {
    expect(sources.length).toBeGreaterThan(200);
  });

  it("names the speaker and their handles only in the kit, comments aside", () => {
    const offenders = sources
      .filter(({ file, code }) => IDENTITY.test(code) && !(file in IDENTITY_ALLOWED))
      .map(({ file, code }) => `${file}:${code.split("\n").findIndex((line) => IDENTITY.test(line)) + 1}`);
    expect(offenders).toEqual([]);
  });

  it("keeps banned phrase lists in the kit", () => {
    const offenders = sources
      .filter(({ file }) => !(file in BANNED_LIST_ALLOWED))
      .flatMap(({ file, code }) => bannedListHits(code).map((line) => `${file}:${line}`));
    expect(offenders).toEqual([]);
  });

  it("does not write the speaker's first name into a string", () => {
    const offenders = sources
      .filter(({ file }) => NAME_SCOPES.some((scope) => file.startsWith(scope)) && !(file in NAME_ALLOWED))
      .flatMap(({ file, ast }) =>
        stringsIn(ast)
          .filter(({ text }) => NAME_IN_STRING.test(text))
          .map(({ line, text }) => `${file}:${line} ${text.slice(0, 60)}`)
      );
    expect(offenders).toEqual([]);
  });

  it("gives every allow-list entry a reason and a file that still exists", () => {
    const files = new Set(sources.map((source) => source.file));
    for (const table of [IDENTITY_ALLOWED, BANNED_LIST_ALLOWED, NAME_ALLOWED, ANALYSIS_ONLY, DIRECT_CALLERS_ALLOWED, NO_RULES_PASS]) {
      for (const [key, reason] of Object.entries(table)) {
        expect(reason.length, key).toBeGreaterThan(15);
        expect(files.has(key.split("#")[0]), `${key} is gone, drop it from the allow-list`).toBe(true);
      }
    }
  });
});

describe("the scanner behind these checks", () => {
  const scan = (text: string, file = "sample.ts") => {
    const ast = parse(file, text);
    return { ast, code: withoutComments(text, ast) };
  };

  it("ignores a name that only appears in a comment", () => {
    const { code } = scan(["// Nic Vandewetering wrote this", "const x = 1; /* @nicvandewetering */"].join("\n"));
    expect(IDENTITY.test(code)).toBe(false);
  });

  it("keeps a name in a string, and a link's double slash is not a comment", () => {
    const { code } = scan('const a = "https://x.com/@nicvandewetering"; // trailing');
    expect(IDENTITY.test(code)).toBe(true);
    expect(code).toContain("https://x.com");
  });

  it("finds the first name inside strings and templates but not in code or comments", () => {
    const { ast } = scan(['const a = "ask Nic";', "const b = `tell ${who} Nic`;", "// Nic", "const Nic = 1;"].join("\n"));
    expect(stringsIn(ast).filter(({ text }) => NAME_IN_STRING.test(text)).map(({ line }) => line)).toEqual([1, 2]);
  });

  it("finds a model call and says whether its prompt reaches the kit block", () => {
    const withBlock = scan(
      ['function system() { return brandPromptBlock("youtube"); }', "async function make() { return runAi({ system: system(), messages: [] }); }"].join("\n")
    );
    const without = scan('async function make() { return runAi({ system: "plain", messages: [] }); }');
    const source = (parsed: ReturnType<typeof scan>): Source => ({ file: "sample.ts", text: "", code: parsed.code, ast: parsed.ast });
    expect(aiCallSites(source(withBlock)).map(({ fn, withBlock: has }) => [fn, has])).toEqual([["make", true]]);
    expect(aiCallSites(source(without)).map(({ fn, withBlock: has }) => [fn, has])).toEqual([["make", false]]);
  });

  it("flags a direct SDK call", () => {
    expect(DIRECT_CALLER.test('import Anthropic from "@anthropic-ai/sdk";')).toBe(true);
    expect(DIRECT_CALLER.test("fetch('https://api.openai.com/v1/chat/completions')")).toBe(true);
  });
});

describe("every AI generator includes the kit", () => {
  const sites = sources.filter(({ file }) => !file.startsWith("src/lib/ai/")).flatMap(aiCallSites);

  it("finds the generators", () => {
    expect(sites.length).toBeGreaterThan(15);
  });

  it("asks for brandPromptBlock at each call site, unless that site only analyses", () => {
    const missing = sites.filter((site) => !site.withBlock && !(site.key in ANALYSIS_ONLY)).map((site) => `${site.key}:${site.line}`);
    expect(missing).toEqual([]);
  });

  it("does not allow-list a call site that already has the block", () => {
    const keys = new Set(sites.filter((site) => !site.withBlock).map((site) => site.key));
    const stale = Object.keys(ANALYSIS_ONLY).filter((key) => !keys.has(key));
    expect(stale).toEqual([]);
  });

  it("passes what it writes through applyBrandRules or applyBrandTitle", () => {
    const missing = sources
      .filter(({ file, code }) => /\bbrandPromptBlock\(/.test(code) && !/\bapplyBrand(Rules|Title)\(/.test(code) && !(file in NO_RULES_PASS))
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it("accounts for code that calls a model SDK or endpoint directly", () => {
    const direct = sources.filter(({ file, code }) => !file.startsWith("src/lib/ai/") && DIRECT_CALLER.test(code)).map(({ file }) => file);
    const unaccounted = direct.filter((file) => !(file in DIRECT_CALLERS_ALLOWED));
    expect(unaccounted).toEqual([]);
    expect(Object.keys(DIRECT_CALLERS_ALLOWED).filter((file) => !direct.includes(file))).toEqual([]);
  });
});
