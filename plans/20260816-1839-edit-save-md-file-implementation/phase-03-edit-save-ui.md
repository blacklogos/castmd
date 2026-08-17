# Phase 03: Edit/Save toolbar + textarea in the viewer

## Context Links

- Plan overview: [plan.md](plan.md)
- UI decision (plain textarea, no live preview): [../20260816-1835-edit-save-local-md/plan.md](../20260816-1835-edit-save-local-md/plan.md) ("Decisions")
- `/Users/trivo/Documents/md-convert/md-convert/md-viewer.js`
- `/Users/trivo/Documents/md-convert/md-convert/md-viewer.css`
- Pattern source: `/Users/trivo/Documents/md-convert/md-convert/popup.html` lines 205-281 (`.preview-panel`, `.preview-textarea`, `.preview-actions`) and 437-461 (markup)
- Pattern source: `/Users/trivo/Documents/md-convert/md-convert/popup.js` lines 221-231, 326-331 (open/close + read `.value`)

## Overview

Add a small toolbar to the rendered viewer with two buttons: **Edit** (toggles
to a `<textarea>` holding the raw markdown) and **Save** (only visible in edit
mode; wired to disk in Phase 04. Here it is a no-op stub with a status
message). Toggling back re-renders the preview from the textarea's current
value so the user sees their edits without saving.

No split pane, no live preview, no WYSIWYG. Explicitly rejected in brainstorm.

## Key Insights

- The raw source already exists in the DOM: `<pre class="castmd-raw" hidden>`
  kept by the current code. Textarea is seeded from `raw` (the same string
  passed to the renderer): **the unmodified source including frontmatter**.
  Phase 01 strips frontmatter for *rendering only*; the editor and any future
  save must never see the stripped version, or saving would delete metadata.
- One toggle button beats Edit/Cancel/Done triples. `Edit ⇄ Preview` on the same
  button, plus `Save` shown only in edit mode. Two DOM nodes, no modal state.
- Re-rendering preview on toggle-back is one `markdownToHtml(textarea.value)`
  call. The renderer is pure and fast. No need to diff or cache.
- Textarea stays in the DOM (hidden) when previewing, so unsaved text survives
  toggling. Single source of truth after first edit = `textarea.value`.
- `md-viewer.css` is injected on every markdown file:// page, so all new rules
  must stay scoped (`.castmd-*`) exactly like existing ones. No bare element
  selectors.
- The popup's palette (violet `#a78bfa` focus glow, `#e5e7eb` borders,
  `#fafafa` fill) is a 320px popup style. Adapt sizes to a full page: 14px
  monospace, `min-height: 70vh`, max-width 800px matching `.castmd-viewer`.
  Keep the focus-glow accent so it reads as castmd.
- Dark mode: `md-viewer.css` already has a `prefers-color-scheme: dark` block.
  Every new rule needs a counterpart there or the editor will be white-on-dark.
- MAIN world: no `chrome.*` for icons/i18n. Buttons are text labels, not the
  inline SVGs popup.html uses (SVG markup in JS strings would bloat the file).

## Requirements

Functional:
1. Toolbar visible on any successfully-rendered markdown file:// page.
2. `Edit` swaps `<article class="castmd-viewer">` (hidden) for the textarea
   (shown), focuses it, and reveals `Save`. Button label becomes `Preview`.
3. `Preview` re-renders the article from `textarea.value`, hides textarea,
   hides `Save`, label back to `Edit`.
4. Textarea is pre-filled with the **raw** markdown source, frontmatter included.
5. A status slot in the toolbar can show transient text (`Saved`, error). Used
   by Phase 04.
6. `Save` in this phase: stub handler that logs/sets status `Not wired yet`.
   Phase 04 replaces the body, not the wiring.

Non-functional:
- `md-viewer.js` stays under ~150 lines total, single IIFE, two-space indent,
  single quotes. If it approaches 200, split the editor into `md-editor.js`
  loaded before `md-viewer.js` (per repo file-size rule). Prefer not to.
- No new dependency, no build step, no `chrome.*`.
- Toolbar must not appear in print output.

## Architecture

