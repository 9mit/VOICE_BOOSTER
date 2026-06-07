/**
 * Universal Volume Booster Pro - UI Controller Module (Minimal)
 * 
 * Manages ONLY the in-page toast notification overlay.
 * The floating panel has been removed — the toolbar popup is the sole interface.
 * Toast notifications provide feedback for keyboard shortcuts and scroll gestures.
 */

class UIController {
  constructor(platformConfig, state, callbacks) {
    this.config = platformConfig;
    this.state = state;
    this.callbacks = callbacks;

    this.toastElement = null;
    this.toastTimeout = null;
  }

  /**
   * Shows a brief, non-intrusive toast notification over the video player.
   * Toast is lazily created on first use and reused for subsequent calls.
   * @param {string} text - The text to display in the toast.
   */
  showToast(text) {
    // Lazily create the toast element on first use
    if (!this.toastElement || !document.body.contains(this.toastElement)) {
      this.toastElement = document.createElement("div");
      this.toastElement.id = "uvb-inplayer-toast";
      this.toastElement.className = "uvb-inplayer-toast";

      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(`
        <div id="wrapper">
          <svg class="toast-icon" viewBox="0 0 24 24">
            <path d="M18.5 2L12 10.5h4.5L10 22l6.5-8.5H12L18.5 2z"/>
          </svg>
          <span id="uvb-toast-text"></span>
        </div>
      `, "text/html");

      const wrapper = parsedDoc.getElementById("wrapper");
      if (wrapper) {
        while (wrapper.firstChild) {
          this.toastElement.appendChild(wrapper.firstChild);
        }
      }

      // Attach to video player parent for proper positioning, fallback to body
      const parent = this._findToastParent();
      parent.appendChild(this.toastElement);
    }

    const span = this.toastElement.querySelector("#uvb-toast-text");
    if (span) span.textContent = text;

    if (this.toastTimeout) clearTimeout(this.toastTimeout);

    this.toastElement.classList.add("show");

    this.toastTimeout = setTimeout(() => {
      if (this.toastElement) {
        this.toastElement.classList.remove("show");
      }
    }, 1800);
  }

  /**
   * Finds the best parent element for the toast notification.
   * Tries the player container first, falls back to document body.
   */
  _findToastParent() {
    if (this.config.playerContainerSelector) {
      const container = document.querySelector(this.config.playerContainerSelector);
      if (container) {
        const style = window.getComputedStyle(container);
        if (style.position === "static") {
          container.style.position = "relative";
        }
        return container;
      }
    }

    const video = document.querySelector(this.config.videoSelector || "video");
    if (video && video.parentElement) {
      const parent = video.parentElement;
      const style = window.getComputedStyle(parent);
      if (style.position === "static") {
        parent.style.position = "relative";
      }
      return parent;
    }

    return document.body;
  }

  /**
   * Cleans up the toast notification element.
   */
  removeUI() {
    if (this.toastElement) {
      this.toastElement.remove();
      this.toastElement = null;
    }
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
  }

  destroy() {
    this.removeUI();
  }
}

window.UIController = UIController;
