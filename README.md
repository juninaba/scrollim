# Scrollim

Minimal Neovim-style vertical scrolling for Chrome — **only** `gg`, `Shift+G`, `Ctrl+u`, and `Ctrl+d`.

[日本語 README](README.ja.md)

## Keybindings

| Shortcut | Action |
| --- | --- |
| `g` `g` | Scroll to top of page |
| `Shift` + `G` | Scroll to bottom of page |
| `Ctrl` + `u` | Scroll up half a page |
| `Ctrl` + `d` | Scroll down half a page |

## Features

- **Strictly 4 motions**: No link hints, no mode switching, no other keybindings hijacked.
- **Input-safe**: Automatically pauses when typing in `<input>`, `<textarea>`, `<select>`, `contenteditable`, ARIA textboxes, Shadow DOM inputs, or during IME composition.
- **Works on modern SPAs**: Automatically detects inner scrollable panes (e.g., documentation sites, chat apps, modals) when the document body itself isn't scrollable.
- **Fluid or instant scrolling**: Target-accumulating smooth scrolling (feels great when holding or tapping `Ctrl+d` / `Ctrl+u`), instant mode toggle, and automatic `prefers-reduced-motion` support.
- **Per-hostname pause**: Pause or resume Scrollim on any exact hostname (e.g., pausing `example.com` does not pause `www.example.com`) with one click from the toolbar popup.
- **Zero dependencies & privacy-first**: Manifest V3, minimal permissions (`storage`, `activeTab`), no network requests, no telemetry. See [PRIVACY.md](PRIVACY.md).

## Installation

### Load Unpacked (Chrome / Chromium / Brave / Arc / Edge)

1. Clone or download this repository.
2. Open `chrome://extensions` in your browser.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this repository's root directory.

## Development

Zero runtime or build dependencies — plain JavaScript (Manifest V3) and Node.js built-in test runner.

```bash
# Run unit tests (Node.js >= 18)
npm test

# Build Chrome Web Store release archive (dist/scrollim-v<version>.zip)
npm run zip

# Regenerate PNG icons from scripts/generate-icons.py (Python 3 stdlib only)
npm run icons
```

## Notes

- Chrome blocks content scripts on internal browser pages (`chrome://*`) and the Chrome Web Store by design.
- `Ctrl+d` and `Ctrl+u` override Chrome's default Bookmark and View Source shortcuts while Scrollim is active on a page. Use the popup's **Pause** button whenever you want a site excluded.
- When keyboard focus is inside a non-scrollable embedded iframe, scrolling does not cross frame boundaries into the outer page.

## License

[MIT](LICENSE)
