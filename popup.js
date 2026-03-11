// === POPUP.JS LOADED ===
console.log('=== popup.js loaded (top-level) ===');

let ombiClient = null;
let debug = false; // Debug mode flag, will be updated from storage



// Define utility functions at the top level
function displayLoading(isLoading) {
    const loadingElement = document.getElementById('loading');
    if (!loadingElement) {
        console.error('Loading element not found in the DOM');
        return;
    }
    
    loadingElement.style.display = isLoading ? 'flex' : 'none';
    
    // If showing loading, hide error
    if (isLoading) {
        const errorElement = document.getElementById('error-message');
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    }
}

function showError(message) {
    console.error('Error:', message);
    
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }
    
    // Hide loading indicator if it's visible
    displayLoading(false);
    
    // Update debug info
    updateDebugInfo({
        error: message
    });
}

// Check the current tab for movie information
async function checkCurrentTab() {
    console.log('=== checkCurrentTab() called in popup.js ===');
    console.log('Checking current tab for movie information');
    
    try {
        // Show loading state
        displayLoading(true);
        
        // Get the active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        
        if (!currentTab) {
            throw new Error('No active tab found');
        }
        
        console.log('Current tab URL:', currentTab.url);
        
        // Check if we're on a Letterboxd movie page
        if (!currentTab.url || !currentTab.url.includes('letterboxd.com/film/')) {
            throw new Error('Not a Letterboxd movie page');
        }
        
        // Extract movie info from the page
        const movieInfo = await getMovieInfo(currentTab);
        
        if (!movieInfo || !movieInfo.title) {
            throw new Error('Could not extract movie information from the page');
        }
        
        console.log('Extracted movie info:', movieInfo);
        
        // Check movie availability in Overseerr
        await checkMovieAvailability(movieInfo);
    } catch (error) {
        console.error('Error checking current tab:', error);
        showError(error.message);
        
        // Hide loading state
        displayLoading(false);
    }
}

// Extract movie information from a Letterboxd page
async function getMovieInfo(tab) {
    console.log('=== getMovieInfo() called in popup.js ===', tab);
    console.log('Extracting movie information from tab:', tab.id);
    
    try {
        // Inject a content script to get movie info from the page
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: extractMovieInfoFromPage
        });
        
        // The results array contains the return value from each frame where the script executed
        if (!results || results.length === 0) {
            throw new Error('No results from content script');
        }
        
        const movieInfo = results[0].result;
        
        // Verify we got valid movie info
        if (!movieInfo || !movieInfo.title) {
            throw new Error('Could not find movie information on the page');
        }
        
        return movieInfo;
    } catch (error) {
        console.error('Error executing content script:', error);
        throw new Error(`Could not extract movie info: ${error.message}`);
    }
}