DOM after Phase 03 (body children in order):

```
<div class="castmd-toolbar">
  <button class="castmd-btn" id="castmd-toggle">Edit</button>
  <button class="castmd-btn" id="castmd-save" hidden>Save</button>
  <span class="castmd-status" role="status" aria-live="polite"></span>
</div>
<article class="castmd-viewer">…rendered…</article>
<textarea class="castmd-editor" spellcheck="false" hidden>…raw…</textarea>
<pre class="castmd-raw" hidden>…original…</pre>
```

`md-viewer.js` structure (still one IIFE, appended after the existing insert):

```js
// ── Editor ────────────────────────────────────────────────────────────────
const editor = document.createElement('textarea');
editor.className = 'castmd-editor';
editor.spellcheck = false;
editor.value = raw;          // raw source, frontmatter included
editor.hidden = true;

const toolbar = document.createElement('div');
toolbar.className = 'castmd-toolbar';
const toggleBtn = makeButton('Edit');
const saveBtn = makeButton('Save');
saveBtn.hidden = true;
const status = document.createElement('span');
status.className = 'castmd-status';
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
toolbar.append(toggleBtn, saveBtn, status);

function setStatus(text) {
  status.textContent = text;
  if (text) setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 4000);
}

function setEditing(on) {
  editor.hidden = !on;
  container.hidden = on;
  saveBtn.hidden = !on;
  toggleBtn.textContent = on ? 'Preview' : 'Edit';
  if (on) editor.focus();
  else container.innerHTML = window.MarkdownToHtml.markdownToHtml(editor.value);
}

toggleBtn.addEventListener('click', () => setEditing(editor.hidden));
saveBtn.addEventListener('click', () => setStatus('Not wired yet')); // Phase 04
body.insertBefore(toolbar, container);
body.insertBefore(editor, rawPre);
```

`makeButton(label)` = 4-line helper (`createElement('button')`, `type='button'`,
`className='castmd-btn'`, `textContent=label`).

**Phase 04 contract:** the `saveBtn` click listener body is replaced in place.
It must remain a listener registered directly on the button, and its first
`await` must be the `showSaveFilePicker()` call. Nothing async may run before
it. Do not refactor this into a promise chain or a message handler.

CSS additions to `md-viewer.css` (light block + dark-mode counterparts):

```css
.castmd-toolbar { position: sticky; top: 0; z-index: 2; display: flex; gap: 6px;
  align-items: center; max-width: 800px; margin: 0 auto; padding: 8px 1.5rem;
  background: #ffffff; }
.castmd-btn { font: inherit; font-size: 13px; padding: 4px 12px; border: 1px solid #e5e7eb;
  border-radius: 6px; background: #fafafa; color: #374151; cursor: pointer; }
.castmd-btn:hover { border-color: #a78bfa; }
.castmd-status { font-size: 12px; color: #9ca3af; }
.castmd-editor { display: block; box-sizing: border-box; width: 100%; max-width: 800px;
  min-height: 70vh; margin: 0 auto; padding: 1rem;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 14px; line-height: 1.6; color: #374151; background: #fafafa;
  border: 1px solid #e5e7eb; border-radius: 6px; resize: vertical; outline: none; }
.castmd-editor:focus { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(124,106,247,0.06); }
@media print { .castmd-toolbar { display: none; } }
```

Dark block additions (inside the existing `@media (prefers-color-scheme: dark)`):
toolbar `background: #0d1117`; `.castmd-btn` `background:#161b22; color:#f0f6fc;
border-color:#3d444d`; `.castmd-editor` `background:#0d1117; color:#f0f6fc;
border-color:#3d444d`.

Also extend the existing `body:has(> .castmd-viewer)` normalize rule so it also
matches when the viewer is hidden in edit mode: add
`body:has(> .castmd-toolbar)` to that selector list (both light and dark).

## Related Code Files

| Path | Action | Change |
|---|---|---|
| `/Users/trivo/Documents/md-convert/md-convert/md-viewer.js` | modify | Append editor/toolbar block inside the existing IIFE; keep `raw` in scope |
| `/Users/trivo/Documents/md-convert/md-convert/md-viewer.css` | modify | `.castmd-toolbar`, `.castmd-btn`, `.castmd-status`, `.castmd-editor` + dark + print rules; extend body normalize selector |

