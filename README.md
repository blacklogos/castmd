# cast.md

**Cast any page. Feed any model.**

A Chrome extension that converts webpages to clean Markdown for LLM workflows. One click → clipboard-ready MD, JSON, or Claude XML. Token-aware.

## Features

- **Instant conversion** — Copy any webpage as Markdown in one click
- **Inline formatting preserved** — Bold, italic, links, inline code survive the conversion
- **Token counting** — See exact token estimates after every conversion
- **Model fit display** — Instantly know if content fits gpt-4, gpt-4o, Claude, or Gemini
- **Output modes** — MD · JSON · XML (Claude `<document>` format)
- **All-tabs export** — Merge all open tabs into one Markdown session document
- **Smart content detection** — Auto-excludes nav, sidebars, footers
- **Right-click** — "Copy page as Markdown" from any page
- **Keyboard shortcut** — `Ctrl+Shift+M`
- **Preview & edit** — Review and tweak output before re-copying or saving

## Install

1. `chrome://extensions/` → Enable Developer mode
2. Load unpacked → select this directory

## Usage

Open the popup → choose output mode (MD / JSON / XML) → click an action.

| Action | Result |
|---|---|
| Copy as Markdown | Full page MD → clipboard |
| Save as .md | Downloads .md file |
| Copy Outline | Headings-only outline → clipboard |
| Copy all tabs | All open tabs merged → clipboard |
| Copy for Claude | Page wrapped in `<document>` XML tags |

## Credits

Built by [cc4.marketing](https://cc4.marketing)
