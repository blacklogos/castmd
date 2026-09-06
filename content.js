// Wrapped in an IIFE — chrome.scripting.executeScript({files:['content.js']}) re-injects
// this file into the tab's isolated world on every action (popup click, context menu,
// keyboard shortcut). That world persists across injections, so top-level const/let
// bindings would throw "Identifier has already been declared" on the 2nd+ injection.
// The IIFE gives each injection its own function scope instead.
(function () {

// Version-based guard — ensures new listeners register when content.js is updated.
// Simple boolean guard would keep stale listeners across extension reloads.
const CONTENT_VERSION = '1.1.0';
if (window.__castmdVersion !== CONTENT_VERSION) {
  window.__castmdVersion = CONTENT_VERSION;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.action === 'convert') {
        const markdown = convertToMarkdown();
        sendResponse({ success: true, markdown, url: location.href, title: document.title });

      } else if (request.action === 'getOutline') {
        const outline = extractPageOutline();
        sendResponse({ success: true, outline });

      } else if (request.action === 'getPageMeta') {
        const markdown = convertToMarkdown();
        const outline = extractPageOutline();
        sendResponse({
          success: true, markdown, outline,
          url: location.href, title: document.title,
          tokens: estimateTokens(markdown)
        });

      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  });
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ── Conversion entry points ────────────────────────────────────────────────

// The element query is flat, so an element already rendered by an ancestor must
// not be emitted a second time — a duplicate landing mid-line also pushes the
// next heading off the start of its line. Which ancestors cover which
// descendants differs:
//
//   TEXT_OWNERS   render their whole subtree via textContent — nothing inside
//                 them is ever emitted again.
//   INLINE_OWNERS render inline descendants only, so a block nested inside one
//                 (a <pre> in an <li>, a <table> in a <p>) still needs its own
//                 turn — inlineNodesToMarkdown skips those subtrees for exactly
//                 that reason.
//   A nested list is the exception: handleLists recurses into the lists that are
//                 direct children of a list item, so those stay skipped.
const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,ul,ol,pre,code,table';
const TEXT_OWNERS = 'pre,table';
const INLINE_OWNERS = 'p,li,h1,h2,h3,h4,h5,h6';
const NESTED_BLOCKS = ['UL', 'OL', 'PRE', 'TABLE'];

function isNestedBlock(tagName) {
  return NESTED_BLOCKS.indexOf(tagName) !== -1;
}

function isRenderedByAncestor(el, root) {
  const parent = el.parentElement;
  if (!parent) return false;

  const textOwner = parent.closest(TEXT_OWNERS);
  if (textOwner && root.contains(textOwner)) return true;

  const inlineOwner = parent.closest(INLINE_OWNERS);
  if (inlineOwner && root.contains(inlineOwner)) {
    if (!isNestedBlock(el.tagName)) return true;
    // handleLists already recursed into a list that hangs directly off the item.
    return (el.tagName === 'UL' || el.tagName === 'OL') &&
           inlineOwner.tagName === 'LI' && parent === inlineOwner;
  }

  // Anything else has no owner that renders it: handleLists only walks the LI
  // children of a list, so a stray <ul> or <p> hanging straight off another
  // list (malformed markup, but Chrome keeps it) has to be emitted here or it
  // would be dropped.
  return false;
}

function convertToMarkdown() {
  const root = findMainContent();
  const pageTitle = findPageTitle();
  let markdown = pageTitle ? `# ${cleanText(pageTitle)}\n\n` : '';

  root.querySelectorAll(BLOCK_SELECTOR).forEach(el => {
    if (isRenderedByAncestor(el, root)) return;
    if (!shouldSkipElement(el)) markdown += getMarkdownForElement(el, pageTitle);
  });

  return markdown;
}

function extractPageOutline() {
  const root = findMainContent();
  let outline = '';
  root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(heading => {
    if (!shouldSkipElement(heading)) {
      outline += `${'#'.repeat(parseInt(heading.tagName[1]))} ${cleanText(heading.textContent)}\n\n`;
    }
  });
  return outline.trim();
}

// ── Element → Markdown ─────────────────────────────────────────────────────

// Traverses inline child nodes and converts to Markdown syntax.
// Preserves bold, italic, links, inline code, strikethrough.
// Nested block elements are left alone: flattening a <pre> or a <table> into a
// line of prose loses its structure, so the flat block pass emits them instead
// (see isRenderedByAncestor).
function inlineNodesToMarkdown(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent.replace(/`/g, '\\`');
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName;
      if (isNestedBlock(tag)) continue;
      const inner = inlineNodesToMarkdown(child);
      if      (tag === 'STRONG' || tag === 'B')   out += inner ? `**${inner}**` : '';
      else if (tag === 'EM'     || tag === 'I')   out += inner ? `*${inner}*`   : '';
      else if (tag === 'CODE')                    out += `\`${child.textContent.trim()}\``;
      else if (tag === 'S' || tag === 'DEL')      out += inner ? `~~${inner}~~` : '';
      else if (tag === 'A') {
        const href = child.getAttribute('href');
        out += (href && inner) ? `[${inner}](${href})` : inner;
      }
      else if (tag === 'BR') out += '  \n';
      else out += inner;
    }
  }
  return out;
}

