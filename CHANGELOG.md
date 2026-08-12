# Changelog

## v0.2.1 — Screenshot reliability

### Fixed

- Prevent PHP diagnostics from being rendered into full-page screenshots.
- Preload and reload WordPress pages before capture so Elementor can finish generating cached icon resources.
- Keep PHP errors in local logs while disabling their direct output into site HTML.

## v0.2.0 — Site content & full-page screenshots

### New

- Open a site details panel directly from its site card.
- Browse the published WordPress pages and posts for each running site.
- Select one or more pages/posts and create full-page PNG screenshots in one action.
- Choose a desktop capture width: 1920px, 1440px, 1280px, 1024px, or a custom width.
- Save capture results in a timestamped `screenshots` folder inside the site directory.

### Improved

- Screenshot capture now scrolls through the page in a real rendered browser window before capture, so lazy-loaded content and viewport-triggered animations can finish naturally.
- Full-page screenshots preserve normal theme layout without overriding theme CSS, including transforms used for positioning.
- Capture waits for sticky headers and scroll-linked elements to settle before generating the final image.

### Fixed

- WordPress content loading now uses query-route REST API fallback for local sites whose `/wp-json/` requests are handled by Caddy rewrites.
