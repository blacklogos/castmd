// Version-based guard — ensures new listeners register when content.js is updated.
// Simple boolean guard would keep stale listeners across extension reloads.
const CONTENT_VERSION = '2.6';
if (window.__mdConvertVersion !== CONTENT_VERSION) {
  window.__mdConvertVersion = CONTENT_VERSION;

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

      } else if (request.action === 'convertAndCopy') {
        // Popup keyboard shortcut path — content script writes clipboard directly
        const markdown = convertToMarkdown();
        writeToClipboard(markdown).then(() =>
          sendResponse({ success: true, tokens: estimateTokens(markdown) })
        );
        return true;
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  });
}

async function writeToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ── Conversion entry points ────────────────────────────────────────────────

function convertToMarkdown() {
  const root = findMainContent();
  const pageTitle = findPageTitle();
  let markdown = pageTitle ? `# ${cleanText(pageTitle)}\n\n` : '';

  root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ul,ol,pre,code,table').forEach(el => {
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

function getMarkdownForElement(element, pageTitle) {
  if (element.tagName === 'CODE') {
    return element.parentElement?.tagName === 'PRE' ? '' : ` \`${cleanText(element.textContent)}\` `;
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
      const inline = inlineNodesToMarkdown(element).trim().replace(/[ \t]+/g, ' ').replace(/[ \t]+([.,!?;:])/g, '$1');
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
  const headers = Array.from(rows[0]?.querySelectorAll('th,td') || []);
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
    if (item.tagName !== 'LI' || shouldSkipElement(item)) return;
    let text = '';
    for (const n of item.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) text += n.textContent.replace(/`/g, '\\`');
      else if (n.nodeType === Node.ELEMENT_NODE && !['UL','OL'].includes(n.tagName))
        text += inlineNodesToMarkdown(n);
    }
    text = text.trim().replace(/[ \t]+/g, ' ').replace(/[ \t]+([.,!?;:])/g, '$1');
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
    'main', 'article', '[role="main"]',
    '#main-content', '.main-content', '.post-content',
    '.article-content', '.entry-content', '.content',
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
  let best = document.body;
  let max = getContentDensity(document.body);
  document.body.querySelectorAll('div,section,article').forEach(el => {
    const d = getContentDensity(el);
    if (d > max) { max = d; best = el; }
  });
  return best;
}

function getContentDensity(el) {
  const linkLen = Array.from(el.getElementsByTagName('a')).reduce((s, a) => s + a.textContent.length, 0);
  return (el.textContent.length - linkLen) / (el.getElementsByTagName('*').length || 1);
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
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s+$/, '');
}

function sanitizeFileName(url) {
  try {
    const { pathname, hostname } = new URL(url);
    let slug = pathname.split('/').filter(Boolean).pop() || hostname;
    slug = decodeURIComponent(slug)
      .toLowerCase()
      .replace(/\.[a-z]{2,4}$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug.length > 35) slug = slug.substring(0, 35).replace(/-+$/, '');
    return slug || hostname;
  } catch {
    return 'page-content';
  }
}
