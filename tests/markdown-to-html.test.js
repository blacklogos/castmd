// Tests for lib/markdown-to-html.js — the renderer behind the local .md file
// viewer. Pure string in/out, no DOM needed (setup.js still provides globals
// the loadLib harness expects).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './setup.js';

loadLib('lib/markdown-to-html.js');
const { markdownToHtml, escapeHtml, safeUrl } = globalThis.MarkdownToHtml;

// ── Headings ────────────────────────────────────────────────────────────────

test('headings — h1 through h6 with slug ids', () => {
  assert.equal(markdownToHtml('# Hello World'), '<h1 id="hello-world">Hello World</h1>\n');
  assert.equal(markdownToHtml('###### Deep'), '<h6 id="deep">Deep</h6>\n');
});

test('headings — inline formatting inside heading', () => {
  assert.match(markdownToHtml('## A `code` title'), /<h2 id="a-code-title">A <code>code<\/code> title<\/h2>/);
});

test('headings — seven hashes is a paragraph, not a heading', () => {
  assert.match(markdownToHtml('####### nope'), /^<p>/);
});

// ── Paragraphs & inline ─────────────────────────────────────────────────────

test('paragraphs — split on blank lines', () => {
  const html = markdownToHtml('first para\n\nsecond para');
  assert.equal(html, '<p>first para</p>\n<p>second para</p>\n');
});

test('inline — bold, italic, strikethrough, code', () => {
  const html = markdownToHtml('**bold** *ital* ~~gone~~ `x=1`');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>ital<\/em>/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<code>x=1<\/code>/);
});

test('inline — underscore variants', () => {
  const html = markdownToHtml('__bold__ and _ital_');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>ital<\/em>/);
});

test('inline — code span content is not further formatted', () => {
  const html = markdownToHtml('`**not bold**`');
  assert.match(html, /<code>\*\*not bold\*\*<\/code>/);
  assert.doesNotMatch(html, /<strong>/);
});

