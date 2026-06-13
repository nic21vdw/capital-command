#!/usr/bin/env python3
"""twitter-prep — daily Twitter/X reply strategy assistant.

This tool does NOT post anything. It prepares a single, copy-paste-ready
"Session Brief" that you drop into a human-reviewed Claude browser session to
find and post one high-quality reply per day, and it keeps a local log of the
replies you actually post.

Commands
--------
    python twitter_prep.py            Build today's Session Brief
    python twitter_prep.py --log      Log a reply you just posted
    python twitter_prep.py --summary  Show a table of the last 30 days of replies

All state lives in two flat files next to this script: brief.md (your
positioning / voice / strategy) and reply_log.json (everything you've posted).
Both are created automatically on first run.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta

# --- Optional dependencies -------------------------------------------------
# Both are optional at import time so the tool degrades gracefully instead of
# crashing when something isn't installed. We check for them where they're used.
try:
    import anthropic
except ImportError:  # pragma: no cover - exercised only without the SDK
    anthropic = None

try:
    import pyperclip
except ImportError:  # pragma: no cover - exercised only without pyperclip
    pyperclip = None


# --- Paths and configuration ----------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BRIEF_FILE = os.path.join(SCRIPT_DIR, "brief.md")
LOG_FILE = os.path.join(SCRIPT_DIR, "reply_log.json")

# The model used to generate the daily search strategy. Override with the
# TWITTER_PREP_MODEL env var if you want a different one. claude-opus-4-8 is the
# current most-capable model; the tool still works (minus AI suggestions) if the
# model is unavailable or the API call fails.
DEFAULT_MODEL = "claude-opus-4-8"
MODEL = os.environ.get("TWITTER_PREP_MODEL", DEFAULT_MODEL)


# --- Starter brief.md template --------------------------------------------
# Written to disk verbatim the first time the tool runs without a brief.md.
BRIEF_TEMPLATE = """# Twitter Reply Brief

## Positioning
I am Nic Vandewetering (@nic21vdw), a Structural EIT building CoLateral AI: software and AI tools for structural-engineering workflows. My positioning is at the intersection of structural engineering, AI coding agents (Claude Code, Codex), vibe coding, agentic engineering, professional review and verification, and building sophisticated vertical software without a traditional software team.

## Core angles
- Code generation is becoming cheap; judgment, verification, and problem definition become more valuable
- More agents increase review and coordination requirements unless design intent and acceptance criteria are explicit
- In professional engineering, an AI system must preserve assumptions, expose uncertainty, document decisions, and support human review
- The valuable product is the verification and workflow harness around the model, not the model-generated output itself
- AI tools become valuable in vertical industries when they understand the review process, not merely the calculation
- Output volume is a poor metric unless the output can be efficiently validated
- Professional workflows need traceability, controlled assumptions, and clear responsibility boundaries

## Search topics
Claude Code, Codex, agentic engineering, vibe coding, AI coding agents, parallel agents, harness engineering, context engineering, AI code review, evaluation and verification, vertical AI, AI tools for professional or regulated industries, human judgment as the bottleneck, moving from prototypes to reliable production systems

## Accounts to check regularly
@mvanhorn, @petergyang, @sachinrekhi, @martinfowler

## Voice rules
- Write like a sharp engineer who understands business and software
- Confident, specific, natural, respectful, slightly provocative when justified
- Based on consequences not abstract philosophy
- 2-4 sentences maximum
- Do NOT start with: Great post, Exactly, This, Couldn't agree more
- Do NOT use hashtags or emojis
- Do NOT sound like a motivational influencer
- Do NOT mention CoLateral unless directly relevant
- Do NOT turn the reply into a sales pitch
- Do NOT claim to be a licensed professional engineer
- Do NOT invent projects, results, revenue, customers, or statistics
- Do NOT use overly polished AI phrasing or excessive em dashes

