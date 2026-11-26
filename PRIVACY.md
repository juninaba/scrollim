# Privacy Policy for Scrollim

**Effective date:** 2026-11-26

Scrollim is designed with minimal permissions and zero data collection.

## Data Collection

Scrollim does **not** collect, transmit, sell, or share any personal data, browsing history, keystrokes, or page content.

- No analytics or telemetry
- No external network requests
- No third-party scripts or trackers

## Permissions Used

Scrollim requests only the minimum Chrome extension permissions required for its features:

- **`storage`**: Saves your extension preferences (enabled state, smooth scrolling, scroll distance, and paused site hostnames) via Chrome's built-in `chrome.storage.sync`. If Chrome Sync is enabled in your browser, Chrome synchronizes these preferences across your signed-in devices via your Google account; Scrollim itself makes no external network requests.
- **`activeTab`**: Reads the active tab's hostname **only** when you click the Scrollim toolbar icon, so you can pause or resume Scrollim on the current site.
- **Content script (`<all_urls>`)**: Runs locally in your browser to listen solely for `gg`, `Shift+G`, `Ctrl+u`, and `Ctrl+d` vertical scroll shortcuts on web pages. Key events are never logged or transmitted anywhere.

## Contact

If you have any questions about this privacy policy, please open an issue at [github.com/juninaba/scrollim/issues](https://github.com/juninaba/scrollim/issues).