// This function runs in the context of the web page to extract movie info
function extractMovieInfoFromPage() {
    console.log('Extracting movie info from page content');
    
    // Try multiple selectors for the movie title
    const titleSelectors = [
        'h1[itemprop="name"]',
        '.film-title h1',
        'h1.headline-1',
        '.film-header-lockup h1'
    ];
    
    let title = null;
    for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            title = element.textContent.trim();
            break;
        }
    }

    // Year: Letterboxd puts it in <span class="releasedate"><a>2026</a></span>
    let year = null;
    const yearEl = document.querySelector('span.releasedate a') ||
                   document.querySelector('.film-header-lockup .number');
    if (yearEl) {
        const yearMatch = yearEl.textContent.trim().match(/\d{4}/);
        if (yearMatch) year = parseInt(yearMatch[0]);
    }

    // Try to find TMDb ID from external links
    let tmdbId = null;
    const externalLinks = document.querySelectorAll('.external-link');
    
    for (const link of externalLinks) {
        const href = link.href;
        if (href && href.includes('themoviedb.org')) {
            const match = href.match(/movie\/(\d+)/);
            if (match && match[1]) {
                tmdbId = match[1];
                break;
            }
        }
    }
    
    // If no TMDb ID found in external links, try looking in all links
    if (!tmdbId) {
        const allLinks = document.querySelectorAll('a[href*="themoviedb.org"]');
        for (const link of allLinks) {
            const match = link.href.match(/movie\/(\d+)/);
            if (match && match[1]) {
                tmdbId = match[1];
                break;
            }
        }
    }

    // Extract rating, genres, poster and TMDB ID from JSON-LD
    // Letterboxd wraps JSON-LD in CDATA comments — strip them before parsing
    let letterboxdRating = null;
    let genres = [];
    let posterUrl = null;
    const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    ldScripts.forEach(script => {
        try {
            const raw = script.textContent
                .replace(/\/\*\s*<!\[CDATA\[[\s\S]*?\*\//g, '')
                .replace(/\/\*\s*\]\]>[\s\S]*?\*\//g, '')
                .trim();
            const data = JSON.parse(raw);
            if (data && data['@type'] === 'Movie') {
                if (data.aggregateRating && data.aggregateRating.ratingValue) {
                    letterboxdRating = parseFloat(data.aggregateRating.ratingValue);
                }
                if (data.genre) {
                    genres = Array.isArray(data.genre) ? data.genre : [data.genre];
                }
                if (data.image) {
                    posterUrl = data.image;
                }
                if (!tmdbId && Array.isArray(data.sameAs)) {
                    for (const url of data.sameAs) {
                        const m = url.match(/themoviedb\.org\/movie\/(\d+)/);
                        if (m) { tmdbId = m[1]; break; }
                    }
                }
            }
        } catch (e) { /* ignore parse errors */ }
    });

    // Extract user's rating if logged in (Letterboxd stores it as data-rating-value)
    let userRating = null;
    const yourRatingEl = document.querySelector('[data-rating-value]') ||
                         document.querySelector('.your-rating [data-value]');
    if (yourRatingEl) {
        const val = parseFloat(yourRatingEl.getAttribute('data-rating-value') ||
                               yourRatingEl.getAttribute('data-value') || '0');
        if (val > 0) userRating = val; // Already on 0.5–5 scale on Letterboxd
    }

    // Watched status (present if user has logged a watch)
    const userWatched = !!document.querySelector('.icon-watched.active, .view-date, [data-film-watch-date]');

    // Create the movie info object
    const movieInfo = {
        title: title,
        year: year,
        tmdbId: tmdbId,
        posterUrl: posterUrl,
        letterboxdRating: letterboxdRating,
        genres: genres,
        userRating: userRating,
        userWatched: userWatched
    };

    console.log('Extracted movie information:', movieInfo);
    return movieInfo;
}

// ── Accent colour helpers ──────────────────────────────────────────────────

function generateAccentColor(title) {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Full 360° hue range for maximum variance; fixed saturation/lightness
    // that reads well on the dark background
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 72%, 58%)`;
}

function applyAccentColor(color) {
    document.body.style.setProperty('--accent', color);
    const dot = document.getElementById('popup-accent-dot');
    if (dot) dot.style.background = color;
}

function renderStars(rating, color) {
    // rating is 0.5–5 (Letterboxd half-star scale) — used for "Your Rating"
    const full = Math.floor(rating);
    const half = (rating % 1) >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    const star = (opacity) => `<span style="color:${color};opacity:${opacity}">&#9733;</span>`;
    return star(1).repeat(full) + (half ? star(0.55) : '') + star(0.2).repeat(empty);
}

function renderRatingStars(rating) {
    // rating is 0–5 Letterboxd community scale; uses Font Awesome icons
    const full  = Math.floor(rating);
    const half  = (rating % 1) >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    let html = '';
    for (let i = 0; i < full;  i++) html += `<i class="fas fa-star rating-star"></i>`;
    if (half)                        html += `<i class="fas fa-star-half-alt rating-star"></i>`;
    for (let i = 0; i < empty; i++) html += `<i class="fas fa-star rating-star rating-star-empty"></i>`;
    return html;
}

