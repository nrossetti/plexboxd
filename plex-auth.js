const PlexAuth = {
    clientId: 'PlexBoxd',
    plexUrl: 'https://app.plex.tv/auth/#!',

    async login() {
        const headers = {
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': this.clientId,
            'X-Plex-Product': 'PlexBoxd',
            'X-Plex-Version': '1.0.0',
            'X-Plex-Platform': 'Chrome',
            'X-Plex-Platform-Version': chrome.runtime.getManifest().version,
            'X-Plex-Device': 'Chrome Extension',
            'X-Plex-Device-Name': 'PlexBoxd Extension'
        };

        try {
            // Step 1: Get the pin
            const pinResponse = await fetch('https://plex.tv/api/v2/pins?strong=true', {
                method: 'POST',
                headers: headers
            });

            if (!pinResponse.ok) {
                throw new Error(`Failed to get PIN: ${pinResponse.status}`);
            }

            const pinData = await pinResponse.json();
            const { id, code } = pinData;

            // Step 2: Build auth URL
            const authUrl = new URL(this.plexUrl);
            const params = new URLSearchParams({
                'clientID': this.clientId,
                'code': code,
                'context[device][product]': 'PlexBoxd',
                'context[device][environment]': 'bundled',
                'context[device][layout]': 'desktop',
                'context[device][platform]': 'Chrome',
                'context[device][device]': 'Chrome Extension'
            });
            
            const finalUrl = `${authUrl.toString()}?${params.toString()}`;
            console.log('Opening auth URL:', finalUrl);

            // Step 3: Send message to background script to handle auth flow
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: "authenticate",
                    authUrl: finalUrl,
                    pinId: id,
                    headers: headers
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Runtime error:', chrome.runtime.lastError);
                        reject(chrome.runtime.lastError);
                        return;
                    }

                    if (response?.error) {
                        console.error('Auth error:', response.error);
                        reject(new Error(response.error));
                        return;
                    }

                    if (response?.token) {
                        // Store the token
                        chrome.storage.local.set({ plexToken: response.token })
                            .then(() => resolve(response.token))
                            .catch(reject);
                    }
                });
            });
        } catch (error) {
            console.error('Plex authentication error:', error);
            throw error;
        }
    },

    async getUser(token) {
        try {
            const response = await fetch('https://plex.tv/api/v2/user', {
                headers: {
                    'Accept': 'application/json',
                    'X-Plex-Token': token,
                    'X-Plex-Client-Identifier': this.clientId
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get user: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error getting user:', error);
            throw error;
        }
    },

    async isAuthenticated() {
        try {
            const { plexToken } = await chrome.storage.local.get('plexToken');
            if (!plexToken) return false;

            const user = await this.getUser(plexToken);
            return !!user;
        } catch (error) {
            console.error('Auth check error:', error);
            return false;
        }
    },

    async logout() {
        try {
            await chrome.storage.local.remove('plexToken');
        } catch (error) {
            console.error('Logout error:', error);
            throw error;
        }
    }
}; 