## Selection criteria
- Published recently enough to still have an active conversation
- Directly relevant to AI-assisted software development
- Gives me an opportunity to add an engineering or professional-workflow perspective
- Has meaningful engagement but is not so overwhelmed with replies that mine will disappear
- Is not political, inflammatory, spammy, promotional bait, or engagement farming
- Only proceed if the best opportunity scores at least 80/100

## Execution instructions
Search recent posts using the suggested queries. Read the full post, linked material when necessary, and enough of the thread to understand context. Score possible posts on: relevance to positioning, freshness, credibility of the author, ability to add an original insight, probability of creating a real conversation, risk of sounding generic or self-promotional. Draft three possible replies privately. Critique them for generic language, unsupported claims, and AI-sounding phrasing. Choose and refine the strongest reply. Enter it into the X composer. Re-read it alongside the original post. Post it. Stop after posting one reply. Report: account replied to, summary of original post, exact reply posted, why this was the strongest opportunity, one possible follow-up response if the author replies.
"""


# The standard execution checklist appended to every Session Brief. Kept here
# (rather than parsed from brief.md) so the brief always carries a consistent
# set of instructions even if the user edits their brief's prose.
EXECUTION_INSTRUCTIONS = """\
EXECUTION INSTRUCTIONS FOR THIS SESSION
1. Search recent X posts using the suggested queries above and check the suggested accounts directly.
2. Evaluate each candidate: read the full post, any linked material, and enough of the thread for context.
3. Score each candidate out of 100 on: relevance to my positioning, freshness, author credibility, my ability to add an original engineering / professional-workflow insight, probability of creating a real conversation, and risk of sounding generic or self-promotional.
4. Only proceed if the best opportunity scores at least 80/100. If nothing clears 80, report that and stop.
5. Draft THREE possible replies privately, following all voice rules (2-4 sentences, no hashtags/emojis, no generic openers, no sales pitch, no invented facts).
6. Critique the three drafts for generic language, unsupported claims, and AI-sounding phrasing.
7. Choose and refine the single strongest reply.
8. Enter it into the X composer and re-read it alongside the original post.
9. Post it. Stop after posting exactly ONE reply.
10. Report back: account replied to, a summary of the original post, the exact reply you posted, why this was the strongest opportunity, and one possible follow-up if the author replies.
"""


# --- File helpers ----------------------------------------------------------
def ensure_brief() -> str | None:
    """Return brief.md contents, or create a starter template and return None.

    Returning None signals to the caller that the brief was just created and the
    user should review/fill it in before continuing.
    """
    if not os.path.exists(BRIEF_FILE):
        with open(BRIEF_FILE, "w", encoding="utf-8") as fh:
            fh.write(BRIEF_TEMPLATE)
        print(f"Created a starter brief at:\n  {BRIEF_FILE}\n")
        print(
            "Review and edit it to match your positioning, voice, and strategy,\n"
            "then run the tool again to build today's Session Brief."
        )
        return None

    with open(BRIEF_FILE, "r", encoding="utf-8") as fh:
        content = fh.read().strip()

    if not content:
        print(f"Your brief at {BRIEF_FILE} is empty. Fill it in and run again.")
        return None

    return content


def load_log() -> list[dict]:
    """Return the list of logged replies, creating an empty log if needed."""
    if not os.path.exists(LOG_FILE):
        save_log([])
        return []

    try:
        with open(LOG_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Warning: could not read {LOG_FILE} ({exc}). Treating it as empty.")
        return []

    if not isinstance(data, list):
        print(f"Warning: {LOG_FILE} is not a list. Treating it as empty.")
        return []

    return data


def save_log(entries: list[dict]) -> None:
    """Write the reply log back to disk (pretty-printed, stable ordering)."""
    with open(LOG_FILE, "w", encoding="utf-8") as fh:
        json.dump(entries, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


# --- Log analysis ----------------------------------------------------------
def _parse_date(value: str) -> date | None:
    """Parse an ISO date string (YYYY-MM-DD), tolerating bad/missing values."""
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def analyze_log(entries: list[dict]) -> dict:
    """Compute the rolling stats the Session Brief needs from the reply log."""
    today = date.today()
    cutoff_7 = today - timedelta(days=7)
    cutoff_14 = today - timedelta(days=14)
    cutoff_30 = today - timedelta(days=30)

    accounts_7d: list[str] = []
    topics_14d: list[str] = []
    total_this_month = 0
    account_counts_30d: dict[str, int] = {}

    for entry in entries:
        entry_date = _parse_date(entry.get("date", ""))
        if entry_date is None:
            continue

        account = (entry.get("account") or "").strip()
        topic = (entry.get("topic") or "").strip()

        if entry_date >= cutoff_7 and account:
            accounts_7d.append(account)

        if entry_date >= cutoff_14 and topic:
            topics_14d.append(topic)

        if entry_date.year == today.year and entry_date.month == today.month:
            total_this_month += 1

        if entry_date >= cutoff_30 and account:
            key = account.lower()
            account_counts_30d[key] = account_counts_30d.get(key, 0) + 1

    # De-duplicate while preserving first-seen order and original casing.
    def _dedupe(items: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for item in items:
            low = item.lower()
            if low not in seen:
                seen.add(low)
                out.append(item)
        return out

    # Map a lowercased handle back to its most recent original-cased form.
    display_for: dict[str, str] = {}
    for entry in entries:
        account = (entry.get("account") or "").strip()
        if account:
            display_for[account.lower()] = account

    frequent_accounts = [
        (display_for.get(key, key), count)
        for key, count in account_counts_30d.items()
        if count > 2
    ]
    frequent_accounts.sort(key=lambda pair: pair[1], reverse=True)

    return {
        "accounts_7d": _dedupe(accounts_7d),
        "topics_14d": _dedupe(topics_14d),
        "total_this_month": total_this_month,
        "frequent_accounts": frequent_accounts,
    }


def print_analysis(analysis: dict) -> None:
    """Show the log analysis on screen before building the brief."""
    print("\n=== Reply log analysis ===")

    accounts_7d = analysis["accounts_7d"]
    print(f"\nAccounts replied to in the last 7 days ({len(accounts_7d)}):")
    print("  " + (", ".join(accounts_7d) if accounts_7d else "(none)"))

    topics_14d = analysis["topics_14d"]
    print(f"\nTopics covered in the last 14 days ({len(topics_14d)}):")
    print("  " + (", ".join(topics_14d) if topics_14d else "(none)"))

    print(f"\nTotal replies posted this month: {analysis['total_this_month']}")

    frequent = analysis["frequent_accounts"]
    if frequent:
        print("\nFLAG - accounts replied to more than twice in 30 days:")
        for account, count in frequent:
            print(f"  {account}: {count} times")
    else:
        print("\nNo accounts replied to more than twice in the last 30 days.")


# --- AI search-strategy generation ----------------------------------------
def generate_search_strategy(brief: str, analysis: dict, focus: str) -> str | None:
    """Ask Claude for today's search queries and account suggestions.

    Returns the generated text, or None if anything goes wrong (missing SDK,
    missing API key, network/API error). All failures are non-fatal: the caller
    falls back to the static brief content.
    """
    if anthropic is None:
        print(
            "\nWarning: the 'anthropic' package is not installed, so AI search "
            "suggestions are unavailable.\nInstall it with: pip install anthropic"
        )
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print(
            "\nWarning: ANTHROPIC_API_KEY is not set, so AI search suggestions are "
            "unavailable.\nSet it and re-run to include them."
        )
        return None

    accounts_avoid = ", ".join(analysis["accounts_7d"]) or "(none yet)"
    topics_recent = ", ".join(analysis["topics_14d"]) or "(none yet)"
    focus_line = focus.strip() if focus.strip() else "(open — no specific focus today)"

    user_prompt = f"""\
