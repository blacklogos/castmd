# Phase 01: Frontmatter handling in `lib/markdown-to-html.js`

## Context Links

- Plan overview: [plan.md](plan.md)
- Brainstorm (prerequisite bug section): [../20260816-1835-edit-save-local-md/plan.md](../20260816-1835-edit-save-local-md/plan.md)
- Renderer: `/Users/trivo/Documents/md-convert/md-convert/lib/markdown-to-html.js`
- Tests: `/Users/trivo/Documents/md-convert/md-convert/tests/markdown-to-html.test.js`
- Harness: `/Users/trivo/Documents/md-convert/md-convert/tests/setup.js`

## Overview

The renderer has zero frontmatter awareness. A file starting with

```
---
title: Now
updated: 2026-08-16
---
```

hits the hr branch (`/^\s{0,3}([-*_])\s*(\1\s*){2,}$/` matches `---`), emits
`<hr>`, then collects `title: Now` + `updated: …` into one `<p>`, then a second
`<hr>`. Preview lies about the document before anyone edits it. Fix: detect a
leading YAML frontmatter block and drop it before block rendering.

Pure string work, no DOM, fully testable under node:test. Ship-able on its own.

## Key Insights

- Detection must run **before** `renderBlocks`, on the normalized line array. Otherwise the hr rule wins.
- Only a block at the *very start* counts. `---` anywhere else is an hr and must
  stay an hr. This is the single most likely regression.
- Unterminated fence (`---` at line 0, no closing `---` before EOF) is **not**
  frontmatter. Falls back to today's hr behavior. Do not silently swallow the
  rest of the file.
- CRLF is already normalized on line 96 (`markdownToHtml`). Frontmatter check
  goes right after that normalization, before `split('\n')` consumers.
- A leading BOM (`\uFEFF`) would break a naive `lines[0] === '---'` check. Strip
  one leading BOM during normalization.
- Chosen behavior: **strip**, render nothing. Matches Astro/Jekyll/Hugo and
  GitHub-ish expectations, zero new CSS, zero new API surface. The user still
  sees and can edit the raw frontmatter in Phase 03's textarea (the textarea is
  fed raw source, never the stripped version), so nothing is lost.
- Rejected alternative: render frontmatter as a styled `<pre>`/`<details>`
  block. More code + CSS + dark-mode variants for a metadata block the user
  rarely reads in preview. YAGNI. Noted as a possible later toggle.

## Requirements

Functional:
1. Leading `---\n … \n---\n` block removed from rendered output.
2. Content after the closing fence renders normally, starting with whatever
   block type it is (heading, paragraph, list, …).
3. Empty frontmatter (`---\n---\n`) removed, no output.
4. No leading fence → output byte-identical to today.
5. Unterminated leading fence → output byte-identical to today (hr + para).
6. Mid-document `---` → still `<hr>`.

Non-functional:
- No API/signature change: `markdownToHtml(markdown)` stays a one-arg pure fn.
- Existing 79 tests untouched and still passing.
- ≤ ~20 net new lines in the lib.

## Architecture

Add one private helper next to `markdownToHtml`:

```js
// Strip a leading YAML frontmatter block. Only a fence on the very first line
// counts. A `---` anywhere else is a horizontal rule. An unterminated fence is
// not frontmatter; the text renders as-is (hr + paragraph), same as before.
function stripFrontmatter(lines) {
  if (lines[0] !== '---') return lines;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return lines.slice(i + 1);
  }
  return lines; // unterminated
}
```

Wire in `markdownToHtml`:

```js
function markdownToHtml(markdown) {
  const lines = (markdown || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  return renderBlocks(stripFrontmatter(lines), 0);
}
```

Notes for the implementer:
- Exact `=== '---'` on the fence lines (no trailing-space tolerance, no `...`
  YAML terminator, no `+++` TOML). KISS; extend only if a real file demands it.
- Do **not** export `stripFrontmatter` on `global.MarkdownToHtml`. Nothing
  outside needs it; tests cover it through `markdownToHtml`. Keeps the public
  surface at the current three functions.

## Related Code Files

