# Privacy Policy — Universal Volume Booster

**Last updated:** June 10, 2026

## Overview

Universal Volume Booster is a browser extension that enhances the audio volume of HTML5 video and audio streams on supported streaming platforms. This extension is committed to protecting your privacy.

## Data Collection

**This extension does not collect, transmit, or store any personal data.**

Specifically:
- **No personal information** is collected, processed, or shared.
- **No browsing history** or URLs are tracked, logged, or transmitted.
- **No analytics, telemetry, or usage tracking** of any kind is performed.
- **No network requests** are made by this extension — it operates entirely offline.
- **No remote code** is loaded, fetched, or executed.
- **No cookies** are set or read by this extension.

## Local Storage

The extension uses `chrome.storage.local` to persist **three user preference values only**:

| Key | Type | Purpose |
|-----|------|---------|
| `boostLevel` | Number (1.0–5.0) | The user's selected volume amplification level |
| `isEnabled` | Boolean | Whether the volume booster is currently active |
| `audioProfile` | String | The selected sound EQ profile (e.g., "flat", "cinema", "speech") |

These values:
- Are stored **locally on your device only**.
- Are **never transmitted** to any server, API, or third party.
- Are **never synced** across devices (uses `chrome.storage.local`, not `chrome.storage.sync`).
- Can be cleared at any time by uninstalling the extension.

## Permissions

| Permission | Justification |
|------------|---------------|
| `storage` | Save user preferences (boost level, enabled state, audio profile) locally |
| `alarms` | Keep the background service worker alive for keyboard shortcut responsiveness |
| `scripting` | Programmatically inject content scripts into already-open streaming tabs after extension install/update |
| Host permissions (specific streaming domains) | Required to inject the audio processing engine into video player pages |

**No `<all_urls>` permission is requested.** The extension operates only on explicitly listed streaming domains.

## Third-Party Services

This extension does not integrate with, communicate with, or depend on any third-party services, APIs, or servers.

## Children's Privacy

This extension does not knowingly collect any information from children under the age of 13.

## Changes to This Policy

Any changes to this privacy policy will be reflected in the extension's repository and store listing.

## Contact

If you have questions about this privacy policy, please open an issue in the extension's GitHub repository.
