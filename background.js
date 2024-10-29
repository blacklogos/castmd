console.log('Background script loaded');

// Initialize ready state
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed or updated');
  chrome.storage.local.set({ isReady: true });
});

// Keep service worker alive and ready
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in background:', request);
  
  if (request.action === 'analyzeUrl') {
    // Check ready state
    chrome.storage.local.get(['isReady'], async (result) => {
      if (!result.isReady) {
        // If not ready, try to initialize
        await chrome.storage.local.set({ isReady: true });
      }
      
      try {
        const analysisResult = await analyzeUrl(request.url);
        sendResponse(analysisResult);
      } catch (error) {
        sendResponse({ error: error.message });
      }
    });
    return true; // Required for async response
  }
});

// Keep service worker alive
chrome.runtime.onConnect.addListener(function(port) {
  port.onDisconnect.addListener(function() {
    // Reinitialize ready state when reconnecting
    chrome.storage.local.set({ isReady: true });
  });
});

async function analyzeUrl(url) {
  try {
    // Create a temporary tab
    const tab = await chrome.tabs.create({ url, active: false });

    // Wait longer for page load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Execute content script
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractContent,
    });

    // Close the temporary tab
    await chrome.tabs.remove(tab.id);

    if (!result || !result.markdown) {
      throw new Error('Failed to extract content');
    }

    return {
      success: true,
      markdown: result.markdown,
      outline: result.outline
    };
  } catch (error) {
    console.error('URL analysis error:', error);
    throw new Error(`Failed to analyze URL: ${error.message}`);
  }
}

function extractContent() {
  function findMainContent() {
    // Try specific article selectors first
    const articleSelectors = [
      'article',
      '[role="article"]',
      '.post-content',
      '.article-content',
      '.entry-content',
      'main article',
      '#article'
    ];

    // Then try main content selectors
    const mainSelectors = [
      'main',
      '[role="main"]',
      '#main-content',
      '.main-content',
      '.content',
      '#content'
    ];

    // Try article selectors first
    for (const selector of articleSelectors) {
      const element = document.querySelector(selector);
      if (element && isValidContentContainer(element)) {
        return element;
      }
    }

    // Then try main content selectors
    for (const selector of mainSelectors) {
      const element = document.querySelector(selector);
      if (element && isValidContentContainer(element)) {
        return element;
      }
    }

    // If no valid container found, try content density analysis
    return findContentByDensity();
  }

  function isValidContentContainer(element) {
    if (!element) return false;

    const text = element.textContent.trim();
    const hasEnoughContent = text.length > 150; // Increased minimum content length
    const hasHeadings = element.querySelector('h1, h2, h3, h4, h5, h6');
    const hasParagraphs = element.querySelector('p');
    const hasNoSkippedParents = !shouldSkipElement(element);

    return hasEnoughContent && hasNoSkippedParents && (hasHeadings || hasParagraphs);
  }

  function findContentByDensity() {
    const body = document.body;
    let bestElement = body;
    let maxDensity = getContentDensity(body);

    // Look for content-rich containers
    const containers = body.querySelectorAll('div, section, article');
    containers.forEach(container => {
      if (shouldSkipElement(container)) return;

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
    return (text.length - linkText) / element.getElementsByTagName('*').length;
  }

  function shouldSkipElement(element) {
    if (element.offsetParent === null) return true;

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

    let current = element;
    while (current && current !== document.body) {
      if (skipSelectors.some(selector => current.matches(selector))) {
        return true;
      }
      current = current.parentElement;
    }

    return false;
  }

  function findPageTitle() {
    const sources = [
      () => document.querySelector('meta[property="og:title"]')?.content,
      () => document.querySelector('meta[name="twitter:title"]')?.content,
      () => {
        const mainH1 = document.querySelector('main h1, article h1, [role="main"] h1');
        return mainH1?.textContent;
      },
      () => {
        const allH1s = Array.from(document.getElementsByTagName('h1'));
        const visibleH1 = allH1s.find(h1 => !shouldSkipElement(h1));
        return visibleH1?.textContent;
      },
      () => document.title
    ];

    for (const source of sources) {
      const title = source();
      if (title) return cleanText(title);
    }

    return null;
  }

  function cleanText(text) {
    return text
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ');
  }

  try {
    // Find the main content area
    const mainContent = findMainContent();
    let markdown = '';

    // Get the page title first
    const pageTitle = findPageTitle();
    if (pageTitle) {
      markdown += `# ${pageTitle}\n\n`;
    }

    if (!mainContent) {
      return { 
        markdown: markdown || '# Content not found',
        outline: pageTitle ? `# ${pageTitle}` : '# Content not found'
      };
    }

    // Process all content
    const elements = mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol');
    elements.forEach(element => {
      if (shouldSkipElement(element)) return;

      const tag = element.tagName.toLowerCase();
      const text = cleanText(element.textContent);

      if (!text) return;

      switch (tag) {
        case 'h1':
          if (text !== pageTitle) {
            markdown += `# ${text}\n\n`;
          }
          break;
        case 'h2':
          markdown += `## ${text}\n\n`;
          break;
        case 'h3':
          markdown += `### ${text}\n\n`;
          break;
        case 'h4':
          markdown += `#### ${text}\n\n`;
          break;
        case 'h5':
          markdown += `##### ${text}\n\n`;
          break;
        case 'h6':
          markdown += `###### ${text}\n\n`;
          break;
        case 'p':
          markdown += `${text}\n\n`;
          break;
        case 'ul':
          Array.from(element.children)
            .filter(li => !shouldSkipElement(li))
            .forEach(li => {
              markdown += `- ${cleanText(li.textContent)}\n`;
            });
          markdown += '\n';
          break;
        case 'ol':
          Array.from(element.children)
            .filter(li => !shouldSkipElement(li))
            .forEach((li, index) => {
              markdown += `${index + 1}. ${cleanText(li.textContent)}\n`;
            });
          markdown += '\n';
          break;
      }
    });

    // Extract outline
    const lines = markdown.split('\n');
    const headingRegex = /^(#{1,6})\s+(.+)$/;
    const outlineLines = lines.filter(line => headingRegex.test(line));
    const outline = outlineLines.join('\n');

    return { 
      markdown: markdown.trim() || '# Content not found',
      outline: outline.trim() || '# Content not found'
    };
  } catch (error) {
    console.error('Content extraction error:', error);
    return {
      markdown: '# Error extracting content',
      outline: '# Error extracting content'
    };
  }
}
