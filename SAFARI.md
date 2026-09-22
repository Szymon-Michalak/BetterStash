# BetterStash for Safari

Safari releases are macOS developer builds for Apple Silicon and Intel Macs running macOS 13+
with Safari 16.4+. They use the same extension code and settings as Chrome, stored separately
in each browser. These builds are ad-hoc signed, not Developer ID signed or notarized.

## Install a release

1. Download `better-stash-safari-vX.Y.Z-macos-developer.zip` from Releases and extract it.
2. Move `BetterStash.app` to Applications and open it. If macOS blocks the downloaded developer
   app, use **System Settings → Privacy & Security → Open Anyway** for this app.
3. In Safari's **Settings → Advanced**, enable **Show features for web developers** (called
   **Show Develop menu in menu bar** in older Safari versions).
4. Choose **Develop → Allow Unsigned Extensions**. Newer Safari versions expose this option
   under **Settings → Developer** instead. Safari may require it again after restarting.
5. Enable BetterStash in **Safari → Settings → Extensions**. The BetterStash app also has a
   button that opens Safari's extension settings.
6. Click BetterStash in Safari's toolbar, enter your Bitbucket Server URL, and select
   **Connect site**. Allow access to that site when Safari asks, then reload the dashboard.

If the extension is missing from Safari, launch the containing app once and check that
unsigned extensions are allowed. Do not disable Gatekeeper globally to install it.

## Build locally

Install full Xcode, open it once to finish setup, and select it with `xcode-select` if needed.
From the repository:

```bash
npm ci
npm test
./scripts/package-safari.sh
```

The script stages only extension resources, generates a macOS app with Apple's Safari Web
Extension Converter, builds both CPU architectures, and packages the app with this guide.
The version of the app and extension follows `manifest.json`. Generated Xcode and build files
are temporary; shared JavaScript remains the source of truth.

Chrome keeps its service worker. Safari's generated manifest loads the same background code
as an event page, with `site-config.js` loaded first, and omits Chrome-only options. Both
browsers request access only when a site is connected.

CI builds both browsers on every pull request. Version tags publish both archives only after
both builds and tests succeed. No Apple account or signing secrets are needed for this
developer release path.

For normal distribution, a future release needs an Apple Developer identity, a registered
bundle identifier, and Apple's signing/distribution process. Developer builds do not provide
that installation experience.

References: [running a Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension),
[distribution](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension),
and [browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).
