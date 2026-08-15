# Pettagam 🔐

Your family's document locker — land records, IDs, medical & vehicle documents. AI decodes photos into structured data, tracks expiry/freshness, and answers questions grounded on **your** documents. Everything stays on your phone (IndexedDB); nothing leaves except the single image sent to your own AI API for decoding.

## Deploy (GitHub Pages, 2 minutes)

1. Create a repo (e.g. `pettagam`) and push this folder's contents to the root
2. Repo → Settings → Pages → Source: `main` branch, `/ (root)` → Save
3. Open `https://<username>.github.io/pettagam/` on your phone
4. **Add to Home Screen** (Chrome menu / Safari share) — installs as a PWA and greatly improves storage persistence on iOS

## Setup on first run

1. **Settings → AI connection**
   - **Anthropic (Claude)** — works directly from the browser. Paste API key, done.
   - **Azure OpenAI** — Azure OpenAI does **not** send CORS headers, so browser calls are blocked. Front your deployment with APIM and add a CORS policy (below), then use the APIM base URL as Endpoint.
2. Tap **Save & test connection**
3. **Settings → Request persistent storage** (protects data from browser eviction)

### APIM CORS policy for Azure OpenAI

```xml
<inbound>
  <cors allow-credentials="false">
    <allowed-origins>
      <origin>https://<username>.github.io</origin>
    </allowed-origins>
    <allowed-methods><method>POST</method><method>OPTIONS</method></allowed-methods>
    <allowed-headers><header>*</header></allowed-headers>
  </cors>
  <base />
</inbound>
```

## The dynamic schema registry

All document types, their fields, expiry rules, freshness windows, and the land sale-readiness checklist live in **one file**: `schemas/registry.json`.

- Add a new document type → commit the file → tap "Refresh registry" in Settings (or just reload). No code change, no redeploy.
- `role: "expiry"` on a date field → drives expired/expiring status
- `freshnessMonths` on a doc type + a `role: "issue"` date field → drives stale tracking (EC ≤ 6 months, Patta yearly, etc.)
- You can also point the app at a different registry URL in Settings (raw.githubusercontent link) to update schemas without redeploying the app itself

## Storage — why 5MB is not a problem

- Photos & data live in **IndexedDB** (quota = a share of free disk, typically GBs), not localStorage (5MB)
- Every photo is compressed to ~200–400KB before storing (1600px JPEG) with a separate 20KB thumbnail
- `navigator.storage.persist()` is requested to protect against eviction
- **Backup habit**: Settings → Export backup — one JSON file containing everything (images included). Restores on any phone via Import. The app nudges you every 30 days.

## Structure

```
index.html            app shell + tab bar
manifest.json, sw.js  PWA install + offline shell
css/tokens.css        design tokens (the "locker world" palette)
css/app.css           all components & views
js/app.js             router + bootstrap
js/views.js           home · vaults · add/decode · detail · ask · settings
js/db.js              IndexedDB layer
js/schemas.js         registry loader (cached, remote-refreshable)
js/ai.js              image compression + AI decode + chat
js/reminders.js       expiry/freshness engine + .ics export
js/backup.js          export/import
schemas/registry.json THE dynamic brain — doc types + land checklist
```

## Reminders

PWA push is unreliable on mobile, so Pettagam does two things instead:
1. **Attention list** on Home (expired / stale / expiring ≤60 days)
2. **📅 Add reminder to calendar** on any document → downloads an `.ics` with a 14-day-before alarm → your phone's native calendar nags you reliably
