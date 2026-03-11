class OverseerrIntegration {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        console.log('=== OVERSERR INTEGRATION INITIALIZATION ===');
        console.log('Initialized with base URL:', this.baseUrl);
        this.token = null;
        this.plexUser = null;
        this.apiKey = null; // Fallback for API key auth
        this._lastSearchResults = []; // Store last search results for future availability checks
        console.log('=== OVERSERR INTEGRATION READY ===');
    }

    async initialize() {
        console.log('=== OVERSERR INITIALIZATION START ===');
        console.log('Initializing Overseerr integration');
        
        if (!this.baseUrl) {
            console.error('❌ Overseerr URL not configured');
            return false;
        }
        
        try {
            // Check if we already have valid authentication
            if (this.token) {
                console.log('🔍 Already have a token, verifying...');
                const isValid = await this.verifyToken();
                if (isValid) {
                    console.log('✅ Existing token is valid');
                    return true;
                } else {
                    console.log('❌ Existing token is invalid, clearing');
                    this.token = null;
                }
            }
            
            if (this.apiKey) {
                console.log('🔍 Have API key, verifying...');
                const isValid = await this.verifyApiKey();
                if (isValid) {
                    console.log('✅ API key is valid');
                    return true;
                } else {
                    console.log('❌ API key is invalid, clearing');
                    this.apiKey = null;
                }
            }
            
            // Get stored tokens and keys
            console.log('📦 Retrieving stored authentication data...');
            const { plexToken, overseerrToken, overseerrTokenExpiry, overseerrSession, overseerrApiKey } = await chrome.storage.local.get([
                'plexToken',
                'overseerrToken',
                'overseerrTokenExpiry',
                'overseerrSession',
                'overseerrApiKey'
            ]);

            // Enforce 30-day session TTL
            if (overseerrToken && overseerrTokenExpiry && Date.now() > overseerrTokenExpiry) {
                console.log('⏰ Overseerr session token has expired (30-day TTL), clearing');
                await chrome.storage.local.remove(['overseerrToken', 'overseerrTokenExpiry']);
                // Fall through to re-authenticate below
            }
            
            console.log('📦 Retrieved from storage:', {
                hasPlexToken: !!plexToken,
                hasOverseerrToken: !!overseerrToken,
                overseerrTokenExpiry: overseerrTokenExpiry ? new Date(overseerrTokenExpiry).toISOString() : null,
                hasOverseerrSession: !!overseerrSession,
                hasOverseerrApiKey: !!overseerrApiKey
            });
            
            // Try Overseerr session if available
            if (overseerrSession && !this.sessionData) {
                this.sessionData = overseerrSession;
                console.log('🔍 Trying stored Overseerr session');
                
                const isValid = await this.verifySession();
                if (isValid) {
                    console.log('✅ Stored Overseerr session is valid');
                    return true;
                } else {
                    console.log('❌ Stored Overseerr session is invalid, clearing');
                    this.sessionData = null;
                    await chrome.storage.local.remove('overseerrSession');
                }
            }
            
            // Try Overseerr token if available and not expired
            const tokenExpired = overseerrTokenExpiry && Date.now() > overseerrTokenExpiry;
            if (overseerrToken && !tokenExpired && !this.token) {
                this.token = overseerrToken;
                console.log('🔍 Trying stored Overseerr token');
                
                const isValid = await this.verifyToken();
                if (isValid) {
                    console.log('✅ Stored Overseerr token is valid');
                    return true;
                } else {
                    console.log('❌ Stored Overseerr token is invalid, clearing');
                    this.token = null;
                    await chrome.storage.local.remove('overseerrToken');
                }
            }
            
            // Try API key if available
            if (overseerrApiKey && !this.apiKey) {
                this.apiKey = overseerrApiKey;
                console.log('🔍 Trying stored API key');
                
                const isValid = await this.verifyApiKey();
                if (isValid) {
                    console.log('✅ Stored API key is valid');
                    return true;
                } else {
                    console.log('❌ Stored API key is invalid, clearing');
                    this.apiKey = null;
                    // Don't remove from storage as the user may need to fix it
                }
            }
            
            // If we have a Plex token, try to authenticate with it
            if (plexToken) {
                console.log('🔍 Trying to authenticate with Plex token');
                const plexAuthSuccess = await this.validateAndInitializeWithPlexToken(plexToken);
                if (plexAuthSuccess) {
                    return true;
                } else {
                    console.log('⚠️ Plex authentication failed, falling back to API key if available');
                    // Fall back to API key if Plex auth fails
                    if (overseerrApiKey) {
                        console.log('🔍 Trying API key fallback');
                        return await this.authenticateWithApiKey(overseerrApiKey);
                    }
                }
            }
            
            console.log('❌ No valid authentication method found');
            return false;
        } catch (error) {
            console.error('❌ Error initializing Overseerr integration:', error);
            return false;
        }
    }
    
    async loadPlexUserInfo(plexToken) {
        console.log('=== LOADING PLEX USER INFO ===');
        if (!plexToken) {
            console.log('❌ No Plex token provided, skipping user info loading');
            return;
        }
        
        try {
            console.log('🔍 Loading Plex user info from Plex.tv API');
            const response = await fetch('https://plex.tv/api/v2/user', {
                headers: {
                    'X-Plex-Token': plexToken,
                    'Accept': 'application/json'
                }
            });
            
            console.log(`📡 Plex API response status: ${response.status}`);
            
            if (response.ok) {
                const userData = await response.json();
                console.log('📦 Received user data from Plex:', userData);
                
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
                console.log('✅ Loaded Plex user info:', this.plexUser);
                
                // Store the Plex user info in storage for debugging and later use
                await chrome.storage.local.set({ 
                    plexUserInfo: this.plexUser,
                    plexUserId: userData.id,
                    plexUsername: this.plexUser.username
                });
                console.log('💾 Stored Plex user info in local storage');
                
                return this.plexUser;
            } else {
                const errorText = await response.text();
                console.error(`❌ Failed to load Plex user info (${response.status}):`, errorText);
                throw new Error(`Failed to load Plex user info: ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Failed to load Plex user info:', error);
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
        console.log('=== PLEX AUTHENTICATION START ===');
        if (!plexToken) {
            throw new Error('No Plex token provided');
        }
        
        if (!this.baseUrl) {
            throw new Error('Overseerr URL not configured');
        }
        
        console.log(`🔍 Authenticating with Plex token at ${this.baseUrl}`);
        
        // Try multiple authentication endpoints to support different Overseerr versions
        const authEndpoints = [
            '/api/v1/auth/plex',
            '/api/v1/auth/plex/token'
        ];
        
        let lastError = null;
        let attemptCount = 0;
        
        for (const endpoint of authEndpoints) {
            attemptCount++;
            console.log(`🔐 Authentication attempt ${attemptCount}: ${endpoint}`);
            
            try {
                const url = this.baseUrl + endpoint;
                console.log(`🌐 Trying to authenticate at: ${url}`);
                
                const headers = {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                };
                
                // Construct the request body for Overseerr
                // Different endpoints expect different field names
                let requestBody;
                
                if (endpoint.includes('/auth/plex')) {
                    // For Plex authentication endpoints
                    requestBody = {
                        authToken: plexToken
                    };
                } else if (endpoint.includes('/auth/local')) {
                    // Skip local auth endpoints for Plex authentication
                    continue;
                } else {
                    // Fallback
                    requestBody = {
                        plexToken: plexToken
                    };
                }
                
                console.log('📤 Authentication request body:', requestBody);
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(requestBody),
                    mode: 'cors',
                    credentials: 'include',
                    redirect: 'follow',
                    cache: 'no-cache'
                });
                
                console.log(`📡 Authentication response status: ${response.status} from ${endpoint}`);
                
                if (response.ok) {
                    const authData = await response.json();
                    console.log('✅ Authentication successful:', authData);
                    
                    // Check if this is session-based authentication (no token field)
                    if (authData.id && authData.plexUsername) {
                        // Session-based auth - store session info instead of token
                        this.sessionData = authData;
                        console.log('✅ Using session-based authentication');

                        // Store session data in chrome storage
                        await chrome.storage.local.set({ overseerrSession: authData });
                        console.log('💾 Stored Overseerr session data in local storage');

                        // The auth response sets a connect.sid cookie with SameSite=Strict,
                        // which the browser won't send in cross-origin extension requests.
                        // Re-set it without the SameSite restriction so credentials:include works.
                        await this.fixSessionCookie();

                        // Load Plex user info
                        await this.loadPlexUserInfo(plexToken);

                        return true;
                    } else if (authData.token || authData.accessToken) {
                        // Token-based auth
                        this.token = authData.token || authData.accessToken;
                        console.log('✅ Using token-based authentication');
                        
                        // Store the token in chrome storage
                        await chrome.storage.local.set({ overseerrToken: this.token });
                        console.log('💾 Stored Overseerr token in local storage');
                        
                        // Load Plex user info
                        await this.loadPlexUserInfo(plexToken);
                        
                        return true;
                    } else {
                        console.error('❌ No authentication data received in response');
                        throw new Error('No authentication data received');
                    }
                } else {
                    const errorText = await response.text();
                    console.error(`❌ Authentication failed with status ${response.status}:`, errorText);
                    
                    // Try to parse error response
                    try {
                        const errorData = JSON.parse(errorText);
                        throw new Error(errorData.message || `Authentication failed: ${response.status}`);
                    } catch (parseError) {
                        throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
                    }
                }
            } catch (endpointError) {
                console.error(`❌ Error with authentication endpoint ${endpoint}:`, endpointError);
                lastError = endpointError;
                
                // If this is a 404, try the next endpoint
                if (endpointError.message.includes('404')) {
                    continue;
                }
                
                // If this is an authentication error, try next endpoint
                if (endpointError.message.includes('401') || endpointError.message.includes('403')) {
                    continue;
                }
            }
        }
        
        // If we reach here, all endpoints failed
        if (lastError) {
            throw lastError;
        }
        
        throw new Error('All authentication endpoints failed');
    }
    
    getAuthHeaders() {
        console.log('🔐 Getting auth headers...');
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
            console.log('🔑 Using Bearer token authentication');
        } else if (this.sessionData) {
            // For session-based auth, we need to include session cookies
            // The session is maintained by the browser automatically
            console.log('🔑 Using session-based authentication');
        } else if (this.apiKey) {
            headers['X-Api-Key'] = this.apiKey;
            console.log('🔑 Using API key authentication');
        } else {
            console.log('⚠️ No authentication method available');
        }
        
        console.log('📤 Auth headers:', headers);
        return headers;
    }
    
    async verifySession() {
        console.log('=== SESSION VERIFICATION ===');
        if (!this.sessionData) {
            console.log('❌ No session data to verify');
            return false;
        }
        
        try {
            console.log('🔍 Verifying session...');
            const response = await fetch(this.baseUrl + '/api/v1/auth/me', {
                method: 'GET',
                headers: this.getAuthHeaders(),
                mode: 'cors',
                credentials: 'include'
            });
            
            console.log(`📡 Session verification response status: ${response.status}`);
            
            if (response.ok) {
                const userData = await response.json();
                console.log('✅ Session is valid, user data:', userData);
                return true;
            } else {
                console.log('❌ Session verification failed');
                return false;
            }
        } catch (error) {
            console.error('❌ Error verifying session:', error);
            return false;
        }
    }
    
    async verifyToken() {
        console.log('=== TOKEN VERIFICATION ===');
        if (!this.token) {
            console.log('❌ No token to verify');
            return false;
        }
        
        try {
            console.log('🔍 Verifying token...');
            const response = await fetch(this.baseUrl + '/api/v1/auth/me', {
                method: 'GET',
                headers: this.getAuthHeaders(),
                mode: 'cors',
                credentials: 'include'
            });
            
            console.log(`📡 Token verification response status: ${response.status}`);
            
            if (response.ok) {
                const userData = await response.json();
                console.log('✅ Token is valid, user data:', userData);
                return true;
            } else {
                console.log('❌ Token verification failed');
                return false;
            }
        } catch (error) {
            console.error('❌ Error verifying token:', error);
            return false;
        }
    }
    
    async verifyApiKey() {
        console.log('=== API KEY VERIFICATION ===');
        if (!this.apiKey) {
            console.log('❌ No API key to verify');
            return false;
        }
        
        try {
            console.log('🔍 Verifying API key...');
            const response = await fetch(this.baseUrl + '/api/v1/auth/me', {
                method: 'GET',
                headers: this.getAuthHeaders(),
                mode: 'cors',
                credentials: 'include'
            });
            
            console.log(`📡 API key verification response status: ${response.status}`);
            
            if (response.ok) {
                const userData = await response.json();
                console.log('✅ API key is valid, user data:', userData);
                return true;
            } else {
                console.log('❌ API key verification failed');
                return false;
            }
        } catch (error) {
            console.error('❌ Error verifying API key:', error);
            return false;
        }
    }
    
    async authenticateWithApiKey(apiKey) {
        console.log('=== API KEY AUTHENTICATION ===');
        if (!apiKey) {
            throw new Error('No API key provided');
        }
        
        if (!this.baseUrl) {
            throw new Error('Overseerr URL not configured');
        }
        
        console.log('🔍 Authenticating with API key');
        
        this.apiKey = apiKey;
        
        // Test the API key
        const isValid = await this.verifyApiKey();
        if (isValid) {
            // Store the API key
            await chrome.storage.local.set({ overseerrApiKey: apiKey });
            console.log('✅ API key authentication successful');
            return true;
        } else {
            this.apiKey = null;
            throw new Error('Invalid API key');
        }
    }
    
    async searchMovie(query, year = null) {
        console.log('=== MOVIE SEARCH START ===');
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
        console.log(`🔍 Searching for movie: "${cleanTitle}"${extractedYear ? ` (${extractedYear})` : ''}`);
        await this.ensureAuthenticated();
        
        try {
            // Correct Overseerr search endpoint (searches both movies and TV)
            const searchEndpoint = `/api/v1/search`;
            const url = this.baseUrl + searchEndpoint;
            console.log(`🌐 Searching using endpoint: ${url}`);
            
            const headers = this.getAuthHeaders();
            
            // Overseerr expects query parameters
            const params = new URLSearchParams({
                query: cleanTitle
            });
            
            const fullUrl = `${url}?${params}`;
            console.log(`🌐 Full search URL: ${fullUrl}`);
            
            const response = await fetch(fullUrl, {
                method: 'GET',
                headers: headers,
                mode: 'cors',
                credentials: 'include',
                redirect: 'follow',
                cache: 'no-cache'
            });
            
            console.log(`📡 Search response status: ${response.status}`);
            console.log(`📡 Search response headers:`, Object.fromEntries(response.headers.entries()));
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Search failed with status ${response.status}:`, errorText);
                throw new Error(`Search failed: ${response.status}: ${errorText}`);
            }
            
            // The Overseerr /api/v1/search endpoint returns an object with a 'results' array
            const data = await this.handleApiResponse(response, searchEndpoint);
            console.log('📦 Raw search response data:', data);
            
            const results = Array.isArray(data.results) ? data.results : [];
            console.log(`📊 Total search results: ${results.length}`);
            
            // Filter to movies only
            let filteredResults = results.filter(item => item.mediaType === 'movie');
            console.log(`🎬 Movies found: ${filteredResults.length}`);
            
            // Filter by year if provided
            if (extractedYear) {
                const beforeYearFilter = filteredResults.length;
                filteredResults = filteredResults.filter(movie => {
                    const movieYear = movie.releaseDate 
                        ? new Date(movie.releaseDate).getFullYear() 
                        : movie.year;
                    return movieYear === parseInt(extractedYear);
                });
                console.log(`📅 Filtered to ${filteredResults.length} results matching year ${extractedYear} (was ${beforeYearFilter})`);
            }
            
            if (filteredResults.length > 0) {
                // Store the results for later use in availability checks
                this._lastSearchResults = filteredResults;
                console.log('💾 Stored search results for later use');
                console.log('✅ Search successful, returning results');
                return filteredResults;
            }
            
            console.log(`❌ No results found for "${cleanTitle}"`);
            return []; // Return empty array if no results found
        } catch (error) {
            console.error('❌ Error searching for movie:', error);
            throw error;
        }
    }
    
    async checkAvailability(type, id) {
        console.log(`=== AVAILABILITY CHECK ===`);
        console.log(`🔍 Checking availability for ${type} ID: ${id}`);
        await this.ensureAuthenticated();
        
        try {
            // Overseerr availability endpoint
            const endpoint = `/api/v1/request/${id}`;
            const fullUrl = this.baseUrl + endpoint;
            console.log(`🌐 Checking availability using endpoint: ${fullUrl}`);
            
            const response = await fetch(fullUrl, {
                method: 'GET',
                headers: this.getAuthHeaders(),
                mode: 'cors',
                credentials: 'include',
                redirect: 'follow',
                cache: 'no-cache'
            });
            
            console.log(`📡 Availability check response status: ${response.status}`);
            
            if (response.ok) {
                const data = await response.json();
                console.log(`📦 Availability result:`, data);
                
                // Overseerr response format
                const result = {
                    available: data.media?.status === 'available',
                    requested: data.status === 'approved' || data.status === 'pending',
                    approved: data.status === 'approved',
                    plexUrl: data.media?.mediaUrl || data.media?.plexUrl || null
                };

                console.log('✅ Availability check result:', result);
                return result;
            } else if (response.status === 404) {
                // Movie not found/not requested
                console.log('❌ Movie not found/not requested (404)');
                return {
                    available: false,
                    requested: false,
                    approved: false,
                    plexUrl: null
                };
            } else {
                const errorText = await response.text();
                console.error(`❌ Availability check failed: ${response.status}`, errorText);
                throw new Error(`Availability check failed: ${response.status}`);
            }
        } catch (error) {
            console.error(`❌ Error checking ${type} availability:`, error);
            throw error;
        }
    }
    
    async requestMovie(id, tmdbId, imdbId) {
        console.log(`=== MOVIE REQUEST START ===`);
        console.log(`📝 Requesting movie: ID=${id}, TMDB=${tmdbId}, IMDB=${imdbId}`);
        
        if (!this.baseUrl) {
            throw new Error('Overseerr URL not configured');
        }
        
        // Make sure we're authenticated
        await this.ensureAuthenticated();
        
        try {
            console.log("👤 User info for request:", this.plexUser);
            
            // Overseerr request endpoint
            const endpoint = '/api/v1/request';
            const url = this.baseUrl + endpoint;
            console.log(`🌐 Request URL: ${url}`);
            
            // Construct the request body for Overseerr
            const requestBody = {
                mediaType: 'movie',
                mediaId: tmdbId || id
            };
            
            // Add user info if available
            if (this.plexUser) {
                requestBody.requestedBy = this.plexUser.username || this.plexUser.title;
            }
            
            console.log(`📤 Request body:`, requestBody);
            
            const headers = this.getAuthHeaders();
            headers['Content-Type'] = 'application/json';
            console.log('🔐 Using auth headers:', JSON.stringify(headers, null, 2));
            
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody),
                mode: 'cors',
                credentials: 'include',
                redirect: 'follow',
                cache: 'no-cache'
            });
            
            console.log(`📡 Response status: ${response.status}`);
            
            // For debugging, try to log the full response body
            let responseText = '';
            try {
                responseText = await response.clone().text();
                console.log(`📦 Raw response: ${responseText.substring(0, 500)}`);
            } catch (e) {
                console.error("❌ Couldn't read response text", e);
            }
            
            // Check for common error status codes
            if (response.status === 500) {
                console.error(`❌ Server error (500) from ${endpoint}`);
                throw new Error(`Server error: ${responseText.substring(0, 100)}`);
            }
            
            if (response.status === 401 || response.status === 403) {
                console.error(`❌ Authentication error with ${endpoint}: ${response.status}`);
                
                // Try to re-authenticate and retry
                this.token = null;
                this.apiKey = null;
                const reAuthSuccess = await this.initialize();
                
                if (reAuthSuccess) {
                    console.log('🔄 Re-authenticated, retrying request...');
                    
                    // Retry the request with new authentication
                    const newHeaders = this.getAuthHeaders();
                    newHeaders['Content-Type'] = 'application/json';
                    
                    const retryResponse = await fetch(url, {
                        method: 'POST',
                        headers: newHeaders,
                        body: JSON.stringify(requestBody),
                        mode: 'cors',
                        credentials: 'include',
                        redirect: 'follow',
                        cache: 'no-cache'
                    });
                    
                    if (retryResponse.ok) {
                        return await this.parseRequestResponse(retryResponse, endpoint);
                    } else {
                        throw new Error(`Retry failed: ${retryResponse.status}`);
                    }
                } else {
                    throw new Error('Re-authentication failed');
                }
            }
            
            // If we get here, try to parse the response
            try {
                const result = await this.parseRequestResponse(response, endpoint);
                return result;
            } catch (parseError) {
                console.error(`❌ Error parsing response from ${endpoint}:`, parseError);
                throw parseError;
            }
        } catch (error) {
            console.error('❌ Error requesting movie:', error);
            throw error;
        }
    }
    
    async parseRequestResponse(response, endpoint) {
        console.log(`=== PARSING REQUEST RESPONSE ===`);
        console.log(`🔍 Parsing response from ${endpoint}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Request failed with status ${response.status}:`, errorText);
            
            // Try to parse error response
            try {
                const errorData = JSON.parse(errorText);
                throw new Error(errorData.message || `Request failed: ${response.status}`);
            } catch (parseError) {
                throw new Error(`Request failed: ${response.status} ${response.statusText}`);
            }
        }
        
        try {
            const data = await response.json();
            console.log(`📦 Request response data:`, data);
            
            // Overseerr response format
            const result = {
                success: true,
                message: 'Movie request submitted successfully',
                requestId: data.id,
                status: data.status
            };
            
            console.log('✅ Parsed request response:', result);
            return result;
        } catch (parseError) {
            console.error('❌ Error parsing JSON response:', parseError);
            throw new Error('Invalid response format from server');
        }
    }
    
    async ensureAuthenticated() {
        console.log('=== AUTHENTICATION CHECK ===');
        if (!this.token && !this.sessionData && !this.apiKey) {
            console.log('❌ Not authenticated, attempting to initialize...');
            const success = await this.initialize();
            if (!success) {
                throw new Error('Failed to authenticate with Overseerr');
            }
        }
        console.log('✅ Authentication confirmed');
    }
    
    getUserInfo() {
        return this.plexUser;
    }
    
    getAuthMethod() {
        return this.token ? 'token' : this.apiKey ? 'apiKey' : 'none';
    }
    
    async searchMovieByTmdbId(tmdbId) {
        console.log(`=== TMDB ID SEARCH ===`);
        console.log(`🔍 Searching for movie by TMDB ID: ${tmdbId}`);
        await this.ensureAuthenticated();
        
        try {
            // Overseerr search by TMDB ID endpoint
            const endpoint = `/api/v1/movie/${tmdbId}`;
            const url = this.baseUrl + endpoint;
            console.log(`🌐 Searching using endpoint: ${url}`);
            
            const headers = this.getAuthHeaders();
            
            const response = await fetch(url, {
                method: 'GET',
                headers: headers,
                mode: 'cors',
                credentials: 'include',
                redirect: 'follow',
                cache: 'no-cache'
            });
            
            console.log(`📡 Search response status: ${response.status}`);
            
            if (response.ok) {
                const movieData = await response.json();
                console.log(`📦 Movie data:`, movieData);
                
                // Extract availability from mediaInfo
                const mediaInfo = movieData.mediaInfo;
                let isAvailable = false;
                let isRequested = false;
                let isApproved = false;
                let requestStatus = null;
                // Overseerr status codes: 1=unknown, 2=pending, 3=processing/requested, 4=partially available, 5=available
                if (mediaInfo) {
                    requestStatus = mediaInfo.status;
                    if (requestStatus === 5 || requestStatus === 'available') {
                        isAvailable = true;
                    }
                    if (requestStatus === 2 || requestStatus === 3 || requestStatus === 'pending' || requestStatus === 'processing') {
                        isRequested = true;
                    }
                    if (requestStatus === 3 || requestStatus === 4 || requestStatus === 5 || requestStatus === 'processing' || requestStatus === 'partially available' || requestStatus === 'available') {
                        isApproved = true;
                    }
                    // Check requests array for more granular status
                    if (Array.isArray(mediaInfo.requests) && mediaInfo.requests.length > 0) {
                        // If any request is pending or processing, set requested
                        isRequested = mediaInfo.requests.some(r => r.status === 2 || r.status === 3);
                        // If any request is approved (status 3+), set approved
                        isApproved = mediaInfo.requests.some(r => r.status >= 3);
                    }
                }
                // Return in the expected format
                const result = [{
                    id: movieData.id,
                    title: movieData.title,
                    originalTitle: movieData.originalTitle,
                    year: movieData.releaseDate ? new Date(movieData.releaseDate).getFullYear() : null,
                    releaseDate: movieData.releaseDate,
                    tmdbId: movieData.id, // TMDB ID is the same as the id field
                    available: isAvailable,
                    requested: isRequested,
                    approved: isApproved,
                    plexUrl: mediaInfo?.mediaUrl || mediaInfo?.plexUrl || null,
                    mediaInfo: mediaInfo // Include the full mediaInfo for debugging
                }];
                
                console.log('✅ TMDB ID search successful:', result);
                return result;
            } else if (response.status === 404) {
                console.log(`❌ Movie with TMDB ID ${tmdbId} not found`);
                return [];
            } else {
                const errorText = await response.text();
                console.error(`❌ Search failed with status ${response.status}:`, errorText);
                throw new Error(`Search failed: ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Error searching for movie by TMDB ID:', error);
            throw error;
        }
    }
    
    async checkMovieAvailability(movieTitle, year, tmdbId) {
        console.log(`=== MOVIE AVAILABILITY CHECK ===`);
        console.log(`🔍 Checking movie availability: "${movieTitle}" (${year}) - TMDB: ${tmdbId}`);
        
        try {
            let searchResults = [];
            
            // If we have a TMDB ID, try searching by that first (most reliable)
            if (tmdbId) {
                console.log('🔍 Searching by TMDB ID first');
                searchResults = await this.searchMovieByTmdbId(tmdbId);
                
                if (searchResults.length > 0) {
                    console.log('✅ Found movie by TMDB ID, using that result');
                    const movie = searchResults[0];
                    
                    // Extract availability directly from the search result
                    const result = {
                        found: true,
                        available: movie.available,
                        requested: movie.requested,
                        approved: movie.requested, // If requested, consider it approved
                        plexUrl: movie.plexUrl,
                        movie: movie
                    };
                    
                    console.log('✅ Availability check complete (TMDB ID):', result);
                    return result;
                }
            }
            
            // If no results by TMDB ID, try searching by title
            if (searchResults.length === 0) {
                console.log('🔍 No results by TMDB ID, searching by title');
                searchResults = await this.searchMovie(movieTitle, year);
            }
            
            if (searchResults.length === 0) {
                console.log('❌ No movie found in Overseerr database');
                return {
                    found: false,
                    available: false,
                    requested: false,
                    message: 'Movie not found in Overseerr database'
                };
            }
            
            // Find the best match
            const bestMatch = this.findBestMatch(searchResults, movieTitle, year);
            
            if (!bestMatch) {
                console.log('❌ No suitable match found');
                return {
                    found: false,
                    available: false,
                    requested: false,
                    message: 'No suitable match found'
                };
            }
            
            console.log('✅ Best match found:', bestMatch);
            
            // Check availability for the best match
            const availability = await this.checkAvailability('movie', bestMatch.id);
            
            const result = {
                found: true,
                available: availability.available,
                requested: availability.requested,
                approved: availability.approved,
                plexUrl: availability.plexUrl,
                movie: bestMatch
            };
            
            console.log('✅ Availability check complete:', result);
            return result;
        } catch (error) {
            console.error('❌ Error checking movie availability:', error);
            throw error;
        }
    }
    
    findBestMatch(searchResults, title, year) {
        console.log(`=== FINDING BEST MATCH ===`);
        console.log(`🔍 Finding best match for "${title}" (${year}) among ${searchResults.length} results`);
        
        // Normalize the search title
        const normalizedSearchTitle = title.toLowerCase().trim();
        
        // First, try to find exact title match (check both title and originalTitle)
        let exactMatches = searchResults.filter(movie => {
            const movieTitle = (movie.title || '').toLowerCase().trim();
            const movieOriginalTitle = (movie.originalTitle || '').toLowerCase().trim();
            return movieTitle === normalizedSearchTitle || movieOriginalTitle === normalizedSearchTitle;
        });
        
        if (exactMatches.length > 0) {
            console.log(`✅ Found ${exactMatches.length} exact title matches`);
            
            // If year is specified, filter by year
            if (year) {
                const yearMatches = exactMatches.filter(movie => {
                    const movieYear = movie.year || (movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : null);
                    return movieYear === parseInt(year);
                });
                
                if (yearMatches.length > 0) {
                    console.log(`✅ Found ${yearMatches.length} exact matches with year ${year}`);
                    return yearMatches[0]; // Return the first match
                }
            }
            
            // If no year match or no year specified, return the first exact title match
            console.log('✅ Returning first exact title match');
            return exactMatches[0];
        }
        
        // If no exact match, try partial matches (check both title and originalTitle)
        const partialMatches = searchResults.filter(movie => {
            const movieTitle = (movie.title || '').toLowerCase().trim();
            const movieOriginalTitle = (movie.originalTitle || '').toLowerCase().trim();
            return movieTitle.includes(normalizedSearchTitle) ||
                   normalizedSearchTitle.includes(movieTitle) ||
                   movieOriginalTitle.includes(normalizedSearchTitle) ||
                   normalizedSearchTitle.includes(movieOriginalTitle);
        });
        
        if (partialMatches.length > 0) {
            console.log(`✅ Found ${partialMatches.length} partial matches`);
            
            // If year is specified, filter by year
            if (year) {
                const yearMatches = partialMatches.filter(movie => {
                    const movieYear = movie.year || (movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : null);
                    return movieYear === parseInt(year);
                });
                
                if (yearMatches.length > 0) {
                    console.log(`✅ Found ${yearMatches.length} partial matches with year ${year}`);
                    return yearMatches[0];
                }
            }
            
            // Return the first partial match
            console.log('✅ Returning first partial match');
            return partialMatches[0];
        }
        
        console.log('❌ No suitable match found');
        return null;
    }
    
    async search(tmdbId) {
        console.log(`=== GENERIC SEARCH ===`);
        console.log(`🔍 Searching Overseerr for TMDB ID: ${tmdbId}`);
        
        try {
            const url = this.baseUrl + `/api/v1/movie/${tmdbId}`;
            console.log(`🌐 Searching Overseerr for TMDB ID: ${tmdbId}`, url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders(),
                mode: 'cors',
                credentials: 'include',
                redirect: 'follow',
                cache: 'no-cache'
            });
            
            console.log(`📡 Search response status: ${response.status}`);
            
            if (!response.ok) {
                const text = await response.text();
                console.error(`❌ Non-OK response from Overseerr (${response.status}):`, text);
                
                if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
                    throw new Error(`Received HTML instead of JSON. Your Overseerr server might be redirecting to a login page. Status: ${response.status}`);
                }
                
                throw new Error(`Overseerr search failed: ${response.status} ${response.statusText}`);
            }
            
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                console.error(`❌ Non-JSON response from Overseerr:`, text, `Content-Type: ${contentType}`);
                
                if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
                    throw new Error(`Received HTML instead of JSON. Your Overseerr server might be redirecting to a login page.`);
                }
                
                throw new Error(`Overseerr returned non-JSON response. Content-Type: ${contentType}`);
            }
            
            const data = await response.json();
            console.log(`📦 Overseerr search result:`, data);
            
            return data;
        } catch (error) {
            console.error('❌ Error searching Overseerr:', error);
            throw error;
        }
    }
    
    async handleApiResponse(response, endpoint) {
        console.log(`=== HANDLING API RESPONSE ===`);
        console.log(`🔍 Handling API response from ${endpoint}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ API request failed with status ${response.status}:`, errorText);
            
            // Try to parse error response
            try {
                const errorData = JSON.parse(errorText);
                throw new Error(errorData.message || `API request failed: ${response.status}`);
            } catch (parseError) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error(`❌ Non-JSON response from ${endpoint}:`, text, `Content-Type: ${contentType}`);
            
            if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
                throw new Error(`Received HTML instead of JSON. Your Overseerr server might be redirecting to a login page.`);
            }
            
            throw new Error(`Overseerr returned non-JSON response. Content-Type: ${contentType}`);
        }
        
        try {
            const data = await response.json();
            console.log(`📦 API response data from ${endpoint}:`, data);
            return data;
        } catch (parseError) {
            console.error(`❌ Error parsing JSON response from ${endpoint}:`, parseError);
            throw new Error('Invalid response format from server');
        }
    }
    
    extractAvailabilityFromSearchResult(movieResult) {
        console.log('=== EXTRACTING AVAILABILITY ===');
        console.log('🔍 Extracting availability from search result:', movieResult);
        
        // Overseerr response format
        const result = {
            available: movieResult.media?.status === 'available',
            requested: movieResult.requested || movieResult.status === 'approved' || movieResult.status === 'pending',
            approved: movieResult.status === 'approved',
            plexUrl: movieResult.media?.mediaUrl || movieResult.media?.plexUrl || null
        };

        console.log('✅ Extracted availability:', result);
        return result;
    }
    
    async fixSessionCookie() {
        try {
            const cookie = await chrome.cookies.get({ url: this.baseUrl, name: 'connect.sid' });
            if (!cookie) {
                console.warn('⚠️ connect.sid cookie not found after auth');
                return;
            }
            // Re-set the cookie without SameSite=Strict so the extension can include
            // it in subsequent cross-origin credentialed requests.
            await chrome.cookies.set({
                url: this.baseUrl,
                name: 'connect.sid',
                value: cookie.value,
                path: cookie.path,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                sameSite: 'no_restriction',
                expirationDate: cookie.expirationDate
            });
            console.log('✅ Session cookie SameSite restriction removed');
        } catch (e) {
            console.error('❌ Failed to fix session cookie:', e);
        }
    }

    async validateAndInitializeWithPlexToken(plexToken) {
        console.log('=== VALIDATING AND INITIALIZING WITH PLEX TOKEN ===');
        console.log('🔍 Validating and initializing with Plex token');
        
        try {
            // Load Plex user info first
            await this.loadPlexUserInfo(plexToken);
            
            // Try to authenticate with Overseerr using Plex token
            const authSuccess = await this.authenticateWithPlex(plexToken);
            
            if (authSuccess) {
                console.log('✅ Successfully authenticated with Overseerr using Plex token');
                return true;
            } else {
                console.log('❌ Failed to authenticate with Overseerr using Plex token');
                return false;
            }
        } catch (error) {
            console.error('❌ Error validating and initializing with Plex token:', error);
            return false;
        }
    }
} 