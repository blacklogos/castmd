# Phase 01 — Extract HTML→MD conversion module

## Goal

Pull the pure HTML→Markdown conversion functions out of `content.js` into `lib/html-to-markdown.js` so `popup.js` (and future Confluence flow) can reuse them without injecting a content script.

## Why

Confluence export fetches HTML via API in **popup context** — no target tab to inject into. Without extraction we'd duplicate conversion logic a third time (we already have one duplication in `background.js`'s `extractContent`).

## Scope

- Extract ONLY the pure functions (no DOM-traversal-of-current-page, no `document.*` globals that assume the page context).
- Functions that take an HTMLElement/string and return MD string.
- Leave `content.js` working as-is — it can keep its copy OR re-import. **Recommendation: keep its copy untouched this phase**. Refactoring content.js is its own risk; do it later if/when content.js needs a real change.

## Files

- **New**: `lib/html-to-markdown.js` — exposes `window.HtmlToMarkdown = { convertHtmlString, convertElement, sanitizeFileName }` (or similar; whatever the cleanest signature is after inspecting current code).
- **Edit**: `popup.html` — add `<script src="lib/html-to-markdown.js"></script>` before `popup.js`.

## Steps

1. Read `content.js` end-to-end. List which functions are pure (input → output, no page DOM dependencies).
2. Create `lib/html-to-markdown.js`. Copy pure functions verbatim. Expose via `window.HtmlToMarkdown`.
3. Add script tag in `popup.html`.
4. Smoke-test in extension: load unpacked, open popup on any page, run existing "Convert" button — must still work identically.
5. Verify no console errors / no double-execution / no CSP warnings.

## Done when

- `lib/html-to-markdown.js` exists, loaded by popup, callable from `popup.js` console.
- All existing popup features (convert, outline, copy, download) unchanged.
- No regressions on 3 sample pages (a blog post, a docs site, a long article).

## Out of scope

- Refactoring `content.js` to use the new module
- Refactoring `background.js`'s `extractContent`
- Adding tests (project has no test suite — manual verification only)

## Open questions

- Should sanitizeFileName live here or stay in content.js? Likely both — sanitization is used by Confluence export's filename generation. Duplicate for now, deal with it if it diverges.
