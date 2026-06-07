# Universal Volume Booster Pro

A lightweight, powerful, and secure Chrome Extension built with Manifest V3 that allows you to seamlessly boost the volume of HTML5 video and audio streams up to 500% without distortion.

## 🚀 Features
- **Zero-Distortion Gain Engine**: Uses a Web Audio API `DynamicsCompressorNode` as a brickwall limiter at `-1.0 dBFS` to ensure extreme volume boosts never mathematically clip and blow out speakers.
- **Dynamic Sound Profiles**: 
  - 📻 **Bypass**: Direct transparent wire-pass
  - 🎬 **Cinema**: Wide dynamic range for movies
  - 🎙️ **Vocals**: Dialogue clarity boost
  - 🌙 **Night**: Reduced dynamic range for quiet listening
  - 🎧 **Bass**: Deep theatrical sub-bass punch
- **SPA & Framework Native**: Employs a robust `MutationObserver` and History API patcher to safely latch onto videos in modern React/Angular Single Page Apps like YouTube, Netflix, Disney+, and Prime Video.
- **Memory Safe**: Utilizes `WeakMap` object associations to ensure disconnected HTMLMediaElements are perfectly garbage collected.

## 🛠️ Installation (Developer Mode)
1. Clone this repository or download the ZIP.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the directory containing the extension files.

## 🔒 Security & Privacy
This extension requires exactly zero external network requests, zero remote fonts/scripts, and utilizes exactly zero `eval()` calls. It adheres strictly to Manifest V3 security rules with a locked-down Content Security Policy (`script-src 'self'`). It uses explicit host permissions for popular streaming sites, eliminating the need for overly-broad `<all_urls>` permissions.
