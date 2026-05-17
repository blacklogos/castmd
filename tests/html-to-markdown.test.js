// Tests for lib/html-to-markdown.js — the conversion module used by the
// Confluence tree-export flow. Uses linkedom to provide a real DOM via the
// DOMParser shim in setup.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLib } from './setup.js';

loadLib('lib/html-to-markdown.js');
const { htmlStringToMarkdown, sanitizeTitle, cleanText } = globalThis.HtmlToMarkdown;

// ── sanitizeTitle ───────────────────────────────────────────────────────────

test('sanitizeTitle — strips path-illegal chars, preserves spaces + case', () => {
  assert.equal(sanitizeTitle('Hello / World'), 'Hello - World');
  assert.equal(sanitizeTitle('My:Title*?'), 'My-Title--');
  assert.equal(sanitizeTitle('Quoted "thing"'), 'Quoted -thing-');
});

test('sanitizeTitle — collapses whitespace and trims', () => {
  assert.equal(sanitizeTitle('  many   spaces  '), 'many spaces');
});

test('sanitizeTitle — caps length at 80 chars', () => {
  const long = 'a'.repeat(200);
  assert.equal(sanitizeTitle(long).length, 80);
});

test('sanitizeTitle — empty/whitespace/null becomes "untitled"', () => {
  assert.equal(sanitizeTitle(''), 'untitled');
  assert.equal(sanitizeTitle('   '), 'untitled');
  assert.equal(sanitizeTitle(null), 'untitled');
  assert.equal(sanitizeTitle(undefined), 'untitled');
});

// ── cleanText ───────────────────────────────────────────────────────────────

test('cleanText — collapses whitespace', () => {
  assert.equal(cleanText('  hello   world  '), 'hello world');
});

test('cleanText — escapes backticks', () => {
  assert.equal(cleanText('a `b` c'), 'a \\`b\\` c');
});

test('cleanText — strips space-before-punctuation', () => {
  assert.equal(cleanText('Hello , world !'), 'Hello, world!');
});

// ── htmlStringToMarkdown — block elements ───────────────────────────────────

test('htmlStringToMarkdown — empty input', () => {
  assert.equal(htmlStringToMarkdown(''), '');
  assert.equal(htmlStringToMarkdown(null), '');
});

test('htmlStringToMarkdown — headings emit correct # count', () => {
  const md = htmlStringToMarkdown('<h2>Two</h2><h3>Three</h3><h6>Six</h6>');
  assert.match(md, /## Two\n\n/);
  assert.match(md, /### Three\n\n/);
  assert.match(md, /###### Six\n\n/);
});

test('htmlStringToMarkdown — paragraph emits trailing blank line', () => {
  const md = htmlStringToMarkdown('<p>Hello world</p>');
  assert.equal(md, 'Hello world\n\n');
});

test('htmlStringToMarkdown — pageTitle prepends H1 once and dedupes matching H1', () => {
  const md = htmlStringToMarkdown('<h1>Title</h1><p>Body</p>', { pageTitle: 'Title' });
  const occurrences = (md.match(/^# Title$/gm) || []).length;
  assert.equal(occurrences, 1, `expected exactly one "# Title", got ${occurrences}\n---\n${md}`);
  assert.match(md, /Body/);
});

test('htmlStringToMarkdown — pageTitle does NOT skip non-matching H1', () => {
  const md = htmlStringToMarkdown('<h1>Different</h1><p>Body</p>', { pageTitle: 'Title' });
  assert.match(md, /^# Title\n\n/);
  assert.match(md, /# Different\n\n/);
});

// ── htmlStringToMarkdown — inline ───────────────────────────────────────────

test('htmlStringToMarkdown — bold + italic + code + strikethrough + link', () => {
  const html = '<p>This is <strong>bold</strong>, <em>italic</em>, ' +
               '<code>inline</code>, <s>strike</s>, and ' +
               '<a href="https://x.test">a link</a>.</p>';
  const md = htmlStringToMarkdown(html);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\*italic\*/);
  assert.match(md, /`inline`/);
  assert.match(md, /~~strike~~/);
  assert.match(md, /\[a link\]\(https:\/\/x\.test\)/);
});

test('htmlStringToMarkdown — <br> emits a line break inside paragraph', () => {
  // Current behavior: P handler collapses runs of spaces, so the hard-break
  // (two-space + newline) reduces to one-space + newline. Pinning that here —
  // change this test deliberately if the P normalization is ever relaxed.
  const md = htmlStringToMarkdown('<p>line1<br>line2</p>');
  assert.match(md, /line1[ ]?\nline2/);
});

// ── htmlStringToMarkdown — code blocks ──────────────────────────────────────

test('htmlStringToMarkdown — fenced code block', () => {
  const md = htmlStringToMarkdown('<pre><code>const x = 1;</code></pre>');
  assert.match(md, /```[a-z]*\nconst x = 1;\n```/);
});

test('htmlStringToMarkdown — language detection from class', () => {
  const md = htmlStringToMarkdown('<pre><code class="language-python">print("hi")</code></pre>');
  assert.match(md, /```python\nprint\("hi"\)\n```/);
});

// ── htmlStringToMarkdown — tables ───────────────────────────────────────────

test('htmlStringToMarkdown — table with header row', () => {
  const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
  const md = htmlStringToMarkdown(html);
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| 1 \| 2 \|/);
});

// ── htmlStringToMarkdown — lists ────────────────────────────────────────────

test('htmlStringToMarkdown — unordered list', () => {
  const md = htmlStringToMarkdown('<ul><li>One</li><li>Two</li></ul>');
  assert.match(md, /- One\n- Two/);
});

test('htmlStringToMarkdown — ordered list numbers items', () => {
  const md = htmlStringToMarkdown('<ol><li>First</li><li>Second</li><li>Third</li></ol>');
  assert.match(md, /1\. First\n2\. Second\n3\. Third/);
});

test('htmlStringToMarkdown — nested list indents two spaces per level', () => {
  const html = '<ul><li>top<ul><li>nested</li></ul></li></ul>';
  const md = htmlStringToMarkdown(html);
  assert.match(md, /- top/);
  assert.match(md, /  - nested/);
});