| Path | Action | Change |
|---|---|---|
| `/Users/trivo/Documents/md-convert/md-convert/lib/markdown-to-html.js` | modify | Add `stripFrontmatter`, call it from `markdownToHtml`, strip BOM |
| `/Users/trivo/Documents/md-convert/md-convert/tests/markdown-to-html.test.js` | modify | New `── Frontmatter ──` section, 6 cases |

No other file. `md-viewer.js` needs no change: it calls `markdownToHtml(raw)`
and keeps `raw` intact for the future textarea.

## Implementation Steps

1. Open `lib/markdown-to-html.js`. Add `stripFrontmatter` immediately above
   `markdownToHtml` (line ~95), with the comment block shown above.
2. Update `markdownToHtml` per the snippet: BOM strip, existing CRLF normalize,
   split, `stripFrontmatter(lines)` into `renderBlocks`.
3. Update the file header comment (lines 7-9) to mention frontmatter is stripped.
4. Add tests to `tests/markdown-to-html.test.js` under a new section header
   comment, matching existing `// ── Name ──` style, placed before `// ── Edge
   cases ──`:
   - `frontmatter — leading YAML block is stripped, content renders`
     input `'---\ntitle: Now\nupdated: 2026-08-16\n---\n# Hello\n\nbody'`
     assert `doesNotMatch(/<hr>/)`, `doesNotMatch(/title: Now/)`,
     `match(/^<h1 id="hello">Hello<\/h1>/)`.
   - `frontmatter — absent, document unchanged` compare
     `markdownToHtml('# Hello\n\nbody')` to a literal expected string.
   - `frontmatter — unterminated fence is not frontmatter`
     input `'---\ntitle: Now\n\nbody'` assert `match(/<hr>/)` and content still
     present.
   - `frontmatter — mid-document --- stays a horizontal rule`
     input `'# A\n\n---\n\ntitle: not frontmatter\n\n---\n\nend'` assert two
     `<hr>` (count via `html.match(/<hr>/g).length === 2`) and that
     `title: not frontmatter` is still rendered in a `<p>`.
   - `frontmatter — empty block` input `'---\n---\n# H'` → `<h1` only, no `<hr>`.
   - `frontmatter — CRLF frontmatter stripped too` input with `\r\n` line
     endings, same assertions as case 1.
5. `npm test` → expect 85 pass, 0 fail.

## Todo List

- [ ] `stripFrontmatter` helper added
- [ ] `markdownToHtml` normalization updated (BOM + strip call)
- [ ] Header comment updated
- [ ] 6 new tests added in matching style
- [ ] `npm test` green (85/85)
- [ ] Sanity-run against a real frontmatter file (`node -e` one-liner using
      `tests/setup.js`'s `loadLib`, reading the actual `now.md`) and eyeball
      the HTML head

## Success Criteria

- `npm test` reports `pass 85 / fail 0`.
- Rendering the real `now.md` produces no `<hr>` before the first heading and no
  `title:` text in a paragraph.
- Diff on `lib/markdown-to-html.js` is < 25 lines.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mid-doc `---` regressed into a strip | Low | High (data hidden from preview) | Dedicated test case 4; the `lines[0]` guard is the only entry point |
| Unterminated fence swallows the doc | Low | High | Explicit fallback returns original array; test case 3 |
| Frontmatter with trailing whitespace on fence (`--- `) not detected | Medium | Low | Accepted; renders as today. Loosen to `.trim()` only if a real file hits it |
| `+++` TOML / `---` … `...` YAML terminators unsupported | Low | Low | Out of scope; castmd targets `.md` from Astro/Obsidian which use `---` |

## Security Considerations

- Stripping *removes* content from the render path; it cannot introduce markup.
  Everything still flows through `escapeHtml`/`safeUrl` downstream.
- No regex over the whole document (only line-0 equality + a bounded forward
  scan), so no ReDoS surface added.
- A file that is one giant unterminated `---` block still terminates in O(n).

## Next Steps

Phase 02: flip the content script to the MAIN world. Independent of this
change but ordered after it so the first manual Chrome QA already shows correct
frontmatter rendering.
