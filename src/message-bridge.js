/**
 * Universal Volume Booster Pro - Message Bridge Module (v3.0 Simplified)
 * 
 * Centralizes IPC (Inter-Process Communication) between page content scripts 
 * and the extension's toolbar Popup interface.
 * Implements bi-directional synchronization to ensure both interfaces reflect 
 * the exact same booster states at all times.
 */

class MessageBridge {
  /**
   * @param {Object} state - The orchestrator's state pointer.
   * @param {Object} callbacks - Interaction callback functions (setBoost, toggleBooster, etc.).
   */
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks;
    this.listener = null;
    
    this.init();
  }

  /**
   * Begins runtime message observations.
   */
  init() {
    this.listener = (message, sender, sendResponse) => {
      try {
        // Accept messages from extension context (popup, background) only.
        const isExtensionMessage = sender.id === chrome.runtime.id;

        if (!isExtensionMessage) {
          sendResponse({ success: false, error: "Unauthorized" });
          return true;
        }

        switch (message.action) {
          case "ping":
            sendResponse({ status: "alive" });
            break;

          case "getStatus":
            sendResponse(this.getSerializedStatus());
            break;

          case "setBoost":
            if (typeof message.value === "number") {
              const safeBoost = Math.min(Math.max(message.value, 1.0), 5.0);
              const smooth = message.smooth !== undefined ? !!message.smooth : true;
              this.callbacks.setBoost(safeBoost, smooth);
              sendResponse({ success: true, boostLevel: this.state.boostLevel });
            } else {
              sendResponse({ success: false, error: "Invalid gain level." });
            }
            break;

          case "toggleEnable":
            if (message.value !== undefined) {
              this.callbacks.toggleBooster(!!message.value);
              sendResponse({ success: true, isEnabled: this.state.isEnabled });
            } else {
              sendResponse({ success: false });
            }
            break;

          case "setAudioProfile":
            if (message.value) {
              const validProfiles = ["flat", "cinema", "speech", "night", "bass"];
              if (!validProfiles.includes(message.value)) {
                sendResponse({ success: false, error: "Invalid audio profile." });
                break;
              }
              this.callbacks.setAudioProfile(message.value);
              sendResponse({ success: true, audioProfile: this.state.audioProfile });
            } else {
              sendResponse({ success: false });
            }
            break;

          case "resetAll": {
            if (message.value && typeof message.value === "object") {
              const v = message.value;
              if (typeof v.isEnabled === "boolean") this.callbacks.toggleBooster(v.isEnabled);
              if (typeof v.boostLevel === "number") this.callbacks.setBoost(Math.min(Math.max(v.boostLevel, 1.0), 5.0), false);
              if (v.audioProfile) this.callbacks.setAudioProfile(v.audioProfile);
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: "Invalid reset payload" });
            }
            break;
          }

          default:
            break;
        }
        
        return true;
      } catch (err) {
        try { sendResponse({ success: false, error: "Internal error" }); } catch (e) {}
        return true;
      }
    };

    chrome.runtime.onMessage.addListener(this.listener);
  }

  /**
   * Compiles current orchestrator flags into a plain payload to send to popup.
   * @returns {Object} State payload
   */
  getSerializedStatus() {
    return {
      boostLevel: this.state.boostLevel,
      isEnabled: this.state.isEnabled,
      audioProfile: this.state.audioProfile,
      isConflictDetected: this.state.isConflictDetected,
      hasVideo: !!this.state.videoElement,
      platformId: this.callbacks.getPlatformId(),
      platformName: this.callbacks.getPlatformName()
    };
  }

  /**
   * Broadcasts the current volume booster settings state to the popup.
   */
  syncStateToPopup() {
    try {
      chrome.runtime.sendMessage({
        action: "statusUpdate",
        status: this.getSerializedStatus()
      }, () => {
        // Suppress expected errors if the popup is closed
        if (chrome.runtime.lastError) { /* expected */ }
      });
    } catch (err) {
      // context invalidated or other runtime issues
    }
  }

  /**
   * Clears bindings.
   */
  destroy() {
    if (this.listener) {
      chrome.runtime.onMessage.removeListener(this.listener);
      this.listener = null;
    }
  }
}

// Make globally accessible in content script environment
window.MessageBridge = MessageBridge;
