// Pure HTML→Markdown conversion functions. Mirrors content.js's element-level
// converters but takes an HTML string (or detached element) — no dependency on
// the active page's DOM. Used by the Confluence tree-export flow which fetches
// rendered HTML over the network and must convert it in popup context.
//
// Kept intentionally duplicated with content.js (which still injects into live
// pages). Refactoring content.js to share this module is a separate concern.

(function (global) {
  'use strict';

  // ── Public API ────────────────────────────────────────────────────────────

  // Convert an HTML string (full or fragment) to Markdown.
  // opts.pageTitle — if provided, prepended as H1 and h1 elements matching it are skipped (dedupe).
  function htmlStringToMarkdown(html, opts) {
    const options = opts || {};
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    return elementToMarkdown(doc.body, options);
  }

  // Convert a DOM element subtree to Markdown.
  function elementToMarkdown(root, opts) {
    const options = opts || {};
    const pageTitle = options.pageTitle ? cleanText(options.pageTitle) : null;
    let md = pageTitle ? `# ${pageTitle}\n\n` : '';
    if (!root) return md;
    root.querySelectorAll(BLOCK_SELECTOR).forEach(el => {
      if (isRenderedByAncestor(el, root)) return;
      md += getMarkdownForElement(el, pageTitle);
    });
    return md;
  }

  // The element query is flat, so an element already rendered by an ancestor
  // must not be emitted a second time — a duplicate landing mid-line also
  // pushes the next heading off the start of its line. Which ancestors cover
  // which descendants differs:
  //
  //   TEXT_OWNERS   render their whole subtree via textContent — nothing inside
  //                 them is ever emitted again.
  //   INLINE_OWNERS render inline descendants only, so a block nested inside one
  //                 (a <pre> in an <li>, a <table> in a <p>: everyday Confluence
  //                 markup) still needs its own turn — inlineNodesToMarkdown
  //                 skips those subtrees for exactly that reason.
  //   A nested list is the exception: handleLists recurses into the lists that
  //                 are direct children of a list item, so those stay skipped.
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
      // handleLists already recursed into a list hanging directly off the item.
      return (el.tagName === 'UL' || el.tagName === 'OL') &&
             inlineOwner.tagName === 'LI' && parent === inlineOwner;
    }
    // Anything else has no owner that renders it: handleLists only walks the LI
    // children of a list, so a stray <ul> or <p> hanging straight off another
    // list (malformed markup, but browsers keep it) has to be emitted here or
    // it would be dropped.
    return false;
  }

  // Make a filesystem-safe filename from a page title. More permissive than
  // URL-slug sanitization — preserves spaces and case for readability inside
  // a ZIP. Strips chars illegal on Windows/macOS.
  function sanitizeTitle(title) {
    const t = (title || '').trim()
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .substring(0, 80)
      .replace(/[ .]+$/, '');
    return t || 'untitled';
  }

  // ── Inline conversion ─────────────────────────────────────────────────────

  // Nested block elements are left alone: flattening a <pre> or a <table> into
  // a line of prose loses its structure, so the flat block pass emits them
  // instead (see isRenderedByAncestor).
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

  // HTML wraps text at arbitrary columns; a bare newline inside a Markdown
  // paragraph keeps the line, but the source indentation leaks through as stray
  // spaces and 4+ spaces would open a code block. Collapse every whitespace
  // run, keeping only the two-space hard breaks that <br> produced.
  function collapseInlineWhitespace(text) {
    return text
      .split(/ {2,}\n/)                                 // <br> hard breaks
      .map(segment => segment.replace(/\s+/g, ' ').trim())
      .join('  \n')
      .trim()
      .replace(/[ \t]+([.,!?;:])(?=\s|$)/g, '$1');
  }

  // ── Block element conversion ──────────────────────────────────────────────

  function getMarkdownForElement(element, pageTitle) {
    if (element.tagName === 'CODE') {
      // Only reached for a <code> that no paragraph, list item or table cell
      // owns. It still has to end the line: emitted inline, it would run into
      // the next block and push a heading off the start of its line.
      const code = cleanText(element.textContent);
      return code ? `\`${code}\`\n\n` : '';
    }
    if (element.tagName === 'PRE')   return handleCodeBlock(element);
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
    // querySelectorAll reaches into a nested table, which would fold its rows
    // and cells into this one. Keep only what belongs to this table.
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
      if (item.tagName !== 'LI') return;
      let text = '';
      for (const n of item.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) {
          text += n.textContent.replace(/`/g, '\\`');
        // Nested blocks (lists, code blocks, tables) are emitted separately.
        } else if (n.nodeType === Node.ELEMENT_NODE && !isNestedBlock(n.tagName)) {
          text += inlineNodesToMarkdown(n);
        }
      }
      text = collapseInlineWhitespace(text);
      md += `${indent}${ordered ? `${i + 1}.` : '-'} ${text}\n`;
      item.querySelectorAll(':scope > ul, :scope > ol').forEach(nested => {
        md += handleLists(nested, nested.tagName === 'OL', level + 1);
      });
    });
    return md;
  }

  function cleanText(text) {
    return (text || '').trim()
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .replace(/`/g, '\\`')
      // Only sentence punctuation: a lookahead keeps " .zip" and " .md" intact.
      .replace(/\s+([.,!?;:])(?=\s|$)/g, '$1')
      .replace(/\s+$/, '');
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.HtmlToMarkdown = {
    htmlStringToMarkdown,
    elementToMarkdown,
    sanitizeTitle,
    cleanText
  };
})(window);