Here is my Twitter/X positioning and reply strategy:

{brief}

Recent reply history (to avoid repeating):
- Accounts I replied to in the last 7 days: {accounts_avoid}
- Topics I covered in the last 14 days: {topics_recent}

Today's focus topic: {focus_line}

Given this positioning and recent reply history, generate 5 specific X search
queries I should run today to find strong reply opportunities. Also suggest 3
accounts I should check directly based on the positioning context (avoid the
accounts I replied to in the last 7 days). Prefer fresh angles over topics I
already covered recently, and lean toward today's focus topic if one is given.

Format your answer as a ready-to-use list with two clearly labelled sections:
"SEARCH QUERIES" (numbered 1-5) and "ACCOUNTS TO CHECK" (3 handles, each with a
one-line reason). Do not add any other commentary."""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=(
                "You are a sharp social-media strategist helping a structural "
                "engineer who builds AI tooling find high-quality reply "
                "opportunities on X. Be specific and practical."
            ),
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception as exc:  # noqa: BLE001 - any failure must stay non-fatal
        print(
            f"\nWarning: the Anthropic API call failed ({exc}).\n"
            "Continuing without AI-generated search suggestions."
        )
        return None

    # Collect all text blocks from the response.
    parts = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    text = "\n".join(parts).strip()
    return text or None


# --- Session Brief assembly ------------------------------------------------
def assemble_session_brief(brief: str, analysis: dict, focus: str, strategy: str | None) -> str:
    """Build the full copy-paste Session Brief block."""
    today_str = date.today().strftime("%Y-%m-%d")
    accounts_avoid = ", ".join(analysis["accounts_7d"]) or "(none)"
    topics_recent = ", ".join(analysis["topics_14d"]) or "(none)"
    focus_line = focus.strip() if focus.strip() else "(open — no specific focus today)"

    if strategy:
        strategy_block = strategy
    else:
        strategy_block = (
            "(AI-generated suggestions unavailable for this session.)\n"
            "Fall back to the 'Search topics' and 'Accounts to check regularly' "
            "sections in my brief above to choose what to search and check today."
        )

    divider = "=" * 70

    return f"""\
{divider}
DAILY X REPLY SESSION BRIEF — {today_str}
{divider}

