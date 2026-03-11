let authWindowId = null;

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "authenticate") {
    // Close any existing auth windows
    if (authWindowId) {
      try {
        chrome.windows.remove(authWindowId);
      } catch (e) {
        console.log('No existing window to close');
      }
    }

    // Create a popup window for Plex auth
    chrome.windows.create({
      url: request.authUrl,
      type: 'popup',
      width: 500,
      height: 600,
      focused: true
    }).then(window => {
      authWindowId = window.id;
      // Start polling for the token
      startTokenPolling(request.pinId, request.headers, window.id, sendResponse);
    }).catch(error => {
      console.error('Error creating auth window:', error);
      sendResponse({ error: error.message });
    });
    
    return true; // Keep the message channel open
  }
});

async function startTokenPolling(pinId, headers, windowId, sendResponse) {
  let attempts = 0;
  const maxAttempts = 120; // 2 minutes
  const pollInterval = 1000; // 1 second

  const pollForToken = async () => {
    try {
      console.log(`Polling attempt ${attempts + 1}/${maxAttempts}`);
      
      const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
        method: 'GET',
        headers: new Headers(headers)
      });
      
      if (!response.ok) {
        throw new Error(`PIN check failed: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Poll response:', data);
      
      if (data.authToken) {
        console.log('Token received');
        // Token received, close the auth window
        try {
          await chrome.windows.remove(windowId);
        } catch (windowError) {
          console.log('Window might already be closed:', windowError);
        }
        
        authWindowId = null;
        sendResponse({ token: data.authToken });
        return;
      }
      
      attempts++;
      
      if (attempts < maxAttempts) {
        setTimeout(() => pollForToken(), pollInterval);
      } else {
        console.log('Auth timed out');
        try {
          await chrome.windows.remove(windowId);
        } catch (windowError) {
          console.log('Window might already be closed:', windowError);
        }
        authWindowId = null;
        sendResponse({ error: 'Authentication timed out' });
      }
    } catch (error) {
      console.error('Token polling error:', error);
      try {
        await chrome.windows.remove(windowId);
      } catch (windowError) {
        console.log('Window might already be closed:', windowError);
      }
      authWindowId = null;
      sendResponse({ error: error.message });
    }
  };

  pollForToken();
}

// Log when the service worker starts
console.log('PlexBoxd service worker initialized'); 