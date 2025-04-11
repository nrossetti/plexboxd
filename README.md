# PlexBoxd

**PlexBoxd** is a Chrome extension that makes it effortless to check if a movie you're browsing on [Letterboxd](https://letterboxd.com) is available on any of your Plex servers (via Ombi) — and lets you request it with a single click if it's not.

## 🚀 Features

- 🔍 Detects when you're viewing a film on Letterboxd
- ⚡ Instantly checks all your configured Ombi servers
- 🎬 One-click movie requests when content isn’t available
- 🖥️ Works with multiple servers (great for shared libraries)

## 🛠 Setup

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer Mode** (top right).
4. Click **Load unpacked** and select the project folder.
5. Click the extension icon, then **Settings** to add your servers.

### 🧩 Ombi Server Requirements

To connect a server, you'll need:

- The **URL** of your Ombi instance (e.g., `http://localhost:5000`)
- A valid **API Key**

#### Where to find your API key:
1. Open your Ombi web interface.
2. Click your user icon (top right) → **API Key**.
3. Copy the key and paste it into the extension settings.

## 📁 Project Structure

```
├── popup.html       # Main popup UI
├── popup.js         # Handles detection and server interaction
├── settings.html    # Extension settings page
├── settings.js      # Settings and storage logic
├── style.css        # Shared styles
```

## 🔐 Planned Features

- 🔐 **JWT-based request attribution** (top priority)
- 🌐 Support for more movie sites (beyond Letterboxd)
- 🦊 Firefox version

## 📦 Releases

A pre-packaged version of the extension will be available soon under the **Releases** section for easy installation.

## 🤝 Contributing

Got feedback, ideas, or bug reports? Open an issue or submit a pull request.