// Initialize the popup when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('=== DOMContentLoaded event fired in popup.js ===');
    console.log('Popup DOM loaded');
    initialize();
    
    // Setup debug toggle button
    const debugToggle = document.getElementById('debug-toggle');
    const debugInfo = document.getElementById('debug-info');

    if (debugToggle && debugInfo) {
        debugToggle.addEventListener('click', () => {
            if (debugInfo.style.display === 'none') {
                debugInfo.style.display = 'block';
                debugToggle.textContent = 'Hide Debug Info';
            } else {
                debugInfo.style.display = 'none';
                debugToggle.textContent = 'Show Debug Info';
            }
        });
    }

    // Theme toggle (light / dark)
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        // Apply saved theme immediately to avoid flash
        chrome.storage.local.get(['popupTheme'], ({ popupTheme }) => {
            if (popupTheme === 'light') {
                document.body.classList.add('light');
                themeToggle.querySelector('i').className = 'fas fa-moon';
            }
        });

        themeToggle.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light');
            themeToggle.querySelector('i').className = isLight ? 'fas fa-moon' : 'fas fa-sun';
            chrome.storage.local.set({ popupTheme: isLight ? 'light' : 'dark' });
        });
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
//settingsButton.addEventListener('click', () => {
//    chrome.runtime.openOptionsPage();
//});

async function displayUserInfo() {
    if (ombiClient && ombiClient.getUserInfo()) {
        const userInfo = ombiClient.getUserInfo();
        const userInfoElement = document.createElement('div');
        userInfoElement.className = 'user-info';
        userInfoElement.innerHTML = `
            <span class="user-label">Connected as:</span>
            <span class="username">${userInfo.username}</span>
        `;
        
        // Insert at appropriate location in your popup
        const headerElement = document.querySelector('.header');
        headerElement.appendChild(userInfoElement);
    }
}

// Check movie availability in Overseerr
async function checkMovieAvailability(movieData) {
    console.log('=== checkMovieAvailability() called in popup.js ===', movieData);
    if (!movieData || !movieData.title) {
        console.error('Invalid movie data for availability check:', movieData);
        showError('Could not determine movie information from the current page');
        return;
    }

    // Update debug info
    updateDebugInfo({
        movie: {
            title: movieData.title,
            year: movieData.year,
            tmdbId: movieData.tmdbId || 'Not available'
        }
    });

    // Initialize request server client if not already done
    const requestServer = await initializeRequestServer();
    
    if (!requestServer) {
        console.error('Failed to initialize request server client');
        return;
    }
    
    console.log('Checking availability for movie:', movieData);
    
    try {
        // Show loading state
        const serverAvailability = document.getElementById('server-availability');
        if (serverAvailability) {
            serverAvailability.innerHTML = '<div class="server-item loading"><span class="loading-spinner"></span> Checking availability...</div>';
            serverAvailability.style.display = 'block';
        }
        
        // Check movie availability - providing all available data
        const availability = await requestServer.checkMovieAvailability(
            movieData.title,
            movieData.year,
            movieData.tmdbId
        );
        
        console.log('Movie availability result:', availability);
        
        // Update debug info with availability
        updateDebugInfo({
            availability: availability
        });
        
        // Display result in the popup
        displayResult(movieData, availability);
    } catch (error) {
        console.error('Error checking movie availability:', error);
        
        // Show error in the UI
        showError(`Failed to check movie availability: ${error.message}`);
        
        // Update debug info with error
        updateDebugInfo({
            error: error.message
        });
        
        // Hide loading
        displayLoading(false);
    }
}

function displayNotInDatabase(movieData, tmdbId) {
    console.log('Displaying not in database:', movieData);
    document.getElementById('loadingContainer').style.display = 'none';
    document.getElementById('resultsContainer').style.display = 'block';
    
    const item = document.createElement('div');
    item.className = 'server-item';

    const statusIcon = document.createElement('div');
    statusIcon.className = 'status-icon not-in-database';
    item.appendChild(statusIcon);

    const title = document.createElement('div');
    title.className = 'server-title';
    title.textContent = 'Not in Overseerr Database';
    item.appendChild(title);

    const action = document.createElement('button');
    action.className = 'action-button request-add';
    action.textContent = 'Request Add';
    action.onclick = async () => {
        try {
            action.disabled = true;
            action.textContent = 'Requesting...';
            await ombiClient.requestMovieAdd(tmdbId);
            action.textContent = 'Requested';
        } catch (error) {
            console.error('Request failed:', error);
            action.textContent = 'Failed';
            action.disabled = false;
        }
    };

    item.appendChild(action);
    document.getElementById('serverStatus').appendChild(item);
}

