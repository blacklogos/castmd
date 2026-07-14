// Pure Markdown→HTML renderer for the local .md file viewer (md-viewer.js).
// String-based, no DOM dependency, so it runs in content-script context and
// under node:test alike. Raw HTML in the source is escaped, never passed
// through — file:// pages share an origin, so rendering untrusted markup
// verbatim would be an XSS hole.
//
// Supported: ATX headings, paragraphs, fenced code blocks (with language
// class), blockquotes (nested), ul/ol (nested by indentation), task lists,
// GFM pipe tables, hr, inline code/bold/italic/strikethrough/links/images.

(function (global) {
  'use strict';

  function escapeHtml(text) {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Only allow protocols that can't execute script. Everything else (javascript:,
  // data:, vbscript:) collapses to '#'.
  function safeUrl(url) {
    const u = (url || '').trim();
    if (/^(https?:|mailto:|file:|#|\/|\.)/i.test(u)) return u;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return u; // relative path, no scheme
    return '#';
  }

  // ── Inline rendering ───────────────────────────────────────────────────────
  // Order matters: code spans first (their content is opaque), then images
  // before links (same bracket syntax), then emphasis.

  function renderInline(text) {
    let out = '';
    const parts = splitOnCodeSpans(text);
    for (const part of parts) {
      if (part.code) {
        out += `<code>${escapeHtml(part.text)}</code>`;
      } else {
        out += renderInlineNoCode(part.text);
      }
    }
    return out;
  }

  // Split "a `b` c" into [{text:'a '},{code:true,text:'b'},{text:' c'}].
  // Handles multi-backtick delimiters (``code with ` inside``).
  function splitOnCodeSpans(text) {
    const parts = [];
    let rest = text;
    const re = /(`+)([\s\S]*?)\1/;
    let m;
    while ((m = re.exec(rest))) {
      if (m.index > 0) parts.push({ text: rest.slice(0, m.index) });
      parts.push({ code: true, text: m[2] });
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) parts.push({ text: rest });
    return parts;
  }

  function renderInlineNoCode(text) {
    let s = escapeHtml(text);
    // Images before links: ![alt](src "title")
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, src, title) =>
      `<img src="${safeUrl(src)}" alt="${alt}"${title ? ` title="${title}"` : ''}>`);
    // Links: [text](href "title")
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, label, href, title) =>
      `<a href="${safeUrl(href)}"${title ? ` title="${title}"` : ''}>${label}</a>`);
    // Autolinks: <https://…> (already escaped to &lt;…&gt;)
    s = s.replace(/&lt;(https?:\/\/[^\s&]+(?:&amp;[^\s&]+)*)&gt;/g, (_, url) =>
      `<a href="${url}">${url}</a>`);
    // Bold, then italic, then strikethrough. Require non-space at boundaries so
    // "a * b * c" stays literal.
    s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
    s = s.replace(/(\*|_)(?=\S)([^*_]*\S)\1/g, '<em>$2</em>');
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    // Hard break: two trailing spaces before newline
    s = s.replace(/ {2,}\n/g, '<br>\n');
    return s;
  }

  // ── Block rendering ────────────────────────────────────────────────────────

  function markdownToHtml(markdown) {
    const lines = (markdown || '').replace(/\r\n?/g, '\n').split('\n');
    return renderBlocks(lines);
  }

  function renderBlocks(lines) {
    let html = '';
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      // Fenced code block
      const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*(\S*)/);
      if (fence) {
        const [, , marker, lang] = fence;
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(marker.slice(0, 3))) {
          body.push(lines[i]);
          i++;
        }
        i++; // closing fence (or EOF)
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        html += `<pre><code${cls}>${escapeHtml(body.join('\n'))}\n</code></pre>\n`;
        continue;
      }

      // ATX heading
      const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (heading) {
        const level = heading[1].length;
        const content = renderInline(heading[2]);
        html += `<h${level} id="${slugify(heading[2])}">${content}</h${level}>\n`;
        i++;
        continue;
      }

      // Horizontal rule
      if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
        html += '<hr>\n';
        i++;
        continue;
      }

      // Blockquote: collect contiguous > lines, strip one level, recurse
      if (/^\s{0,3}>/.test(line)) {
        const inner = [];
        while (i < lines.length && (/^\s{0,3}>/.test(lines[i]) || (lines[i].trim() && inner.length && inner[inner.length - 1].trim()))) {
          inner.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        html += `<blockquote>\n${renderBlocks(inner)}</blockquote>\n`;
        continue;
      }

      // List (unordered or ordered)
      if (/^\s*([-+*]|\d{1,9}[.)])\s+/.test(line)) {
        const consumed = renderList(lines, i);
        html += consumed.html;
        i = consumed.next;
        continue;
      }

      // GFM table: header row + delimiter row
      if (line.includes('|') && i + 1 < lines.length &&
          /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const consumed = renderTable(lines, i);
        if (consumed) {
          html += consumed.html;
          i = consumed.next;
          continue;
        }
      }

      // Paragraph: collect until blank line or block start
      const para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(\s*)(`{3,}|~{3,})/.test(lines[i]) &&
             !/^#{1,6}\s/.test(lines[i]) &&
             !/^\s{0,3}>/.test(lines[i]) &&
             !/^\s*([-+*]|\d{1,9}[.)])\s+/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) {
        html += `<p>${renderInline(para.join('\n'))}</p>\n`;
      } else {
        i++; // safety: line matched no block and no paragraph (shouldn't happen)
      }
    }
    return html;
  }

  function slugify(text) {
    return (text || '').toLowerCase().trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80);
  }

  // ── Lists ──────────────────────────────────────────────────────────────────

  function listItemMatch(line) {
    return line.match(/^(\s*)([-+*]|\d{1,9}[.)])\s+(.*)$/);
  }

  // Render a (possibly nested) list starting at lines[start]. Nesting is by
  // indentation: an item indented deeper than the list's base is a child.
  function renderList(lines, start) {
    const first = listItemMatch(lines[start]);
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    let html = ordered ? '<ol>\n' : '<ul>\n';
    let i = start;

    while (i < lines.length) {
      const m = listItemMatch(lines[i]);
      if (!m) {
        if (!lines[i].trim()) { // blank line: list continues only if next line is a list item
          const nxt = i + 1 < lines.length ? listItemMatch(lines[i + 1]) : null;
          if (nxt && nxt[1].length >= baseIndent) { i++; continue; }
        }
        break;
      }
      const indent = m[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) { // nested list under previous item
        const nested = renderList(lines, i);
        html = html.replace(/<\/li>\n$/, '') + nested.html + '</li>\n';
        i = nested.next;
        continue;
      }
      // Task list item
      let text = m[3];
      const task = text.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
        text = `<input type="checkbox" disabled${checked}> ${renderInline(task[2])}`;
        html += `<li class="task">${text}</li>\n`;
      } else {
        html += `<li>${renderInline(text)}</li>\n`;
      }
      i++;
    }
    html += ordered ? '</ol>\n' : '</ul>\n';
    return { html, next: i };
  }

  // ── Tables ─────────────────────────────────────────────────────────────────

  function splitRow(line) {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    // Split on unescaped pipes
    return trimmed.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  }

  function renderTable(lines, start) {
    const header = splitRow(lines[start]);
    const aligns = splitRow(lines[start + 1]).map(d => {
      const left = d.startsWith(':'), right = d.endsWith(':');
      if (left && right) return ' style="text-align:center"';
      if (right) return ' style="text-align:right"';
      if (left) return ' style="text-align:left"';
      return '';
    });
    if (!header.length) return null;

    let html = '<table>\n<thead>\n<tr>';
    header.forEach((cell, idx) => { html += `<th${aligns[idx] || ''}>${renderInline(cell)}</th>`; });
    html += '</tr>\n</thead>\n<tbody>\n';

    let i = start + 2;
    while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
      const cells = splitRow(lines[i]);
      html += '<tr>';
      header.forEach((_, idx) => { html += `<td${aligns[idx] || ''}>${renderInline(cells[idx] || '')}</td>`; });
      html += '</tr>\n';
      i++;
    }
    html += '</tbody>\n</table>\n';
    return { html, next: i };
  }

  // ── Export ────────────────────────────────────────────────────────────────

  global.MarkdownToHtml = {
    markdownToHtml,
    escapeHtml,
    safeUrl
  };
})(typeof window !== 'undefined' ? window : globalThis);
