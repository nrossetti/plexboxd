document.addEventListener('DOMContentLoaded', async () => {
    const addServerButton = document.getElementById('addServer');
    const serverList = document.getElementById('serverList');
    const cacheExpirationInput = document.getElementById('cacheExpiration');
    const saveCacheSettingsButton = document.getElementById('saveCacheSettings');
    const debugMode = document.getElementById('debugMode');

    // Plex Auth Elements
    const plexAuthStatus = document.getElementById('plexAuthStatus');
    const notAuthenticated = plexAuthStatus?.querySelector('.not-authenticated');
    const authenticated = plexAuthStatus?.querySelector('.authenticated');
    const loginButton = document.getElementById('plexLogin');
    const logoutButton = document.getElementById('plexLogout');
    const usernameElement = document.getElementById('plexUsername');
    const avatarElement = document.getElementById('plexUserAvatar');

    // Server Type Elements
    const serverTypeSelect = document.getElementById('serverType');
    const overseerrConfig = document.getElementById('overseerrConfig');
    const ombiConfig = document.getElementById('ombiConfig');
    
    // Overseerr Elements
    const overseerrUrlInput = document.getElementById('overseerrUrl');
    const testOverseerrButton = document.getElementById('testOverseerrConnection');
    const overseerrConnectionStatus = document.getElementById('overseerrConnectionStatus');

    // Ombi Elements
    const ombiUrlInput = document.getElementById('ombiUrl');
    const testOmbiButton = document.getElementById('testOmbiConnection');
    const ombiConnectionStatus = document.getElementById('ombiConnectionStatus');

    // Initialize APIs
    let overseerrApi = null;
    let ombiApi = null;

    // Load saved settings
    async function loadSettings() {
        const settings = await chrome.storage.local.get([
            'serverType', 'overseerrUrl', 'overseerrApiKey', 'ombiUrl', 'ombiApiKey', 
            'cacheExpiration', 'debugMode'
        ]);
        
        // Set server type (default to Overseerr)
        if (settings.serverType) {
            serverTypeSelect.value = settings.serverType;
        } else {
            serverTypeSelect.value = 'overseerr';
        }
        
        // Show/hide appropriate config based on server type
        updateServerConfigVisibility();
        
        // Load Overseerr settings
        if (settings.overseerrUrl) {
            overseerrUrlInput.value = settings.overseerrUrl;
        }
        if (settings.overseerrApiKey) {
            document.getElementById('overseerrApiKey').value = settings.overseerrApiKey;
        }
        
        // Load Ombi settings
        if (settings.ombiUrl) {
            ombiUrlInput.value = settings.ombiUrl;
        }
        if (settings.ombiApiKey) {
            document.getElementById('ombiApiKey').value = settings.ombiApiKey;
        }
        
        if (settings.cacheExpiration) {
            cacheExpirationInput.value = settings.cacheExpiration;
        }
        
        if (settings.debugMode) {
            debugMode.checked = settings.debugMode;
        }

        await updateAuthUI();
    }
    
    // Update server configuration visibility based on selected server type
    function updateServerConfigVisibility() {
        const selectedType = serverTypeSelect.value;
        
        if (selectedType === 'overseerr') {
            overseerrConfig.style.display = 'block';
            ombiConfig.style.display = 'none';
        } else {
            overseerrConfig.style.display = 'none';
            ombiConfig.style.display = 'block';
        }
    }
    
    // Event listener for server type toggle
    serverTypeSelect.addEventListener('change', () => {
        updateServerConfigVisibility();
        saveServerType();
    });

    // Update Authentication UI
    async function updateAuthUI() {
        try {
            const isAuthenticated = await PlexAuth.isAuthenticated();
            
            if (isAuthenticated) {
                const { plexToken } = await chrome.storage.local.get('plexToken');
                const user = await PlexAuth.getUser(plexToken);
                
                usernameElement.textContent = user.username;
                avatarElement.src = user.thumb;
                
                notAuthenticated.style.display = 'none';
                authenticated.style.display = 'block';

                // Try to authenticate with Overseerr if URL is set
                if (overseerrApi) {
                    await testOverseerrConnection();
                }
            } else {
                notAuthenticated.style.display = 'block';
                authenticated.style.display = 'none';
                overseerrConnectionStatus.textContent = 'Not connected';
                overseerrConnectionStatus.className = 'connection-status error';
            }
        } catch (error) {
            console.error('Error updating auth UI:', error);
            showToast('Failed to update authentication status', 'error');
        }
    }

    // Test Overseerr Connection
    async function testOverseerrConnection() {
        try {
            const { plexToken } = await chrome.storage.local.get('plexToken');
            if (!plexToken) {
                throw new Error('No Plex token available');
            }

            overseerrConnectionStatus.textContent = 'Testing connection...';
            overseerrConnectionStatus.className = 'connection-status pending';

            const overseerrToken = await overseerrApi.authenticate(plexToken);
            await chrome.storage.local.set({ overseerrToken });

            overseerrConnectionStatus.textContent = 'Connected';
            overseerrConnectionStatus.className = 'connection-status success';
            showToast('Successfully connected to Overseerr');
        } catch (error) {
            console.error('Overseerr connection error:', error);
            overseerrConnectionStatus.textContent = 'Connection failed';
            overseerrConnectionStatus.className = 'connection-status error';
            showToast('Failed to connect to Overseerr', 'error');
        }
    }

    // Test Overseerr Connection with API Key
    async function testOverseerrApiKeyConnection() {
        try {
            const overseerrUrl = document.getElementById('overseerrUrl').value.trim();
            const overseerrApiKey = document.getElementById('overseerrApiKey').value.trim();
            
            if (!overseerrUrl) {
                overseerrConnectionStatus.textContent = 'Please enter an Overseerr URL';
                overseerrConnectionStatus.className = 'connection-status error';
                showToast('Please enter an Overseerr URL', 'error');
                return;
            }
            
            if (!overseerrApiKey) {
                overseerrConnectionStatus.textContent = 'Please enter an API key';
                overseerrConnectionStatus.className = 'connection-status error';
                showToast('Please enter an API key', 'error');
                return;
            }
            
            overseerrConnectionStatus.textContent = 'Testing connection...';
            overseerrConnectionStatus.className = 'connection-status pending';
            
            // Create a temporary OverseerrIntegration instance for testing
            const testClient = new OverseerrIntegration(overseerrUrl);
            testClient.apiKey = overseerrApiKey;
            
            // Try to verify the API key
            const isValid = await testClient.verifyApiKey();
            
            if (isValid) {
                overseerrConnectionStatus.textContent = 'Connected successfully';
                overseerrConnectionStatus.className = 'connection-status success';
                showToast('Successfully connected to Overseerr using API key');
                
                // Save the settings if successful
                await chrome.storage.local.set({ 
                    overseerrUrl: overseerrUrl,
                    overseerrApiKey: overseerrApiKey 
                });
                
                console.log('Settings saved after successful test');
            } else {
                overseerrConnectionStatus.textContent = 'Connection failed - Invalid API key or URL';
                overseerrConnectionStatus.className = 'connection-status error';
                showToast('Failed to connect to Overseerr using API key', 'error');
            }
        } catch (error) {
            console.error('API key test error:', error);
            overseerrConnectionStatus.textContent = 'Connection failed: ' + (error.message || 'Unknown error');
            overseerrConnectionStatus.className = 'connection-status error';
            showToast(`Failed to connect to Overseerr: ${error.message}`, 'error');
        }
    }
    
    // Test Ombi Connection with API Key
    async function testOmbiApiKeyConnection() {
        try {
            const ombiUrl = document.getElementById('ombiUrl').value.trim();
            const ombiApiKey = document.getElementById('ombiApiKey').value.trim();
            
            if (!ombiUrl) {
                ombiConnectionStatus.textContent = 'Please enter an Ombi URL';
                ombiConnectionStatus.className = 'connection-status error';
                showToast('Please enter an Ombi URL', 'error');
                return;
            }
            
            if (!ombiApiKey) {
                ombiConnectionStatus.textContent = 'Please enter an API key';
                ombiConnectionStatus.className = 'connection-status error';
                showToast('Please enter an API key', 'error');
                return;
            }
            
            ombiConnectionStatus.textContent = 'Testing connection...';
            ombiConnectionStatus.className = 'connection-status pending';
            
            // Create a temporary OmbiIntegration instance for testing
            const testClient = new OmbiIntegration(ombiUrl);
            testClient.apiKey = ombiApiKey;
            
            // Try to verify the API key
            const isValid = await testClient.verifyApiKey();
            
            if (isValid) {
                ombiConnectionStatus.textContent = 'Connected successfully';
                ombiConnectionStatus.className = 'connection-status success';
                showToast('Successfully connected to Ombi using API key');
                
                // Save the settings if successful
                await chrome.storage.local.set({ 
                    ombiUrl: ombiUrl,
                    ombiApiKey: ombiApiKey 
                });
                
                console.log('Settings saved after successful test');
            } else {
                ombiConnectionStatus.textContent = 'Connection failed - Invalid API key or URL';
                ombiConnectionStatus.className = 'connection-status error';
                showToast('Failed to connect to Ombi using API key', 'error');
            }
        } catch (error) {
            console.error('API key test error:', error);
            ombiConnectionStatus.textContent = 'Connection failed: ' + (error.message || 'Unknown error');
            ombiConnectionStatus.className = 'connection-status error';
            showToast(`Failed to connect to Ombi: ${error.message}`, 'error');
        }
    }

    // Event Listeners
    loginButton.addEventListener('click', async () => {
        try {
            await PlexAuth.login();
            await updateAuthUI();
            showToast('Successfully connected to Plex');
        } catch (error) {
            console.error('Login error:', error);
            showToast('Failed to connect to Plex', 'error');
        }
    });

    logoutButton.addEventListener('click', async () => {
        try {
            await PlexAuth.logout();
            await chrome.storage.local.remove('overseerrToken');
            await updateAuthUI();
            showToast('Disconnected from Plex');
        } catch (error) {
            console.error('Logout error:', error);
            showToast('Failed to disconnect from Plex', 'error');
        }
    });

    overseerrUrlInput.addEventListener('change', saveOverseerrSettings);
    document.getElementById('overseerrApiKey').addEventListener('change', saveOverseerrSettings);
    ombiUrlInput.addEventListener('change', saveOmbiSettings);
    document.getElementById('ombiApiKey').addEventListener('change', saveOmbiSettings);

    testOverseerrButton.addEventListener('click', testOverseerrApiKeyConnection);
    testOmbiButton.addEventListener('click', testOmbiApiKeyConnection);

    saveCacheSettingsButton.addEventListener('click', async () => {
        const hours = parseInt(cacheExpirationInput.value);
        if (hours >= 1 && hours <= 72) {
            await chrome.storage.local.set({ cacheExpiration: hours });
            showToast('Cache settings saved');
        } else {
            showToast('Please enter a value between 1 and 72 hours', 'error');
        }
    });

    debugMode.addEventListener('change', () => {
        chrome.storage.local.set({ debugMode: debugMode.checked });
    });

    // Initialize drag-and-drop
    if (serverList) {
        // We'll add it back when we implement the server management feature
    }

    // Load initial data
    loadServers();
    loadSettings();

    // Event Listeners
    if (addServerButton) {
        addServerButton.addEventListener('click', () => {
            addNewServer();
        });
    }

    function createServerItem(server = { name: '', url: '', apiKey: '' }, index = -1, isNew = true) {
        const serverItem = document.createElement('div');
        serverItem.className = 'server-item' + (isNew ? ' editing' : '');

        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.title = 'Drag to reorder';
        dragHandle.innerHTML = '<i class="fas fa-grip-vertical"></i>';

        const serverContent = document.createElement('div');
        serverContent.className = 'server-content' + (isNew ? '' : ' view-mode');

        if (isNew) {
            // Edit mode
            const serverHeader = document.createElement('div');
            serverHeader.className = 'server-header';

            const nameGroup = document.createElement('div');
            nameGroup.className = 'field-group';
            
            const nameLabel = document.createElement('label');
            nameLabel.textContent = 'Server Name';
            
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.placeholder = 'e.g., Home Server';
            nameInput.value = server.name;

            nameGroup.appendChild(nameLabel);
            nameGroup.appendChild(nameInput);
            serverHeader.appendChild(nameGroup);

            const serverFields = document.createElement('div');
            serverFields.className = 'server-fields';

            const urlGroup = document.createElement('div');
            urlGroup.className = 'field-group';
            
            const urlLabel = document.createElement('label');
            urlLabel.textContent = 'Ombi URL';
            
            const urlInput = document.createElement('input');
            urlInput.type = 'url';
            urlInput.placeholder = 'e.g., http://localhost:5000';
            urlInput.value = server.url;

            urlGroup.appendChild(urlLabel);
            urlGroup.appendChild(urlInput);

            const apiKeyGroup = document.createElement('div');
            apiKeyGroup.className = 'field-group';
            
            const apiKeyLabel = document.createElement('label');
            apiKeyLabel.textContent = 'API Key';

            const apiKeyWrapper = document.createElement('div');
            apiKeyWrapper.className = 'api-key-wrapper';

            const apiKeyInput = document.createElement('input');
            apiKeyInput.type = 'password';
            apiKeyInput.placeholder = 'Your Ombi API key';
            apiKeyInput.value = server.apiKey;

            const togglePassword = document.createElement('button');
            togglePassword.className = 'toggle-password';
            togglePassword.innerHTML = '<i class="fas fa-eye"></i>';
            togglePassword.onclick = () => {
                const type = apiKeyInput.type === 'password' ? 'text' : 'password';
                apiKeyInput.type = type;
                togglePassword.innerHTML = `<i class="fas fa-eye${type === 'password' ? '' : '-slash'}"></i>`;
            };

            apiKeyWrapper.appendChild(apiKeyInput);
            apiKeyWrapper.appendChild(togglePassword);
            
            apiKeyGroup.appendChild(apiKeyLabel);
            apiKeyGroup.appendChild(apiKeyWrapper);

            serverFields.appendChild(urlGroup);
            serverFields.appendChild(apiKeyGroup);

            serverContent.appendChild(serverHeader);
            serverContent.appendChild(serverFields);
        } else {
            // View mode
            const serverName = document.createElement('div');
            serverName.className = 'server-name';
            serverName.textContent = server.name;
            serverContent.appendChild(serverName);
        }

        const actions = document.createElement('div');
        actions.className = 'server-actions';

        if (isNew) {
            const saveButton = document.createElement('button');
            saveButton.className = 'button button-primary';
            saveButton.title = 'Save server';
            saveButton.innerHTML = '<i class="fas fa-save"></i>';
            saveButton.onclick = () => saveServer(serverItem, index);

            const cancelButton = document.createElement('button');
            cancelButton.className = 'button button-danger';
            cancelButton.title = 'Cancel';
            cancelButton.innerHTML = '<i class="fas fa-times"></i>';
            cancelButton.onclick = () => {
                if (index === -1) {
                    serverList.removeChild(serverItem);
                } else {
                    loadServers(); // Reload to original state
                }
            };

            actions.appendChild(saveButton);
            actions.appendChild(cancelButton);
        } else {
            const editButton = document.createElement('button');
            editButton.className = 'button button-edit';
            editButton.title = 'Edit server';
            editButton.innerHTML = '<i class="fas fa-pen"></i>';
            editButton.onclick = () => editServer(index);

            const deleteButton = document.createElement('button');
            deleteButton.className = 'button button-danger';
            deleteButton.title = 'Delete server';
            deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
            deleteButton.onclick = () => deleteServer(index);

            actions.appendChild(editButton);
            actions.appendChild(deleteButton);
        }

        serverItem.appendChild(dragHandle);
        serverItem.appendChild(serverContent);
        serverItem.appendChild(actions);

        return serverItem;
    }

    function addNewServer() {
        const serverItem = createServerItem();
        serverList.insertBefore(serverItem, serverList.firstChild);
        serverItem.querySelector('input').focus();
    }

    function saveServer(serverItem, index) {
        const inputs = serverItem.querySelectorAll('input');
        const name = inputs[0].value.trim();
        const url = inputs[1].value.trim();
        const apiKey = inputs[2].value.trim();

        if (!name || !url || !apiKey) {
            showToast('Please fill in all fields', 'error');
            return;
        }

        getServers(servers => {
            if (index === -1) {
                // New server
                if (servers.some(server => server.name === name)) {
                    showToast('A server with this name already exists', 'error');
                    return;
                }
                servers.unshift({ name, url, apiKey });
            } else {
                // Existing server
                servers[index] = { name, url, apiKey };
            }
            
            saveServers(servers);
            showToast('Server saved successfully', 'success');
        });
    }

    function editServer(index) {
        getServers(servers => {
            const server = servers[index];
            const serverItem = createServerItem(server, index, true);
            const currentItem = serverList.children[index];
            serverList.replaceChild(serverItem, currentItem);
            serverItem.querySelector('input').focus();
        });
    }

    function deleteServer(index) {
        if (!confirm('Are you sure you want to delete this server?')) return;

        getServers(servers => {
            servers.splice(index, 1);
            saveServers(servers);
            showToast('Server deleted successfully', 'success');
        });
    }

    function loadServers() {
        if (!serverList) return;
        getServers(servers => {
            serverList.innerHTML = '';
            
            if (servers.length === 0) {
                const emptyMessage = document.createElement('div');
                emptyMessage.className = 'empty-message';
                emptyMessage.textContent = 'No servers configured';
                serverList.appendChild(emptyMessage);
                return;
            }

            servers.forEach((server, index) => {
                const serverItem = createServerItem(server, index, false);
                serverList.appendChild(serverItem);
            });
        });
    }

    function getServers(callback) {
        chrome.storage.local.get(['servers'], (result) => {
            callback(result.servers || []);
        });
    }

    function saveServers(servers) {
        chrome.storage.local.set({ servers }, () => {
            loadServers();
        });
    }

    function showToast(message, type = '') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.style.display = 'block';
        
        setTimeout(() => {
            toast.style.display = 'none';
        }, 3000);
    }

    function saveServerType() {
        const serverType = serverTypeSelect.value;
        chrome.storage.local.set({ serverType }, () => {
            console.log('Server type saved:', serverType);
        });
    }
    
    function saveOverseerrSettings() {
        const overseerrUrl = document.getElementById('overseerrUrl').value.trim();
        const overseerrApiKey = document.getElementById('overseerrApiKey').value.trim();
        
        console.log('Saving Overseerr settings - URL:', overseerrUrl, 'API key length:', overseerrApiKey?.length || 0);
        
        chrome.storage.local.set({
            overseerrUrl: overseerrUrl,
            overseerrApiKey: overseerrApiKey
        }, () => {
            console.log('Overseerr settings saved successfully');
            showToast('Settings saved', 'success');
        });
    }
    
    function saveOmbiSettings() {
        const ombiUrl = document.getElementById('ombiUrl').value.trim();
        const ombiApiKey = document.getElementById('ombiApiKey').value.trim();
        
        console.log('Saving Ombi settings - URL:', ombiUrl, 'API key length:', ombiApiKey?.length || 0);
        
        chrome.storage.local.set({
            ombiUrl: ombiUrl,
            ombiApiKey: ombiApiKey
        }, () => {
            console.log('Ombi settings saved successfully');
            showToast('Settings saved', 'success');
        });
    }

    const testOverseerrPlexButton = document.getElementById('testOverseerrPlexConnection');
    const overseerrPlexUserInfo = document.getElementById('overseerrPlexUserInfo');
    // Test Overseerr Connection with Plex User
    async function testOverseerrPlexConnection() {
        try {
            const { plexToken } = await chrome.storage.local.get('plexToken');
            if (!plexToken) {
                overseerrConnectionStatus.textContent = 'No Plex token available';
                overseerrConnectionStatus.className = 'connection-status error';
                showToast('No Plex token available', 'error');
                return;
            }
            const overseerrUrl = overseerrUrlInput.value.trim();
            if (!overseerrUrl) {
                overseerrConnectionStatus.textContent = 'Please enter an Overseerr URL';
                overseerrConnectionStatus.className = 'connection-status error';
                showToast('Please enter an Overseerr URL', 'error');
                return;
            }
            overseerrConnectionStatus.textContent = 'Testing connection...';
            overseerrConnectionStatus.className = 'connection-status pending';
            // Create a temporary OverseerrIntegration instance for testing
            const testClient = new OverseerrIntegration(overseerrUrl);
            // Authenticate with Plex token
            const success = await testClient.validateAndInitializeWithPlexToken(plexToken);
            if (success) {
                // Persist session expiry if "Remember me" is checked
                const rememberMe = document.getElementById('rememberOverseerrSession')?.checked;
                if (rememberMe) {
                    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
                    await chrome.storage.local.set({ overseerrTokenExpiry: expiry });
                } else {
                    await chrome.storage.local.remove('overseerrTokenExpiry');
                }

                overseerrConnectionStatus.textContent = 'Connected as Plex user';
                overseerrConnectionStatus.className = 'connection-status success';
                showToast('Successfully connected to Overseerr as Plex user');
                // Show user info
                const user = testClient.plexUser;
                if (user) {
                    overseerrPlexUserInfo.style.display = 'block';
                    overseerrPlexUserInfo.innerHTML =
                        `<strong>Plex User:</strong><br>` +
                        `Username: ${user.username || user.title}<br>` +
                        `Email: ${user.email || ''}<br>` +
                        `ID: ${user.id || ''}<br>` +
                        (user.thumb ? `<img src="${user.thumb}" style="width:48px;height:48px;border-radius:24px;">` : '');
                } else {
                    overseerrPlexUserInfo.style.display = 'none';
                }
            } else {
                overseerrConnectionStatus.textContent = 'Connection failed (Plex user)';
                overseerrConnectionStatus.className = 'connection-status error';
                overseerrPlexUserInfo.style.display = 'none';
                showToast('Failed to connect to Overseerr as Plex user', 'error');
            }
        } catch (error) {
            console.error('Overseerr Plex user connection error:', error);
            overseerrConnectionStatus.textContent = 'Connection failed (Plex user)';
            overseerrConnectionStatus.className = 'connection-status error';
            overseerrPlexUserInfo.style.display = 'none';
            showToast('Failed to connect to Overseerr as Plex user', 'error');
        }
    }
    // Attach event listener
    testOverseerrPlexButton.addEventListener('click', testOverseerrPlexConnection);
}); 