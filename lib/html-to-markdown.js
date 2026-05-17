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
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ul,ol,pre,code,table').forEach(el => {
      md += getMarkdownForElement(el, pageTitle);
    });
    return md;
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

  function inlineNodesToMarkdown(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent.replace(/`/g, '\\`');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName;
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

  // ── Block element conversion ──────────────────────────────────────────────

  function getMarkdownForElement(element, pageTitle) {
    if (element.tagName === 'CODE') {
      return element.parentElement && element.parentElement.tagName === 'PRE'
        ? ''
        : ` \`${cleanText(element.textContent)}\` `;
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
        const inline = inlineNodesToMarkdown(element).trim()
          .replace(/[ \t]+/g, ' ').replace(/[ \t]+([.,!?;:])/g, '$1');
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
    const rows = element.querySelectorAll('tr');
    const headers = Array.from((rows[0] && rows[0].querySelectorAll('th,td')) || []);
    if (headers.length === 0) return '';

    let md = '\n';
    md += '| ' + headers.map(c => cleanText(c.textContent)).join(' | ') + ' |\n';
    md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
    Array.from(rows).slice(1).forEach(row => {
      const cells = Array.from(row.querySelectorAll('td'));
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
        } else if (n.nodeType === Node.ELEMENT_NODE && !['UL', 'OL'].includes(n.tagName)) {
          text += inlineNodesToMarkdown(n);
        }
      }
      text = text.trim().replace(/[ \t]+/g, ' ').replace(/[ \t]+([.,!?;:])/g, '$1');
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
      .replace(/\s+([.,!?;:])/g, '$1')
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
