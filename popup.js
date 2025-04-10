document.addEventListener('DOMContentLoaded', async () => {
    const masterToggle = document.getElementById('masterToggle');
    const settingsButton = document.getElementById('settings-button');
    const movieTitle = document.getElementById('movie-title');
    const serverAvailability = document.getElementById('server-availability');
    const noMovieInfo = document.getElementById('no-movie-info');
    const noServers = document.getElementById('no-servers');
    const contentWrapper = document.querySelector('.content-wrapper');

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
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url?.includes('letterboxd.com/film/')) {
            // Get movie info from the page
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: getMovieInfo,
            });

            const movieData = result[0].result;
            if (movieData) {
                await checkMovieAvailability(movieData, tab);
            }
        } else {
            serverAvailability.style.display = 'none';
            noMovieInfo.style.display = 'block';
        }
    }

    async function checkMovieAvailability({ title, tmdbId, year }, currentTab) {
        chrome.storage.local.get(['servers', 'cacheExpiration'], async (result) => {
            const servers = result.servers || [];
            
            if (servers.length === 0) {
                serverAvailability.style.display = 'none';
                noServers.style.display = 'block';
                return;
            }

            serverAvailability.style.display = 'block';
            movieTitle.textContent = title || 'Unknown Movie';
            serverAvailability.innerHTML = '';

            let hasAvailable = false;
            const cacheExpiration = (result.cacheExpiration || 24) * 60 * 60 * 1000;

            for (const server of servers) {
                const cacheKey = `movie_${server.name}_${tmdbId || title}`;
                
                // Check cache first
                const cachedResult = await checkCache(cacheKey, cacheExpiration);
                if (cachedResult) {
                    displayServerResult(server.name, cachedResult.status, cachedResult.id, cachedResult.plexUrl);
                    if (cachedResult.status === 'available') hasAvailable = true;
                    continue;
                }

                try {
                    console.log('PlexBoxd: Checking server', server.name);
                    const searchResult = await searchOmbi(server, tmdbId || title, year);
                    if (searchResult) {
                        const status = determineStatus(searchResult);
                        displayServerResult(server.name, status, searchResult.id, searchResult.plexUrl);
                        if (status === 'available') hasAvailable = true;
                        cacheResult(cacheKey, { 
                            status, 
                            id: searchResult.id,
                            plexUrl: searchResult.plexUrl 
                        });
                    }
                } catch (error) {
                    console.error(`PlexBoxd: Error checking ${server.name}:`, error);
                    displayServerResult(server.name, 'error');
                }
            }

            // Update extension icon
            const badgeColor = hasAvailable ? '#00B020' : '#666666';
            const badgeText = hasAvailable ? '✓' : '';
            
            chrome.action.setBadgeBackgroundColor({ color: badgeColor });
            if (currentTab) {
                chrome.action.setBadgeText({ text: badgeText, tabId: currentTab.id });
            } else {
                chrome.action.setBadgeText({ text: badgeText });
            }
        });
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
                const requestedText = document.createElement('span');
                requestedText.className = 'request-button';
                requestedText.textContent = 'Requested';
                requestedText.style.cursor = 'default';
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
                const errorText = document.createElement('span');
                errorText.className = 'request-button';
                errorText.textContent = 'Error';
                errorText.style.cursor = 'default';
                item.appendChild(errorText);
        }

        serverAvailability.appendChild(item);
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

async function searchOmbi(server, query, year) {
    // Format the base URL properly
    const baseUrl = formatApiUrl(server.url);
    
    let searchUrl;
    let searchResult;

    // If we have a TMDb ID, try that first
    if (typeof query === 'number' || (typeof query === 'string' && /^\d+$/.test(query))) {
        const tmdbId = typeof query === 'string' ? query : query.toString();
        searchUrl = `${baseUrl}/Search/movie/info/${tmdbId}`;
        try {
            const response = await fetch(searchUrl, {
                method: 'GET',
                headers: {
                    'ApiKey': server.apiKey,
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                searchResult = await response.json();
                if (searchResult) {
                    // Also check if it's already available or requested
                    const availabilityUrl = `${baseUrl}/Request/movie/available/${tmdbId}`;
                    const availabilityResponse = await fetch(availabilityUrl, {
                        method: 'GET',
                        headers: {
                            'ApiKey': server.apiKey,
                            'Accept': 'application/json'
                        }
                    });
                    
                    if (availabilityResponse.ok) {
                        const availabilityData = await availabilityResponse.json();
                        searchResult.available = availabilityData.available;
                        searchResult.requested = availabilityData.requested;
                        searchResult.approved = availabilityData.approved;
                        searchResult.plexUrl = availabilityData.plexUrl;
                        searchResult.id = tmdbId; // Ensure we set the ID for the request button
                    }
                    return searchResult;
                }
            } else {
                console.error('Search by TMDb ID failed:', response.status, response.statusText);
            }
        } catch (error) {
            console.error('Error checking by TMDb ID:', error);
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
            }
        } catch (error) {
            console.error('Search error:', error);
            throw error;
        }
    }

    return searchResult;
}

function determineStatus(result) {
    // First check if it's available in Plex
    if (result.plexUrl || result.available) {
        return 'available';
    }
    // Then check if it's requested or approved
    if (result.requested || result.approved) {
        return 'requested';
    }
    // Otherwise it's unavailable
    return 'unavailable';
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
    
    return cached.data;
}

function cacheResult(key, data) {
    chrome.storage.local.set({
        [key]: {
            data,
            timestamp: Date.now()
        }
    });
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