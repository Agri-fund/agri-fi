# PWA Implementation Guide

AgriFi is now a Progressive Web App (PWA), installable on Android and iOS for a native-like experience.

## Features Implemented

### ✅ Core PWA Features
- **Web App Manifest** (`public/manifest.json`) — Defines app metadata, icons, and display modes
- **Service Worker** (`public/sw.js`) — Handles caching, offline support, and push notifications
- **Install Banner** — Custom prompt shows after 30 seconds of use on compatible browsers
- **Offline Fallback** — Beautiful offline page with auto-retry logic
- **iOS Support** — Apple meta tags for home screen installation

### 📱 Installation

#### Android (Chrome)
1. Open AgriFi in Chrome
2. After 30 seconds, a banner appears with "Install AgriFi"
3. Tap **Install** → app is added to home screen
4. Opens in standalone mode (full-screen, no browser UI)

#### iOS (Safari)
1. Open AgriFi in Safari
2. Tap **Share** → **Add to Home Screen**
3. Tap **Add** to confirm
4. Opens in standalone mode with Agri-Fi branding

## Testing PWA Features

### 1. Service Worker Registration
```bash
# Start dev server
npm run dev

# Open DevTools (F12 → Application → Service Workers)
# Should see /sw.js registered with scope /
```

### 2. Caching Strategy
- **App Shell** (HTML, CSS, JS) cached on first install
- **API calls** use network-first (network preferred, cache fallback)
- **Static assets** (images, fonts) use cache-first strategy

```bash
# DevTools → Application → Cache Storage
# Should see agri-fi-v1 and agri-fi-runtime-v1 caches
```

### 3. Offline Mode
```bash
# DevTools → Network → set throttling
# Disable network completely and reload
# Should see offline.html with "You are Offline" message
```

### 4. Install Prompt
```bash
# DevTools → Console → type:
window.dispatchEvent(new Event('beforeinstallprompt'));
# Should trigger banner manually for testing
```

### 5. Push Notifications (Backend Integration)
```javascript
// After user opts in, get subscription:
const subscription = await serviceWorkerRegistration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
});

// Send subscription to backend to store for later push
```

## Lighthouse PWA Audit

Run automated PWA quality checks:

```bash
# Run Lighthouse audit (requires Chrome/Chromium installed)
npm run test:pwa

# Full report saved to: frontend/lighthouse-report.json
```

**Target Score:** 90+ ✓

Audit checks:
- ✓ Manifest present and valid
- ✓ Service worker registered
- ✓ HTTPS (or localhost)
- ✓ Responsive design
- ✓ Splash screen capable
- ✓ Themed address bar
- ✓ Icons with appropriate sizes
- ✓ Offline capability

## File Structure

```
frontend/
├── public/
│   ├── manifest.json           # PWA metadata
│   ├── sw.js                   # Service worker
│   ├── offline.html            # Offline fallback
│   ├── icon-192.png            # PWA icon (192x192)
│   ├── icon-192-maskable.png   # PWA icon (maskable)
│   ├── icon-512.png            # PWA icon (512x512)
│   └── icon-512-maskable.png   # PWA icon (maskable)
├── src/
│   ├── app/
│   │   └── layout.tsx          # Service worker registration + SW meta tags
│   └── components/
│       └── PWAInstallBanner.tsx # Install prompt UI
├── scripts/
│   └── lighthouse-audit.js     # Lighthouse testing script
└── docs/
    └── PWA_GUIDE.md            # This file
```

## Icon Generation

You need to generate PWA icons. Use an online tool or:

```bash
# Using ImageMagick (if installed)
convert logo.png -resize 192x192 public/icon-192.png
convert logo.png -resize 512x512 public/icon-512.png
```

For maskable icons (with safe zone), use:
- [Maskable.app](https://maskable.app/)
- [PWA Asset Generator](https://www.npmjs.com/package/pwa-asset-generator)

## Troubleshooting

### Service Worker not registering
- Check browser supports SW (all modern browsers do)
- Check HTTPS or localhost only (not http://)
- Clear site data: DevTools → Application → Clear storage

### Install prompt not showing
- Browser must support beforeinstallprompt (Android Chrome, Edge)
- User must have 2+ visits within 24 hours (or trigger manually)
- Must be installable (manifest, SW, icons, HTTPS)

### Offline page not showing
- Check offline.html exists at `public/offline.html`
- Check service worker fetch event handles 'navigate' mode
- Test with DevTools Network → Offline

### Push notifications not working
- Service Worker must be registered
- User must grant notification permission
- Backend must send valid push payload with VAPID key

## Security Considerations

✓ All service worker code is sandboxed  
✓ Manifest does not grant elevated permissions  
✓ Push notifications require user opt-in  
✓ No sensitive data stored in cache  
✓ CSP headers prevent injection attacks  

## References

- [PWA Checklist](https://web.dev/pwa-checklist/)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)
- [Installable Web Apps](https://web.dev/install-criteria/)
