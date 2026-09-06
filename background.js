function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'copy-page-md',
      title: 'Copy page as Markdown',
      contexts: ['page', 'frame']
    });
  });
}

// Register on install/update AND on service worker startup
// (service worker can be killed/restarted without firing onInstalled)
chrome.runtime.onInstalled.addListener(setupContextMenus);
chrome.runtime.onStartup.addListener(setupContextMenus);

// Inject content.js, get markdown from content script, then write clipboard
// via an injected function — more reliable than content script clipboard write
// after context menu interactions (page focus may be lost).
async function convertAndCopyViaBackground(tabId, action) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const response = await chrome.tabs.sendMessage(tabId, { action });
    if (!response?.success) {
      showBadge(tabId, '✗', '#f87171');
      return;
    }

    const text = response.markdown;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async (t) => { await navigator.clipboard.writeText(t); },
      args: [text]
    });

    showBadge(tabId, '✓', '#4ade80');
  } catch (error) {
    // No popup UI on this path (context menu / keyboard shortcut) to surface the
    // error in, so at least flip the badge instead of failing silently.
    console.error('castmd: convertAndCopyViaBackground failed', error);
    showBadge(tabId, '✗', '#f87171');
  }
}

function showBadge(tabId, text, color) {
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 2000);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // `tab` is optional in the API: a click from a surface without a tab (e.g. a
  // detached devtools window) would otherwise throw inside the listener.
  if (!tab?.id) return;
  convertAndCopyViaBackground(tab.id, 'convert');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'copy-markdown') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) convertAndCopyViaBackground(tab.id, 'convert');
});
