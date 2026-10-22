/**
 * Universal Volume Booster Pro - Popup Control Panel (v3.0 Simplified)
 * 
 * Synchronizes with content script audio engine bi-directionally.
 * Sets theme class modifiers, maps sliders to message actions,
 * and maintains settings persistence.
 */

let activeTabId = null;
let activeFrameId = 0;
let isCapturedTab = false;

const TAB_CAPTURE_PLATFORMS = new Set([
  "netflix", "primevideo", "disneyplus", "jiohotstar", "spotify",
  "twitch", "sonyliv", "zee5", "hulu", "max", "appletv",
  "peacock", "paramount", "crunchyroll", "funimation", "hidive",
  "bilibili", "hianime", "aniwatch", "animepahe", "aniwave",
  "gogoanime", "animeflv", "kickassanime", "retrocrush"
]);

const state = {
  boostLevel: 1.0,
  isEnabled: true,
  audioProfile: "flat",
  isConflictDetected: false,
  hasVideo: false,
  platformId: "generic",
  platformName: "Generic Site"
};

document.addEventListener("DOMContentLoaded", async () => {
  // DOM Cache Queries
  const popupRoot = document.getElementById("popup-root");
  const activeVideoContainer = document.getElementById("state-active-video");
  const noVideoContainer = document.getElementById("state-no-video");
  const deactivatedContainer = document.getElementById("state-deactivated");
  const deactivatedTitle = document.getElementById("deactivated-title");
  const deactivatedSubtitle = document.getElementById("deactivated-subtitle");
  const statusBadge = document.getElementById("status-badge");
  const noVideoSubtitle = document.getElementById("no-video-subtitle");
  
  // Hero Dial Controls
  const dialValueText = document.getElementById("simple-boost-val-text");
  const dialLabelText = document.getElementById("simple-boost-status-label");
  const dialGlow = document.getElementById("simple-booster-glow");
  
  // Primary Gain Slider Controls
  const sliderInput = document.getElementById("simple-boost-slider");
  const sliderPctText = document.getElementById("simple-boost-slider-pct");
  
  // Preset Pills Grid & Profiles Grid
  const presetPillBtns = document.querySelectorAll(".simple-preset-btn");
  const profileSelectorBtns = document.querySelectorAll(".simple-profile-btn");
  
  // Warnings
  const volumeWarning = document.getElementById("simple-volume-warning");
  const conflictWarning = document.getElementById("simple-conflict-warning");
  
  // Footer / Power
  const masterCheckBox = document.getElementById("booster-enable");
  const resetBtn = document.getElementById("simple-reset-btn");
  const powerToggleBtn = document.getElementById("power-toggle-btn");
  const activateBtn = document.getElementById("activate-extension-btn");
  const retryBtn = document.getElementById("retry-btn");

  if (!activeVideoContainer || !sliderInput) {
    return;
  }

  /**
   * Refreshes the visual elements of the Popup based on the current state.
   */
  function renderPopupUI() {
    // 1. Check if video is found
    if (!state.hasVideo) {
      showNoVideoState();
      return;
    }

    const isEn = state.isEnabled;

    if (!isEn) {
      activeVideoContainer.classList.add("hidden");
      noVideoContainer.classList.add("hidden");
      deactivatedContainer.classList.remove("hidden");

      if (deactivatedTitle) deactivatedTitle.textContent = "System Offline";
      if (deactivatedSubtitle) deactivatedSubtitle.textContent = "The audio processing engine is currently disabled.";
      if (activateBtn) activateBtn.classList.remove("hidden");

      if (powerToggleBtn) {
        powerToggleBtn.classList.add("deactivated");
        powerToggleBtn.title = "Activate Volume Booster";
      }

      popupRoot.classList.forEach(cls => {
        if (cls.startsWith('popup-root-theme-')) popupRoot.classList.remove(cls);
      });
      popupRoot.classList.add("popup-root-theme-flat");
      popupRoot.classList.remove("active-mode");

      if (masterCheckBox) {
        masterCheckBox.checked = false;
      }

      if (statusBadge) {
        statusBadge.textContent = "BYPASS";
        statusBadge.className = "status-indicator";
      }

      if (conflictWarning) {
        conflictWarning.classList.add("hidden");
      }
      return;
    }

    activeVideoContainer.classList.remove("hidden");
    noVideoContainer.classList.add("hidden");
    deactivatedContainer.classList.add("hidden");

    if (powerToggleBtn) {
      powerToggleBtn.classList.remove("deactivated");
      powerToggleBtn.title = "Deactivate Volume Booster";
    }

    // 2. Set dynamic theme class on root container
    const activeTheme = state.isEnabled ? state.audioProfile : "flat";
    
    popupRoot.classList.forEach(cls => {
      if (cls.startsWith('popup-root-theme-')) popupRoot.classList.remove(cls);
    });
    popupRoot.classList.add(`popup-root-theme-${activeTheme}`);

    const percentage = Math.round(state.boostLevel * 100);

    // 3. Sync primary displays
    if (dialValueText) dialValueText.textContent = isEn ? `${percentage}%` : "100%";
    if (sliderPctText) sliderPctText.textContent = `${percentage}%`;
    if (sliderInput) {
      sliderInput.value = state.boostLevel;
      if (isEn) {
        popupRoot.classList.add("active-mode");
      } else {
        popupRoot.classList.remove("active-mode");
      }
    }
    if (masterCheckBox) masterCheckBox.checked = state.isEnabled;

    // 4. Highlight preset pills
    presetPillBtns.forEach(btn => {
      const val = parseFloat(btn.getAttribute("data-val"));
      if (state.isEnabled && Math.abs(state.boostLevel - val) < 0.02) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 5. Highlight sound profiles
    const activeProfileMode = state.isEnabled ? state.audioProfile : "flat";

    profileSelectorBtns.forEach(btn => {
      const mode = btn.getAttribute("data-simple-mode");
      if (mode === activeProfileMode) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 6. Update Status indicator badge
    if (statusBadge) {
      if (state.isEnabled) {
        statusBadge.textContent = (state.platformName || "ACTIVE").toUpperCase();
        statusBadge.className = "status-indicator active";
      } else {
        statusBadge.textContent = "BYPASS";
        statusBadge.className = "status-indicator";
      }
    }

    // Dial animations and glows
    if (dialGlow) {
      dialGlow.className = "dial-glow";
      if (isEn) {
        dialGlow.classList.add("active-mode");
      }
    }

    if (isEn) {
      let statusLabel = "Normal";
      let levelClass = "";

      if (state.boostLevel > 3.0) {
        statusLabel = "Extreme Boost";
        levelClass = "danger";
        if (volumeWarning) volumeWarning.classList.remove("hidden");
        if (dialValueText) dialValueText.className = "dial-value danger";
      } else if (state.boostLevel > 1.5) {
        statusLabel = "Medium Boost";
        levelClass = "warning";
        if (volumeWarning) volumeWarning.classList.add("hidden");
        if (dialValueText) dialValueText.className = "dial-value warning";
      } else if (state.boostLevel > 1.0) {
        statusLabel = "Boost Active";
        levelClass = "boosted";
        if (volumeWarning) volumeWarning.classList.add("hidden");
        if (dialValueText) dialValueText.className = "dial-value boosted";
      } else {
        statusLabel = "Normal";
        levelClass = "";
        if (volumeWarning) volumeWarning.classList.add("hidden");
        if (dialValueText) dialValueText.className = "dial-value";
      }

      if (dialLabelText) {
        dialLabelText.textContent = statusLabel;
        dialLabelText.className = `dial-label ${levelClass}`;
      }
    } else {
      if (dialLabelText) {
        dialLabelText.textContent = "Disabled";
        dialLabelText.className = "dial-label disabled";
      }
      if (volumeWarning) volumeWarning.classList.add("hidden");
      if (dialValueText) dialValueText.className = "dial-value disabled";
    }

    if (conflictWarning) {
      if (state.isConflictDetected) conflictWarning.classList.remove("hidden");
      else conflictWarning.classList.add("hidden");
    }
  }

  function showNoVideoState() {
    activeVideoContainer.classList.add("hidden");
    noVideoContainer.classList.remove("hidden");
    deactivatedContainer.classList.add("hidden");

    popupRoot.classList.forEach(cls => {
      if (cls.startsWith('popup-root-theme-')) popupRoot.classList.remove(cls);
    });
    popupRoot.classList.add("popup-root-theme-flat");
    popupRoot.classList.remove("active-mode");

    if (statusBadge) {
      statusBadge.textContent = "OFFLINE";
      statusBadge.className = "status-indicator deactivated";
    }

    if (noVideoSubtitle) {
      noVideoSubtitle.textContent = "Play content on YouTube, Netflix, JioCinema, Prime Video, or Twitch to initiate volume boost processing.";
    }
  }

  /**
   * Whitelisted state keys accepted from content script responses.
   */
  const STATE_KEYS = [
    "boostLevel", "isEnabled", "audioProfile",
    "isConflictDetected", "hasVideo", "platformId", "platformName"
  ];

  function parseStateResponse(data) {
    if (!data) return;
    for (let i = 0; i < STATE_KEYS.length; i++) {
      const key = STATE_KEYS[i];
      if (data[key] !== undefined) {
        if (key === "boostLevel") {
          const val = parseFloat(data[key]);
          state.boostLevel = !isNaN(val) ? Math.min(Math.max(val, 1.0), 5.0) : 1.0;
        } else {
          state[key] = data[key];
        }
      }
    }
    renderPopupUI();
  }

  async function queryActiveTabStatus() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0]) {
        const activeTab = tabs[0];
        activeTabId = activeTab.id;

        // Auto-detect platform from active tab URL immediately
        const detectedPlatform = (typeof window.PlatformDetector !== "undefined" && activeTab.url)
          ? window.PlatformDetector.getDetectedPlatform(activeTab.url)
          : { id: "generic", name: "Generic Site" };

        const isRecognizedPlatform = detectedPlatform.id !== "generic";
        const isAudible = !!activeTab.audible;

        if (isRecognizedPlatform) {
          state.platformId = detectedPlatform.id;
          state.platformName = detectedPlatform.name;
          state.hasVideo = true;
        }

        // Check if background service worker recorded an active media subframe or capture session
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          try {
            const p = chrome.runtime.sendMessage({ action: "getTabMediaStatus", tabId: activeTabId }, (bgStatus) => {
              if (!chrome.runtime.lastError && bgStatus) {
                if (bgStatus.isCaptured) {
                  if (state.platformId === "youtube") {
                    try {
                      chrome.runtime.sendMessage({ action: "stopTabCapture", tabId: activeTabId }, () => {
                        if (chrome.runtime.lastError) {}
                      });
                    } catch (e) {}
                    isCapturedTab = false;
                  } else {
                    isCapturedTab = true;
                    state.hasVideo = true;
                  }
                }
                if (bgStatus.hasVideo) {
                  if (bgStatus.frameId !== undefined) activeFrameId = bgStatus.frameId;
                  parseStateResponse(bgStatus);
                }
              }
            });
            if (p && typeof p.catch === "function") {
              p.catch(() => {});
            }
          } catch (e) {}
        }

        // Read stored user booster preferences
        chrome.storage.local.get([
          "boostLevel", "isEnabled", "audioProfile"
        ], (result) => {
          if (result) {
            const bVal = parseFloat(result.boostLevel);
            state.boostLevel = !isNaN(bVal) ? Math.min(Math.max(bVal, 1.0), 5.0) : 1.0;
            state.isEnabled = result.isEnabled !== undefined ? !!result.isEnabled : true;
            const validProfiles = ["flat", "cinema", "speech", "night", "bass"];
            state.audioProfile = validProfiles.includes(result.audioProfile) ? result.audioProfile : "flat";
          }

          if (isRecognizedPlatform || isAudible || isCapturedTab || state.hasVideo) {
            state.hasVideo = true;
            renderPopupUI();

            // If on a designated capture platform (never YouTube) and booster is active with gain > 1.0, engage tab capture
            if (TAB_CAPTURE_PLATFORMS.has(state.platformId) && state.platformId !== "youtube" && state.isEnabled && state.boostLevel > 1.0) {
              try {
                const p = chrome.runtime.sendMessage({
                  action: "startTabCapture",
                  tabId: activeTabId,
                  settings: {
                    boostLevel: state.boostLevel,
                    isEnabled: state.isEnabled,
                    audioProfile: state.audioProfile
                  }
                }, (res) => {
                  if (!chrome.runtime.lastError && res && res.success) {
                    isCapturedTab = true;
                  }
                });
                if (p && typeof p.catch === "function") {
                  p.catch(() => {});
                }
              } catch (e) {}
            } else if (state.platformId === "youtube" && isCapturedTab) {
              try {
                chrome.runtime.sendMessage({ action: "stopTabCapture", tabId: activeTabId }, () => {
                  if (chrome.runtime.lastError) {}
                });
              } catch (e) {}
              isCapturedTab = false;
            }
          } else {
            showNoVideoState();
          }
        });

        // Query content script (if loaded on tab)
        try {
          const p = chrome.tabs.sendMessage(activeTabId, { action: "getStatus" }, (response) => {
            if (!chrome.runtime.lastError && response && response.hasVideo) {
              activeFrameId = 0;
              parseStateResponse(response);
            } else if (!isRecognizedPlatform && !isAudible && !isCapturedTab && !state.hasVideo) {
              showNoVideoState();
            }
          });
          if (p && typeof p.catch === "function") {
            p.catch(() => {});
          }
        } catch (e) {
          if (!isRecognizedPlatform && !isAudible && !isCapturedTab && !state.hasVideo) {
            showNoVideoState();
          }
        }
      } else {
        showNoVideoState();
      }
    } catch (err) {
      showNoVideoState();
    }
  }

  /**
   * Tracks the last time the popup sent a user-initiated command.
   * statusUpdate messages arriving within 500ms of this are IGNORED
   * to prevent the content script's stale state from overwriting
   * the popup's freshly-set local state (race condition fix).
   */
  let _lastPopupAction = 0;
  const INTERACTION_GUARD_MS = 500;

  function sendActionToTab(action, value, smooth = true) {
    _lastPopupAction = Date.now();

    // Map and persist to local storage so settings apply globally across tabs
    try {
      if (action === "toggleEnable") {
        chrome.storage.local.set({ isEnabled: !!value });
      } else if (action === "setBoost" && typeof value === "number") {
        chrome.storage.local.set({ boostLevel: value });
      } else if (action === "setAudioProfile" || action === "setProfile") {
        chrome.storage.local.set({ audioProfile: value });
      }
    } catch (err) {}

    if (!activeTabId) return;

    const payload = { action, value, smooth };

    // Remap internal action identifiers
    if (action === "setProfile") {
      payload.action = "setAudioProfile";
    }

    // Coordinate with tabCapture offscreen audio engine for DRM, Twitch, and anime iframe players (NEVER YouTube)
    const isTabCapturePlatform = TAB_CAPTURE_PLATFORMS.has(state.platformId) && state.platformId !== "youtube";
    if (isTabCapturePlatform && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        if (state.isEnabled && (state.boostLevel > 1.0 || state.audioProfile !== "flat")) {
          const p = chrome.runtime.sendMessage({
            action: "startTabCapture",
            tabId: activeTabId,
            settings: {
              boostLevel: state.boostLevel,
              isEnabled: state.isEnabled,
              audioProfile: state.audioProfile
            }
          }, (res) => {
            if (!chrome.runtime.lastError && res && res.success) {
              isCapturedTab = true;
            }
          });
          if (p && typeof p.catch === "function") {
            p.catch(() => {});
          }
        } else {
          const p = chrome.runtime.sendMessage({
            action: "updateTabAudioSettings",
            tabId: activeTabId,
            settings: {
              boostLevel: state.boostLevel,
              isEnabled: state.isEnabled,
              audioProfile: state.audioProfile
            }
          }, () => {
            if (chrome.runtime.lastError) {}
          });
          if (p && typeof p.catch === "function") {
            p.catch(() => {});
          }
        }
      } catch (e) {}
    } else if (state.platformId === "youtube" && isCapturedTab) {
      try {
        chrome.runtime.sendMessage({ action: "stopTabCapture", tabId: activeTabId }, () => {
          if (chrome.runtime.lastError) {}
        });
      } catch (e) {}
      isCapturedTab = false;
    }

    try {
      if (activeFrameId !== 0) {
        const p1 = chrome.tabs.sendMessage(activeTabId, payload, { frameId: activeFrameId }, () => {
          if (chrome.runtime.lastError) {}
        });
        if (p1 && typeof p1.catch === "function") {
          p1.catch(() => {});
        }
      }
      const p2 = chrome.tabs.sendMessage(activeTabId, payload, () => {
        if (chrome.runtime.lastError) {}
      });
      if (p2 && typeof p2.catch === "function") {
        p2.catch(() => {});
      }
    } catch (err) {
      // IPC send failed - continue with silent failure
    }
  }

  // Initial tab query
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
    try {
      await queryActiveTabStatus();
    } catch (e) {
      showNoVideoState();
    }
  } else {
    showNoVideoState();
  }

  // Listen for background tab state updates (keyboard shortcuts)
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === "statusUpdate" && message.status) {
        if (Date.now() - _lastPopupAction < INTERACTION_GUARD_MS) {
          return;
        }
        parseStateResponse(message.status);
      }
    });
  }

  // --- Bind Interactive Listeners ---

  // Main Amplification slider
  let sliderRafPending = false;
  sliderInput.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    state.boostLevel = val;
    
    const pctText = `${Math.round(val * 100)}%`;
    if (dialValueText && state.isEnabled) dialValueText.textContent = pctText;
    if (sliderPctText) sliderPctText.textContent = pctText;

    // Update full UI state during drag (dial, warnings, preset highlights)
    renderPopupUI();

    if (!sliderRafPending) {
      sliderRafPending = true;
      requestAnimationFrame(() => {
        sendActionToTab("setBoost", state.boostLevel, true);
        sliderRafPending = false;
      });
    }
  });

  sliderInput.addEventListener("change", (e) => {
    const val = parseFloat(e.target.value);
    state.boostLevel = val;
    sendActionToTab("setBoost", state.boostLevel, false);
  });

  // Master power toggle checkbox
  if (masterCheckBox) {
    masterCheckBox.addEventListener("change", (e) => {
      const en = e.target.checked;
      state.isEnabled = en;
      sendActionToTab("toggleEnable", en);
      renderPopupUI();
    });
  }

  // Header quick power button
  if (powerToggleBtn) {
    powerToggleBtn.addEventListener("click", () => {
      const next = !state.isEnabled;
      state.isEnabled = next;
      sendActionToTab("toggleEnable", next);
      renderPopupUI();
    });
  }

  // Enable button on disabled state
  if (activateBtn) {
    activateBtn.addEventListener("click", () => {
      state.isEnabled = true;
      sendActionToTab("toggleEnable", true);
      renderPopupUI();
    });
  }

  // Preset quick boost selector pills
  presetPillBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const val = parseFloat(btn.getAttribute("data-val"));
      state.boostLevel = val;
      state.isEnabled = true;
      if (masterCheckBox) masterCheckBox.checked = true;

      sendActionToTab("toggleEnable", true);
      sendActionToTab("setBoost", val, false);
      renderPopupUI();
    });
  });

  // Sound Profile selector nodes
  profileSelectorBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-simple-mode");
      state.isEnabled = true;
      state.audioProfile = mode;
      if (masterCheckBox) masterCheckBox.checked = true;

      sendActionToTab("toggleEnable", true);
      sendActionToTab("setProfile", state.audioProfile);

      renderPopupUI();
    });
  });

  // Retry detector scan ("Force Scan")
  if (retryBtn) {
    retryBtn.addEventListener("click", async () => {
      if (activeTabId) {
        try {
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
            const p1 = chrome.runtime.sendMessage({ action: "forceScanTab", tabId: activeTabId }, () => {
              if (chrome.runtime.lastError) {}
            });
            if (p1 && typeof p1.catch === "function") {
              p1.catch(() => {});
            }
          }
          const p2 = chrome.tabs.sendMessage(activeTabId, { action: "forceScan" }, (response) => {
            if (chrome.runtime.lastError || !response) {
              queryActiveTabStatus();
            } else {
              parseStateResponse(response);
            }
          });
          if (p2 && typeof p2.catch === "function") {
            p2.catch(() => {});
          }
          return;
        } catch (e) {}
      }
      await queryActiveTabStatus();
    });
  }

  // Reset settings
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.boostLevel = 1.0;
      state.isEnabled = true;
      state.audioProfile = "flat";

      _lastPopupAction = Date.now();

      // Persist directly to storage so reset works even without active media tab
      try {
        chrome.storage.local.set({
          boostLevel: 1.0,
          isEnabled: true,
          audioProfile: "flat"
        }, () => { if (chrome.runtime.lastError) {} });
      } catch (e) {}

      if (activeTabId) {
        try {
          const resetPayload = {
            action: "resetAll",
            value: {
              boostLevel: 1.0,
              isEnabled: true,
              audioProfile: "flat"
            }
          };
          if (activeFrameId !== 0) {
            const p1 = chrome.tabs.sendMessage(activeTabId, resetPayload, { frameId: activeFrameId }, () => {
              if (chrome.runtime.lastError) {}
            });
            if (p1 && typeof p1.catch === "function") {
              p1.catch(() => {});
            }
          }
          const p2 = chrome.tabs.sendMessage(activeTabId, resetPayload, () => {
            if (chrome.runtime.lastError) {}
          });
          if (p2 && typeof p2.catch === "function") {
            p2.catch(() => {});
          }
        } catch (err) {}
      }
      
      renderPopupUI();
    });
  }

});
