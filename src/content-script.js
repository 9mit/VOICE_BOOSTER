/**
 * Universal Volume Booster - Content Script Orchestrator (v3.0 Simplified)
 * 
 * This is the master bootstrap controller injected into the page.
 * Responsibilities:
 * - Bootstraps the platform detector and sets up site-specific profiles.
 * - Instantiates the core Audio Engine (DSP Web Audio chain) and WeakMap cache.
 * - Bootstraps the SPA Navigator to handle dynamic URL switches and DOM changes.
 * - Establishes bi-directional communication bridge to Toolbar Popup.
 * - Handles keyboard shortcuts (Ctrl+Shift+Up/Down) for volume adjustments.
 * - Initiates a watchdog recovery timer to safely heal audio connections when elements are swapped.
 */

(function bootstrapUniversalBooster() {
  "use strict";

  // Prevent duplicate injections during extension reload
  if (window.__uvb_initialized) {
    if (typeof window.__uvb_cleanup === "function") {
      window.__uvb_cleanup();
    }
  }
  window.__uvb_initialized = true;

  // 1. Initialize Global Orchestration State
  const state = {
    boostLevel: 1.0,
    isEnabled: true,
    audioProfile: "flat",
    
    // UI tracking
    videoElement: null,
    isConflictDetected: false
  };

  // Modules reference pointers
  let platformConfig = null;
  let audioEngine = null;
  let spaNavigator = null;
  let uiController = null;
  let messageBridge = null;
  let watchdogInterval = null;
  let videoScanRetryTimer = null;
  let videoMutationObserver = null;
  let keydownHandler = null;

  let _storagePendingData = null;
  let _storageWriteScheduled = false;

  /**
   * Safe wrapper for chrome.storage.local.set that aggregates writes
   * and limits them to at most once per 250ms to prevent quota exhaustion.
   * @param {Object} data - Key-value pairs to persist.
   */
  function safeStorageSet(data) {
    if (!_storagePendingData) {
      _storagePendingData = {};
    }
    Object.assign(_storagePendingData, data);

    if (_storageWriteScheduled) return;
    _storageWriteScheduled = true;

    setTimeout(function() {
      _storageWriteScheduled = false;
      const dataToWrite = _storagePendingData;
      _storagePendingData = null;

      try {
        chrome.storage.local.set(dataToWrite, function() {
          if (chrome.runtime.lastError) {
            // Storage write error - continue silently
          }
        });
      } catch (err) {
        // Storage write failed - continue silently
      }
    }, 250);
  }

  /**
   * Throttled wrapper for audioEngine.applyAudioEngineSettings().
   * Limits DSP recalculations to at most 30 calls/second to reduce CPU load
   * during rapid slider drags (which fire 60+ input events/sec).
   */
  let _applySettingsScheduled = false;
  function throttledApplySettings() {
    if (!audioEngine) return;
    if (_applySettingsScheduled) return;
    _applySettingsScheduled = true;
    setTimeout(function() {
      _applySettingsScheduled = false;
      if (audioEngine) audioEngine.applyAudioEngineSettings();
    }, 33); // ~30Hz
  }

  /**
   * Loads persisted settings from local storage with comprehensive error handling.
   * @param {Function} callback - Called after settings are loaded or error occurs.
   */
  function loadSettings(callback) {
    try {
      chrome.storage.local.get([
        "boostLevel", "isEnabled", "audioProfile"
      ], function(result) {
        if (chrome.runtime.lastError) {
          if (typeof callback === "function") callback(false);
          return;
        }

        if (result) {
          try {
            if (result.boostLevel !== undefined) state.boostLevel = Math.max(1.0, Math.min(5.0, parseFloat(result.boostLevel)));
            if (result.isEnabled !== undefined) state.isEnabled = !!result.isEnabled;
            if (result.audioProfile !== undefined) {
              const validProfiles = ["flat", "cinema", "speech", "night", "bass"];
              state.audioProfile = validProfiles.includes(result.audioProfile) ? result.audioProfile : "flat";
            }
          } catch (parseErr) {
            // Settings parse error - using defaults
          }
        }
        if (typeof callback === "function") callback(true);
      });
    } catch (err) {
      if (typeof callback === "function") callback(false);
    }
  }

  /**
   * Copies user-saved state onto the audio engine's internal state,
   * without overwriting AudioNode references.
   */
  function syncStateToAudioEngine() {
    if (!audioEngine) return;
    audioEngine.state.boostLevel = state.boostLevel;
    audioEngine.state.isEnabled = state.isEnabled;
    audioEngine.state.audioProfile = state.audioProfile;
  }

  /**
   * Bootstraps the application modules.
   */
  function init() {
    try {
      // Clear any previous boot errors
      try { chrome.storage.local.remove("lastBootError"); } catch (e) {}

      // 1. Detect platform
      platformConfig = window.PlatformDetector.getDetectedPlatform();

      // 2. Instantiate or inherit AudioEngine to preserve graph across extension reloads
      if (window.__uvb_audioEngine) {
        audioEngine = window.__uvb_audioEngine;
      } else {
        audioEngine = new window.AudioEngine();
        window.__uvb_audioEngine = audioEngine;
      }

      // 3. Instantiate MessageBridge (registers chrome.runtime.onMessage listener immediately)
      messageBridge = new window.MessageBridge(state, {
        setBoost: setBoost,
        toggleBooster: toggleBooster,
        setAudioProfile: setAudioProfile,
        getPlatformId: function() { return platformConfig.id; },
        getPlatformName: function() { return platformConfig.name; }
      });

      // 4. Instantiate UIController (toast-only, no floating panel)
      uiController = new window.UIController(platformConfig, state, {
        setBoost: setBoost,
        toggleBooster: toggleBooster
      });

      // 5. Load settings, then sync and scan
      loadSettings(function() {
        syncStateToAudioEngine();

        // 6. Begin scanning for video elements
        scanForVideo();

        // 7. Instantiate SPANavigator for route changes
        spaNavigator = new window.SPANavigator(platformConfig, function() {
          scanForVideo();
        });

        // 8. Bind keyboard shortcuts
        bindKeyboardShortcuts();

        // 9. Start watchdog
        startWatchdogTimer();

        // 10. Start mutation observer to catch dynamically injected video elements
        startVideoMutationObserver();

        // 11. Register cleanup handler for page navigation/tab close
        registerCleanup();
      });

    } catch (err) {
      console.error("[UVB] Critical boot error:", err);
      try {
        chrome.storage.local.set({ lastBootError: (err && (err.stack || err.message)) || String(err) });
      } catch (e) {}
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  function registerCleanup() {
    window.__uvb_cleanup = function() {
      if (watchdogInterval) clearTimeout(watchdogInterval);
      if (videoScanRetryTimer) clearTimeout(videoScanRetryTimer);
      if (videoMutationObserver) videoMutationObserver.disconnect();
      if (spaNavigator && typeof spaNavigator.destroy === "function") spaNavigator.destroy();
      if (uiController && typeof uiController.destroy === "function") uiController.destroy();
      if (messageBridge && typeof messageBridge.destroy === "function") messageBridge.destroy();
      if (keydownHandler) {
        window.removeEventListener("keydown", keydownHandler);
        keydownHandler = null;
      }
      window.removeEventListener("beforeunload", window.__uvb_cleanup);
    };
    window.addEventListener("beforeunload", window.__uvb_cleanup);
  }

  // ─── Video Detection ─────────────────────────────────────────────────────────

  /**
   * Primary video scanning function. Finds video elements, filters for the primary one,
   * and connects the audio graph. If videos exist but are zero-size, retries with backoff.
   */
  function scanForVideo() {
    if (videoScanRetryTimer) {
      clearTimeout(videoScanRetryTimer);
      videoScanRetryTimer = null;
    }
    scanForVideoInternal(0);
  }

  function scanForVideoInternal(attempt) {
    var videoSelector = platformConfig.videoSelector || "video";
    var videos = [];
    try {
      videos = Array.from(document.querySelectorAll(videoSelector));
    } catch (e) {
      videos = Array.from(document.querySelectorAll("video"));
    }

    if (videos.length === 0) {
      if (state.videoElement) {
        state.videoElement = null;
        if (uiController) uiController.removeUI();
        if (messageBridge) messageBridge.syncStateToPopup();
      }
      return;
    }

    var primaryVideo = findPrimaryVideo(videos);

    if (!primaryVideo) {
      return;
    }

    var rect = primaryVideo.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      if (attempt < 10) {
        var delay = Math.min(500 * (attempt + 1), 3000);
        videoScanRetryTimer = setTimeout(function() {
          scanForVideoInternal(attempt + 1);
        }, delay);
      }
      return;
    }

    if (state.videoElement === primaryVideo) {
      return;
    }
    state.videoElement = primaryVideo;

    if (videoMutationObserver) videoMutationObserver.disconnect();

    watchdogMissCount = 0;

    // Connect the Web Audio API graph
    audioEngine.setupAudioGraph(primaryVideo);

    // Sync conflict state back
    state.isConflictDetected = audioEngine.state.isConflictDetected;

    // Sync to popup
    if (messageBridge) messageBridge.syncStateToPopup();
  }

  /**
   * Finds the primary video element from a list of candidates.
   * Filters out YouTube thumbnail/preview videos and selects the largest visible one.
   */
  function findPrimaryVideo(videos) {
    var candidates = videos;

    if (platformConfig.id === "youtube") {
      var filtered = videos.filter(function(vid) {
        return !vid.closest("ytd-video-preview, #inline-preview-player, ytd-thumbnail, #shorts-player");
      });
      if (filtered.length > 0) {
        candidates = filtered;
      }
    }

    var best = null;
    var bestArea = 0;
    candidates.forEach(function(candidate) {
      var r = candidate.getBoundingClientRect();
      var area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = candidate;
      }
    });

    return best || candidates[0];
  }

  /**
   * Watches the DOM for dynamically injected <video> elements.
   */
  var _videoObserverThrottled = false;

  function startVideoMutationObserver() {
    if (videoMutationObserver) {
      videoMutationObserver.disconnect();
    }

    videoMutationObserver = new MutationObserver(function(mutations) {
      if (state.videoElement && document.contains(state.videoElement)) return;

      if (_videoObserverThrottled) return;
      _videoObserverThrottled = true;
      setTimeout(function() { _videoObserverThrottled = false; }, 600);

      var found = false;
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type !== "childList") continue;
        var added = mutation.addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName === "VIDEO") { found = true; break; }
          if (node.childElementCount > 0 && node.querySelector("video")) { found = true; break; }
        }
        if (found) break;
      }

      if (found) {
        setTimeout(function() { scanForVideo(); }, 600);
      }
    });

    videoMutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // ─── Watchdog ─────────────────────────────────────────────────────────────────

  var watchdogMissCount = 0;
  var WATCHDOG_BASE_INTERVAL = 2000;
  var WATCHDOG_BACKOFF_INTERVAL = 5000;
  var WATCHDOG_BACKOFF_THRESHOLD = 10;

  function startWatchdogTimer() {
    if (watchdogInterval) clearTimeout(watchdogInterval);

    function runWatchdog() {
      if (state.videoElement) {
        if (!document.contains(state.videoElement)) {
          state.videoElement = null;
          watchdogMissCount = 0;
          startVideoMutationObserver();
          scanForVideo();
        } else if (audioEngine && typeof audioEngine.validateGraphIntegrity === "function" && !audioEngine.validateGraphIntegrity()) {
          // Audio graph is broken — attempt recovery by re-scanning
          state.videoElement = null;
          scanForVideo();
        }
        watchdogInterval = setTimeout(runWatchdog, WATCHDOG_BASE_INTERVAL);
      } else {
        watchdogMissCount++;
        scanForVideo();

        var nextInterval = watchdogMissCount >= WATCHDOG_BACKOFF_THRESHOLD
          ? WATCHDOG_BACKOFF_INTERVAL
          : WATCHDOG_BASE_INTERVAL;
        watchdogInterval = setTimeout(runWatchdog, nextInterval);
      }
    }

    watchdogInterval = setTimeout(runWatchdog, WATCHDOG_BASE_INTERVAL);
  }

  // ─── User Interactions ────────────────────────────────────────────────────────

  function bindKeyboardShortcuts() {
    keydownHandler = function(e) {
      if (!audioEngine) return;

      // Skip shortcuts when user is typing in editable fields
      var target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }

      if (e.ctrlKey && e.shiftKey && e.code === "ArrowUp") {
        if (!state.isEnabled) toggleBooster(true);
        var nextUp = Math.min(state.boostLevel + 0.1, audioEngine.PARAMS.BOOST_MAX);
        setBoost(nextUp, true);
        uiController.showToast("Boost Up: " + Math.round(nextUp * 100) + "%");
        e.preventDefault();
      }
      
      if (e.ctrlKey && e.shiftKey && e.code === "ArrowDown") {
        var nextDown = Math.max(state.boostLevel - 0.1, audioEngine.PARAMS.BOOST_MIN);
        setBoost(nextDown, true);
        uiController.showToast("Boost Down: " + Math.round(nextDown * 100) + "%");
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", keydownHandler);
  }

  // ─── State Mutation Functions ─────────────────────────────────────────────────

  function setBoost(value, smooth) {
    if (typeof value !== "number" || isNaN(value)) return;
    if (!audioEngine) return;

    var clampedVal = Math.min(Math.max(value, audioEngine.PARAMS.BOOST_MIN), audioEngine.PARAMS.BOOST_MAX);
    state.boostLevel = clampedVal;
    safeStorageSet({ boostLevel: clampedVal });

    audioEngine.state.boostLevel = clampedVal;
    // Direct apply — no throttle. Every boost change must be heard immediately.
    audioEngine.applyAudioEngineSettings();

    if (!smooth && state.isEnabled && uiController) {
      uiController.showToast("Booster Active: " + Math.round(clampedVal * 100) + "%");
    }

    if (messageBridge) messageBridge.syncStateToPopup();
  }

  function toggleBooster(enabled) {
    state.isEnabled = enabled;
    safeStorageSet({ isEnabled: enabled });

    if (!audioEngine) return;
    audioEngine.state.isEnabled = enabled;
    
    // Use instant bypass mode for click-free, near-instantaneous on/off toggle
    if (typeof audioEngine.setBypassMode === 'function') {
      audioEngine.setBypassMode(!enabled);
    } else {
      audioEngine.applyAudioEngineSettings();
    }

    if (uiController) uiController.showToast(enabled ? "Booster Active: " + Math.round(state.boostLevel * 100) + "%" : "Booster Disabled");
    if (messageBridge) messageBridge.syncStateToPopup();
  }

  function setAudioProfile(profile) {
    if (!profile) return;
    state.audioProfile = profile;
    safeStorageSet({ audioProfile: profile });

    if (!audioEngine) return;
    audioEngine.state.audioProfile = profile;
    audioEngine.applyAudioEngineSettings();
    if (messageBridge) messageBridge.syncStateToPopup();
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  init();
})();
