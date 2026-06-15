/**
 * Universal Volume Booster Pro - SPA Navigator Module
 * 
 * Intercepts page transitions on modern Single Page Applications (SPAs).
 * Employs a hybrid detection strategy:
 * 1. Monkey-patches history.pushState and history.replaceState.
 * 2. Monitors DOM transitions using a platform-specific MutationObserver.
 * 3. Incorporates a debouncing mechanism to prevent redundant initializations during rapid DOM churn.
 */

class SPANavigator {
  /**
   * @param {Object} platformConfig - The configuration object for the active platform.
   * @param {Function} onNavigationCallback - Callback triggered when a navigation/video state update is detected.
   */
  constructor(platformConfig, onNavigationCallback) {
    this.config = platformConfig;
    this.onNavigation = onNavigationCallback;
    this.observer = null;
    this.debounceTimer = null;
    this.lastUrl = window.location.href;
    this._originalPushState = null;
    this._originalReplaceState = null;
    this._popstateHandler = null;
    this._hashchangeHandler = null;
    // Local fallback for container selector — avoids mutating shared config
    this._containerSelectorOverride = null;
    
    this.setupHistoryAPIOverride();
    this.setupEventListeners();
    this.setupContainerObserver();
  }

  /**
   * Overrides History API methods (pushState / replaceState) to catch SPA transitions.
   */
  setupHistoryAPIOverride() {
    try {
      if (window.history.pushState.__uvbPatched) return;
      const self = this;
      
      // Store originals for cleanup
      this._originalPushState = history.pushState;
      this._originalReplaceState = history.replaceState;

      // Patch pushState
      const originalPushState = history.pushState;
      history.pushState = function(...args) {
        originalPushState.apply(this, args);
        self.handleUrlChange("pushState");
      };
      history.pushState.__uvbPatched = true;

      // Patch replaceState (with separate guard)
      if (!history.replaceState.__uvbPatched) {
        const originalReplaceState = history.replaceState;
        history.replaceState = function(...args) {
          originalReplaceState.apply(this, args);
          self.handleUrlChange("replaceState");
        };
        history.replaceState.__uvbPatched = true;
      }
    } catch (err) {
      // History API override failed, relying on DOM observers
    }
  }

  /**
   * Attaches listeners for standard browser popstate and hashchange navigation actions.
   */
  setupEventListeners() {
    this._popstateHandler = () => this.handleUrlChange("popstate");
    this._hashchangeHandler = () => this.handleUrlChange("hashchange");
    window.addEventListener("popstate", this._popstateHandler);
    window.addEventListener("hashchange", this._hashchangeHandler);
  }

  /**
   * Monitors the platform's primary container for critical player elements or child shifts.
   */
  setupContainerObserver() {
    this.disconnectObserver();

    const selector = this._containerSelectorOverride || this.config.containerSelector || "body";
    const container = document.querySelector(selector);

    if (!container) {
      this.containerRetryCount = (this.containerRetryCount || 0) + 1;
      if (this.containerRetryCount > 10) {
        // Use local override instead of mutating the shared config object
        this._containerSelectorOverride = "body";
        this.containerRetryCount = 0;
        this.setupContainerObserver();
        return;
      }
      // If container isn't ready, wait and try to reconnect
      setTimeout(() => this.setupContainerObserver(), 1000);
      return;
    }
    this.containerRetryCount = 0;

    // Initialize MutationObserver with throttle to protect video playback framerate.
    // On YouTube, the observed containers (#movie_player, ytd-app) mutate hundreds of
    // times per second during playback. Without throttling, each mutation runs
    // node.matches() and querySelector() which forces layout recalculations.
    let _spaObserverThrottled = false;

    this.observer = new MutationObserver((mutations) => {
      // Throttle: skip if we already processed mutations within 800ms
      if (_spaObserverThrottled) return;

      let shouldTrigger = false;
      const videoSelector = this.config.videoSelector || "video";

      for (const mutation of mutations) {
        // Look for addition/removal of nodes
        if (mutation.type === "childList") {
          const added = mutation.addedNodes;
          for (let i = 0; i < added.length; i++) {
            const node = added[i];
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            // Fast tag check first, expensive querySelector only for containers
            if (node.tagName === "VIDEO" || (node.childElementCount > 0 && node.querySelector(videoSelector))) {
              shouldTrigger = true;
              break;
            }
          }
          if (shouldTrigger) break;
        }
      }

      if (shouldTrigger) {
        _spaObserverThrottled = true;
        setTimeout(() => { _spaObserverThrottled = false; }, 800);
        this.debounceTrigger("mutation-observer");
      }
    });

    try {
      this.observer.observe(container, {
        childList: true,
        subtree: true
      });
    } catch (err) {
      // MutationObserver observation failed
    }
  }

  /**
   * Tracks URL changes and compares against last known URL.
   * @param {string} source - The system action initiating the URL inspection.
   */
  handleUrlChange(source) {
    const currentUrl = window.location.href;
    if (currentUrl !== this.lastUrl) {
      this.lastUrl = currentUrl;
      this.debounceTrigger("url-change");
    }
  }

  /**
   * Debounces transition triggers to let dynamic scripts inject media frames before scanning.
   * @param {string} triggerSource - Source initiating the re-initialization.
   */
  debounceTrigger(triggerSource) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const delay = this.config.reinitDelay || 1000;
    this.debounceTimer = setTimeout(() => {
      this.onNavigation();
    }, delay);
  }

  /**
   * Cleans up running loops, timers, and observer connections.
   */
  disconnectObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Re-evaluates container observation when platform configuration updates.
   * @param {Object} newConfig - The newly loaded platform configuration.
   */
  updateConfig(newConfig) {
    this.config = newConfig;
    this.setupContainerObserver();
  }

  /**
   * Fully cleans up state event listeners.
   */
  destroy() {
    this.disconnectObserver();
    // Remove stored event listeners
    if (this._popstateHandler) {
      window.removeEventListener("popstate", this._popstateHandler);
      this._popstateHandler = null;
    }
    if (this._hashchangeHandler) {
      window.removeEventListener("hashchange", this._hashchangeHandler);
      this._hashchangeHandler = null;
    }
    // Restore original History API methods if we patched them
    if (this._originalPushState) {
      try { history.pushState = this._originalPushState; } catch (e) {}
    }
    if (this._originalReplaceState) {
      try { history.replaceState = this._originalReplaceState; } catch (e) {}
    }
    this.onNavigation = () => {};
  }
}

// Make globally accessible in content script environment
window.SPANavigator = SPANavigator;
