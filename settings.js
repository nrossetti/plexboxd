document.addEventListener('DOMContentLoaded', () => {
    const addServerButton = document.getElementById('addServer');
    const serverList = document.getElementById('serverList');
    const cacheExpirationInput = document.getElementById('cacheExpiration');
    const saveCacheSettingsButton = document.getElementById('saveCacheSettings');

    // Initialize drag-and-drop
    new Sortable(serverList, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'dragging',
        onEnd: function(evt) {
            getServers(servers => {
                const movedServer = servers.splice(evt.oldIndex, 1)[0];
                servers.splice(evt.newIndex, 0, movedServer);
                saveServers(servers);
            });
        }
    });

    // Load initial data
    loadServers();
    loadCacheSettings();

    // Event Listeners
    addServerButton.addEventListener('click', () => {
        addNewServer();
    });

    saveCacheSettingsButton.addEventListener('click', () => {
        const hours = parseInt(cacheExpirationInput.value);
        if (isNaN(hours) || hours < 1) {
            showToast('Please enter a valid number of hours', 'error');
            return;
        }

        chrome.storage.local.set({ cacheExpiration: hours }, () => {
            showToast('Cache settings saved successfully', 'success');
        });
    });

    function createServerItem(server = { name: '', url: '', apiKey: '' }, index = -1, isNew = true) {
        const serverItem = document.createElement('div');
        serverItem.className = 'server-item' + (isNew ? ' editing' : '');

        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.title = 'Drag to reorder';
        dragHandle.innerHTML = '<i class="fas fa-grip-dots-vertical"></i>';

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

    function loadCacheSettings() {
        chrome.storage.local.get(['cacheExpiration'], (result) => {
            cacheExpirationInput.value = result.cacheExpiration || 24;
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
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }
}); 