console.log('Content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request);

  if (request.action === 'convert') {
    try {
      const markdown = convertToMarkdown();
      sendResponse({ success: true, markdown });
    } catch (error) {
      console.error('Conversion error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (request.action === 'getOutline') {
    try {
      const outline = extractPageOutline();
      sendResponse({ success: true, outline });
    } catch (error) {
      console.error('Outline extraction error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
});

function convertToMarkdown() {
  console.log('Starting conversion');
  const mainContent = findMainContent();
  let markdown = '';

  const pageTitle = findPageTitle();
  if (pageTitle) {
    markdown += `# ${cleanText(pageTitle)}\n\n`;
  }

  function getMarkdown(element) {
    try {
      if (shouldSkipElement(element)) {
        return '';
      }

      // Handle code elements
      if (element.tagName === 'CODE') {
        if (element.parentElement.tagName === 'PRE') {
          return '';
        }
        return ` \`${cleanText(element.textContent)}\` `;
      }

      // Handle code blocks
      if (element.tagName === 'PRE') {
        return handleCodeBlock(element);
      }

      // Handle tables
      if (element.tagName === 'TABLE') {
        return handleTable(element);
      }

      switch (element.tagName) {
        case 'H1':
          const h1Text = cleanText(element.textContent);
          return pageTitle !== h1Text ? `# ${h1Text}\n\n` : '';
        case 'H2':
          return `## ${cleanText(element.textContent)}\n\n`;
        case 'H3':
          return `### ${cleanText(element.textContent)}\n\n`;
        case 'H4':
          return `#### ${cleanText(element.textContent)}\n\n`;
        case 'H5':
          return `##### ${cleanText(element.textContent)}\n\n`;
        case 'H6':
          return `###### ${cleanText(element.textContent)}\n\n`;
        case 'P':
          const pContent = cleanText(element.textContent);
          return pContent ? `${pContent}\n\n` : '';
        case 'UL':
          return handleLists(element, false, 0) + '\n';
        case 'OL':
          return handleLists(element, true, 0) + '\n';
        default:
          return '';
      }
    } catch (error) {
      console.error('Error converting element:', element, error);
      return '';
    }
  }

  // Process all relevant elements within the main content
  const elements = mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol, pre, code, table');
  elements.forEach(element => {
    markdown += getMarkdown(element);
  });

  return markdown;
}

function handleCodeBlock(element) {
  let code;
  let language = '';

  // Check if PRE contains CODE element
  const codeElement = element.querySelector('code');
  if (codeElement) {
    code = codeElement.textContent;
    language = detectLanguage(codeElement);
  } else {
    code = element.textContent;
    language = detectLanguage(element);
  }

  // Clean up the code
  code = code.trim()
    .replace(/^\n+|\n+$/g, '') // Remove extra newlines at start/end
    .replace(/\t/g, '  '); // Convert tabs to spaces

  return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
}

function detectLanguage(element) {
  // Check for common class patterns
  const classNames = element.className || '';
  const langMatches = classNames.match(/(?:language|lang|brush)-(\w+)/i);
  if (langMatches) return langMatches[1].toLowerCase();

  // Check data attributes
  const lang = element.getAttribute('data-language') || 
               element.getAttribute('data-lang') || 
               element.getAttribute('data-code-language');
  if (lang) return lang.toLowerCase();

  // Try to detect from content
  const content = element.textContent;
  if (content.includes('function') || content.includes('var ') || content.includes('const ')) return 'javascript';
  if (content.includes('<?php')) return 'php';
  if (content.includes('<html') || content.includes('<!DOCTYPE')) return 'html';
  if (content.includes('@import') || content.includes('{')) return 'css';
  if (content.includes('SELECT ') || content.includes('FROM ')) return 'sql';
  if (content.includes('import ') || content.includes('def ')) return 'python';

  // Default to text if no language detected
  return '';
}

function handleTable(element) {
  let markdown = '\n';
  const rows = element.querySelectorAll('tr');
  const headerCells = Array.from(rows[0]?.querySelectorAll('th, td') || []);
  
  if (headerCells.length === 0) return '';

  // Add header row
  markdown += '| ' + headerCells.map(cell => cleanText(cell.textContent)).join(' | ') + ' |\n';

  // Add alignment row
  markdown += '| ' + headerCells.map(() => '---').join(' | ') + ' |\n';

  // Add data rows
  Array.from(rows).slice(1).forEach(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length > 0) {
      markdown += '| ' + cells.map(cell => cleanText(cell.textContent)).join(' | ') + ' |\n';
    }
  });

  return markdown + '\n';
}

function findPageTitle() {
  // Try multiple sources to find the page title
  const sources = [
    // Try meta title first
    () => {
      const metaTitle = document.querySelector('meta[property="og:title"]')?.content ||
                       document.querySelector('meta[name="twitter:title"]')?.content;
      return metaTitle ? cleanText(metaTitle) : null;
    },
    // Try main h1
    () => {
      const mainH1 = document.querySelector('main h1, article h1, [role="main"] h1');
      return mainH1 ? cleanText(mainH1.textContent) : null;
    },
    // Try first visible h1
    () => {
      const allH1s = Array.from(document.getElementsByTagName('h1'));
      const visibleH1 = allH1s.find(h1 => !shouldSkipElement(h1));
      return visibleH1 ? cleanText(visibleH1.textContent) : null;
    },
    // Fallback to document title
    () => document.title ? cleanText(document.title) : null
  ];

  // Try each source until we find a title
  for (const source of sources) {
    const title = source();
    if (title) return title;
  }

  return null;
}

function findMainContent() {
  // Common selectors for main content, in order of preference
  const mainSelectors = [
    'main',
    'article',
    '[role="main"]',
    '#main-content',
    '.main-content',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    // Add more common content selectors here
  ];

  // Try to find the main content area
  for (const selector of mainSelectors) {
    const element = document.querySelector(selector);
    if (element && isValidContentContainer(element)) {
      return element;
    }
  }

  // Fallback: Use content density analysis
  return findContentByDensity();
}

function isValidContentContainer(element) {
  // Check if the container has enough content
  const text = element.textContent.trim();
  const hasEnoughContent = text.length > 100; // Minimum content length
  const hasHeadings = element.querySelector('h1, h2, h3, h4, h5, h6');
  const hasParagraphs = element.querySelector('p');

  return hasEnoughContent && (hasHeadings || hasParagraphs);
}

function findContentByDensity() {
  const body = document.body;
  let bestElement = body;
  let maxDensity = getContentDensity(body);

  // Check all major containers
  const containers = body.querySelectorAll('div, section, article');
  containers.forEach(container => {
    const density = getContentDensity(container);
    if (density > maxDensity) {
      maxDensity = density;
      bestElement = container;
    }
  });

  return bestElement;
}

function getContentDensity(element) {
  const text = element.textContent;
  const links = element.getElementsByTagName('a');
  const linkText = Array.from(links).reduce((acc, link) => acc + link.textContent.length, 0);
  
  // Calculate text density excluding navigation links
  return (text.length - linkText) / element.getElementsByTagName('*').length;
}

function shouldSkipElement(element) {
  // Skip hidden elements
  if (element.offsetParent === null) {
    return true;
  }

  // Skip navigation and footer elements
  const skipSelectors = [
    'nav',
    'header',
    'footer',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '.navigation',
    '.nav',
    '.menu',
    '.footer',
    '.sidebar',
    '.comments',
    '.advertisement',
    '.social-share'
  ];

  // Check if element or its ancestors match skip selectors
  let current = element;
  while (current && current !== document.body) {
    if (skipSelectors.some(selector => current.matches(selector))) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function cleanText(text) {
  return text
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[\r\n]+/g, ' ') // Remove line breaks
    .replace(/`/g, '\\`') // Escape backticks
    .replace(/\s+([.,!?;:])/g, '$1') // Remove spaces before punctuation
    .replace(/\s+$/g, ''); // Remove trailing spaces
}

function extractPageOutline() {
  const mainContent = findMainContent();
  let outline = '';
  
  // Get all headings
  const headings = mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6');
  
  headings.forEach(heading => {
    if (!shouldSkipElement(heading)) {
      const level = parseInt(heading.tagName[1]);
      const prefix = '#'.repeat(level);
      outline += `${prefix} ${cleanText(heading.textContent)}\n\n`;
    }
  });

  return outline.trim();
}

function handleLists(element, isOrdered = false, level = 0) {
  let markdown = '';
  const items = element.children;
  
  Array.from(items).forEach((item, index) => {
    if (item.tagName !== 'LI' || shouldSkipElement(item)) return;

    // Calculate indentation
    const indent = '  '.repeat(level);
    
    // Get the list marker
    const marker = isOrdered ? `${index + 1}.` : '-';
    
    // Get the immediate text content of the LI, excluding nested lists
    let itemText = Array.from(item.childNodes)
      .filter(node => node.nodeType === 3 || (node.nodeType === 1 && !['UL', 'OL'].includes(node.tagName)))
      .map(node => node.textContent)
      .join('')
      .trim();

    // Add the list item with proper indentation
    markdown += `${indent}${marker} ${cleanText(itemText)}\n`;

    // Handle nested lists
    const nestedLists = item.querySelectorAll(':scope > ul, :scope > ol');
    nestedLists.forEach(nestedList => {
      markdown += handleLists(nestedList, nestedList.tagName === 'OL', level + 1);
    });
  });

  return markdown;
}
