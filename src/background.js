/**
 * Universal Volume Booster — Background Service Worker (MV3)
 *
 * Responsibilities:
 * - Sets default preferences on first install.
 * - On install/update/reload: programmatically injects content scripts into
 *   ALL already-open streaming tabs so users never need to manually refresh.
 * - Listens for keyboard shortcut commands (Ctrl+Shift+U) to toggle globally.
 * - Maintains a keep-alive alarm to prevent the service worker from dying.
 */

// ─── Constants ──────────────────────────────────────────────────────────────────

/**
 * URL match patterns for all supported streaming platforms.
 * Used for both tab queries and scripting injection targets.
 */
const STREAMING_PATTERNS = [
  "https://*.youtube.com/*",
  "https://*.youtube-nocookie.com/*",
  "https://*.netflix.com/*",
  "https://*.jiocinema.com/*",
  "https://*.jiohotstar.com/*",
  "https://*.disneyplus.com/*",
  "https://*.hotstar.com/*",
  "https://*.primevideo.com/*",
  "https://*.amazon.com/gp/video/*",
  "https://*.amazon.com/*/video/*",
  "https://*.amazon.co.uk/gp/video/*",
  "https://*.amazon.co.uk/*/video/*",
  "https://*.amazon.de/gp/video/*",
  "https://*.amazon.de/*/video/*",
  "https://*.amazon.co.jp/gp/video/*",
  "https://*.amazon.co.jp/*/video/*",
  "https://*.amazon.in/gp/video/*",
  "https://*.amazon.in/*/video/*",
  "https://*.sonyliv.com/*",
  "https://*.zee5.com/*",
  "https://*.hulu.com/*",
  "https://*.max.com/*",
  "https://*.hbomax.com/*",
  "https://tv.apple.com/*",
  "https://*.tv.apple.com/*",
  "https://*.peacocktv.com/*",
  "https://*.paramountplus.com/*",
  "https://*.crunchyroll.com/*",
  "https://*.twitch.tv/*"
];

/**
 * Content scripts to inject, in correct dependency order.
 * Must match the order in manifest.json content_scripts.js array.
 */
const CONTENT_SCRIPTS = [
  "platform-detector.js",
  "audio-engine.js",
  "spa-navigator.js",
  "ui-controller.js",
  "message-bridge.js",
  "content-script.js"
];

const CONTENT_CSS = ["content.css"];

// ─── Installation & Auto-Injection ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // Store default settings
    chrome.storage.local.set({
      boostLevel: 1.0,
      isEnabled: true,
      audioProfile: "flat"
    }, () => {
      if (chrome.runtime.lastError) {
        // Storage write failed (e.g. quota exceeded) — defaults will be used at runtime
      }
    });
  } else if (details.reason === "update") {
    // Extension updated - continue with injection
  }

  // Create keep-alive alarm (5 minutes is optimal for service worker persistence)
  chrome.alarms.create("keepAlive", { periodInMinutes: 5 });

  // Inject content scripts into all already-open streaming tabs
  injectIntoExistingTabs();
});

/**
 * Also inject on service worker startup (handles extension reload via chrome://extensions).
 * onStartup fires when Chrome starts OR when the service worker restarts.
 */
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("keepAlive", { periodInMinutes: 5 });
  injectIntoExistingTabs();
});

/**
 * Alarm handler: Keep service worker alive and perform light health checks.
 * Single listener — no duplicates.
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    // Perform light health check
    chrome.storage.local.get(["boostLevel"], () => {
      if (chrome.runtime.lastError) {
        // Storage access failed - continue with silent failure
      }
    });
  }
});

/**
 * Programmatically injects content scripts + CSS into every open tab
 * that matches our streaming URL patterns. This is the key fix for the
 * "OFFLINE after reload" bug — Chrome's declarative content_scripts only
 * run on NEW navigations, not on tabs that were already open.
 */
let _injectionPromise = null;

async function injectIntoExistingTabs() {
  // Promise-based lock: if injection is already in progress, await it rather than skip
  if (_injectionPromise) {
    await _injectionPromise;
    return;
  }

  _injectionPromise = (async () => {
    try {
      // Single query for all patterns — replaces 28 serial queries
      const tabs = await chrome.tabs.query({ url: STREAMING_PATTERNS });
      if (!tabs || tabs.length === 0) return;

      // Fire all tab injections in parallel
      const injectionPromises = [];
      for (const tab of tabs) {
        // Skip chrome:// internal pages, PDF viewer, etc.
        if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) continue;
        injectionPromises.push(injectIntoTab(tab.id));
      }
      await Promise.allSettled(injectionPromises);
    } catch (err) {
      // Tab query failed — this is fine
    }
  })();

  try {
    await _injectionPromise;
  } finally {
    _injectionPromise = null;
  }
}

/**
 * Injects content scripts into a single tab. Guards against double-injection
 * by first checking if the content script is already running via an async ping
 * with a timeout. If content script responds, we skip injection entirely.
 */
async function injectIntoTab(tabId) {
  // Ping with a short timeout to detect if content scripts are already running.
  // The declarative content_scripts may still be loading, so we wait briefly.
  const alreadyRunning = await new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, 300); // Reduced from 800ms — content scripts respond in <50ms if alive

    try {
      chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError || !response) {
          resolve(false); // Not loaded
        } else {
          resolve(true); // Already running
        }
      });
    } catch (e) {
      if (!settled) { settled = true; clearTimeout(timeoutId); resolve(false); }
    }
  });

  if (alreadyRunning) {
    return;
  }

  try {
    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: CONTENT_CSS
    });
  } catch (e) {
    // CSS injection failure is non-fatal
  }

  try {
    // Inject JS files in order
    // Note: injectImmediately omitted for Firefox WebExtension API compatibility
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: CONTENT_SCRIPTS
    });
  } catch (err) {
    // Injection failed - continue with next tab
  }
}

// ─── Global Toggle (Keyboard Shortcut) ──────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-booster") {
    toggleBoosterGlobal();
  }
});

/**
 * Toggles the volume booster on/off across ALL active streaming tabs.
 */
function toggleBoosterGlobal() {
  chrome.storage.local.get(["isEnabled"], (result) => {
    if (chrome.runtime.lastError) return;
    const current = (result && result.isEnabled !== undefined) ? !!result.isEnabled : true;
    const next = !current;

    chrome.storage.local.set({ isEnabled: next }, () => {
      if (chrome.runtime.lastError) return;
      // Single query for all streaming tabs — replaces 28 serial queries
      chrome.tabs.query({ url: STREAMING_PATTERNS }, (tabs) => {
        if (chrome.runtime.lastError || !tabs) return;
        tabs.forEach((tab) => {
          if (!tab.id) return;
          try {
            chrome.tabs.sendMessage(tab.id, { action: "toggleEnable", value: next }, () => {
              if (chrome.runtime.lastError) { /* tab doesn't have content script */ }
            });
          } catch (e) { /* tab closed */ }
        });
      });
    });
  });
}

// ─── Message Handler ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ status: "pong", version: chrome.runtime.getManifest().version });
    return false; // Synchronous response — close channel immediately
  }
  // No async responses needed from background for other message types
  return false;
});
