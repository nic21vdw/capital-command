# twitter-prep

A local Python CLI that prepares a daily Twitter/X reply **Session Brief** for a
human-reviewed Claude browser session. It helps you find and post **one
high-quality reply per day** that fits your positioning.

**It never posts anything.** The tool only generates the best possible input for
your Claude session and keeps a local log of the replies you actually post.

---

## What it does

Running `python twitter_prep.py`:

1. Loads your positioning from `brief.md` (creates a starter template on first run).
2. Loads your reply history from `reply_log.json` (creates an empty one on first run).
3. Analyzes the log and shows: accounts replied to in the last 7 days, topics
   covered in the last 14 days, total replies this month, and a flag for any
   account replied to more than twice in 30 days.
4. Prompts for an optional focus topic for the day.
5. Uses the Anthropic API to generate 5 X search queries and 3 accounts to check.
6. Assembles a single copy-paste **Session Brief** with your brief, today's
   context, the search strategy, and a standard execution checklist.
7. Optionally copies the brief to your clipboard.

If the API call fails for any reason (no key, no network, package missing), the
tool still produces the Session Brief from your static `brief.md` and just skips
the AI-generated suggestions, with a warning.

---

## Setup

Requires **Python 3.10+**.

```bash
cd twitter-prep
pip install -r requirements.txt
export ANTHROPIC_API_KEY="sk-ant-..."   # required for AI search suggestions
```

- `anthropic` is used for the search-strategy step.
- `pyperclip` is used for the optional clipboard copy. On Linux it needs a
  clipboard backend such as `xclip` or `xsel`. If `pyperclip` is missing, the
  tool simply skips the copy step.

Optional: set `TWITTER_PREP_MODEL` to override the model (default
`claude-opus-4-8`).

---

## Daily workflow

```bash
# 1. Build today's Session Brief (analyzes your log, asks for a focus topic,
#    generates the search strategy, and prints the brief).
python twitter_prep.py
#    -> when prompted, optionally copy it to your clipboard.

# 2. Paste the Session Brief into your Claude browser session and let it search,
#    evaluate, draft, critique, choose, and post ONE reply (you review and post).

# 3. After you post, log the reply.
python twitter_prep.py --log
#    -> enter: account, topic, exact reply text, optional engagement notes.

# 4. Review recent activity any time.
python twitter_prep.py --summary
```

---

## File structure

```
twitter-prep/
├── twitter_prep.py     # the CLI tool
├── requirements.txt    # anthropic, pyperclip
├── README.md           # this file
├── brief.md            # your positioning/voice/strategy (auto-created, you edit)
└── reply_log.json      # every reply you've logged (auto-created)
```

`brief.md` and `reply_log.json` are created next to the script on first run and
hold all of your local data. There is no database, web server, or other external
dependency. Both files are git-ignored so your personal data stays local.