--- MY POSITIONING & STRATEGY ---
{brief}

--- TODAY'S CONTEXT ---
Date: {today_str}
Today's focus topic: {focus_line}

Accounts to AVOID this week (replied to in the last 7 days):
{accounts_avoid}

Topics already covered recently (last 14 days):
{topics_recent}

--- SUGGESTED SEARCH STRATEGY ---
{strategy_block}

--- {EXECUTION_INSTRUCTIONS}{divider}
"""


def maybe_copy_to_clipboard(text: str) -> None:
    """Offer to copy the brief to the clipboard, handling pyperclip gracefully."""
    if pyperclip is None:
        print(
            "\n(Clipboard copy unavailable: install 'pyperclip' to enable it — "
            "pip install pyperclip)"
        )
        return

    answer = input("\nCopy to clipboard? (y/n): ").strip().lower()
    if answer not in {"y", "yes"}:
        return

    try:
        pyperclip.copy(text)
        print("Copied the Session Brief to your clipboard.")
    except Exception as exc:  # noqa: BLE001 - clipboard backends vary by platform
        print(
            f"Could not copy to clipboard ({exc}).\n"
            "On Linux you may need 'xclip' or 'xsel' installed. "
            "The brief is printed above — copy it manually."
        )


# --- Commands --------------------------------------------------------------
def cmd_build() -> int:
    """Default command: assemble and display today's Session Brief."""
    brief = ensure_brief()
    if brief is None:
        return 0  # Brief was just created (or empty); nothing more to do today.

    entries = load_log()
    analysis = analyze_log(entries)
    print_analysis(analysis)

    focus = input("\nToday's focus topic (press Enter to leave open): ").strip()

    print("\nGenerating today's search strategy...")
    strategy = generate_search_strategy(brief, analysis, focus)

    session_brief = assemble_session_brief(brief, analysis, focus, strategy)

    print("\n")
    print(session_brief)

    maybe_copy_to_clipboard(session_brief)

    print("\nPaste the Session Brief into your Claude browser session to run it.")
    print("After you post a reply, log it with: python twitter_prep.py --log")
    return 0


