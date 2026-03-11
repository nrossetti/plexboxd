/**
 * PlexBoxd Content Script
 * 
 * This script runs on Letterboxd pages to extract movie information
 * for use by the popup and background scripts.
 */

// Function to extract movie information from Letterboxd page
function extractMovieInfo() {
    try {
        console.log('Extracting movie info from Letterboxd page...');
        
        let title = '';
        let year = null;
        let tmdbId = null;
        
        // Extract title and year from the page
        const titleElement = document.querySelector('meta[property="og:title"]');
        if (titleElement) {
            // Format is typically "Movie Name (Year) • Letterboxd"
            const titleText = titleElement.getAttribute('content');
            console.log('Raw title from meta tag:', titleText);
            
            // Try to extract clean title and year
            const match = titleText.match(/^(.+?)(?:\s+\((\d{4})\))?\s+(?:[•\-]|&nbsp;)\s+Letterboxd/);
            
            if (match) {
                title = match[1].trim();
                year = match[2] ? parseInt(match[2]) : null;
            } else {
                // Just use whatever we can get
                title = titleText.split('•')[0].trim();
                
                // See if we can extract a year from what we got
                const yearMatch = title.match(/\((\d{4})\)$/);
                if (yearMatch) {
                    // Remove the year from the title
                    title = title.replace(/\s*\(\d{4}\)$/, '').trim();
                    year = parseInt(yearMatch[1]);
                }
            }
        } else {
            // Fallback to h1
            const h1 = document.querySelector('.film-title h1');
            if (h1) {
                const rawTitle = h1.textContent.trim();
                console.log('Raw title from h1:', rawTitle);
                
                // Check for year in parentheses
                const yearMatch = rawTitle.match(/\((\d{4})\)$/);
                if (yearMatch) {
                    // Remove the year from the title
                    title = rawTitle.replace(/\s*\(\d{4}\)$/, '').trim();
                    year = parseInt(yearMatch[1]);
                } else {
                    title = rawTitle;
                }
            }
        }
        
        // Extract year if we didn't get it from the title
        if (!year) {
            // Primary: <span class="releasedate"><a>2026</a></span>
            const releaseDateEl = document.querySelector('span.releasedate a') ||
                                  document.querySelector('.film-header-lockup .number');
            if (releaseDateEl) {
                const yearText = releaseDateEl.textContent.trim();
                if (/^\d{4}$/.test(yearText)) year = parseInt(yearText);
            }
        }
        
        // Try to get TMDB ID from the page data - this is the most reliable method
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        scripts.forEach(script => {
            try {
                // Letterboxd wraps JSON-LD in CDATA comments; strip them before parsing
                const raw = script.textContent.replace(/\/\*\s*<!\[CDATA\[[\s\S]*?\*\//g, '')
                                              .replace(/\/\*\s*\]\]>[\s\S]*?\*\//g, '')
                                              .trim();
                const data = JSON.parse(raw);
                if (data && data.sameAs) {
                    if (Array.isArray(data.sameAs)) {
                        for (const url of data.sameAs) {
                            const tmdbMatch = url.match(/themoviedb\.org\/movie\/(\d+)/);
                            if (tmdbMatch && tmdbMatch[1]) {
                                tmdbId = tmdbMatch[1];
                                console.log('Found TMDB ID in JSON-LD:', tmdbId);
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Error parsing JSON-LD data:', e);
            }
        });
        
        // Fallback for TMDB ID - look for TMDb link in the details sidebar
        if (!tmdbId) {
            const tmdbLink = Array.from(document.querySelectorAll('.sidebar a')).find(a => 
                a.href.includes('themoviedb.org/movie/'));
                
            if (tmdbLink) {
                const tmdbMatch = tmdbLink.href.match(/themoviedb\.org\/movie\/(\d+)/);
                if (tmdbMatch && tmdbMatch[1]) {
                    tmdbId = tmdbMatch[1];
                    console.log('Found TMDB ID in sidebar link:', tmdbId);
                }
            }
        }
        
        // Ensure we have a clean title without any year in parentheses
        title = title.replace(/\s*\(\d{4}\)$/, '').trim();
        
        // Assemble the movie info
        const movieInfo = {
            title: title,
            year: year,
            tmdbId: tmdbId,
            url: window.location.href
        };
        
        console.log('Extracted movie info:', movieInfo);
        return movieInfo;
    } catch (error) {
        console.error('Error extracting movie info:', error);
        return { error: error.message };
    }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script received message:', request);
    
    if (request.action === 'getMovieInfo') {
        try {
            const movieInfo = extractMovieInfo();
            console.log('Sending movie info response:', movieInfo);
            sendResponse(movieInfo);
        } catch (error) {
            console.error('Error processing getMovieInfo request:', error);
            sendResponse({ error: error.message });
        }
        return true; // Keep the message channel open
    }
    
    return true; // Always keep the message channel open
});

// Extract movie info as soon as the page loads
const movieInfo = extractMovieInfo();
// Store it in a global variable that can be accessed from the popup
window.letterboxdMovieInfo = movieInfo;

console.log('PlexBoxd content script loaded'); 