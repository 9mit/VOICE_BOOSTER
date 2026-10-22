/**
 * Universal Volume Booster Pro - Offscreen Audio Host (MV3)
 *
 * Runs inside the offscreen document context to capture decrypted tab audio streams
 * via chrome.tabCapture and route them through the AudioEngine DSP chain (EQ, Compressor,
 * Gain, Headroom Limiter, Dolby Spatial Widener, Anti-Burst Soft-Clipper).
 *
 * Provides 100% universal compatibility on platforms that restrict DOM createMediaElementSource
 * (Netflix, Prime Video, Disney+, Apple TV+, Spotify, Twitch, and cross-origin anime iframes).
 */

(function initOffscreenAudioHost() {
  "use strict";

  // Map of active tab audio sessions: tabId -> { engine, stream, settings }
  const activeSessions = new Map();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== "offscreen") {
      return false;
    }

    switch (message.action) {
      case "START_TAB_CAPTURE": {
        const tabId = message.tabId;
        const streamId = message.streamId;
        const settings = message.settings || { boostLevel: 1.0, isEnabled: true, audioProfile: "flat" };

        if (!tabId || !streamId) {
          sendResponse({ success: false, error: "Missing tabId or streamId" });
          return false;
        }

        // Clean up any existing session for this tab before creating a new one
        if (activeSessions.has(tabId)) {
          const oldSession = activeSessions.get(tabId);
          try {
            if (oldSession.stream) {
              oldSession.stream.getTracks().forEach((track) => track.stop());
            }
            if (oldSession.engine) {
              oldSession.engine.cleanup();
            }
          } catch (e) {}
          activeSessions.delete(tabId);
        }

        navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId
            }
          },
          video: false
        }).then((stream) => {
          const engine = new window.AudioEngine();
          engine.state.boostLevel = typeof settings.boostLevel === "number" ? settings.boostLevel : 1.0;
          engine.state.isEnabled = settings.isEnabled !== undefined ? !!settings.isEnabled : true;
          engine.state.audioProfile = settings.audioProfile || "flat";

          engine.setupAudioStream(stream);

          activeSessions.set(tabId, { engine, stream, settings });

          // Notify background that stream is active
          try {
            const p = chrome.runtime.sendMessage({
              action: "tabCaptureStarted",
              tabId: tabId
            }, () => {
              if (chrome.runtime.lastError) {}
            });
            if (p && typeof p.catch === "function") {
              p.catch(() => {});
            }
          } catch (e) {}

          sendResponse({ success: true, tabId });
        }).catch((err) => {
          console.error("[UVB Offscreen] getUserMedia failed:", err);
          sendResponse({ success: false, error: err.message });
        });

        return true; // Async response
      }

      case "UPDATE_SETTINGS": {
        const tabId = message.tabId;
        const settings = message.settings || {};

        const updateSession = (session) => {
          if (!session || !session.engine) return;
          if (typeof settings.boostLevel === "number") {
            session.engine.state.boostLevel = settings.boostLevel;
          }
          if (settings.isEnabled !== undefined) {
            session.engine.state.isEnabled = !!settings.isEnabled;
            if (typeof session.engine.setBypassMode === "function") {
              session.engine.setBypassMode(!settings.isEnabled);
            }
          }
          if (settings.audioProfile) {
            session.engine.state.audioProfile = settings.audioProfile;
          }
          session.engine.resumeAudioContext();
          session.engine.applyAudioEngineSettings();
        };

        if (tabId && activeSessions.has(tabId)) {
          updateSession(activeSessions.get(tabId));
        } else {
          // If no tabId specified, update all active sessions
          activeSessions.forEach((session) => updateSession(session));
        }

        sendResponse({ success: true });
        return false;
      }

      case "STOP_TAB_CAPTURE": {
        const tabId = message.tabId;
        if (tabId && activeSessions.has(tabId)) {
          const session = activeSessions.get(tabId);
          try {
            if (session.stream) {
              session.stream.getTracks().forEach((track) => track.stop());
            }
            if (session.engine) {
              session.engine.cleanup();
            }
          } catch (e) {}
          activeSessions.delete(tabId);
        } else if (!tabId) {
          // Stop all
          activeSessions.forEach((session) => {
            try {
              if (session.stream) session.stream.getTracks().forEach((track) => track.stop());
              if (session.engine) session.engine.cleanup();
            } catch (e) {}
          });
          activeSessions.clear();
        }

        sendResponse({ success: true });
        return false;
      }

      case "GET_CAPTURE_STATUS": {
        const tabId = message.tabId;
        const isCaptured = tabId ? activeSessions.has(tabId) : activeSessions.size > 0;
        sendResponse({ isCaptured, sessionCount: activeSessions.size });
        return false;
      }

      default:
        return false;
    }
  });

  // Listen for storage changes to synchronize across tabs in real-time
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      activeSessions.forEach((session) => {
        if (!session.engine) return;
        if (changes.boostLevel && changes.boostLevel.newValue !== undefined) {
          session.engine.state.boostLevel = parseFloat(changes.boostLevel.newValue) || 1.0;
        }
        if (changes.isEnabled && changes.isEnabled.newValue !== undefined) {
          session.engine.state.isEnabled = !!changes.isEnabled.newValue;
          if (typeof session.engine.setBypassMode === "function") {
            session.engine.setBypassMode(!changes.isEnabled.newValue);
          }
        }
        if (changes.audioProfile && changes.audioProfile.newValue !== undefined) {
          session.engine.state.audioProfile = changes.audioProfile.newValue;
        }
        session.engine.resumeAudioContext();
        session.engine.applyAudioEngineSettings();
      });
    });
  }

  console.log("[UVB Offscreen] Audio host initialized.");
})();
