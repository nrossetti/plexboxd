class OmbiIntegration {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        console.log('Initialized with base URL:', this.baseUrl);
        this.token = null;
        this.plexUser = null;
        this.apiKey = null; // Fallback for API key auth
        this._lastSearchResults = []; // Store last search results for future availability checks
    }

    async initialize() {
        console.log('Initializing Ombi integration');
        
        if (!this.baseUrl) {
            console.error('Ombi URL not configured');
            return false;
        }
        
        try {
            // Check if we already have valid authentication
            if (this.token) {
                console.log('Already have a token, verifying...');
                const isValid = await this.verifyToken();
                if (isValid) {
                    console.log('Existing token is valid');
                    return true;
                } else {
                    console.log('Existing token is invalid, clearing');
                    this.token = null;
                }
            }
            
            if (this.apiKey) {
                console.log('Have API key, verifying...');
                const isValid = await this.verifyApiKey();
                if (isValid) {
                    console.log('API key is valid');
                    return true;
                } else {
                    console.log('API key is invalid, clearing');
                    this.apiKey = null;
                }
            }
            
            // Get stored tokens and keys
            const { plexToken, ombiToken, ombiApiKey } = await chrome.storage.local.get([
                'plexToken', 
                'ombiToken', 
                'ombiApiKey'
            ]);
            
            console.log('Retrieved from storage:', { 
                hasPlexToken: !!plexToken, 
                hasOmbiToken: !!ombiToken, 
                hasOmbiApiKey: !!ombiApiKey 
            });
            
            // Try Ombi token if available
            if (ombiToken && !this.token) {
                this.token = ombiToken;
                console.log('Trying stored Ombi token');
                
                const isValid = await this.verifyToken();
                if (isValid) {
                    console.log('Stored Ombi token is valid');
                    return true;
                } else {
                    console.log('Stored Ombi token is invalid, clearing');
                    this.token = null;
                    await chrome.storage.local.remove('ombiToken');
                }
            }
            
            // Try API key if available
            if (ombiApiKey && !this.apiKey) {
                this.apiKey = ombiApiKey;
                console.log('Trying stored API key');
                
                const isValid = await this.verifyApiKey();
                if (isValid) {
                    console.log('Stored API key is valid');
                    return true;
                } else {
                    console.log('Stored API key is invalid, clearing');
                    this.apiKey = null;
                    // Don't remove from storage as the user may need to fix it
                }
            }
            
            // If we have a Plex token, try to authenticate with it
            if (plexToken) {
                console.log('Trying to authenticate with Plex token');
                return await this.validateAndInitializeWithPlexToken(plexToken);
            }
            
            console.log('No valid authentication method found');
            return false;
        } catch (error) {
            console.error('Error initializing Ombi integration:', error);
            return false;
        }
    }
    
    async loadPlexUserInfo(plexToken) {
        if (!plexToken) {
            console.log('No Plex token provided, skipping user info loading');
            return;
        }
        
        try {
            console.log('Loading Plex user info from Plex.tv API');
            const response = await fetch('https://plex.tv/api/v2/user', {
                headers: {
                    'X-Plex-Token': plexToken,
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                const userData = await response.json();
                console.log('Received user data from Plex:', userData);
                
                this.plexUser = {
                    username: userData.username || userData.title,
                    email: userData.email,
                    id: userData.id,
                    uuid: userData.uuid,
                    thumb: userData.thumb,
                    title: userData.title,
                    friendlyName: userData.friendlyName || userData.title,
                    authToken: plexToken,
                    lastFetched: new Date().toISOString()
                };
                console.log('Loaded Plex user info:', this.plexUser);
                
                // Store the Plex user info in storage for debugging and later use
                await chrome.storage.local.set({ 
                    plexUserInfo: this.plexUser,
                    plexUserId: userData.id,
                    plexUsername: this.plexUser.username
                });
                console.log('Stored Plex user info in local storage');
                
                return this.plexUser;
            } else {
                const errorText = await response.text();
                console.error(`Failed to load Plex user info (${response.status}):`, errorText);
                throw new Error(`Failed to load Plex user info: ${response.status}`);
            }
        } catch (error) {
            console.error('Failed to load Plex user info:', error);
            // Store the error for debugging
            await chrome.storage.local.set({ 
                plexUserInfoError: {
                    message: error.message,
                    timestamp: new Date().toISOString()
                }
            });
            // Non-critical error, continue
        }
    }
    
    async authenticateWithPlex(plexToken) {
        if (!plexToken) {
            throw new Error('No Plex token provided');
        }
        
        if (!this.baseUrl) {
            throw new Error('Ombi URL not configured');
        }
        
        console.log(`Authenticating with Plex token at ${this.baseUrl}`);
        
        // Try multiple authentication endpoints to support different Ombi versions
        const authEndpoints = [
            '/api/v1/Token/plextoken',
            '/api/v2/Token/plextoken',
            '/api/v1/auth/plex',
            '/api/v2/auth/plex',
            '/token/plextoken',
            '/auth/plex'
        ];
        
        let lastError = null;
        let attemptCount = 0;
        
        for (const endpoint of authEndpoints) {
            attemptCount++;
            console.log(`Authentication attempt ${attemptCount}: ${endpoint}`);
            
            try {
                const url = this.baseUrl + endpoint;
                console.log(`Trying to authenticate at: ${url}`);
                
                const headers = {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                };
                
                // Construct the request body (different endpoints expect different formats)
                let requestBody;
                
                if (endpoint.includes('plextoken')) {
                    // For token/plextoken style endpoints
                    requestBody = JSON.stringify({
                        plexToken: plexToken
                    });
                } else {
                    // For auth/plex style endpoints
                    requestBody = JSON.stringify({
                        authToken: plexToken
                    });
                }
                
                console.log(`Request body: ${requestBody}`);
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: requestBody,
                    mode: 'cors',
                    credentials: 'same-origin',
                    redirect: 'follow',
                    cache: 'no-cache'
                });
                
                console.log(`Response status from ${endpoint}: ${response.status}`);
                
                // Some endpoints might redirect on failure instead of returning proper error codes
                if (response.redirected || response.url.includes('login')) {
                    console.warn(`Got redirected to ${response.url}, authentication likely failed`);
                    lastError = new Error('Authentication redirect, likely failed');
                    continue;
                }
                
                if (response.status === 404) {
                    console.log(`Endpoint ${endpoint} not found, trying next`);
                    continue;
                }
                
                // Try to parse the response
                const contentType = response.headers.get('content-type');
                
                if (contentType && contentType.includes('application/json')) {
                    const result = await response.json();
                    console.log(`JSON response from ${endpoint}:`, result);
                    
                    // Different endpoints return tokens in different formats
                    if (result.access_token || result.token) {
                        const token = result.access_token || result.token;
                        console.log(`Successfully obtained token using ${endpoint}`);
                        this.token = token;
                        
                        // Save the token for future use
                        await chrome.storage.local.set({ ombiToken: token });
                        
                        return token;
                    } else if (result.error || result.errorMessage) {
                        const errorMsg = result.error || result.errorMessage;
                        console.error(`Authentication error from ${endpoint}: ${errorMsg}`);
                        lastError = new Error(`Authentication error: ${errorMsg}`);
                    } else {
                        console.log(`Unexpected response format from ${endpoint}`);
                        lastError = new Error(`Unexpected response format from ${endpoint}`);
                    }
                } else {
                    // Handle non-JSON responses (might be HTML login page)
                    const text = await response.text();
                    console.log(`Non-JSON response from ${endpoint} (first 100 chars): ${text.substring(0, 100)}`);
                    
                    if (response.ok) {
                        try {
                            // Try to parse as JSON anyway in case content type is wrong
                            const possibleJson = JSON.parse(text);
                            if (possibleJson.access_token || possibleJson.token) {
                                const token = possibleJson.access_token || possibleJson.token;
                                console.log(`Successfully obtained token from non-JSON response using ${endpoint}`);
                                this.token = token;
                                
                                // Save the token for future use
                                await chrome.storage.local.set({ ombiToken: token });
                                
                                return token;
                            }
                        } catch (parseError) {
                            // Not JSON, continue with text analysis
                        }
                        
                        // If response is OK but not parseable as JSON, check for token in text
                        const tokenMatch = text.match(/"token":"([^"]+)"/);
                        if (tokenMatch && tokenMatch[1]) {
                            console.log(`Extracted token from text response using ${endpoint}`);
                            const token = tokenMatch[1];
                            this.token = token;
                            
                            // Save the token for future use
                            await chrome.storage.local.set({ ombiToken: token });
                            
                            return token;
                        }
                    }
                    
                    lastError = new Error(`Failed to parse authentication response from ${endpoint}`);
                }
            } catch (error) {
                console.error(`Error with auth endpoint ${endpoint}:`, error);
                lastError = error;
            }
        }
        
        // If we've tried all endpoints and failed, throw the last error
        if (lastError) {
            console.error('All authentication endpoints failed', lastError);
            throw lastError;
        }
        
        throw new Error('Failed to authenticate with Plex token, all endpoints failed');
    }
    
    getAuthHeaders() {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        
        // Use token if available (preferred)
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
            console.log('Using token authentication');
            return headers;
        }
        
        // Fall back to API key if available
        if (this.apiKey) {
            headers['ApiKey'] = this.apiKey;
            console.log('Using API key authentication');
            return headers;
        }
        
        console.warn('No authentication credentials available');
        return headers;
    }
    
    async verifyToken() {
        try {
            // Try different status endpoints to see which works
            const endpoints = [
                '/api/v1/Status',
                '/api/v2/Status',
                '/api/v1/System/status'
            ];
            
            for (const endpoint of endpoints) {
                try {
                    console.log(`Verifying token with endpoint: ${this.baseUrl}${endpoint}`);
                    
                    const response = await fetch(`${this.baseUrl}${endpoint}`, {
                        headers: {
                            'Authorization': `Bearer ${this.token}`,
                            'Accept': 'application/json'
                        }
                    });
                    
                    if (response.ok) {
                        console.log(`Token verification successful with ${endpoint}`);
                        return true;
                    }
                } catch (endpointError) {
                    console.log(`Endpoint ${endpoint} failed:`, endpointError);
                    // Try next endpoint
                }
            }
            
            console.error('All token verification endpoints failed');
            return false;
        } catch (error) {
            console.error('Token verification error:', error);
            return false;
        }
    }
    
    async verifyApiKey() {
        if (!this.apiKey) {
            console.error('No API key provided for verification');
            return false;
        }
        
        // Try multiple API endpoints that might work
        const apiEndpoints = [
            '/api/v1/Status',
            '/Status',
            '/api/v2/Status',
            '/api/v1/System/status',
            '/System/status'
        ];
        
        for (const endpoint of apiEndpoints) {
            try {
                const url = `${this.baseUrl}${endpoint}`;
                console.log(`Trying API key verification with endpoint: ${url}`);
                
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'ApiKey': this.apiKey,
                        'Accept': 'application/json'
                    },
                    mode: 'cors',
                    credentials: 'same-origin',
                    redirect: 'follow'
                });
                
                if (response.ok) {
                    // Try to parse the response as JSON to make sure it's valid
                    try {
                        const data = await response.json();
                        console.log(`API key verification successful with ${endpoint}:`, data);
                        return true;
                    } catch (parseError) {
                        console.error(`Failed to parse API response from ${endpoint} as JSON:`, parseError);
                        // Continue to next endpoint
                    }
                } else {
                    const text = await response.text();
                    console.error(`API key verification failed for ${endpoint} (${response.status}):`, text);
                    // Continue to next endpoint
                }
            } catch (error) {
                console.error(`API key verification network error for ${endpoint}:`, error);
                // Continue to next endpoint
            }
        }
        
        // If we get here, all endpoints failed
        console.error('All API key verification endpoints failed');
        return false;
    }
    
    async authenticateWithApiKey(apiKey) {
        if (!apiKey) {
            throw new Error('No API key provided');
        }
        
        console.log('Authenticating with API key');
        this.apiKey = apiKey;
        
        // Verify the API key works by making a test request
        const isValid = await this.verifyApiKey();
        if (!isValid) {
            throw new Error('API key authentication failed');
        }
        
        console.log('API key authentication successful');
        return true;
    }
    
    // The rest of your methods like searchMovieByTmdbId, checkAvailability, etc.
    // should use this.getAuthHeaders() for authentication
    
    async searchMovie(query, year = null) {
        // Parse the title to remove year in parentheses if present
        let cleanTitle = query;
        let extractedYear = year;
        
        // Check if the title contains a year in parentheses like "Star Kid (1997)"
        const yearMatch = query.match(/^(.*?)\s*\((\d{4})\)$/);
        if (yearMatch) {
            cleanTitle = yearMatch[1].trim();
            // Only use extracted year if no year was explicitly provided
            if (!extractedYear) {
                extractedYear = yearMatch[2];
            }
        }
        
        console.log(`Searching for movie: "${cleanTitle}"${extractedYear ? ` (${extractedYear})` : ''}`);
        await this.ensureAuthenticated();
        
        try {
            // Try multiple search endpoint patterns
            const searchEndpoints = [
                `/api/v1/Search/movie/${encodeURIComponent(cleanTitle)}`,
                `/api/v2/Search/movie/${encodeURIComponent(cleanTitle)}`
            ];
            
            let lastError = null;
            
            for (const endpoint of searchEndpoints) {
                try {
                    const url = this.baseUrl + endpoint;
                    console.log(`Searching using endpoint: ${url}`);
                    
                    const headers = this.getAuthHeaders();
                    
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: headers,
                        mode: 'cors',
                        credentials: 'same-origin',
                        redirect: 'follow',
                        cache: 'no-cache'
                    });
                    
                    // Log raw response details for debugging
                    console.log(`Search response status: ${response.status} from ${endpoint}`);
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error(`Search failed with status ${response.status}:`, errorText);
                    }
                    
                    const results = await this.handleApiResponse(response, endpoint);
                    console.log(`Search results from ${endpoint}:`, results);
                    
                    if (Array.isArray(results) && results.length > 0) {
                        let filteredResults = results;
                        
                        // Filter by year if provided
                        if (extractedYear) {
                            filteredResults = filteredResults.filter(movie => {
                                const movieYear = movie.releaseDate 
                                    ? new Date(movie.releaseDate).getFullYear() 
                                    : null;
                                return movieYear === parseInt(extractedYear);
                            });
                            console.log(`Filtered to ${filteredResults.length} results matching year ${extractedYear}`);
                        }
                        
                        if (filteredResults.length > 0) {
                            // Store the results for later use in availability checks
                            this._lastSearchResults = results;
                            
                            return filteredResults;
                        }
                    }
                    
                    // If we got results but couldn't find a match, continue to next endpoint
                    console.log(`No matching movies found with endpoint ${endpoint}`);
                    
                } catch (endpointError) {
                    console.error(`Error with search endpoint ${endpoint}:`, endpointError);
                    lastError = endpointError;
                }
            }
            
            // If we reach here, all endpoints failed or returned no results
            if (lastError) {
                throw lastError;
            }
            console.log(`No results found for "${cleanTitle}" after trying all endpoints`);
            return []; // Return empty array if no results found
        } catch (error) {
            console.error('Error searching for movie:', error);
            throw error;
        }
    }
    
    async checkAvailability(type, id) {
        console.log(`Checking availability for ${type} ID: ${id}`);
        await this.ensureAuthenticated();
        
        try {
            // Endpoints to try
            const endpoints = [
                `/api/v1/Search/${id}/availability/${type}`,
                `/api/v2/Search/${id}/availability/${type}`,
                `/api/v1/Search/availability/${id}/${type}`,
                `/api/v2/Search/availability/${id}/${type}`,
                `/api/v1/Request/${type}/available/${id}`,
                `/api/v2/Request/${type}/available/${id}`
            ];
            
            let lastHtmlResponse = null;
            let lastError = null;
            
            for (const endpoint of endpoints) {
                try {
                    console.log(`Checking availability using endpoint: ${this.baseUrl}${endpoint}`);
                    
                    const response = await fetch(this.baseUrl + endpoint, {
                        method: 'GET',
                        headers: this.getAuthHeaders(),
                        mode: 'cors',
                        credentials: 'same-origin',
                        redirect: 'follow',
                        cache: 'no-cache'
                    });
                    
                    console.log(`Availability check response status: ${response.status} from ${endpoint}`);
                    
                    // Store the raw response text for debugging/fallback
                    const responseText = await response.text();
                    
                    // Check if the response is HTML (likely an error page)
                    if (responseText.includes('<!DOCTYPE html>') || 
                        responseText.includes('<html') || 
                        responseText.startsWith('<')) {
                        console.log(`Received HTML from availability endpoint ${endpoint}, will use fallback data`);
                        lastHtmlResponse = responseText;
                        continue; // Try next endpoint
                    }
                    
                    // Try to parse as JSON
                    try {
                        const data = JSON.parse(responseText);
                        console.log(`Availability result from ${endpoint}:`, data);
                        
                        // Different API versions return different formats
                        // Normalize the response
                        return {
                            available: data.available === true,
                            requested: data.requested === true || data.approved === true,
                            approved: data.approved === true,
                            plexUrl: data.plexUrl || null
                        };
                    } catch (jsonError) {
                        console.error(`Error parsing JSON from ${endpoint}:`, jsonError);
                        console.log(`Non-JSON response from availability endpoint: ${responseText.substring(0, 100)}...`);
                        lastError = new Error('Received non-JSON response from server');
                    }
                } catch (endpointError) {
                    console.error(`Error with endpoint ${endpoint}:`, endpointError);
                    lastError = endpointError;
                }
            }
            
            // If we got here, all endpoints failed
            console.log(`No availability data found for ${id} ${type} after trying all endpoints`);
            
            // Extract availability info from existing search result if possible
            if (this._lastSearchResults && this._lastSearchResults.length > 0) {
                console.log('Trying to extract availability from search results');
                for (const result of this._lastSearchResults) {
                    if ((result.id && result.id.toString() === id.toString()) || 
                        (result.theMovieDbId && result.theMovieDbId.toString() === id.toString())) {
                        return {
                            available: result.available === true || (result.plexUrl && result.plexUrl !== ''),
                            requested: result.requested === true || result.approved === true,
                            approved: result.approved === true,
                            plexUrl: result.plexUrl || null
                        };
                    }
                }
            }
            
            // Create a default "not available" response as fallback
            return {
                available: false,
                requested: false,
                approved: false,
                plexUrl: null,
                error: lastError ? lastError.message : 'No availability data found'
            };
        } catch (error) {
            console.error(`Error checking ${type} availability:`, error);
            throw error;
        }
    }
    
    async requestMovie(id, tmdbId, imdbId) {
        console.log(`Requesting movie: ID=${id}, TMDB=${tmdbId}, IMDB=${imdbId}`);
        
        if (!this.baseUrl) {
            throw new Error('Ombi URL not configured');
        }
        
        // Make sure we're authenticated
        await this.ensureAuthenticated();
        
        try {
            // Extended debugging for request issues
            console.log("User info for request:", this.plexUser);
            
            let endpointPatterns;
            
            // Try different endpoint patterns based on what IDs we have
            if (tmdbId) {
                endpointPatterns = [
                    // Using TheMovieDbId as the field name which is what Ombi typically expects
                    { endpoint: '/api/v1/Request/movie', idType: 'theMovieDbId' },
                    { endpoint: '/api/v2/Request/movie', idType: 'theMovieDbId' },
                    { endpoint: '/api/v1/Request/movie/tmdb', idType: 'id' },
                    { endpoint: '/api/v2/Request/movie/tmdb', idType: 'id' }
                ];
            } else if (imdbId) {
                endpointPatterns = [
                    { endpoint: '/api/v1/Request/movie', idType: 'imdbId' },
                    { endpoint: '/api/v2/Request/movie', idType: 'imdbId' },
                    { endpoint: '/api/v1/Request/movie/imdb', idType: 'id' },
                    { endpoint: '/api/v2/Request/movie/imdb', idType: 'id' }
                ];
            } else if (id) {
                endpointPatterns = [
                    { endpoint: '/api/v1/Request/movie', idType: 'theMovieDbId' },
                    { endpoint: '/api/v2/Request/movie', idType: 'theMovieDbId' },
                    { endpoint: '/api/v1/Request/movie', idType: 'id' },
                    { endpoint: '/api/v2/Request/movie', idType: 'id' }
                ];
            } else {
                throw new Error('No valid ID provided (need at least one of: id, tmdbId, imdbId)');
            }

            let lastError = null;
            let attemptCount = 0;
            
            for (const pattern of endpointPatterns) {
                attemptCount++;
                console.log(`Attempt ${attemptCount}: Trying endpoint ${pattern.endpoint} with ${pattern.idType}`);
                
                try {
                    const url = this.baseUrl + pattern.endpoint;
                    console.log(`Request URL: ${url}`);
                    
                    // Construct the appropriate request body
                    let requestBody = {};
                    
                    if (pattern.endpoint.includes('/tmdb')) {
                        // If it's a TMDB-specific endpoint using ID directly
                        requestBody = { id: tmdbId };
                    } else if (pattern.endpoint.includes('/imdb')) {
                        // If it's an IMDB-specific endpoint using ID directly
                        requestBody = { id: imdbId };
                    } else {
                        // General endpoint that uses a specific ID field type
                        requestBody[pattern.idType] = pattern.idType === 'theMovieDbId' 
                            ? (tmdbId || id) 
                            : (pattern.idType === 'imdbId' ? imdbId : (id || tmdbId));
                        
                        // Add language code and other required fields
                        requestBody.languageCode = "en";
                        
                        // Add user info if available
                        if (this.plexUser) {
                            requestBody.requestedByAlias = this.plexUser.username || this.plexUser.title;
                            requestBody.requestedUser = this.plexUser.username || this.plexUser.title;
                            requestBody.requestedUserId = this.plexUser.id;
                        }
                    }
                    
                    console.log(`Request body for ${pattern.endpoint}:`, requestBody);
                    
                    const headers = this.getAuthHeaders();
                    headers['Content-Type'] = 'application/json';
                    console.log('Using auth headers:', JSON.stringify(headers, null, 2));
                    
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(requestBody),
                        mode: 'cors',
                        credentials: 'same-origin',
                        redirect: 'follow',
                        cache: 'no-cache'
                    });
                    
                    console.log(`Response status: ${response.status} from ${pattern.endpoint}`);
                    
                    // For debugging, try to log the full response body
                    let responseText = '';
                    try {
                        responseText = await response.clone().text();
                        console.log(`Raw response: ${responseText.substring(0, 200)}`);
                    } catch (e) {
                        console.error("Couldn't read response text", e);
                    }
                    
                    // Check if the response is a redirect to login
                    if (response.status === 302 || response.url.includes('login')) {
                        console.warn(`Received redirect or login response from ${pattern.endpoint}`);
                        throw new Error('Authentication required');
                    }
                    
                    // Check for common error status codes
                    if (response.status === 500) {
                        console.error(`Server error (500) from ${pattern.endpoint}`);
                        throw new Error(`Server error: ${responseText.substring(0, 100)}`);
                    }
                    
                    if (response.status === 405) {
                        console.error(`Method not allowed (405) from ${pattern.endpoint}`);
                        continue; // Try next endpoint
                    }
                    
                    if (response.status === 401 || response.status === 403) {
                        console.error(`Authentication error with ${pattern.endpoint}: ${response.status}`);
                        
                        // Try to re-authenticate and retry
                        this.token = null;
                        this.apiKey = null;
                        const reAuthSuccess = await this.initialize();
                        
                        if (reAuthSuccess) {
                            console.log('Re-authenticated, retrying request...');
                            
                            // Retry the request with new authentication
                            const newHeaders = this.getAuthHeaders();
                            newHeaders['Content-Type'] = 'application/json';
                            
                            const retryResponse = await fetch(url, {
                                method: 'POST',
                                headers: newHeaders,
                                body: JSON.stringify(requestBody),
                                mode: 'cors',
                                credentials: 'same-origin',
                                redirect: 'follow',
                                cache: 'no-cache'
                            });
                            
                            if (retryResponse.ok) {
                                return await this.parseRequestResponse(retryResponse, pattern.endpoint);
                            } else {
                                throw new Error(`Retry failed: ${retryResponse.status}`);
                            }
                        } else {
                            throw new Error('Re-authentication failed');
                        }
                    }
                    
                    // If we get here, try to parse the response
                    try {
                        const result = await this.parseRequestResponse(response, pattern.endpoint);
                        return result;
                    } catch (parseError) {
                        console.error(`Error parsing response from ${pattern.endpoint}:`, parseError);
                        // If the error message suggests trying again later, try next endpoint
                        if (parseError.message.includes('try again later')) {
                            console.log('Server busy, trying next endpoint');
                            continue;
                        }
                        throw parseError;
                    }
                } catch (endpointError) {
                    console.error(`Error with endpoint ${pattern.endpoint}:`, endpointError);
                    lastError = endpointError;
                    
                    // If this is a server error, try next endpoint
                    if (endpointError.message.includes('500') || 
                        endpointError.message.includes('try again later')) {
                        continue; 
                    }
                }
            }
            
            // If we reach here, all endpoints failed
            if (lastError) {
                // Throw a more descriptive error for HTTP 500
                if (lastError.message.includes('500')) {
                    throw new Error('The Ombi server encountered an error processing this request. The server might be busy or the movie may already be requested.');
                }
                throw lastError;
            }
            
            throw new Error('All request endpoints failed without specific error');
        } catch (error) {
            console.error('Error requesting movie:', error);
            throw error;
        }
    }
    
    async parseRequestResponse(response, endpoint) {
        try {
            // Handle different response formats
            if (response.status === 200 || response.status === 201) {
                const contentType = response.headers.get('content-type');
                const responseClone = response.clone(); // Clone response for potential text access
                
                // Check if it's JSON
                if (contentType && contentType.includes('application/json')) {
                    let result;
                    try {
                        result = await response.json();
                    } catch (jsonError) {
                        console.error(`Error parsing JSON from ${endpoint}:`, jsonError);
                        const text = await responseClone.text();
                        console.log(`Response text (failed JSON parse): ${text.substring(0, 200)}`);
                        throw new Error(`Invalid JSON response: ${jsonError.message}`);
                    }
                    
                    console.log(`Request success from ${endpoint}, JSON response:`, result);
                    
                    // Enhanced error checking in response
                    if (result && result.message === "Please try again later") {
                        console.warn(`Server busy message from ${endpoint}`);
                        throw new Error('Please try again later');
                    }
                    
                    // Check for success indicator in the response
                    if (result && (result.result === true || result.requested === true || result.success === true)) {
                        return { success: true, ...result };
                    } else if (result && result.isError) {
                        throw new Error(result.errorMessage || 'Request returned error');
                    } else if (result && result.message && typeof result.message === 'string' && 
                              (result.message.toLowerCase().includes('error') || 
                               result.message.toLowerCase().includes('failed'))) {
                        throw new Error(result.message);
                    } else {
                        // Assume success if no error indicators
                        return { success: true, ...result };
                    }
                } else {
                    // Non-JSON response that's a success code is assumed successful
                    const text = await responseClone.text();
                    console.log(`Request success from ${endpoint}, text response: ${text.substring(0, 200)}`);
                    
                    if (text.includes('error') || text.includes('Error')) {
                        throw new Error(`Error in response: ${text.substring(0, 100).trim()}`);
                    }
                    
                    if (text.includes('Please try again later')) {
                        throw new Error('Please try again later');
                    }
                    
                    return { success: true, message: text };
                }
            } else if (response.status === 400) {
                // Try to parse error details from the response
                try {
                    const errorData = await response.json();
                    console.log(`Error 400 from ${endpoint}:`, errorData);
                    
                    if (errorData.errorMessage) {
                        throw new Error(errorData.errorMessage);
                    } else if (errorData.error) {
                        throw new Error(errorData.error);
                    } else if (errorData.message) {
                        throw new Error(errorData.message);
                    } else {
                        throw new Error(`Bad request: ${JSON.stringify(errorData)}`);
                    }
                } catch (jsonError) {
                    // If can't parse JSON, use raw text
                    const text = await response.text();
                    throw new Error(`Bad request: ${text.substring(0, 100)}`);
                }
            } else {
                // Other error status codes
                try {
                    const errorText = await response.text();
                    
                    if (errorText.includes('Please try again later')) {
                        throw new Error('Please try again later');
                    }
                    
                    if (response.status === 500) {
                        throw new Error(`Server error: ${errorText.substring(0, 100) || 'HTTP 500 Internal Server Error'}`);
                    }
                    
                    throw new Error(`HTTP error ${response.status}: ${errorText.substring(0, 100)}`);
                } catch (textError) {
                    if (textError.message !== 'Please try again later') {
                        throw new Error(`HTTP error ${response.status}`);
                    } else {
                        throw textError; // Rethrow the "try again later" error
                    }
                }
            }
        } catch (error) {
            console.error(`Error parsing response from ${endpoint}:`, error);
            throw error;
        }
    }
    
    async ensureAuthenticated() {
        if (!this.baseUrl) {
            throw new Error('Ombi URL not configured');
        }
        
        // Check if we're already authenticated
        if (this.token || this.apiKey) {
            return true;
        }
        
        // If not, try to authenticate
        return await this.initialize();
    }
    
    // Get user info for display
    getUserInfo() {
        return this.plexUser;
    }
    
    // Get auth method for display
    getAuthMethod() {
        if (this.token) return 'Plex Token';
        if (this.apiKey) return 'API Key';
        return 'Not Authenticated';
    }
    
    async searchMovieByTmdbId(tmdbId) {
        console.log(`Searching for movie by TMDB ID: ${tmdbId}`);
        
        if (!this.baseUrl) {
            throw new Error('Ombi URL not configured');
        }
        
        // Make sure we're authenticated
        await this.ensureAuthenticated();
        
        try {
            // Try multiple endpoint patterns for TMDB ID search
            const endpoints = [
                `/api/v1/Search/movie/info/${tmdbId}`,
                `/api/v2/Search/movie/info/${tmdbId}`,
                `/api/v1/Search/tmdb/${tmdbId}`,
                `/api/v2/Search/tmdb/${tmdbId}`
            ];
            
            let lastError = null;
            
            for (const endpoint of endpoints) {
                try {
                    const url = this.baseUrl + endpoint;
                    console.log(`Searching using TMDB endpoint: ${url}`);
                    
                    const headers = this.getAuthHeaders();
                    console.log('Using auth headers:', JSON.stringify(headers, null, 2));
                    
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: headers,
                        mode: 'cors',
                        credentials: 'same-origin',
                        redirect: 'follow',
                        cache: 'no-cache'
                    });
                    
                    // Log raw response status
                    console.log(`TMDB search response status: ${response.status} from ${endpoint}`);
                    // Log response headers
                    console.log(`Response headers for ${endpoint}:`, 
                        Array.from(response.headers.entries())
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(', ')
                    );
                    
                    // Check if the response is a redirect to login
                    if (response.status === 302 || response.url.includes('login')) {
                        console.warn(`Received redirect or login response from ${endpoint}`);
                        throw new Error('Authentication required');
                    }
                    
                    if (response.status === 200) {
                        // Try to parse response as JSON
                        let responseText;
                        try {
                            responseText = await response.text();
                            const result = JSON.parse(responseText);
                            console.log(`TMDB search result from ${endpoint}:`, result);
                            
                            // Valid result should have an id or theMovieDbId
                            if (result && (result.id || result.theMovieDbId)) {
                                // Store result for future availability checks
                                this._lastSearchResults = [result];
                                return result;
                            }
                        } catch (jsonError) {
                            console.error(`Error parsing JSON from ${endpoint}:`, jsonError);
                            console.log('Raw response text:', responseText);
                            throw new Error(`Invalid response format: ${jsonError.message}`);
                        }
                    } else if (response.status === 401 || response.status === 403) {
                        console.error(`Authentication error with ${endpoint}: ${response.status}`);
                        throw new Error(`Authentication error: ${response.status}`);
                    } else if (response.status === 404) {
                        console.log(`Endpoint ${endpoint} returned 404, trying next endpoint`);
                        // Continue to next endpoint
                    } else {
                        console.error(`Error with ${endpoint}: ${response.status}`);
                        throw new Error(`API error: ${response.status}`);
                    }
                } catch (endpointError) {
                    console.error(`Error with TMDB endpoint ${endpoint}:`, endpointError);
                    lastError = endpointError;
                    
                    // If this is a "not found" error, continue to next endpoint
                    if (endpointError.message && endpointError.message.includes('404')) {
                        console.log(`Movie not found with TMDB endpoint ${endpoint}, trying next endpoint`);
                        continue;
                    }
                    
                    // If this is an authentication error, stop and try to re-authenticate
                    if (endpointError.message && (
                        endpointError.message.includes('Authentication') || 
                        endpointError.message.includes('401') || 
                        endpointError.message.includes('403')
                    )) {
                        // Clear tokens and try to re-authenticate
                        this.token = null;
                        this.apiKey = null;
                        await this.initialize();
                        
                        // If we successfully re-authenticated, retry this endpoint
                        if (this.token || this.apiKey) {
                            console.log('Re-authenticated, retrying endpoint');
                            const headers = this.getAuthHeaders();
                            
                            const retryResponse = await fetch(this.baseUrl + endpoint, {
                                method: 'GET',
                                headers: headers,
                                mode: 'cors',
                                credentials: 'same-origin',
                                redirect: 'follow',
                                cache: 'no-cache'
                            });
                            
                            if (retryResponse.ok) {
                                const result = await retryResponse.json();
                                if (result && (result.id || result.theMovieDbId)) {
                                    this._lastSearchResults = [result];
                                    return result;
                                }
                            }
                        }
                        
                        // If re-authentication failed or retry failed, break the loop
                        break;
                    }
                }
            }
            
            // If we reach here, all endpoints failed or returned no results
            if (lastError) {
                throw lastError;
            }
            
            console.log(`No results found for TMDB ID ${tmdbId} after trying all endpoints`);
            return null;
        } catch (error) {
            console.error('Error searching for movie by TMDB ID:', error);
            throw error;
        }
    }
    
    async checkMovieAvailability(movieTitle, year, tmdbId) {
        console.log(`Checking availability for movie: ${movieTitle}, Year: ${year}, TMDB ID: ${tmdbId}`);
        await this.ensureAuthenticated();

        try {
            let movieData = null;
            
            // Try finding the movie by TMDB ID first if available
            if (tmdbId) {
                try {
                    console.log(`Searching by TMDB ID: ${tmdbId}`);
                    movieData = await this.searchMovieByTmdbId(tmdbId);
                } catch (error) {
                    console.warn(`Failed to find movie by TMDB ID: ${error.message}. Falling back to search.`);
                }
            }
            
            // If TMDB ID search failed or wasn't provided, search by title
            if (!movieData) {
                console.log(`Searching by title: ${movieTitle} and year: ${year}`);
                const searchResults = await this.searchMovie(movieTitle, year);
                
                if (!searchResults || searchResults.length === 0) {
                    console.log('No search results found');
                    return {
                        available: false,
                        requested: false,
                        approved: false,
                        denied: false,
                        error: 'Movie not found',
                        details: null
                    };
                }
                
                // Find the best match from search results
                movieData = this.findBestMatch(searchResults, movieTitle, year);
                
                if (!movieData) {
                    console.log('No good match found in search results');
                    return {
                        available: false,
                        requested: false,
                        approved: false,
                        denied: false,
                        error: 'No matching movie found',
                        details: null
                    };
                }
            }
            
            console.log('Movie data found:', movieData);
            
            // Return availability status
            return {
                available: movieData.available || false,
                requested: movieData.requested || false,
                approved: movieData.approved || false,
                denied: movieData.denied || false,
                processing: movieData.processing || false,
                error: null,
                details: movieData
            };
        } catch (error) {
            console.error('Error checking movie availability:', error);
            return {
                available: false,
                requested: false,
                approved: false,
                denied: false,
                error: `Error checking availability: ${error.message}`,
                details: null
            };
        }
    }
    
    findBestMatch(searchResults, title, year) {
        console.log(`Finding best match for "${title}" (${year}) in ${searchResults.length} results`);
        
        if (!searchResults || searchResults.length === 0) {
            return null;
        }
        
        // If there's only one result, return it
        if (searchResults.length === 1) {
            return searchResults[0];
        }
        
        // Normalize the title for comparison
        const normalizedTitle = title.toLowerCase().trim();
        
        // First, try to find an exact match with title and year
        if (year) {
            const exactMatch = searchResults.find(movie => {
                const movieYear = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : null;
                return movie.title.toLowerCase().trim() === normalizedTitle && 
                       movieYear === parseInt(year);
            });
            
            if (exactMatch) {
                console.log('Found exact match with title and year');
                return exactMatch;
            }
        }
        
        // Next, try to find an exact title match
        const titleMatch = searchResults.find(movie => 
            movie.title.toLowerCase().trim() === normalizedTitle
        );
        
        if (titleMatch) {
            console.log('Found exact title match');
            return titleMatch;
        }
        
        // If no exact matches, return the first result
        console.log('No exact match found, returning first result');
        return searchResults[0];
    }

    async search(tmdbId) {
        try {
            // API endpoint to search for a movie by TMDB ID
            const url = `${this.baseUrl}/api/v2/Search/movie/info/${tmdbId}`;
            console.log(`Searching Ombi for TMDB ID: ${tmdbId}`, url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'ApiKey': this.apiKey,
                    'Accept': 'application/json'
                }
            });

            // Check if the response is not OK
            if (!response.ok) {
                const text = await response.text();
                console.error(`Non-OK response from Ombi (${response.status}):`, text);
                
                // Check if we received HTML instead of JSON (common error with redirects)
                if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
                    throw new Error(`Received HTML instead of JSON. Your Ombi server might be redirecting to a login page. Status: ${response.status}`);
                }
                
                throw new Error(`Ombi search failed: ${response.status} ${response.statusText}`);
            }

            // Check the content type
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                console.error(`Non-JSON response from Ombi:`, text, `Content-Type: ${contentType}`);
                
                if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
                    throw new Error(`Received HTML instead of JSON. Your Ombi server might be redirecting to a login page.`);
                }
                
                throw new Error(`Ombi returned non-JSON response. Content-Type: ${contentType}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error searching Ombi:', error);
            throw error;
        }
    }

    // Helper method to ensure response is proper JSON
    async handleApiResponse(response, endpoint) {
        // Log response details
        console.log(`Response for ${endpoint}: status=${response.status}, content-type=${response.headers.get('content-type')}`);
        
        // Handle error responses
        if (!response.ok) {
            const text = await response.text();
            console.error(`API request failed (${response.status}) with endpoint ${endpoint}:`, 
                text.length > 500 ? text.substring(0, 500) + '...' : text);
            
            // Try to parse error as JSON if possible for more details
            let errorDetails = "";
            try {
                if (text && text.includes('{')) {
                    const errorJson = JSON.parse(text);
                    if (errorJson.errors) {
                        errorDetails = Object.entries(errorJson.errors)
                            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
                            .join('; ');
                    } else if (errorJson.error || errorJson.message) {
                        errorDetails = errorJson.error || errorJson.message;
                    }
                }
            } catch (e) {
                console.log('Could not parse error response as JSON');
            }
            
            // Different error message based on status
            if (response.status === 400) {
                throw new Error(`Bad Request (400): ${errorDetails || 'Invalid input parameters'}`);
            } else if (response.status === 401 || response.status === 403) {
                throw new Error(`Authentication failed (${response.status}): ${text.substring(0, 100)}`);
            } else if (response.status === 404) {
                throw new Error(`Resource not found (404): The requested endpoint ${endpoint} does not exist`);
            } else if (response.status >= 500) {
                throw new Error(`Server error (${response.status}): The Ombi server encountered an error`);
            } else {
                throw new Error(`API request failed with status ${response.status}`);
            }
        }
        
        // Check content type and parse response
        const contentType = response.headers.get('content-type');
        
        // Special handling for availability endpoints - they might return HTML in some Ombi versions
        if (endpoint.includes('availability') && contentType && contentType.includes('text/html')) {
            console.log('Availability endpoint returned HTML instead of JSON - this is a known issue with some Ombi configurations');
            
            // Return a default "not available" object instead of throwing an error
            return {
                available: false,
                requested: false,
                approved: false,
                plexUrl: null,
                embyUrl: null
            };
        }
        
        // For other endpoints, enforce JSON
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.warn(`Received non-JSON response from ${endpoint}:`, 
                text.length > 500 ? text.substring(0, 500) + '...' : text);
            
            // Check for login page
            if (text.includes('<html') && (text.includes('login') || text.includes('signin'))) {
                throw new Error('Received login page instead of API response - authentication may have failed');
            }
            
            throw new Error('Received non-JSON response from server');
        }
        
        try {
            const data = await response.json();
            
            // For availability endpoints, normalize the data structure
            if (endpoint.includes('availability')) {
                console.log('Processing availability data', data);
                // Different versions of Ombi API return different structures
                if (data) {
                    return {
                        available: data.available === true || 
                                  (data.plexUrl || data.embyUrl) ? true : false,
                        requested: data.requested === true || 
                                  data.isRequested === true || false,
                        approved: data.approved === true || false,
                        plexUrl: data.plexUrl || null,
                        embyUrl: data.embyUrl || null,
                        id: data.id || data.theMovieDbId || null
                    };
                }
            }
            
            return data;
        } catch (error) {
            console.error(`Error parsing JSON from ${endpoint}:`, error);
            throw new Error(`Failed to parse JSON response: ${error.message}`);
        }
    }

    // Helper method to extract availability info from search results
    // This is used when availability endpoints return HTML instead of JSON
    extractAvailabilityFromSearchResult(movieResult) {
        if (!movieResult) return null;
        
        console.log('Extracting availability info from search result:', movieResult);
        
        // Different Ombi versions use different property names for availability info
        // Let's check all known variations
        const available = 
            movieResult.available === true ||
            movieResult.isAvailable === true ||
            (movieResult.plexUrl && movieResult.plexUrl !== '') || 
            (movieResult.embyUrl && movieResult.embyUrl !== '');
        
        const requested = 
            movieResult.requested === true || 
            movieResult.isRequested === true ||
            movieResult.requestStatus === 1 ||
            (movieResult.requestStatus && movieResult.requestStatus.toLowerCase() === 'requested');
        
        const approved = 
            movieResult.approved === true ||
            movieResult.isApproved === true;
        
        const denied = 
            movieResult.denied === true ||
            movieResult.isDenied === true;
        
        // Create a normalized availability object
        return {
            available: available,
            requested: requested,
            approved: approved,
            denied: denied,
            plexUrl: movieResult.plexUrl || null,
            embyUrl: movieResult.embyUrl || null,
            id: movieResult.id || movieResult.theMovieDbId || null
        };
    }

    async validateAndInitializeWithPlexToken(plexToken) {
        console.log('Validating and initializing with Plex token');
        
        if (!plexToken) {
            console.error('No Plex token provided');
            return false;
        }
        
        if (!this.baseUrl) {
            console.error('Ombi URL not configured');
            return false;
        }
        
        // Clear existing authentication
        this.token = null;
        
        try {
            // Try to authenticate with Plex token
            const result = await this.authenticateWithPlex(plexToken);
            
            if (result && this.token) {
                console.log('Successfully authenticated with Plex token');
                
                // Save Plex user info for later use
                try {
                    const userResponse = await fetch('https://plex.tv/api/v2/user', {
                        headers: {
                            'Accept': 'application/json',
                            'X-Plex-Token': plexToken,
                            'X-Plex-Client-Identifier': 'PlexBoxd'
                        }
                    });
                    
                    if (userResponse.ok) {
                        const userInfo = await userResponse.json();
                        this.plexUser = userInfo;
                        
                        // Store in Chrome storage for later
                        chrome.storage.local.set({ plexUserInfo: userInfo });
                        console.log('Saved Plex user info:', userInfo);
                    }
                } catch (userError) {
                    console.warn('Failed to get Plex user info:', userError);
                }
                
                return true;
            } else {
                console.error('Failed to authenticate with Plex token');
                return false;
            }
        } catch (error) {
            console.error('Error validating Plex token:', error);
            return false;
        }
    }
} 