// HTML wraps text at arbitrary columns; Markdown treats a bare newline inside a
// paragraph as part of the same line, but leading indentation from the source
// leaks through as stray spaces and 4+ spaces would start a code block. Collapse
// every run of whitespace, keeping only the two-space hard breaks that <br>
// produced.
function collapseInlineWhitespace(text) {
  return text
    .split(/ {2,}\n/)                                   // <br> hard breaks
    .map(segment => segment.replace(/\s+/g, ' ').trim())
    .join('  \n')
    .trim()
    .replace(/[ \t]+([.,!?;:])(?=\s|$)/g, '$1');
}

function getMarkdownForElement(element, pageTitle) {
  if (element.tagName === 'CODE') {
    // Only reached for a <code> that no paragraph, list item or table cell
    // owns. It still has to end the line: emitted inline, it would run into the
    // next block and push a heading off the start of its line.
    const code = cleanText(element.textContent);
    return code ? `\`${code}\`\n\n` : '';
  }
  if (element.tagName === 'PRE') return handleCodeBlock(element);
  if (element.tagName === 'TABLE') return handleTable(element);

  const text = cleanText(element.textContent);
  if (!text) return '';

  switch (element.tagName) {
    case 'H1': return text !== pageTitle ? `# ${text}\n\n` : '';
    case 'H2': return `## ${text}\n\n`;
    case 'H3': return `### ${text}\n\n`;
    case 'H4': return `#### ${text}\n\n`;
    case 'H5': return `##### ${text}\n\n`;
    case 'H6': return `###### ${text}\n\n`;
    case 'P': {
      const inline = collapseInlineWhitespace(inlineNodesToMarkdown(element));
      return inline ? `${inline}\n\n` : '';
    }
    case 'UL': return handleLists(element, false, 0) + '\n';
    case 'OL': return handleLists(element, true, 0) + '\n';
    default:   return '';
  }
}

function handleCodeBlock(element) {
  const codeEl = element.querySelector('code');
  const src = codeEl || element;
  const lang = detectLanguage(src);
  const code = src.textContent.trim().replace(/^\n+|\n+$/g, '').replace(/\t/g, '  ');
  return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
}

function detectLanguage(element) {
  const cls = element.className || '';
  const m = cls.match(/(?:language|lang|brush)-(\w+)/i);
  if (m) return m[1].toLowerCase();

  const attr = element.getAttribute('data-language') ||
               element.getAttribute('data-lang') ||
               element.getAttribute('data-code-language');
  if (attr) return attr.toLowerCase();

  const c = element.textContent;
  if (c.includes('<?php')) return 'php';
  if (c.includes('<html') || c.includes('<!DOCTYPE')) return 'html';
  if (c.includes('SELECT ') || c.includes('FROM ')) return 'sql';
  if (c.includes('import ') && c.includes('def ')) return 'python';
  if (c.includes('function') || c.includes('const ') || c.includes('var ')) return 'javascript';
  return '';
}

