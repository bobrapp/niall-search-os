# Niall Search OS

A private, local-first workspace for a Global Head search. The app never sends messages, posts to LinkedIn, scrapes, applies for roles, or tracks usage. Drafts are copied for a person to send. The existing Python scout is a separate system: paste its plain-text email into **Signal → Import scout digest**.

## Run locally

From this directory, using Node 24 LTS:

```sh
npm ci
npm run dev
```

Open the localhost URL Vite prints. To test the installable build:

```sh
npm run build
npm run preview
```

The service worker is only enabled in the production build. Visit once while online and allow the initial cache to finish before checking offline. Serve the built app at the root of a stable HTTPS origin for cross-device installation; localhost is suitable on the development machine, but plain HTTP on the LAN does not support installation. Keep any hosted origin behind an owner-approved private access control. Nothing has been deployed.

### Optional AI

To run the local proxy, copy `.env.example` to `.env.local` in this directory and set both `ANTHROPIC_API_KEY` and `AI_ACCESS_CODE` there. Generate a separate strong code (for example, `openssl rand -hex 32`), restart Vite, then paste the code into **Tools & Setup → AI drafting access** once per browser. Never enter the Anthropic key in the app. The access code stays in browser storage and is not included in backups. Without either server value the workspace still works and AI is off.

`api/ai.mjs` is a Node serverless endpoint. The same handler is available in Vite dev and preview. Set `ANTHROPIC_MODEL` if you want to use a model other than `claude-sonnet-5-5`. The local commands bind to localhost by default. The proxy never logs keys, submitted facts or responses. Only an explicit AI action transmits drafting facts to Anthropic; the rest of the app works offline. Dictation is optional and the browser may use its own online speech service.

## Deploy on Vercel

After the owner creates or signs into a Vercel Hobby account, select **Add New → Project**, connect GitHub, and import the private `bobrapp/niall-search-os` repository. Use these settings:

| Dashboard field | Value |
| --- | --- |
| Production Branch | `main` |
| Root Directory | `app` |
| Framework Preset | **Vite** |
| Node.js Version | **24.x** |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` |
| Environment Variables | Leave unset to start. To enable AI, set `ANTHROPIC_API_KEY` and `AI_ACCESS_CODE` in Production, then redeploy. Optionally set `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Do not give these variables a `VITE_` prefix. |

A private GitHub repo does **not** make the Vercel production URL private. A public URL serves the app shell; workspace data is stored in each browser. The AI access code protects drafting requests, not access to the app shell. If the shell itself must be private, verify **Settings → Deployment Protection** covers the exact production URL or use an owner-approved private gateway.

For a no-key smoke test, visit `/api/ai` and check for `"enabled": false`. Once configured, a POST without the access code must return `401`. The proxy limits draft payloads to 180 KB and allows at most 20 drafts per minute per running instance; this is not a deployment-wide spending cap. Open the app once online, then disconnect and reopen it from the Home Screen or installed browser app.

## Install on your devices

| Device | Steps |
| --- | --- |
| Mac | Open the HTTPS URL (or local built preview) in Chrome or Edge. Use the install icon in the address bar or **Install Niall Search OS** from the browser's app menu. Open the installed app from Applications or Spotlight. |
| Windows PC | Open the HTTPS URL in Chrome or Edge. Use the address-bar install icon or the browser's **Apps → Install** menu. Open it from Start. |
| iPhone | In Safari, open the HTTPS URL, tap **Share → Add to Home Screen**, and leave **Open as Web App** on if shown. Launch from the Home Screen for standalone mode. |
| iPad | In Safari, open the HTTPS URL, tap **Share → Add to Home Screen**, and leave **Open as Web App** on if shown. Launch from the Home Screen for standalone mode. |

Open the installed app online once. Then switch on airplane mode (or disconnect from Wi-Fi) and reopen it. The workspace and local data should still open; AI is unavailable offline. Browser/origin profiles and installed apps may have separate storage. Export a backup before changing origins, switching devices or clearing site data.

## Capacitor and iOS

On a Mac with Xcode and its iOS SDK installed:

```sh
npm run build
npx cap sync ios
npx cap open ios
```

If the native project is not present, run `npx cap add ios` once first. In Xcode, select an iPhone or iPad simulator and use **Run**. The native shell bundles the web assets and works without the PWA service worker or network. Its local origin has no AI endpoint, so AI is off there; a hosted native AI connection would require an owner-approved private endpoint and authentication. For a later TestFlight build, the owner needs an existing Apple Developer team, a provisioned bundle ID and signing in Xcode; then use **Product → Archive → Distribute App**. This repo does not set up signing, an account, or an App Store listing.

## Data

Data is stored in IndexedDB. **Tools & Setup** exports/imports a JSON backup with `settings`, `targets`, `contacts`, `roles`, `outreach`, `posts`, `interviews`, `board`, `weeks`, `engage`, `firms`, `stories`, `offers` and `refs`. Import replaces the workspace after confirmation, preserving unknown fields. Export contains plain JSON; keep it private. To share between devices today, export on one and import on the other. A future sync implementation plugs in through the workspace store and `SyncProvider` contract; no network sync runs today.

CSV export is available for contacts and outreach. To import a LinkedIn export, select the connections CSV in Setup; imported contacts are marked Warm, matched by company name or alias, and never store the email column. Unknown companies remain unassigned. The initial ten company targets come from the scout's configuration. Remove example data deletes records marked `example: true`.

## Checks

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

Playwright uses Chromium desktop and WebKit iPhone/iPad emulation. It verifies no-key navigation, offline reload of the production shell, live browser installability in Chromium, and a download/import round trip through IndexedDB. The app workflow also pins Lighthouse 11 for its `installable-manifest` audit (the PWA category was removed in Lighthouse 12); browser service-worker and offline checks are in Playwright. Browser emulation does not replace an actual Home Screen install or signed TestFlight test.