test('inline — double-backtick code span containing a backtick', () => {
  const html = markdownToHtml('``a ` b``');
  assert.match(html, /<code>a ` b<\/code>/);
});

test('inline — links and images', () => {
  const html = markdownToHtml('[site](https://x.dev) ![pic](img.png)');
  assert.match(html, /<a href="https:\/\/x\.dev">site<\/a>/);
  assert.match(html, /<img src="img.png" alt="pic">/);
});

test('inline — autolink', () => {
  const html = markdownToHtml('see <https://example.com/a>');
  assert.match(html, /<a href="https:\/\/example\.com\/a">https:\/\/example\.com\/a<\/a>/);
});

test('inline — hard break on two trailing spaces', () => {
  const html = markdownToHtml('line one  \nline two');
  assert.match(html, /line one<br>\nline two/);
});

test('inline — loose asterisks stay literal', () => {
  const html = markdownToHtml('a * b * c');
  assert.doesNotMatch(html, /<em>/);
});

// ── Security ────────────────────────────────────────────────────────────────

test('security — raw HTML is escaped, not rendered', () => {
  const html = markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('security — javascript: and data: link hrefs are neutralized', () => {
  assert.match(markdownToHtml('[x](javascript:alert(1))'), /href="#"/);
  assert.match(markdownToHtml('![x](data:text/html;base64,xxx)'), /src="#"/);
});

test('security — safeUrl allows normal schemes and relative paths', () => {
  assert.equal(safeUrl('https://a.b'), 'https://a.b');
  assert.equal(safeUrl('./rel/path.md'), './rel/path.md');
  assert.equal(safeUrl('other.md'), 'other.md');
  assert.equal(safeUrl('#anchor'), '#anchor');
  assert.equal(safeUrl('vbscript:x'), '#');
});

test('security — safeUrl strips control chars before scheme check (java\\tscript bypass)', () => {
  assert.equal(safeUrl('java\tscript:alert(1)'), '#');
  assert.equal(safeUrl('java\nscript:alert(1)'), '#');
  assert.equal(safeUrl('\u0000javascript:alert(1)'), '#');
});

test('security — deep blockquote nesting does not blow the stack', () => {
  // ~5KB of ">" used to throw RangeError via unbounded recursion
  const html = markdownToHtml('>'.repeat(5000) + ' x');
  assert.equal(typeof html, 'string');
  assert.doesNotMatch(html, /<script/);
});

test('security — deep list nesting does not blow the stack, renders flat past cap', () => {
  const md = Array.from({ length: 300 }, (_, d) => `${'  '.repeat(d)}- item${d}`).join('\n');
  const html = markdownToHtml(md);
  assert.equal(typeof html, 'string');
  assert.match(html, /item299/);
});

test('security — escapeHtml covers the four metacharacters', () => {
  assert.equal(escapeHtml('<a href="x" & y>'), '&lt;a href=&quot;x&quot; &amp; y&gt;');
});

// ── Code blocks ─────────────────────────────────────────────────────────────

test('fenced code — language class, content escaped verbatim', () => {
  const html = markdownToHtml('```js\nconst a = 1 < 2;\n**not bold**\n```');
  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const a = 1 &lt; 2;/);
  assert.match(html, /\*\*not bold\*\*/);
});

test('fenced code — no language, tilde fences', () => {
  assert.match(markdownToHtml('~~~\nplain\n~~~'), /<pre><code>plain/);
});

test('fenced code — unclosed fence consumes to EOF without error', () => {
  const html = markdownToHtml('```\nline1\nline2');
  assert.match(html, /line1\nline2/);
  assert.match(html, /<\/code><\/pre>/);
});

// ── Blockquotes ─────────────────────────────────────────────────────────────

test('blockquote — simple and nested', () => {
  const html = markdownToHtml('> outer\n> > inner');
  assert.match(html, /<blockquote>\n<p>outer<\/p>\n<blockquote>\n<p>inner<\/p>\n<\/blockquote>/);
});

// ── Lists ───────────────────────────────────────────────────────────────────

test('lists — unordered', () => {
  const html = markdownToHtml('- one\n- two');
  assert.equal(html, '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n');
});

test('lists — ordered with . and )', () => {
  assert.match(markdownToHtml('1. a\n2) b'), /<ol>\n<li>a<\/li>\n<li>b<\/li>\n<\/ol>/);
});

test('lists — nested by indentation', () => {
  const html = markdownToHtml('- parent\n  - child\n- sibling');
  assert.match(html, /<li>parent<ul>\n<li>child<\/li>\n<\/ul>\n<\/li>\n<li>sibling<\/li>/);
});

test('lists — task list checkboxes', () => {
  const html = markdownToHtml('- [ ] todo\n- [x] done');
  assert.match(html, /<input type="checkbox" disabled> todo/);
  assert.match(html, /<input type="checkbox" disabled checked> done/);
});

test('lists — list ends at outdented text', () => {
  const html = markdownToHtml('- item\n\nparagraph after');
  assert.match(html, /<\/ul>\n<p>paragraph after<\/p>/);
});

// ── Tables ──────────────────────────────────────────────────────────────────

test('tables — header, body, alignment', () => {
  const md = '| Name | Age |\n|:-----|----:|\n| Ann  | 30  |';
  const html = markdownToHtml(md);
  assert.match(html, /<th style="text-align:left">Name<\/th>/);
  assert.match(html, /<th style="text-align:right">Age<\/th>/);
  assert.match(html, /<td style="text-align:left">Ann<\/td>/);
});

test('tables — escaped pipe inside cell', () => {
  const md = '| a |\n|---|\n| x \\| y |';
  assert.match(markdownToHtml(md), /<td>x \| y<\/td>/);
});

test('tables — pipe line without delimiter row is a paragraph', () => {
  assert.match(markdownToHtml('a | b\nc | d'), /^<p>/);
});

// ── Horizontal rule ─────────────────────────────────────────────────────────

test('hr — dashes, asterisks, underscores', () => {
  assert.equal(markdownToHtml('---'), '<hr>\n');
  assert.equal(markdownToHtml('* * *'), '<hr>\n');
  assert.equal(markdownToHtml('___'), '<hr>\n');
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test('edge — empty and null input', () => {
  assert.equal(markdownToHtml(''), '');
  assert.equal(markdownToHtml(null), '');
});

test('edge — CRLF input normalized', () => {
  assert.equal(markdownToHtml('# A\r\n\r\ntext\r\n'), markdownToHtml('# A\n\ntext\n'));
});

test('edge — mixed document renders all blocks in order', () => {
  const md = '# Title\n\nIntro **text**.\n\n- a\n- b\n\n```sh\necho hi\n```\n\n> quote\n\n---';
  const html = markdownToHtml(md);
  const order = ['<h1', '<p>Intro', '<ul>', '<pre><code class="language-sh">', '<blockquote>', '<hr>'];
  let pos = -1;
  for (const token of order) {
    const at = html.indexOf(token);
    assert.ok(at > pos, `${token} out of order`);
    pos = at;
  }
});
