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
  "https://*/*",
  "http://*/*"
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
      // Single query for all patterns
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
    }, 300);

    try {
      const p = chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (chrome.runtime.lastError || !response) {
          resolve(false); // Not loaded
        } else {
          resolve(true); // Already running
        }
      });
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            resolve(false);
          }
        });
      }
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
      target: { tabId: tabId, allFrames: true },
      files: CONTENT_CSS
    });
  } catch (e) {
    // CSS injection failure is non-fatal
  }

  try {
    // Inject JS files in order
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
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
      updateOffscreenSettings(null, { isEnabled: next });
      chrome.tabs.query({ url: STREAMING_PATTERNS }, (tabs) => {
        if (chrome.runtime.lastError || !tabs) return;
        tabs.forEach((tab) => {
          if (!tab.id) return;
          try {
            const p = chrome.tabs.sendMessage(tab.id, { action: "toggleEnable", value: next }, () => {
              if (chrome.runtime.lastError) { /* tab doesn't have content script */ }
            });
            if (p && typeof p.catch === "function") {
              p.catch(() => {});
            }
          } catch (e) { /* tab closed */ }
        });
      });
    });
  });
}

// ─── Offscreen Document & Tab Capture Engine ─────────────────────────────────

const capturedTabs = new Set();

async function ensureOffscreenDocument() {
  if (typeof chrome === "undefined" || !chrome.offscreen) return false;
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    if (existingContexts && existingContexts.length > 0) {
      return true;
    }
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Volumify Audio Engine Tab Audio Enhancement"
    });
    return true;
  } catch (err) {
    if (err && err.message && (
      err.message.includes("Only a single offscreen document may be created") ||
      err.message.includes("already exists")
    )) {
      return true;
    }
    return false;
  }
}

async function startTabCapture(tabId, settings) {
  if (!tabId || typeof chrome === "undefined" || !chrome.tabCapture) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url && (tab.url.includes("youtube.com") || tab.url.includes("youtu.be"))) {
      return false;
    }
  } catch (e) {}
  if (capturedTabs.has(tabId)) {
    updateOffscreenSettings(tabId, settings);
    return true;
  }
  try {
    const ready = await ensureOffscreenDocument();
    if (!ready) return false;

    return new Promise((resolve) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          resolve(false);
          return;
        }

        try {
          const p = chrome.runtime.sendMessage({
            target: "offscreen",
            action: "START_TAB_CAPTURE",
            tabId: tabId,
            streamId: streamId,
            settings: settings || {}
          }, (res) => {
            if (chrome.runtime.lastError) {
              resolve(false);
              return;
            }
            if (res && res.success) {
              capturedTabs.add(tabId);
              resolve(true);
            } else {
              resolve(false);
            }
          });
          if (p && typeof p.catch === "function") {
            p.catch(() => resolve(false));
          }
        } catch (e) {
          resolve(false);
        }
      });
    });
  } catch (err) {
    return false;
  }
}

function stopTabCapture(tabId) {
  if (!tabId) return;
  const wasCaptured = capturedTabs.has(tabId);
  capturedTabs.delete(tabId);
  if (!wasCaptured) {
    return; // Tab was never captured; do not send unneeded message to offscreen
  }
  try {
    const p = chrome.runtime.sendMessage({
      target: "offscreen",
      action: "STOP_TAB_CAPTURE",
      tabId: tabId
    }, () => {
      if (chrome.runtime.lastError) {}
    });
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  } catch (e) {}
}

function updateOffscreenSettings(tabId, settings) {
  if (capturedTabs.size === 0 && !tabId) {
    return;
  }
  if (tabId && !capturedTabs.has(tabId)) {
    return;
  }
  try {
    const p = chrome.runtime.sendMessage({
      target: "offscreen",
      action: "UPDATE_SETTINGS",
      tabId: tabId,
      settings: settings
    }, () => {
      if (chrome.runtime.lastError) {}
    });
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  } catch (e) {}
}

// ─── Multi-frame Media State Tracking & Message Handler ────────────────────────

const tabMediaStates = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "ping") {
    sendResponse({ status: "pong", version: chrome.runtime.getManifest().version });
    return false; // Synchronous response — close channel immediately
  }

  if (message.action === "statusUpdate" || message.action === "videoDetected") {
    if (sender && sender.tab && message.status) {
      if (message.status.hasVideo) {
        tabMediaStates.set(sender.tab.id, {
          ...message.status,
          frameId: sender.frameId || 0
        });
      } else {
        const existing = tabMediaStates.get(sender.tab.id);
        if (existing && existing.frameId === (sender.frameId || 0)) {
          tabMediaStates.delete(sender.tab.id);
        }
      }
    }
    return false;
  }

  if (message.action === "getTabMediaStatus") {
    const tabId = message.tabId;
    const cached = tabMediaStates.get(tabId);
    const isCaptured = capturedTabs.has(tabId);
    sendResponse({
      ...(cached || {}),
      isCaptured: isCaptured
    });
    return false;
  }

  if (message.action === "startTabCapture") {
    startTabCapture(message.tabId, message.settings).then((success) => {
      sendResponse({ success });
    });
    return true; // Async response
  }

  if (message.action === "stopTabCapture") {
    stopTabCapture(message.tabId);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "isTabCaptured") {
    sendResponse({ isCaptured: capturedTabs.has(message.tabId) });
    return false;
  }

  if (message.action === "updateTabAudioSettings") {
    updateOffscreenSettings(message.tabId, message.settings);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "forceScanTab") {
    const tabId = message.tabId;
    if (tabId && chrome.scripting) {
      chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        func: () => {
          if (typeof window.__uvb_scanForVideo === "function") {
            window.__uvb_scanForVideo();
          }
        }
      }).catch(() => {});
    }
    sendResponse({ success: true });
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaStates.delete(tabId);
  stopTabCapture(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabMediaStates.delete(tabId);
    stopTabCapture(tabId);
  }
});