Read-only references: `popup.html` (styling pattern), `popup.js` (textarea
`.value` usage). Do not modify either.

## Implementation Steps

1. `md-viewer.js`: keep everything up to `body.insertBefore(container, rawPre);`
   as-is. Below it, add the `// ── Editor ──` section from Architecture.
2. Add the `makeButton` helper above that section.
3. Confirm `raw`, `container`, `rawPre`, `body` are all still in IIFE scope at
   that point (they are: all `const` in the same function body).
4. `md-viewer.css`: append the light-mode rules after the `.castmd-viewer hr`
   block, before the dark-mode `@media`. Add the dark counterparts inside the
   existing dark `@media`. Add the `@media print` rule at the end.
5. Extend `body:has(> .castmd-viewer)` → `body:has(> .castmd-viewer), body:has(> .castmd-toolbar)` in both light and dark blocks.
6. Reload the unpacked extension, open a `.md` file, click Edit / Preview /
   Edit, edit some text, toggle back, confirm the render reflects edits.

## Todo List

- [ ] `makeButton` helper added
- [ ] Toolbar + textarea created and inserted
- [ ] `setEditing` toggle works both directions
- [ ] Textarea seeded from raw source (frontmatter visible in edit mode)
- [ ] `setStatus` helper with auto-clear
- [ ] Save button stub registered as a direct click listener
- [ ] CSS light rules added
- [ ] CSS dark rules added
- [ ] Print rule added
- [ ] Body normalize selector extended
- [ ] `md-viewer.js` still < 150 lines
- [ ] `npm test` still 85/85 (no lib change, but run it)
- [ ] Manual: edit → Preview shows edited content
- [ ] Manual: frontmatter file. Edit mode shows the `---` block, preview does not
- [ ] Manual: dark mode readable
- [ ] Manual: long file (>2000 lines). Textarea scrolls, no layout break

## Success Criteria

- Toolbar renders at top of every markdown file:// page, sticky on scroll.
- `Edit` shows a monospace textarea containing byte-identical raw source
  (verify: `document.querySelector('.castmd-editor').value === document.querySelector('.castmd-raw').textContent` in DevTools console → `true`).
- Toggling to Preview re-renders from the textarea, including newly typed text.
- No console errors. No visual change to the read-only path before clicking Edit
  beyond the toolbar row.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Textarea seeded from stripped/rendered text, frontmatter lost on save | Low but catastrophic | Data loss | Seed from `raw`; DevTools equality check in Success Criteria; Phase 05 QA re-checks after a real save |
| User edits, navigates away, loses work | Medium | Medium | Accepted for v1. `beforeunload` guard is ~4 lines. Deferred, listed in Next Steps, add only if user asks |
| Sticky toolbar overlaps first heading | Medium | Cosmetic | Toolbar has its own background + padding; verify on a doc starting with `# H1` |
| `md-viewer.js` grows past the 200-line file rule | Low | Maintainability | Split editor into `md-editor.js` (add to manifest `js` array before `md-viewer.js`) only if it happens |
| `:has()` selector unsupported | Very low | Cosmetic (body margins) | Chrome 105+; extension already relies on it today |

## Security Considerations

- `container.innerHTML = markdownToHtml(editor.value)` re-renders **user-typed**
  markdown through the same escaping renderer. Raw HTML still escaped,
  `javascript:`/`data:` still neutralized. Never bypass the renderer, never
  assign `editor.value` to `innerHTML` directly.
- Buttons are created with `createElement` + `textContent`, no HTML string
  templating, so no injection surface in the toolbar itself.
- No new listener on `window`/`document`: everything is button-scoped.
- MAIN world: page scripts could in principle read the textarea. On a file://
  markdown page there are none. No secrets involved anyway.

## Next Steps

Phase 04: replace the Save stub with `showSaveFilePicker` →
`createWritable()` → write, keeping the handle in module scope for the session.
