# turfsides.com files

What turfsides.com (the main domain, its own folder on cPanel) needs so turf share links
(`turfsides.com/FDJV346`) work. Upload once; they only change if the app's signing key changes.

| File | Why |
|---|---|
| `.htaccess` | Sends `turfsides.com/<7-character code>` to the turf page (`api.turfsides.com/t/<code>`) for people without the app. If the folder already has an `.htaccess`, add this block at the top instead of replacing it. |
| `.well-known/assetlinks.json` | Lets Android open these links straight in the TurfSides app (Android App Links). Replace `REPLACE_WITH_SHA256_FINGERPRINT` with the app's signing fingerprint: run `npx eas-cli credentials -p android`, pick the build profile, copy **SHA256 Fingerprint**. When the app is on Google Play, also add the one from Play Console → Release → Setup → App signing. |

Check after uploading:
- `https://turfsides.com/.well-known/assetlinks.json` shows the JSON (no redirect).
- `https://turfsides.com/<a real code>` opens the turf page.

iOS (Universal Links) needs a paid Apple Developer account. Then add
`.well-known/apple-app-site-association` and `ios.associatedDomains` in app.json.
