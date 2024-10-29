console.log('Popup script loaded');

document.addEventListener('DOMContentLoaded', function() {
  // Setup event listeners
  document.getElementById('convertBtn').addEventListener('click', handleConvert);
  document.getElementById('copyOutlineBtn').addEventListener('click', handleCopyOutline);
  document.getElementById('outlineBtn').addEventListener('click', () => handleAction('outline'));
  document.getElementById('analyzeUrlBtn').addEventListener('click', handleAnalyzeUrl);

  // Easter egg theme switcher
  let clickCount = 0;
  let lastClick = 0;
  const credits = document.querySelector('.credits');

  credits.addEventListener('click', (e) => {
    const now = Date.now();
    if (now - lastClick > 2000) { // Reset if more than 2 seconds between clicks
      clickCount = 0;
    }
    
    clickCount++;
    lastClick = now;

    if (clickCount === 5) {
      toggleVampireTheme();
      clickCount = 0;
    }
  });

  // Theme menu handling
  const themeToggle = document.getElementById('themeToggle');
  const themeMenu = document.getElementById('themeMenu');
  const themeOptions = document.querySelectorAll('.theme-option');

  // Toggle theme menu
  themeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    themeMenu.classList.toggle('show');
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!themeMenu.contains(e.target) && !themeToggle.contains(e.target)) {
      themeMenu.classList.remove('show');
    }
  });

  // Theme selection
  themeOptions.forEach(option => {
    option.addEventListener('click', () => {
      const theme = option.dataset.theme;
      setTheme(theme);
      themeMenu.classList.remove('show');
    });
  });

  // Check saved theme
  chrome.storage.local.get(['theme'], (result) => {
    setTheme(result.theme || 'dracula');
  });
});

function toggleVampireTheme() {
  const body = document.body;
  const isVampire = body.classList.toggle('vampire-theme');
  
  // Save preference
  chrome.storage.local.set({ vampireTheme: isVampire });

  // Show easter egg found message
  updateStatus(
    isVampire ? '🧛‍♂️ Vampire theme activated!' : '🌙 Regular theme restored',
    'info'
  );
}

// Check for saved theme preference
chrome.storage.local.get(['vampireTheme'], (result) => {
  if (result.vampireTheme) {
    document.body.classList.add('vampire-theme');
  }
});

async function handleConvert() {
  updateStatus('Processing...', 'info');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'convert' });
    
    if (response && response.success) {
      await navigator.clipboard.writeText(response.markdown);
      updateStatus('Markdown copied to clipboard!', 'success');
    } else {
      throw new Error(response?.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Conversion error:', error);
    updateStatus(`Error: ${error.message}. Please refresh and try again.`, 'error');
  }
}

async function handleCopyOutline() {
  updateStatus('Extracting outline...', 'info');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getOutline' });
    
    if (response && response.success) {
      await navigator.clipboard.writeText(response.outline);
      updateStatus('Outline copied to clipboard!', 'success');
    } else {
      throw new Error(response?.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Outline extraction error:', error);
    updateStatus(`Error: ${error.message}. Please refresh and try again.`, 'error');
  }
}

async function handleAnalyzeUrl() {
  const urlInput = document.getElementById('urlInput');
  const url = urlInput.value.trim();
  
  if (!url) {
    updateStatus('Please enter a URL', 'error');
    return;
  }

  try {
    updateStatus('Analyzing URL...', 'info');
    
    const response = await chrome.runtime.sendMessage({
      action: 'analyzeUrl',
      url: url
    });

    if (response.error) {
      updateStatus(response.error, 'error');
      return;
    }

    // Store the response data for later use
    window.analysisResult = response;

    // Display results with updated styling
    const resultDiv = document.getElementById('result');
    resultDiv.innerHTML = `
      <h3 style="margin-bottom: 12px;">Analysis Results:</h3>
      <p style="margin-bottom: 8px;"><strong>Outline:</strong></p>
      <pre style="margin-bottom: 16px; background-color: #282a36; padding: 12px; border-radius: 4px;">${response.outline || 'No headings found'}</pre>
      <div class="result-actions">
        <button id="copyFullMarkdownBtn" style="margin-bottom: 8px;">Copy Full Markdown</button>
        <button id="copyUrlOutlineBtn" style="margin-bottom: 8px;">Copy Outline</button>
      </div>
    `;

    // Add copy buttons functionality with separate IDs
    document.getElementById('copyFullMarkdownBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.analysisResult.markdown);
        updateStatus('Full markdown copied to clipboard!', 'success');
      } catch (err) {
        updateStatus('Failed to copy markdown', 'error');
      }
    });

    document.getElementById('copyUrlOutlineBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.analysisResult.outline);
        updateStatus('Outline copied to clipboard!', 'success');
      } catch (err) {
        updateStatus('Failed to copy outline', 'error');
      }
    });

    updateStatus('URL analyzed successfully!', 'success');
  } catch (error) {
    updateStatus('Failed to analyze URL. Please try again.', 'error');
    console.error('URL analysis error:', error);
  }
}

function handleAction(action) {
  if (action === 'outline') {
    chrome.tabs.create({ url: 'outline.html' });
  }
}

function updateStatus(message, type) {
  console.log(`Status update (${type}):`, message);
  const statusElement = document.getElementById('status');
  statusElement.textContent = message;
  statusElement.className = type;
}

function setTheme(theme) {
  const body = document.body;
  
  // Remove all theme classes
  body.classList.remove('dracula-theme', 'cursor-theme', 'vampire-theme');
  
  // Add selected theme class
  switch (theme) {
    case 'cursor':
      body.classList.add('cursor-theme');
      break;
    case 'vampire':
      body.classList.add('vampire-theme');
      break;
    default:
      body.classList.add('dracula-theme');
      theme = 'dracula';
  }

  // Save theme preference
  chrome.storage.local.set({ theme });
  updateStatus(`${theme.charAt(0).toUpperCase() + theme.slice(1)} theme activated`, 'info');
}
