# Responsive frontend and Progressive Web App

## Responsive behavior
The frontend uses responsive layouts for narrow phones, larger phones, tablets, and desktop screens. Interactive controls have touch-friendly minimum heights, form controls avoid mobile browser zoom, long wallet addresses and transaction hashes wrap safely, and the layout respects device safe areas and reduced-motion preferences.

## PWA behavior
- Web app manifest enables standalone installation where supported.
- A service worker registers under the current deployment path, including the GitHub Pages repository subpath.
- The app shell and its referenced same-origin Next.js JavaScript/CSS assets are precached for repeat visits and an offline navigation fallback.
- Cross-origin requests are deliberately excluded from caching. Wallet providers, Sepolia RPC, QR signing, and transactions require a live network connection.
- An install button appears only when the browser emits the supported `beforeinstallprompt` event. On browsers without that event, use the browser's own **Install app** or **Add to Home Screen** menu.

## Hosting
The same PWA assets are served from Vercel at the domain root and GitHub Pages beneath `/Student-Attendance-DApp/`. Service-worker scope and manifest URLs are relative so they follow either deployment path.

## Validation
Playwright checks the manifest and service-worker assets, and checks for horizontal overflow at phone, tablet, and desktop viewport widths. Browser-specific installation prompts and offline behavior should also be manually checked on target Android browsers.