function handleTable(element) {
  // querySelectorAll reaches into a nested table, which would fold its rows and
  // cells into this one. Keep only what belongs to this table.
  const own = (node, selector) =>
    Array.from(node.querySelectorAll(selector)).filter(n => n.closest('table') === element);

  const rows = own(element, 'tr');
  const headers = rows.length ? own(rows[0], 'th,td') : [];
  if (headers.length === 0) return '';

  let md = '\n';
  md += '| ' + headers.map(c => cleanText(c.textContent)).join(' | ') + ' |\n';
  md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
  rows.slice(1).forEach(row => {
    const cells = own(row, 'td');
    if (cells.length) md += '| ' + cells.map(c => cleanText(c.textContent)).join(' | ') + ' |\n';
  });
  return md + '\n';
}

function handleLists(element, ordered, level) {
  let md = '';
  const indent = '  '.repeat(level);
  Array.from(element.children).forEach((item, i) => {
    if (item.tagName !== 'LI' || shouldSkipElement(item)) return;
    let text = '';
    for (const n of item.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) text += n.textContent.replace(/`/g, '\\`');
      // Nested blocks (lists, code blocks, tables) are emitted separately.
      else if (n.nodeType === Node.ELEMENT_NODE && !isNestedBlock(n.tagName))
        text += inlineNodesToMarkdown(n);
    }
    text = collapseInlineWhitespace(text);
    md += `${indent}${ordered ? `${i + 1}.` : '-'} ${text}\n`;
    item.querySelectorAll(':scope > ul, :scope > ol').forEach(nested => {
      md += handleLists(nested, nested.tagName === 'OL', level + 1);
    });
  });
  return md;
}

// ── Content detection ──────────────────────────────────────────────────────

function findPageTitle() {
  const sources = [
    () => document.querySelector('meta[property="og:title"]')?.content,
    () => document.querySelector('meta[name="twitter:title"]')?.content,
    () => document.querySelector('main h1, article h1, [role="main"] h1')?.textContent,
    () => Array.from(document.getElementsByTagName('h1')).find(h => !shouldSkipElement(h))?.textContent,
    () => document.title
  ];
  for (const src of sources) {
    const t = src();
    if (t) return cleanText(t);
  }
  return null;
}

function findMainContent() {
  const selectors = [
    '#readme article', '.markdown-body', '#readme',
    '[itemprop="articleBody"]',                    // schema.org — every.to, news sites
    'main', 'article', '[role="main"]',
    '#main-content', '.main-content', '.post-content', '.post-body',
    '.article-content', '.article-body', '.entry-content', '.content',
    '#content', '.page-content', '.site-content', '.body-content',
    '[data-content]', '.container > section', 'section.content'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isValidContentContainer(el)) return el;
  }
  const sections = Array.from(document.querySelectorAll('section,main,article'));
  const bigSection = sections.find(s => isValidContentContainer(s));
  return bigSection || findContentByDensity();
}

function isValidContentContainer(el) {
  const text = el.textContent.trim();
  return text.length > 100 && (el.querySelector('h1,h2,h3,h4,h5,h6') || el.querySelector('p'));
}

function findContentByDensity() {
  // Score by paragraph text per element — favours the article wrapper over
  // individual paragraph divs (which have high density but only one <p>).
  let best = document.body;
  let max = -1;
  document.body.querySelectorAll('div,section,article').forEach(el => {
    const paras = el.querySelectorAll('p');
    if (paras.length < 2) return;
    const paraText = Array.from(paras).reduce((s, p) => s + p.textContent.trim().length, 0);
    if (paraText < 200) return;
    const score = paraText / (el.getElementsByTagName('*').length || 1);
    if (score > max) { max = score; best = el; }
  });
  return best;
}

function shouldSkipElement(el) {
  // Check computed visibility — avoids false positives from position:fixed containers
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return true;

  const skip = ['nav','[role="navigation"]','[role="banner"]','[role="contentinfo"]',
                 '.navigation','.nav','.menu','.footer',
                 '.sidebar','.comments','.advertisement','.social-share'];
  let cur = el;
  while (cur && cur !== document.body) {
    if (skip.some(s => { try { return cur.matches(s); } catch { return false; } })) return true;
    cur = cur.parentElement;
  }
  return false;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function cleanText(text) {
  return text.trim()
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/`/g, '\\`')
    // Only sentence punctuation: a lookahead keeps " .zip" and " .md" intact.
    .replace(/\s+([.,!?;:])(?=\s|$)/g, '$1')
    .replace(/\s+$/, '');
}

})();
