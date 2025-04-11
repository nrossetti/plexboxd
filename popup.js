document.addEventListener('DOMContentLoaded', async () => {
    const masterToggle = document.getElementById('masterToggle');
    const settingsButton = document.getElementById('settings-button');
    const movieTitle = document.getElementById('movie-title');
    const serverAvailability = document.getElementById('server-availability');
    const noMovieInfo = document.getElementById('no-movie-info');
    const noServers = document.getElementById('no-servers');
    const contentWrapper = document.querySelector('.content-wrapper');
    const debugInfo = document.getElementById('debugInfo');

    // Add initial-load class to prevent transition on page load
    contentWrapper.classList.add('initial-load');
    
    // Load the master toggle state and apply it immediately
    chrome.storage.local.get(['extensionEnabled'], (result) => {
        const isEnabled = result.extensionEnabled !== false; // Default to true if not set
        masterToggle.checked = isEnabled;
        
        if (!isEnabled) {
            contentWrapper.classList.add('disabled');
        }
        
        // Remove the initial-load class after a brief delay to enable transitions
        setTimeout(() => {
            contentWrapper.classList.remove('initial-load');
        }, 100);

        // If enabled, check the current tab
        if (isEnabled) {
            checkCurrentTab();
        }
    });

    // Handle master toggle changes
    masterToggle.addEventListener('change', () => {
        const isEnabled = masterToggle.checked;
        chrome.storage.local.set({ extensionEnabled: isEnabled }, () => {
            updateContentVisibility(isEnabled);
            
            // If enabling, refresh the content
            if (isEnabled) {
                setTimeout(() => {
                    checkCurrentTab();
                }, 300); // Wait for transition to complete
            }
        });
    });

    function updateContentVisibility(isEnabled) {
        if (isEnabled) {
            contentWrapper.classList.remove('disabled');
        } else {
            contentWrapper.classList.add('disabled');
        }
    }

    // Open settings page
    settingsButton.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    async function checkCurrentTab() {
        try {
            logDebug('Starting checkCurrentTab');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            logDebug('Current tab:', tab);
            
            if (tab?.url?.includes('letterboxd.com/film/')) {
                logDebug('Found Letterboxd film page');
                // Get movie info from the page
                try {
                    const result = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        function: getMovieInfo,
                    });
                    logDebug('Script execution result:', result);

                    const movieData = result[0].result;
                    logDebug('Movie data extracted:', movieData);
                    
                    if (movieData) {
                        await checkMovieAvailability(movieData, tab);
                    } else {
                        logDebug('No movie data found');
                        serverAvailability.style.display = 'none';
                        noMovieInfo.style.display = 'block';
                    }
                } catch (scriptError) {
                    logDebug('Error executing content script:', scriptError);
                    console.error('PlexBoxd: Error executing content script:', scriptError);
                    serverAvailability.style.display = 'none';
                    noMovieInfo.style.display = 'block';
                }
            } else {
                logDebug('Not a Letterboxd film page');
                serverAvailability.style.display = 'none';
                noMovieInfo.style.display = 'block';
            }
        } catch (error) {
            logDebug('Error in checkCurrentTab:', error);
            console.error('PlexBoxd: Error in checkCurrentTab:', error);
            serverAvailability.style.display = 'none';
            noMovieInfo.style.display = 'block';
        }
    }

    async function checkMovieAvailability({ title, tmdbId, year }, currentTab) {
        logDebug('Checking movie availability:', { title, tmdbId, year });
        
        try {
            chrome.storage.local.get(['servers', 'cacheExpiration'], async (result) => {
                const servers = result.servers || [];
                logDebug('Loaded servers:', servers.length);
                
                if (servers.length === 0) {
                    logDebug('No servers configured');
                    serverAvailability.style.display = 'none';
                    noServers.style.display = 'block';
                    return;
                }

                serverAvailability.style.display = 'block';
                movieTitle.textContent = title || 'Unknown Movie';
                serverAvailability.innerHTML = '';

                const cacheExpiration = (result.cacheExpiration || 24) * 60 * 60 * 1000;
                logDebug('Cache expiration:', cacheExpiration);

                for (const server of servers) {
                    const cacheKey = `movie_${server.name}_${tmdbId || title}`;
                    logDebug('Checking cache for key:', cacheKey);
                    
                    // Check cache first
                    const cachedResult = await checkCache(cacheKey, cacheExpiration);
                    if (cachedResult) {
                        logDebug('Found cached result:', cachedResult);
                        displayServerResult(server.name, cachedResult.status, cachedResult.id, cachedResult.plexUrl);
                        continue;
                    }

                    try {
                        logDebug('Checking server:', server.name);
                        const searchResult = await searchOmbi(server, tmdbId || title, year);
                        if (searchResult) {
                            const status = determineStatus(searchResult);
                            displayServerResult(server.name, status, searchResult.id, searchResult.plexUrl);
                            cacheResult(cacheKey, { 
                                status, 
                                id: searchResult.id,
                                plexUrl: searchResult.plexUrl 
                            });
                        } else {
                            logDebug('No search result found');
                            displayServerResult(server.name, 'error');
                        }
                    } catch (error) {
                        logDebug(`Error checking ${server.name}:`, error);
                        console.error(`PlexBoxd: Error checking ${server.name}:`, error);
                        displayServerResult(server.name, 'error');
                    }
                }
            });
        } catch (error) {
            logDebug('Error in checkMovieAvailability:', error);
            console.error('PlexBoxd: Error in checkMovieAvailability:', error);
        }
    }

    function displayServerResult(serverName, status, movieId, plexUrl) {
        const item = document.createElement('div');
        item.className = 'server-availability-item';

        const statusDiv = document.createElement('div');
        statusDiv.className = 'status';

        const icon = document.createElement('span');
        icon.className = 'status-icon';
        if (status === 'available') {
            icon.style.backgroundColor = '#00B020';
        } else if (status === 'requested') {
            icon.style.backgroundColor = '#FFA500';
        } else if (status === 'error') {
            icon.style.backgroundColor = '#FF4444';
        } else {
            icon.style.backgroundColor = '#666666';
        }
        statusDiv.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'server-name';
        name.textContent = serverName;

        item.appendChild(statusDiv);
        item.appendChild(name);
        
        switch (status) {
            case 'available':
                if (plexUrl) {
                    const watchButton = document.createElement('button');
                    watchButton.className = 'request-button available';
                    watchButton.textContent = 'Watch';
                    watchButton.onclick = () => window.open(plexUrl, '_blank');
                    item.appendChild(watchButton);
                }
                break;
            case 'requested':
                const requestedText = document.createElement('button');
                requestedText.className = 'request-button';
                requestedText.textContent = 'Requested';
                requestedText.disabled = true;
                item.appendChild(requestedText);
                break;
            case 'unavailable':
                if (movieId) {
                    const requestButton = document.createElement('button');
                    requestButton.className = 'request-button';
                    requestButton.textContent = 'Request';
                    requestButton.onclick = () => makeRequest(serverName, movieId);
                    item.appendChild(requestButton);
                }
                break;
            default:
                const errorButton = document.createElement('button');
                errorButton.className = 'request-button';
                errorButton.textContent = 'Error';
                errorButton.disabled = true;
                item.appendChild(errorButton);
        }

        serverAvailability.appendChild(item);
    }

    function logDebug(message, data = null) {
        chrome.storage.local.get(['debugMode'], (result) => {
            if (!result.debugMode) {
                return;
            }

            const timestamp = new Date().toLocaleTimeString();
            let logMessage = `[${timestamp}] ${message}\n`;
            if (data) {
                logMessage += JSON.stringify(data, null, 2) + '\n';
            }
            debugInfo.textContent += logMessage + '\n';
            debugInfo.scrollTop = debugInfo.scrollHeight;
        });
    }

    // Update debug panel visibility based on debug mode
    function updateDebugVisibility() {
        chrome.storage.local.get(['debugMode'], (result) => {
            debugInfo.style.display = result.debugMode ? 'block' : 'none';
            if (!result.debugMode) {
                debugInfo.textContent = ''; // Clear debug info when disabled
            }
        });
    }

    // Call this when popup opens and when debug mode changes
    updateDebugVisibility();

    // Listen for debug mode changes
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.debugMode) {
            updateDebugVisibility();
        }
    });

    async function searchOmbi(server, query, year) {
        const baseUrl = formatApiUrl(server.url);
        logDebug(`Checking server: ${server.name}`);
        logDebug(`Query: ${query}, Year: ${year || 'N/A'}`);
        
        let searchUrl;
        let searchResult;
        let existingRequest;

        if (typeof query === 'number' || (typeof query === 'string' && /^\d+$/.test(query))) {
            const tmdbId = typeof query === 'string' ? query : query.toString();
            logDebug(`Checking existing requests for TMDb ID: ${tmdbId}`);
            
            try {
                const requestsUrl = `${baseUrl}/Request/movie?count=1000&statusType=1&availabilityType=1`;
                logDebug(`Fetching requests from: ${requestsUrl}`);
                
                const requestsResponse = await fetch(requestsUrl, {
                    method: 'GET',
                    headers: {
                        'ApiKey': server.apiKey,
                        'Accept': 'application/json'
                    }
                });
                
                if (!requestsResponse.ok) {
                    const errorText = await requestsResponse.text();
                    logDebug(`Error fetching requests: ${requestsResponse.status} ${requestsResponse.statusText}`);
                    logDebug(`Error response: ${errorText}`);
                    throw new Error(`Failed to fetch requests: ${requestsResponse.status} - ${errorText}`);
                }
                
                const requests = await requestsResponse.json();
                logDebug(`Found ${requests.length} total requests`);
                
                // Log all requests for debugging
                logDebug('All requests:', requests);
                
                existingRequest = requests.find(r => {
                    if (!r.theMovieDbId) {
                        logDebug(`Warning: Request missing theMovieDbId:`, r);
                        return false;
                    }
                    const match = r.theMovieDbId.toString() === tmdbId;
                    if (match) {
                        logDebug('Found matching request:', r);
                    }
                    return match;
                });

                if (existingRequest) {
                    logDebug('Found existing request:', existingRequest);
                    // Create a basic search result from the existing request
                    searchResult = {
                        id: tmdbId,
                        available: false,
                        requested: true,
                        approved: existingRequest.approved,
                        plexUrl: null,
                        title: existingRequest.title
                    };
                    logDebug('Created search result from existing request:', searchResult);
                    return searchResult;
                } else {
                    logDebug('No existing request found for this movie');
                }

                searchUrl = `${baseUrl}/Search/movie/info/${tmdbId}`;
                logDebug(`Searching by TMDb ID: ${searchUrl}`);
                
                const response = await fetch(searchUrl, {
                    method: 'GET',
                    headers: {
                        'ApiKey': server.apiKey,
                        'Accept': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    logDebug(`Search by TMDb ID failed: ${response.status} ${response.statusText}`);
                    logDebug(`Error response: ${errorText}`);
                    throw new Error(`Search failed: ${response.status} - ${errorText}`);
                }
                
                searchResult = await response.json();
                if (searchResult) {
                    logDebug('Search result:', searchResult);
                    
                    // Try to get availability info, but don't fail if it errors
                    try {
                        const availabilityUrl = `${baseUrl}/Request/movie/available/${tmdbId}`;
                        logDebug(`Checking availability: ${availabilityUrl}`);
                        
                        const availabilityResponse = await fetch(availabilityUrl, {
                            method: 'GET',
                            headers: {
                                'ApiKey': server.apiKey,
                                'Accept': 'application/json'
                            }
                        });
                        
                        if (!availabilityResponse.ok || availabilityResponse.status === 204) {
                            logDebug(`Availability check returned ${availabilityResponse.status}`);
                            // Keep existing plexUrl if we have it
                            searchResult.plexUrl = searchResult.plexUrl || null;
                            searchResult.available = searchResult.available || false;
                            searchResult.requested = existingRequest ? true : false;
                        } else {
                            try {
                                const availabilityData = await availabilityResponse.json();
                                logDebug('Availability data:', availabilityData);
                                
                                // Keep plexUrl from either source
                                searchResult.plexUrl = searchResult.plexUrl || availabilityData.plexUrl || null;
                                searchResult.available = availabilityData.available || searchResult.available || false;
                                searchResult.requested = existingRequest ? true : (availabilityData.requested || false);
                            } catch (jsonError) {
                                logDebug('Error parsing availability JSON:', jsonError);
                                // Keep existing plexUrl if we have it
                                searchResult.plexUrl = searchResult.plexUrl || null;
                                searchResult.available = searchResult.available || false;
                                searchResult.requested = existingRequest ? true : false;
                            }
                        }
                    } catch (availabilityError) {
                        logDebug('Error checking availability:', availabilityError);
                        logDebug('Error details:', {
                            message: availabilityError.message,
                            stack: availabilityError.stack
                        });
                        // Don't throw, just use default values
                        searchResult.available = false;
                        searchResult.requested = existingRequest ? true : false;
                        searchResult.plexUrl = null;
                    }
                    
                    searchResult.id = tmdbId;
                    logDebug('Final search result:', searchResult);
                    return searchResult;
                }
            } catch (error) {
                logDebug('Error in TMDb search process:', {
                    message: error.message,
                    stack: error.stack
                });
                throw error;
            }
        }

        // If TMDb ID search failed or we only have title, try title search
        if (!searchResult && typeof query === 'string') {
            const searchTerm = year ? `${query} ${year}` : query;
            searchUrl = `${baseUrl}/Search/movie/${encodeURIComponent(searchTerm)}`;
            
            try {
                const response = await fetch(searchUrl, {
                    method: 'GET',
                    headers: {
                        'ApiKey': server.apiKey,
                        'Accept': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Search failed:', response.status, response.statusText, errorText);
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const results = await response.json();
                // Try to find the exact match
                if (Array.isArray(results)) {
                    searchResult = results.find(movie => {
                        const titleMatch = movie.title.toLowerCase() === query.toLowerCase();
                        const yearMatch = !year || movie.releaseDate?.includes(year);
                        return titleMatch && yearMatch;
                    });

                    // If we found a match, check if it's already requested
                    if (searchResult && searchResult.theMovieDbId) {
                        try {
                            const requestsUrl = `${baseUrl}/Request/movie?count=1000&statusType=1&availabilityType=1`;
                            const requestsResponse = await fetch(requestsUrl, {
                                method: 'GET',
                                headers: {
                                    'ApiKey': server.apiKey,
                                    'Accept': 'application/json'
                                }
                            });
                            
                            if (requestsResponse.ok) {
                                const requests = await requestsResponse.json();
                                existingRequest = requests.find(r => r.theMovieDbId === searchResult.theMovieDbId);
                                if (existingRequest) {
                                    searchResult.requested = true;
                                }
                            }
                        } catch (error) {
                            console.error('Error checking existing requests:', error);
                        }
                    }
                }
            } catch (error) {
                console.error('Search error:', error);
                throw error;
            }
        }

        return searchResult;
    }

    function determineStatus(result) {
        logDebug('Determining status for:', result);
        let status;
        // Check if it's available in Plex
        if (result.available) {
            status = 'available';
        }
        // If not available, check if it's been requested
        else if (result.requested) {
            status = 'requested';
        }
        // Otherwise it's unavailable
        else {
            status = 'unavailable';
        }
        logDebug(`Status determined: ${status}`);
        return status;
    }

    async function makeRequest(serverName, movieId) {
        chrome.storage.local.get(['servers'], async (result) => {
            const server = result.servers.find(s => s.name === serverName);
            if (!server) return;

            // Format the base URL properly
            const baseUrl = formatApiUrl(server.url);
            const requestUrl = `${baseUrl}/Request/movie`;
            
            console.log('PlexBoxd: Making request to:', requestUrl);

            try {
                // First, get the count of current requests
                const countResponse = await fetch(`${baseUrl}/Request/movie/total`, {
                    method: 'GET',
                    headers: {
                        'ApiKey': server.apiKey,
                        'Accept': 'application/json'
                    }
                });

                if (!countResponse.ok) {
                    throw new Error('Failed to get request count');
                }

                // Now make the movie request
                const response = await fetch(requestUrl, {
                    method: 'POST',
                    headers: {
                        'ApiKey': server.apiKey,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        theMovieDbId: movieId,
                        languageCode: "en",
                        is4KRequest: false,
                        requestOnBehalf: null,
                        rootFolderOverride: -1,
                        qualityOverride: -1
                    })
                });

                if (response.ok) {
                    // Clear the cache for this movie on all servers
                    chrome.storage.local.get(null, (items) => {
                        const keysToRemove = Object.keys(items).filter(key => 
                            key.startsWith('movie_') && key.endsWith(`_${movieId}`)
                        );
                        if (keysToRemove.length > 0) {
                            chrome.storage.local.remove(keysToRemove);
                        }
                    });
                    
                    alert('Request submitted successfully!');
                    // Refresh the popup
                    location.reload();
                } else {
                    const errorText = await response.text();
                    console.error('Request failed:', response.status, response.statusText, errorText);
                    if (response.status === 401) {
                        alert('Authentication failed. Please check your API key in the server settings.');
                    } else if (response.status === 500) {
                        alert('Server error. Please verify your Ombi configuration and API key.');
                    } else {
                        alert(`Failed to make request (${response.status}). Please check the server logs for more details.`);
                    }
                }
            } catch (error) {
                console.error('Error making request:', error);
                alert('Failed to make request. Please check if the server is running and accessible.');
            }
        });
    }

    async function checkCache(key, expiration) {
        const result = await chrome.storage.local.get([key]);
        const cached = result[key];
        if (!cached) return null;
        
        const now = Date.now();
        if (now - cached.timestamp > expiration) {
            chrome.storage.local.remove([key]);
            return null;
        }
        
        // If this is a requested movie, always recheck to get latest status
        if (cached.data.status === 'requested') {
            return null;
        }
        
        return cached.data;
    }

    function cacheResult(key, data) {
        // Don't cache errors
        if (data.status === 'error') return;
        
        chrome.storage.local.set({
            [key]: {
                data,
                timestamp: Date.now()
            }
        });
    }

    // Add a function to clear all movie caches
    function clearAllMovieCaches() {
        chrome.storage.local.get(null, (items) => {
            const keysToRemove = Object.keys(items).filter(key => key.startsWith('movie_'));
            if (keysToRemove.length > 0) {
                chrome.storage.local.remove(keysToRemove);
            }
        });
    }

    // Clear caches when popup opens
    clearAllMovieCaches();

    function updateServerAvailability(movieId) {
        const serverAvailability = document.getElementById('server-availability');
        serverAvailability.innerHTML = '';

        getServers(servers => {
            if (!servers || servers.length === 0) {
                document.getElementById('no-servers').style.display = 'block';
                return;
            }

            servers.forEach(server => {
                const item = document.createElement('div');
                item.className = 'server-availability-item';

                const status = document.createElement('div');
                status.className = 'status';

                const icon = document.createElement('span');
                icon.className = 'status-icon';

                const name = document.createElement('span');
                name.className = 'server-name';
                name.textContent = server.name;

                status.appendChild(icon);
                status.appendChild(name);

                const button = document.createElement('button');
                button.className = 'request-button';

                // Check availability
                checkMovieAvailability(server, movieId)
                    .then(result => {
                        if (result.available) {
                            item.classList.add('available');
                            button.textContent = 'Watch';
                            button.classList.add('available');
                            button.onclick = () => openInPlex(result.plexUrl);
                        } else if (result.requested) {
                            item.classList.add('requested');
                            button.textContent = 'Requested';
                            button.disabled = true;
                        } else if (result.error) {
                            item.classList.add('error');
                            button.textContent = 'Error';
                            button.disabled = true;
                        } else {
                            item.classList.add('unavailable');
                            button.textContent = 'Request';
                            button.onclick = () => requestMovie(server, movieId);
                        }
                    })
                    .catch(() => {
                        item.classList.add('error');
                        button.textContent = 'Error';
                        button.disabled = true;
                    });

                item.appendChild(status);
                item.appendChild(button);
                serverAvailability.appendChild(item);
            });
        });
    }
});

// Helper function to extract movie info from the page
function getMovieInfo() {
    // Try multiple selectors for the title
    const title = 
        document.querySelector('h1[itemprop="name"]')?.textContent.trim() ||
        document.querySelector('.headline-1')?.textContent.trim() ||
        document.querySelector('.film-title')?.textContent.trim() ||
        document.querySelector('h1.title-1')?.textContent.trim();

    // Try to find TMDb ID - first try the direct TMDB link
    let tmdbId = null;
    const tmdbLink = document.querySelector('a[href*="themoviedb.org/movie/"]');
    if (tmdbLink) {
        const match = tmdbLink.href.match(/\/movie\/(\d+)/);
        if (match) {
            tmdbId = match[1];
        }
    }
    
    // If no TMDb link found, try data attributes
    if (!tmdbId) {
        const filmData = document.querySelector('[data-tmdb-id]');
        if (filmData) {
            tmdbId = filmData.getAttribute('data-tmdb-id');
        }
    }

    // Try to get year for better search results
    const year = 
        document.querySelector('[itemprop="datePublished"]')?.textContent.trim() ||
        document.querySelector('.film-year')?.textContent.trim();

    console.log('PlexBoxd: Found movie info:', { title, tmdbId, year });
    
    if (!tmdbId) {
        console.warn('PlexBoxd: No TMDb ID found for movie');
    }
    
    return { 
        title: title || null,
        tmdbId,
        year
    };
}

// Helper function to ensure proper API URL formatting
function formatApiUrl(baseUrl) {
    // Remove trailing slashes and normalize
    baseUrl = baseUrl.replace(/\/+$/, '');
    
    // Always use /api/v1 without /ombi prefix
    return `${baseUrl}/api/v1`;
}

function updateServerAvailability(movieId) {
    const serverAvailability = document.getElementById('server-availability');
    serverAvailability.innerHTML = '';

    getServers(servers => {
        if (!servers || servers.length === 0) {
            document.getElementById('no-servers').style.display = 'block';
            return;
        }

        servers.forEach(server => {
            const item = document.createElement('div');
            item.className = 'server-availability-item';

            const status = document.createElement('div');
            status.className = 'status';

            const icon = document.createElement('span');
            icon.className = 'status-icon';

            const name = document.createElement('span');
            name.className = 'server-name';
            name.textContent = server.name;

            status.appendChild(icon);
            status.appendChild(name);

            const button = document.createElement('button');
            button.className = 'request-button';

            // Check availability
            checkMovieAvailability(server, movieId)
                .then(result => {
                    if (result.available) {
                        item.classList.add('available');
                        button.textContent = 'Watch';
                        button.classList.add('available');
                        button.onclick = () => openInPlex(result.plexUrl);
                    } else if (result.requested) {
                        item.classList.add('requested');
                        button.textContent = 'Requested';
                        button.disabled = true;
                    } else if (result.error) {
                        item.classList.add('error');
                        button.textContent = 'Error';
                        button.disabled = true;
                    } else {
                        item.classList.add('unavailable');
                        button.textContent = 'Request';
                        button.onclick = () => requestMovie(server, movieId);
                    }
                })
                .catch(() => {
                    item.classList.add('error');
                    button.textContent = 'Error';
                    button.disabled = true;
                });

            item.appendChild(status);
            item.appendChild(button);
            serverAvailability.appendChild(item);
        });
    });
} 