function displayResult(movieInfo, availability) {
    console.log('Displaying result for:', movieInfo, 'Availability:', availability);
    
    try {
        // Hide loading
        displayLoading(false);

        // Show movie content panel and apply accent colour
        const movieContent = document.getElementById('movie-content');
        if (movieContent) movieContent.style.display = 'block';
        if (movieInfo.title) applyAccentColor(generateAccentColor(movieInfo.title));

        // Poster image
        if (movieInfo.posterUrl) {
            const posterImg = document.getElementById('movie-poster-img');
            const posterPlaceholder = document.getElementById('poster-placeholder');
            if (posterImg) {
                posterImg.src = movieInfo.posterUrl;
                posterImg.style.display = 'block';
                if (posterPlaceholder) posterPlaceholder.style.display = 'none';
            }
        }

        // Get references to the DOM elements
        const movieTitleElement = document.getElementById('movie-title');
        const serverAvailabilityElement = document.getElementById('server-availability');
        const actionsElement = document.getElementById('actions');

        // Title (year lives in the meta grid, not the heading)
        if (movieTitleElement && movieInfo.title) {
            movieTitleElement.textContent = movieInfo.title;
            movieTitleElement.style.display = 'block';
        }

        // Year
        const yearEl = document.getElementById('popup-year');
        if (yearEl && movieInfo.year) yearEl.textContent = movieInfo.year;

        // Watched status — only show the cell when we actually detected a watch
        if (movieInfo.userWatched) {
            const watchedCell = document.getElementById('popup-watched-cell');
            const watchedEl   = document.getElementById('popup-watched');
            if (watchedCell) watchedCell.style.display = 'flex';
            if (watchedEl)   watchedEl.textContent = '✓ Watched';
        }

        // Letterboxd rating — stars + numeric value
        if (movieInfo.letterboxdRating) {
            const ratingSection = document.getElementById('popup-rating-section');
            const ratingStars   = document.getElementById('popup-rating-stars');
            const ratingValue   = document.getElementById('popup-rating-value');
            if (ratingSection) {
                ratingSection.style.display = 'block';
                if (ratingStars) ratingStars.innerHTML = renderRatingStars(movieInfo.letterboxdRating);
                if (ratingValue) ratingValue.textContent = movieInfo.letterboxdRating.toFixed(1);
            }
        }

        // User star rating
        if (movieInfo.userRating) {
            const userRatingDiv = document.getElementById('popup-user-rating');
            const starsDiv      = document.getElementById('popup-stars');
            if (userRatingDiv && starsDiv) {
                userRatingDiv.style.display = 'block';
                starsDiv.innerHTML = renderStars(movieInfo.userRating, 'var(--accent)');
            }
        }

        // Genre tags
        if (movieInfo.genres && movieInfo.genres.length > 0) {
            const genresDiv = document.getElementById('popup-genres');
            if (genresDiv) {
                genresDiv.innerHTML = movieInfo.genres.slice(0, 4).map(g =>
                    `<span class="popup-genre-tag" style="background:var(--accent,#10b981)22;border:1px solid var(--accent,#10b981)55;color:var(--accent,#10b981)">${g}</span>`
                ).join('');
            }
        }
        
        // Check if we have an error in the availability result
        if (availability.error) {
            console.error('Error in availability result:', availability.error);
            showError(`Error checking availability: ${availability.error}`);
            return;
        }
        
        // Status badge
        if (serverAvailabilityElement) {
            let circleColor, icon, statusText, statusSubtext;

            if (availability.available) {
                circleColor  = 'var(--accent, #10b981)';
                icon         = '<i class="fas fa-check"></i>';
                statusText   = 'Available on Plex';
                statusSubtext = 'Available to watch';
            } else if (availability.approved || availability.requested) {
                circleColor  = '#f59e0b';
                icon         = '<i class="fas fa-clock"></i>';
                statusText   = availability.approved ? 'Processing Request' : 'Requested';
                statusSubtext = 'Request pending processing';
            } else if (availability.denied) {
                circleColor  = '#6b7280';
                icon         = '<i class="fas fa-ban"></i>';
                statusText   = 'Request Denied';
                statusSubtext = 'Request was not approved';
            } else {
                circleColor  = '#ef4444';
                icon         = '<i class="fas fa-times"></i>';
                statusText   = 'Not Available';
                statusSubtext = 'Not currently available';
            }

            serverAvailabilityElement.innerHTML = `
                <div class="popup-status-inner">
                    <div class="popup-status-circle" style="background:${circleColor}">${icon}</div>
                    <div>
                        <p class="popup-status-title">${statusText}</p>
                        <p class="popup-status-sub">${statusSubtext}</p>
                    </div>
                </div>
            `;
            serverAvailabilityElement.style.display = 'block';
        }
        
        // Action buttons
        if (actionsElement) {
            let action = '';

            if (availability.available) {
                action = `<button class="action-button watch-button popup-action-btn popup-action-primary">
                    <i class="fas fa-play"></i> Watch on Plex
                </button>`;
            } else if (availability.requested || availability.approved) {
                action = `<button class="action-button requested-button popup-action-btn popup-action-outline" disabled>
                    <i class="fas fa-check"></i> Already Requested
                </button>`;
            } else if (availability.denied) {
                action = `<button class="action-button denied-button popup-action-btn popup-action-outline" disabled style="border-color:#6b7280;color:#6b7280">
                    <i class="fas fa-ban"></i> Request Denied
                </button>`;
            } else {
                action = `<button class="action-button request-button popup-action-btn popup-action-primary">
                    <i class="fas fa-plus"></i> Request
                </button>`;
            }

            actionsElement.innerHTML = action;
            actionsElement.style.display = 'block';
            
            // Add event listeners for the buttons
            const watchButton = actionsElement.querySelector('.watch-button');
            if (watchButton) {
                watchButton.addEventListener('click', () => {
                    // Construct Plex URL - try to use movie.mediaInfo if available
                    let plexUrl = null;
                    const movie = availability.movie;
                    if (movie && movie.mediaInfo) {
                        const mediaInfo = movie.mediaInfo;
                        if (mediaInfo.mediaUrl || mediaInfo.plexUrl) {
                            plexUrl = mediaInfo.mediaUrl || mediaInfo.plexUrl;
                            console.log('Using plexUrl from mediaInfo:', plexUrl);
                        } else if (mediaInfo.media && mediaInfo.media.length > 0) {
                            // Try to construct from the first media item
                            const media = mediaInfo.media[0];
                            if (media.guid) {
                                plexUrl = `https://app.plex.tv/desktop#!/media/${media.guid}`;
                                console.log('Constructed plexUrl from GUID:', plexUrl);
                            } else if (media.key) {
                                plexUrl = `https://app.plex.tv/desktop#!/media/${media.key}`;
                                console.log('Constructed plexUrl from key:', plexUrl);
                            }
                        }
                    }
                    // If still no URL, use a fallback
                    if (!plexUrl) {
                        console.log('No plexUrl available, using fallback');
                        plexUrl = 'https://app.plex.tv/desktop';
                    }
                    console.log('Opening Plex URL:', plexUrl);
                    chrome.tabs.create({ url: plexUrl });
                });
            }
            
            const requestButton = actionsElement.querySelector('.request-button');
            if (requestButton) {
                requestButton.addEventListener('click', async () => {
                    try {
                        requestButton.disabled = true;
                        requestButton.innerHTML = '<span class="spinner"></span> Requesting...';
                        
                        // Use the already initialized request server client (Overseerr)
                        const requestServer = window.requestServerClient;
                        if (!requestServer) {
                            throw new Error('Request server client not initialized');
                        }
                        
                        const movieDetails = availability.movie;
                        if (!movieDetails) {
                            throw new Error('No movie details available for request');
                        }
                        
                        const result = await requestServer.requestMovie(
                            movieDetails.id, // TMDB ID
                            movieDetails.id, // TMDB ID again (for compatibility)
                            movieDetails.imdbId // IMDB ID
                        );
                        
                        console.log('Request result:', result);
                        // Update the UI to show requested state
                        requestButton.classList.remove('request-button', 'popup-action-primary');
                        requestButton.classList.add('requested-button', 'popup-action-outline');
                        requestButton.innerHTML = '<i class="fas fa-check"></i> Request Successful';
                        // Update the status badge
                        if (serverAvailabilityElement) {
                            serverAvailabilityElement.innerHTML = `
                                <div class="popup-status-inner">
                                    <div class="popup-status-circle" style="background:#f59e0b">
                                        <i class="fas fa-clock"></i>
                                    </div>
                                    <div>
                                        <p class="popup-status-title">Requested</p>
                                        <p class="popup-status-sub">Request pending processing</p>
                                    </div>
                                </div>
                            `;
                        }
                        // Change the button after a delay
                        setTimeout(() => {
                            requestButton.innerHTML = '<i class="fas fa-check"></i> Requested';
                        }, 2000);
                    } catch (error) {
                        console.error('Error requesting movie:', error);
                        requestButton.disabled = false;
                        requestButton.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Request Failed - Try Again';
                        showError(`Failed to request movie: ${error.message}`);
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error displaying result:', error);
        showError(`Error displaying result: ${error.message}`);
    }
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
        debug = !!result.debugMode; // Update the global debug flag
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
    if (result.available) return 'available';
    if (result.requested) return 'requested';
    if (result.approved) return 'requested';
    return 'unavailable';
}

async function makeRequest(serverName, movieId) {
    try {
        await ombiClient.requestMovie(movieId);
        // Refresh the display after successful request
        const button = event.target;
        button.textContent = 'Requested';
        button.disabled = true;
        button.className = 'request-button requested';
    } catch (error) {
        console.error('Error making request:', error);
        // Show error state
        const button = event.target;
        button.textContent = 'Error';
        button.disabled = true;
        button.className = 'request-button error';
    }
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

// Update server availability based on movie ID
function updateServerAvailability(movieId) {
    const serverAvailability = document.getElementById('server-availability');
    if (!serverAvailability) {
        console.error('server-availability element not found');
        return;
    }
    
    serverAvailability.innerHTML = '';

    getServers(servers => {
        if (!servers || servers.length === 0) {
            document.getElementById('no-servers').style.display = 'block';
            return;
        }

        // Get the current movie data from the page
        const movieData = {
            tmdbId: movieId,
            title: document.getElementById('movie-title')?.textContent,
            year: document.getElementById('movie-year')?.textContent
        };

        console.log('Updating server availability for movie:', movieData);

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

            // Pass the movie data (not the server) to checkMovieAvailability
            checkMovieAvailability(movieData)
                .then(result => {
                    console.log(`Availability result for server ${server.name}:`, result);
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
                        button.onclick = () => requestMovie(movieData); // Pass movieData here
                    }
                })
                .catch(error => {
                    console.error(`Error checking availability for server ${server.name}:`, error);
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

// Get servers from storage
function getServers(callback) {
    chrome.storage.local.get(['servers'], function(result) {
        callback(result.servers || []);
    });
}

// Initialize request server client based on configured server type
async function initializeRequestServer() {
    console.log('=== initializeRequestServer() called in popup.js ===');
    console.log('Initializing request server client...');
    
    try {
        // Get server type and configuration from storage
        const { serverType, overseerrUrl, ombiUrl } = await chrome.storage.local.get(['serverType', 'overseerrUrl', 'ombiUrl']);
        
        const selectedType = serverType || 'overseerr';
        console.log('Selected server type:', selectedType);
        
        if (selectedType === 'overseerr') {
            // Initialize Overseerr client
            if (!overseerrUrl) {
                console.error('Overseerr URL not configured');
                showError('Please configure your Overseerr server URL in settings');
                return null;
            }
            
            console.log('Using Overseerr URL:', overseerrUrl);
            window.requestServerUrl = overseerrUrl;
            
            // Create OverseerrIntegration client if not already done
            if (!window.requestServerClient) {
                window.requestServerClient = new OverseerrIntegration(overseerrUrl);
                console.log('Created new Overseerr client');
            }
            
            // Initialize the client
            const initialized = await window.requestServerClient.initialize();
            
            if (!initialized) {
                console.error('Failed to initialize Overseerr client');
                
                // Check if we have a Plex token and try to use it
                const { plexToken } = await chrome.storage.local.get('plexToken');
                
                if (plexToken) {
                    console.log('Trying to re-authenticate with Plex token');
                    const success = await window.requestServerClient.validateAndInitializeWithPlexToken(plexToken);
                    
                    if (!success) {
                        showError('Failed to authenticate with Plex token. Please check your settings.');
                        return null;
                    }
                } else {
                    showError('Authentication failed. Please login in the extension settings.');
                    return null;
                }
            }
            
            console.log('Overseerr client initialized successfully');
            
            // Update debug info
            updateDebugInfo({
                serverType: 'Overseerr',
                url: overseerrUrl,
                authMethod: window.requestServerClient.getAuthMethod ? window.requestServerClient.getAuthMethod() : 'Unknown'
            });
            
            return window.requestServerClient;
        } else {
            // Initialize Ombi client
            if (!ombiUrl) {
                console.error('Ombi URL not configured');
                showError('Please configure your Ombi server URL in settings');
                return null;
            }
            
            console.log('Using Ombi URL:', ombiUrl);
            window.requestServerUrl = ombiUrl;
            
            // Create OmbiIntegration client if not already done
            if (!window.requestServerClient) {
                window.requestServerClient = new OmbiIntegration(ombiUrl);
                console.log('Created new Ombi client');
            }
            
            // Initialize the client
            const initialized = await window.requestServerClient.initialize();
            
            if (!initialized) {
                console.error('Failed to initialize Ombi client');
                
                // Check if we have a Plex token and try to use it
                const { plexToken } = await chrome.storage.local.get('plexToken');
                
                if (plexToken) {
                    console.log('Trying to re-authenticate with Plex token');
                    const success = await window.requestServerClient.validateAndInitializeWithPlexToken(plexToken);
                    
                    if (!success) {
                        showError('Failed to authenticate with Plex token. Please check your settings.');
                        return null;
                    }
                } else {
                    showError('Authentication failed. Please login in the extension settings.');
                    return null;
                }
            }
            
            console.log('Ombi client initialized successfully');
            
            // Update debug info
            updateDebugInfo({
                serverType: 'Ombi',
                url: ombiUrl,
                authMethod: window.requestServerClient.getAuthMethod ? window.requestServerClient.getAuthMethod() : 'Unknown'
            });
            
            return window.requestServerClient;
        }
    } catch (error) {
        console.error('Error initializing request server:', error);
        showError(`Error initializing request server: ${error.message}`);
        return null;
    }
}

// Main initialization function
async function initialize() {
    console.log('=== initialize() called in popup.js ===');
    console.log('Initializing popup...');
    
    // Show loading indicator
    displayLoading(true);
    
    // Setup event listeners
    const settingsButton = document.getElementById('settings-button');
    if (settingsButton) {
        settingsButton.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
    }
    
    // Check if the extension is enabled
    const { enabled = true } = await new Promise(resolve => {
        chrome.storage.local.get(['enabled'], resolve);
    });
    
    // Update the toggle state
    const masterToggle = document.getElementById('masterToggle');
    if (masterToggle) {
        masterToggle.checked = enabled;
        masterToggle.addEventListener('change', (e) => {
            const newState = e.target.checked;
            chrome.storage.local.set({ enabled: newState }, () => {
                console.log(`Extension ${newState ? 'enabled' : 'disabled'}`);
            });
        });
    }
    
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
        // Add initial-load class to prevent transition on page load
        contentWrapper.classList.add('initial-load');
        
        // Whether to show disabled state
        if (!enabled && contentWrapper) {
            contentWrapper.classList.add('disabled');
        }
        
        // Remove the initial-load class after a brief delay to enable transitions
        setTimeout(() => {
            contentWrapper.classList.remove('initial-load');
        }, 100);
    }
    
    // Check current tab for movie info
    if (enabled) {
        try {
            await checkCurrentTab();
        } catch (error) {
            console.error('Error checking current tab:', error);
            showError(`Error: ${error.message}`);
        }
    } else {
        showError('Extension is currently disabled. Enable it using the power button.');
    }
}

// Update debug info
function updateDebugInfo(data = {}) {
    console.log('=== updateDebugInfo() called in popup.js ===', data);
    console.log('Updating debug info with:', data);
    // Find the debug section element
    const debugSection = document.getElementById('debug-info');
    if (!debugSection) {
        console.error('Debug section not found');
        return;
    }
    // Update server type
    const serverTypeElement = document.querySelector('#debug-server-type span');
    if (serverTypeElement && data.serverType) {
        serverTypeElement.textContent = data.serverType;
    }
    // Update URL
    const urlElement = document.querySelector('#debug-url span');
    if (urlElement) {
        urlElement.textContent = window.requestServerUrl || 'Not set';
    }
    // Update auth method
    const authElement = document.querySelector('#debug-auth span');
    if (authElement && window.requestServerClient) {
        authElement.textContent = window.requestServerClient.getAuthMethod ? 
            window.requestServerClient.getAuthMethod() : 
            (window.requestServerClient.apiKey ? 'API Key' : window.requestServerClient.token ? 'Token' : 'None');
    }
    // Update movie info (show title, TMDB ID, year, status)
    const movieElement = document.querySelector('#debug-movie span');
    let movie = data.movieData || (data.availability && data.availability.movie) || null;
    if (movieElement) {
        if (movie) {
            let info = '';
            if (movie.title) info += `Title: ${movie.title}\n`;
            if (movie.tmdbId || movie.id) info += `TMDB ID: ${movie.tmdbId || movie.id}\n`;
            if (movie.year) info += `Year: ${movie.year}\n`;
            if (movie.status) info += `Status: ${movie.status}\n`;
            if (movie.available !== undefined) info += `Available: ${movie.available}\n`;
            if (movie.requested !== undefined) info += `Requested: ${movie.requested}\n`;
            if (movie.approved !== undefined) info += `Approved: ${movie.approved}\n`;
            movieElement.textContent = info.trim();
        } else {
            movieElement.textContent = 'None';
        }
    }
    // Update error
    if (data.error) {
        const errorElement = document.querySelector('#debug-error span');
        if (errorElement) {
            errorElement.textContent = data.error;
        }
    }
    // Update raw response
    if (data.rawResponse) {
        const rawElement = document.querySelector('#debug-raw span');
        if (rawElement) {
            rawElement.textContent = typeof data.rawResponse === 'object' ? 
                JSON.stringify(data.rawResponse) : data.rawResponse;
        }
    }
}

// Helper function to toggle debug info visibility
function setupDebugToggle() {
    console.log('=== setupDebugToggle() called in popup.js ===');
    console.log('Setting up debug toggle');
    
    // Look for both potential IDs for the debug elements
    const debugInfo = document.getElementById('debug-info') || document.getElementById('debugInfo');
    const debugToggle = document.getElementById('debug-toggle') || document.getElementById('toggleDebug');
    
    // If we're using a different ID, check for the Show Debug Info button 
    if (!debugToggle) {
        // Try to find it by text content
        const buttons = document.querySelectorAll('button');
        for (const button of buttons) {
            if (button.textContent.includes('Debug Info')) {
                console.log('Found debug toggle by text content');
                debugToggle = button;
                break;
            }
        }
    }
    
    if (!debugInfo) {
        console.error('Debug info element not found. Available IDs:', 
            Array.from(document.querySelectorAll('[id]')).map(el => el.id).join(', '));
        return;
    }
    
    if (!debugToggle) {
        console.error('Debug toggle button not found');
        return;
    }
    
    console.log('Found debug elements:', { info: debugInfo.id, toggle: debugToggle.id || 'unknown' });
    
    // Load stored preference for debug visibility
    chrome.storage.local.get(['debugVisible'], function(result) {
        const debugVisible = result.debugVisible !== undefined ? result.debugVisible : false;
        console.log('Debug visibility from storage:', debugVisible);
        
        debugInfo.style.display = debugVisible ? 'block' : 'none';
        debugToggle.textContent = debugVisible ? 'Hide Debug Info' : 'Show Debug Info';
        
        // Add click handler for debug toggle
        debugToggle.addEventListener('click', function() {
            console.log('Debug toggle clicked');
            const currentlyVisible = debugInfo.style.display === 'block';
            const newVisibility = !currentlyVisible;
            
            debugInfo.style.display = newVisibility ? 'block' : 'none';
            debugToggle.textContent = newVisibility ? 'Hide Debug Info' : 'Show Debug Info';
            
            // Save preference
            chrome.storage.local.set({ debugVisible: newVisibility });
            console.log('Saved debug visibility:', newVisibility);
        });
    });
} 