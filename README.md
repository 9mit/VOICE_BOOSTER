# Volumify: Volume Booster & Sound Equalizer

[![Version](https://img.shields.io/badge/version-1.0.7-blue.svg)](package.json)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-success.svg)](src/manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](package.json)
[![Chrome 116+](https://img.shields.io/badge/Chrome-116%2B-green.svg)](src/manifest.json)
[![Firefox 120+](https://img.shields.io/badge/Firefox-120%2B-orange.svg)](src/manifest.json)

A lightweight, high-performance, and secure browser extension built with **Manifest V3** that allows you to boost the volume of HTML5 video and audio streams up to **500% (+29.5 dB)** with zero audio clipping, distortion-free dialog, and studio-grade sound profiles.

---

## 📺 Supported Platforms

Volumify features an intelligent platform detection engine (`PlatformDetector`) that dynamically optimizes audio capture, player attachment, and SPA navigation handling across streaming services and video players.

### 🎬 Major Streaming & Video-on-Demand (OTT)
| Platform | Domain / Service | Detection & Engine Strategy |
| :--- | :--- | :--- |
| **YouTube** | `youtube.com`, `youtube-nocookie.com` | `MutationObserver` + History API + `yt-navigate-finish` |
| **Netflix** | `netflix.com` | Custom player container tracking & Shaka/React wrapper latch |
| **Amazon Prime Video** | `primevideo.com`, `amazon.*` video pages | WebPlayer renderer container hooks |
| **Disney+** | `disneyplus.com`, `hotstar.com` | BTM media client & Shaka video container observer |
| **JioHotstar / JioCinema** | `jiocinema.com`, `jiohotstar.com` | VideoJS tech & custom player wrapper observer |
| **Max / HBO Max** | `max.com`, `hbomax.com` | React video player container latch |
| **Hulu** | `hulu.com` | Hulu player container tracking |
| **Apple TV+** | `tv.apple.com` | Web player container observer |
| **Peacock** | `peacocktv.com` | Peacock video player hooks |
| **Paramount+** | `paramountplus.com` | Paramount video-js tech hooks |
| **SonyLIV** | `sonyliv.com` | Player-container DOM observer |
| **Zee5** | `zee5.com` | Player-wrapper DOM observer |

### ⛩️ Anime Streaming & Embedded Video Hosts
Full multi-frame iframe injection (`all_frames: true`) ensures embedded players and cross-origin video streams are boosted seamlessly:

* **Crunchyroll** (`crunchyroll.com` / Vilos Player)
* **Funimation** (`funimation.com`)
* **HIDIVE** (`hidive.com`)
* **Bilibili** (`bilibili.com`, `bilibili.tv`)
* **HiAnime** (`hianime.*`)
* **AniWatch / Zoro** (`aniwatch.*`, `zoro.*`)
* **AnimePahe** (`animepahe.*`)
* **AniWave / 9Anime** (`aniwave.*`, `9anime.*`)
* **Gogoanime / Anitaku** (`gogoanime.*`, `anitaku.*`)
* **KickAssAnime** (`kickassanime.*`, `kaas.am`)
* **AnimeFLV** (`animeflv.*`)
* **RetroCrush** (`retrocrush.tv`)
* **Third-Party Video Cloud Hosts**: MegaCloud, RapidCloud, StreamTape, VidCloud, and standard embed players.

### 🎵 Music & Live Streaming
* **Spotify Web Player** (`open.spotify.com`) — Native audio pipeline and now-playing bar hooks.
* **Twitch** (`twitch.tv`) — Live stream video player hooks with fast re-attachment on channel switch.

### 🌐 Universal HTML5 & Generic Media Support
* **Any Website with HTML5 Media**: If a website uses standard `<video>` or `<audio>` elements, Volumify's generic engine automatically detects and hooks into the media element.
* **Nested & Cross-Origin Iframes**: Multi-frame injection hooks into player iframes on blogs, news portals, and social media sites.

### 💻 Supported Browsers
* **Google Chrome** (v116+ recommended, Manifest V3)
* **Microsoft Edge** (Chromium-based)
* **Brave Browser**
* **Opera & Opera GX**
* **Vivaldi**
* **Mozilla Firefox** (v120.0+, Gecko Manifest V3)

---

## 🚀 Key Features

* **Zero-Distortion Gain Engine**: Combines logarithmic decibel polynomial curve scaling with Chromium makeup gain neutralization to eliminate low-frequency "farting" distortion.
* **VLC Overdrive & Dolby Dialogue DRC**: Employs continuous $C^1$ Hermite soft-saturation and dynamic profile-aware headroom compensation to prevent vocal breaking and raspy audio at 500% volume.
* **5 Dynamic Sound Profiles**:
  * 📻 **Bypass / Flat**: Direct transparent wire-pass
  * 🎙️ **Vocals**: Dialogue clarity boost with Dolby Dynamic Range Control
  * 🎧 **Bass**: Deep theatrical sub-bass punch
  * 🎬 **Cinema**: Wide dynamic range expansion for movies
  * 🌙 **Night**: Controlled dynamic range for quiet late-night listening
* **SPA & Framework Native**: Employs an asynchronous `MutationObserver` and History API patcher to safely latch onto videos in modern Single Page Applications without page reloads.
* **Memory Safe**: Utilizes `WeakMap` object associations to ensure disconnected `HTMLMediaElement` nodes are cleanly garbage-collected.
* **Multi-Tab State Synchronization**: Real-time reactive bridge ensures sound profile and volume adjustments synchronize instantly across all open streaming tabs.

---

## 📦 Distribution ZIP & Installation

### Option 1: Install from Pre-Built ZIP (`v1.0.7`)
The root directory includes the latest pre-packaged, production-ready extension package:
📁 **[`volumify-volume-booster.zip`](./volumify-volume-booster.zip)** (Version 1.0.7)

1. Download or clone this repository to obtain **`volumify-volume-booster.zip`**.
2. Extract `volumify-volume-booster.zip` into a local directory of your choice.
3. Open your browser and navigate to:
   * Chrome: `chrome://extensions/`
   * Edge: `edge://extensions/`
   * Brave: `brave://extensions/`
4. Toggle on **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the extracted folder (containing `manifest.json`).

### Option 2: Load Unpacked Source Directory
You can also load the source code directly without unzipping:
1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose the **`src/`** directory of this repository.

### Option 3: Building / Re-packaging the ZIP from Source
To create or update the distribution ZIP file:
```bash
# Verify syntax across all scripts
npm run check

# Audit assets and generate a fresh distribution ZIP (volumify-volume-booster.zip)
npm run build:zip
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>U</kbd> *(Windows / Linux)* | Global toggle booster On / Off |
| <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>U</kbd> *(macOS)* | Global toggle booster On / Off |

Shortcuts can be customized at any time by navigating to `chrome://extensions/shortcuts`.

---

## 🔒 Security & Privacy

* **100% Client-Side Processing**: All audio digital signal processing occurs locally in memory using the browser's Web Audio API.
* **Zero External Requests**: The extension makes zero remote network calls, tracks zero analytics, and uses zero third-party telemetry.
* **Strict Content Security Policy**: Enforces `script-src 'self'` with zero `eval()` or remote script execution.
* **Targeted Audio Processing**: Scoped strictly to HTML5 audio/video elements and user-initiated tab capture sessions.

---

## 📝 Version History

* **v1.0.7 (Current)**:
  * Packaged updated manifest version for Chrome Web Store distribution.
  * Cleaned up redundant development and testing artifacts.
* **v1.0.6**:
  * Expanded platform coverage to include 12+ anime streaming portals (HiAnime, Zoro/AniWatch, AnimePahe, AniWave, Gogoanime, KickAssAnime, Bilibili) and embedded iframe players.
  * Added Dolby Dialogue DRC and profile-aware headroom compensation to eliminate vocal breaking at 500% boost.
  * Enabled multi-frame injection (`all_frames: true`) with collision guards.
  * Bundled updated production zip package (`volumify-volume-booster.zip`).
* **v1.0.5**:
  * Integrated anti-burst soft-clipper, spatial widener, and Spotify Web Player support.
  * Added automated verification test suite.
* **v1.0.4**:
  * Renamed to Volumify with 5 dynamic sound presets and brickwall limiter protection.
