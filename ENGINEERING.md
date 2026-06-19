# Volumify — Engineering & Architecture Document

This document outlines the technical architecture, digital signal processing (DSP) math, barrier resolutions, and core engineering concepts used to build the **Volumify: Volume Booster & Sound Equalizer** browser extension.

---

## 1. Technology Stack

* **Platform:** Chrome Extension Manifest V3
* **Core Language:** Vanilla JavaScript (ES6+), highly optimized without external frameworks to ensure a zero-latency audio pipeline.
* **Audio Engine:** HTML5 Web Audio API
* **UI/Styles:** Vanilla HTML5 and CSS3 (Content Security Policy compliant, no inline scripts or `@import`).

---

## 2. Core Engineering Concepts

### A. The Digital Signal Processing (DSP) Pipeline
The core of the extension is a linear node graph built using the Web Audio API. When a `<video>` or `<audio>` element is detected, its audio is routed through the following pipeline:

`MediaElementSource` → `6-Band Parametric EQ` → `Compressor` → `Master Gain` → `Limiter` → `Compensator` → `Destination`

1. **6-Band BiquadFilter EQ:** Shapes the frequency response before amplitude changes to prevent muddying the mix.
   * *Bass:* Lowshelf @ 150Hz
   * *Speech:* Peaking @ 2.2kHz
   * *Presence:* Peaking @ 3.2kHz
   * *Clarity:* Highshelf @ 5kHz
   * *De-Esser:* Peaking @ 6.8kHz (negative gain to reduce harsh sibilants)
   * *Treble:* Highshelf @ 7kHz
2. **Master Gain:** Scales the amplitude of the signal.
3. **Brickwall Limiter:** A secondary compressor with extreme settings (`ratio: 20`, `attack: 0.001`) acting as a safety ceiling to prevent hard digital clipping.

### B. Perceptual Gain Curve (Math Technique)
**Barrier:** A naive volume booster simply multiplies the linear audio signal (e.g., `gainNode.gain.value = 5.0`). However, human hearing is logarithmic, not linear. Multiplying by 5 results in a harsh, overly distorted sound that feels uncontrollable.
**Solution:** We mapped the user's linear slider (1.0x to 5.0x) into a Decibel (dB) curve using the following mathematical formulation:
```javascript
// Map linear boost to dB (Max 14dB boost)
const db = (boostLevel - 1.0) * 3.5; 
// Convert dB back to perceptual Web Audio Gain multiplier
const gain = Math.pow(10, db / 20); 
```
This ensures that moving the slider from 100% to 200% feels like a smooth, predictable increase in loudness.

### C. The Undocumented Makeup Gain Barrier (The "Farting" Distortion Fix)
**Barrier:** Early iterations suffered from severe low-frequency tracking distortion ("farting") when pushing the volume. This was isolated to a hidden quirk in the Chromium Web Audio engine: the `DynamicsCompressorNode` automatically applies an undocumented "makeup gain" to compensate for volume lost during compression. When we pushed a boosted signal into it, this hidden gain pushed the signal way past 0dBFS, causing severe digital clipping.

**Solution:** We reverse-engineered the Chromium source code's makeup gain formula and built an inverted `compensatorNode` to perfectly neutralize the hidden gain:
```javascript
// Chromium's internal makeup gain math in dB
const compMakeupDb = -0.5 * threshold * (1.0 - 1.0 / ratio);
const limiterMakeupDb = -0.5 * -1.0 * (1.0 - 1.0 / 20.0);

// Calculate the total unwanted hidden gain
const totalMakeupDb = compMakeupDb + limiterMakeupDb;

// Invert the gain and apply it to our custom Compensator Node
const compensationGain = Math.pow(10, -totalMakeupDb / 20);
compensatorNode.gain.value = compensationGain;
```
This engineering intelligence completely eliminated the distortion, allowing 500% volume boosts while maintaining crystal-clear audio.

---

## 3. Advanced Barrier Handling

### A. Single Page Application (SPA) Resilience
**Barrier:** Modern platforms like YouTube, Netflix, and Prime Video use SPA architectures. The URL changes dynamically, and new `<video>` elements are injected into the DOM without triggering a page reload. A standard Manifest V3 `content-script` only runs on the initial hard load, missing subsequent videos.
**Solution:** We implemented a `MutationObserver` in `spa-navigator.js`. It constantly watches the DOM for newly injected media nodes. When a new `<video>` tag is appended to the document, the observer instantly hooks the DSP pipeline into it.

### B. The `InvalidStateError` Crash
**Barrier:** The Web Audio API throws a fatal `InvalidStateError` if you attempt to call `createMediaElementSource()` twice on the same video element. Because our `MutationObserver` fires rapidly, it risked double-hooking the same video.
**Solution:** We implemented a JavaScript `WeakMap` memory cache. 
```javascript
this.connectedVideos = new WeakMap();
// Before connecting, check if the object reference exists in the WeakMap
if (!this.connectedVideos.has(video)) {
    // Safely connect
}
```
`WeakMap` is highly memory-efficient because it allows the browser's garbage collector to destroy the video reference once the user navigates away, preventing massive memory leaks over long YouTube sessions.

### C. Service Worker Sleep (Manifest V3 Limitations)
**Barrier:** In Manifest V3, Chrome forcefully kills the `background.js` Service Worker after 30 seconds of inactivity. This meant keyboard shortcuts (Alt+Up / Alt+Down) would suddenly stop working after 30 seconds.
**Solution:** We implemented a `chrome.alarms` heartbeat. By setting an alarm to fire every 1 minute, the Service Worker is gently woken up just enough to keep the keyboard listener ports open and responsive without draining the user's laptop battery.

### D. "Extension Context Invalidated" Errors
**Barrier:** When pushing updates to the extension, users with already-open tabs would experience complete UI crashes (`Extension context invalidated`), requiring them to manually refresh the page.
**Solution:** We built a robust "Hot Swap" bridge. 
1. The extension wraps all `chrome.runtime.sendMessage` calls in `try/catch` blocks.
2. We check for the specific `Extension context invalidated` error message.
3. We inject a `window.__audioEngineCleanup()` global destructor. When the extension updates, the new script forces the old orphaned scripts to disconnect their Audio Nodes and die gracefully before spinning up the new version.

---

## 4. Summary
Volumify is not just a volume multiplier. It is a highly robust, memory-safe, zero-latency Digital Signal Processing unit. By combining Web Audio mathematical compensators with aggressive DOM observation and Manifest V3 lifecycle management, it delivers a flawless, distortion-free audio experience on any streaming platform.
