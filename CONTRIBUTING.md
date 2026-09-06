# Contributing to castmd

Thanks for your interest! castmd is a Chrome Extension (Manifest V3) with no build step — files load directly into Chrome, so getting started is quick.

## Development setup

### Prerequisites

- Google Chrome (or any Chromium-based browser supporting MV3)
- Git
- A text editor

No Node, npm, or compilers required. Optional: `gh` CLI for releases, `wrangler` for landing-page deploys.

### Clone and load

```bash
git clone https://github.com/blacklogos/castmd.git
cd castmd
```

Then in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the cloned folder
4. The castmd icon should appear in the toolbar

After editing any file, click the **reload icon** on the extension card. To make sure your changes apply on already-open tabs, **close and reopen** the tab — `content.js` is injected once per page load.

## Project layout

```
manifest.json        Extension config (MV3, permissions, entry points)
popup.html / popup.js   Toolbar popup UI — orchestrates user actions
content.js           Injected into every page — core conversion logic
background.js        Service worker — context menu, keyboard shortcut
outline.html / outline.js   Standalone page (extract outline from pasted MD)
index.html           Landing page (deployed to Cloudflare Pages)
```

See `CLAUDE.md` for architecture details, message flow, and the rationale behind specific design decisions.

## Making changes

### 1. Branch

```bash
git checkout main && git pull
git checkout -b feat/your-feature      # or fix/your-bug
```

### 2. Code style

There's no linter — match the patterns in the file you're editing:

- Two-space indentation
- Single quotes for strings, template literals for interpolation
- Comments only when the *why* isn't obvious from the code
- Prefer small helpers over deeply-nested logic

### 3. Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add save all tabs export
fix: extract every.to articles correctly
docs: update README install steps
chore: bump dev dependencies
release: v1.1.0 — short summary
```

### 4. Run the tests

```bash
npm install
npm run test:all      # lib unit tests + Chrome-driven e2e
```

- `npm test` covers the pure modules in `lib/` under Node.
- `npm run test:e2e` loads the extension into Chrome for Testing and drives it
  with puppeteer: popup, content script injection, service worker, the local
  `.md` viewer/editor, and the Confluence export against a stubbed tenant.
  The browser is downloaded once into `~/.cache/puppeteer`; `CHROME_PATH`
  points at your own binary and `CASTMD_E2E_HEADED=1` shows the window.
  Branded Google Chrome will not work — it ignores `--load-extension`.

A conversion change belongs in both `content.js` and `lib/html-to-markdown.js`
(see "Known Duplicated Code" in `CLAUDE.md`); add a case to
`tests/html-to-markdown.test.js` and, when the fix depends on a live page, to
`tests/e2e/fixtures/article.html`.

### 5. Verify in the browser

Automated coverage does not replace a look at the real thing:

- Reload the extension at `chrome://extensions/`
- Open a fresh tab on a page representative of the change
- Exercise the affected action (Copy MD, Save .md, Copy outline, Copy/Save all tabs, right-click, keyboard shortcut)
- Test on at least 2–3 different sites if you touched content detection
- Watch the Chrome DevTools console (popup + page) for errors

If you fix a content-detection bug, mention the specific URL(s) you verified against in the PR description so reviewers can spot-check.

### 6. Open a pull request

```bash
git push origin feat/your-feature
gh pr create --title "feat: short description" --body "Closes #N"
```

**PR checklist:**

- [ ] `npm run test:all` passes
- [ ] Verified manually in Chrome on the affected site(s)
- [ ] No console errors in popup or content script
- [ ] Commit messages follow Conventional Commits
- [ ] One logical change per PR

## What we're looking for

- Bug fixes for sites where content detection misses or mangles the article
- New output modes or export formats
- Performance/quality improvements to the Markdown conversion (lists, tables, code blocks, inline formatting)
- Accessibility improvements to the popup UI

## What we're NOT looking for

- Build tools, bundlers, or transpilers — we want files to stay loadable directly
- Heavy dependencies — keep the extension small and auditable
- Features outside the "page → clean Markdown for LLMs" scope
- Style-only refactors with no functional improvement

## Releasing (maintainers)

Use the `/release` workflow which handles version bumps across `manifest.json`, `content.js` (`CONTENT_VERSION`), and `index.html`, then tags, builds the zip, and creates a GitHub release.

## Need help?

- Open an [issue](https://github.com/blacklogos/castmd/issues)
- Read [`CLAUDE.md`](CLAUDE.md) for architecture context
- Read [`README.md`](README.md) for user-facing docs
