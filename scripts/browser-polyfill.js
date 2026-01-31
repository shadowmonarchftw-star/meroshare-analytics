/* 
 * Browser API Polyfill
 * Makes Chrome extension APIs work in Firefox and Edge
 * Firefox uses 'browser.*' while Chrome/Edge uses 'chrome.*'
 */

// Create a unified API that works across all browsers
if (typeof browser === "undefined") {
    // Chrome and Edge - 'browser' doesn't exist, use 'chrome'
    globalThis.browser = chrome;
} else if (typeof chrome === "undefined") {
    // Firefox - 'chrome' doesn't exist, use 'browser'
    globalThis.chrome = browser;
}

// For Firefox, wrap callback-based APIs to work with both patterns
// Firefox's browser.* APIs return Promises, Chrome's chrome.* use callbacks
// This ensures compatibility when code uses chrome.* with callbacks
