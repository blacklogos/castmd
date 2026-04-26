# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Chrome Extension (Manifest V3) that converts webpage HTML to Markdown, extracts heading outlines, and analyzes arbitrary URLs. No build step — files are loaded directly by Chrome.

## Loading & Testing

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select this directory
4. After code changes, click the reload icon on the extension card

There is no test suite. Verification is manual in the browser.

## Architecture

```
manifest.json       Extension config (MV3, permissions, entry points)
popup.html/js       Extension popup UI — orchestrates all user actions
content.js          Injected into every page — core conversion logic
background.js       Service worker — handles URL analysis via temp tabs
outline.html/js     Standalone page for extracting outlines from pasted MD
```

### Message Flow

```
popup.js  ──(chrome.tabs.sendMessage)──►  content.js   (convert, getOutline, getPageTitle)
popup.js  ──(chrome.runtime.sendMessage)──►  background.js  (analyzeUrl)
background.js  ──(scripting.executeScript)──►  extractContent() runs in temp tab
```

### Key Design Decisions

- **Content detection** (`findMainContent`): tries semantic HTML selectors in priority order (`main`, `article`, `[role="main"]`, etc.), falls back to content-density analysis (text length minus link text, divided by element count).
- **`shouldSkipElement`**: filters out nav/header/footer/sidebar elements. This logic is **intentionally duplicated** in both `content.js` and inside `background.js`'s `extractContent` function — the latter runs via `scripting.executeScript` in a separate tab context where it can't reference outer scope.
- **Filename sanitization** (`sanitizeFileName` in `content.js`): uses the URL pathname slug, falls back to hostname, caps at 35 chars.
- **Theme persistence**: stored in `chrome.storage.local` under key `theme`. Vampire theme (Easter egg) stored separately under `vampireTheme`, triggered by 5 rapid clicks on `.credits`.

### Permissions Used

`activeTab`, `scripting`, `clipboardWrite`, `webRequest`, `tabs`, `storage`, `host_permissions: <all_urls>`

## Known Duplicated Code

`findMainContent`, `isValidContentContainer`, `findContentByDensity`, `getContentDensity`, `shouldSkipElement`, `findPageTitle`, `cleanText` all exist in both `content.js` (top-level functions) and `background.js` (nested inside `extractContent`). This is required by Chrome's `scripting.executeScript` serialization constraint — only self-contained functions can be injected.
