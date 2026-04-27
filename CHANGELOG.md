## v1.0.0 — 2026-04-27

### New features
- Light theme popup (Linear/Vercel/Raycast-inspired — white bg, violet glow hover)
- Output modes: MD · JSON · XML (Claude `<document>` wrapper format)
- Token count + model fit display — gpt-4, gpt-4o, claude, gemini
- All-tabs export — merge all open tabs into one Markdown session document
- Preview & edit panel — review and tweak output before re-copying or saving
- Right-click context menu — "Copy page as Markdown" on any page
- Keyboard shortcut — `Ctrl+Shift+M`
- Inline formatting preserved — bold, italic, links, inline code survive conversion

### Improvements
- Smart content detection — removes nav, sidebars, footers automatically
- GitHub support — adds `.markdown-body`, `#readme` selectors
- ARIA role-based skip (was tag-based — caused GitHub content to be stripped)
- Context menus registered on `onInstalled` + `onStartup` (survives service worker restart)

### Changes
- Rebranded from md·convert → castmd
- Removed URL analyzer and outline extractor (niche features)
- Removed selection+context copy (unreliable across SPA pages)
- Trimmed permissions footprint (removed `webRequest`, `storage`, `host_permissions`)
