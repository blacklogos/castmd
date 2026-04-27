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
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const response = await chrome.tabs.sendMessage(tabId, { action });
  if (!response?.success) return;

  const text = response.markdown;
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async (t) => { await navigator.clipboard.writeText(t); },
    args: [text]
  });

  chrome.action.setBadgeText({ text: '✓', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#4ade80', tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 2000);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  convertAndCopyViaBackground(tab.id, 'convert');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'copy-markdown') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) convertAndCopyViaBackground(tab.id, 'convert');
});