def cmd_log() -> int:
    """Append a posted reply to the reply log."""
    print("Log a reply you just posted. Required fields cannot be left blank.\n")

    account = input("Account replied to (e.g. @JayTL00): ").strip()
    if not account:
        print("Account is required. Nothing logged.")
        return 1

    topic = input("Short topic description (e.g. Databricks Omnigent meta-harness): ").strip()
    if not topic:
        print("Topic is required. Nothing logged.")
        return 1

    reply_text = input("Exact reply text you posted: ").strip()
    if not reply_text:
        print("Reply text is required. Nothing logged.")
        return 1

    engagement = input("Engagement notes (optional, press Enter to skip): ").strip()

    entry = {
        "date": date.today().strftime("%Y-%m-%d"),
        "account": account,
        "topic": topic,
        "reply": reply_text,
        "engagement": engagement,
    }

    entries = load_log()
    entries.append(entry)
    save_log(entries)

    print(f"\nLogged reply to {account} on {entry['date']}.")
    print(f"Total replies in log: {len(entries)}.")
    return 0


def cmd_summary() -> int:
    """Print a table of all replies from the last 30 days."""
    entries = load_log()
    today = date.today()
    cutoff = today - timedelta(days=30)

    recent = []
    for entry in entries:
        entry_date = _parse_date(entry.get("date", ""))
        if entry_date is not None and entry_date >= cutoff:
            recent.append((entry_date, entry))

    if not recent:
        print("No replies logged in the last 30 days.")
        return 0

    recent.sort(key=lambda pair: pair[0])

    # Column widths chosen to stay readable in a standard terminal.
    date_w, acct_w, topic_w, reply_w, eng_w = 10, 16, 24, 80, 24
    header = (
        f"{'Date':<{date_w}}  {'Account':<{acct_w}}  {'Topic':<{topic_w}}  "
        f"{'Reply (first 80 chars)':<{reply_w}}  {'Engagement':<{eng_w}}"
    )
    print(f"\nReplies in the last 30 days ({len(recent)}):\n")
    print(header)
    print("-" * len(header))

    for entry_date, entry in recent:
        account = (entry.get("account") or "")[:acct_w]
        topic = (entry.get("topic") or "")[:topic_w]
        reply = (entry.get("reply") or "").replace("\n", " ")[:reply_w]
        engagement = (entry.get("engagement") or "")[:eng_w]
        print(
            f"{entry_date.strftime('%Y-%m-%d'):<{date_w}}  {account:<{acct_w}}  "
            f"{topic:<{topic_w}}  {reply:<{reply_w}}  {engagement:<{eng_w}}"
        )

    print(f"\nTotal: {len(recent)} replies in the last 30 days.")
    return 0


# --- Entry point -----------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="twitter_prep.py",
        description=(
            "Prepare a daily X reply Session Brief, log replies you post, and "
            "review recent activity. This tool never posts anything itself."
        ),
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--log",
        action="store_true",
        help="Log a reply you just posted to reply_log.json.",
    )
    group.add_argument(
        "--summary",
        action="store_true",
        help="Print a table of all replies from the last 30 days.",
    )
    args = parser.parse_args(argv)

    try:
        if args.log:
            return cmd_log()
        if args.summary:
            return cmd_summary()
        return cmd_build()
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
