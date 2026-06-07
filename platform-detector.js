/**
 * Universal Volume Booster Pro - Platform Detector Module
 * 
 * Analyzes the hostname and maps it to specific structural configurations:
 * - DOM selectors for the video element and the player wrapper.
 * - Container selectors to watch for SPA updates.
 * - Platform-specific timing delays to let dynamic React/Angular overlays settle.
 */

class PlatformDetector {
  static get CONFIGS() {
    return {
      youtube: {
        id: "youtube",
        name: "YouTube",
        videoSelector: "video.html5-main-video, #movie_player video, ytd-player video, video",
        playerContainerSelector: "#movie_player, ytd-player, .html5-video-player",
        containerSelector: "#movie_player, #page-manager, ytd-app",
        navigationDetection: "mutationobserver+historyapi",
        reinitDelay: 800,
        ignoreSelector: "ytd-video-preview video, #inline-preview-player video"
      },
      netflix: {
        id: "netflix",
        name: "Netflix",
        videoSelector: ".watch-video video, .nf-player-container video, video",
        playerContainerSelector: ".watch-video, .nf-player-container, .video-container",
        containerSelector: "#appMountPoint, .watch-video",
        navigationDetection: "mutationobserver",
        reinitDelay: 1500
      },
      jiohotstar: {
        id: "jiohotstar",
        name: "JioHotstar / Cinema",
        videoSelector: "video",
        playerContainerSelector: "[class*='player'], [class*='video-player'], [data-testid*='player'], .vjs-tech",
        containerSelector: "body, #root, #app",
        navigationDetection: "mutationobserver",
        reinitDelay: 1500
      },
      disneyplus: {
        id: "disneyplus",
        name: "Disney+",
        videoSelector: ".btm-media-client video, .shaka-video-container video, video",
        playerContainerSelector: "[data-testid='video-player'], .btm-media-client, .shaka-video-container",
        containerSelector: "body, #app, #slider, .btm-media-client",
        navigationDetection: "mutationobserver",
        reinitDelay: 1200
      },
      primevideo: {
        id: "primevideo",
        name: "Amazon Prime Video",
        videoSelector: ".webPlayer video, .dv-player-container video, video",
        playerContainerSelector: ".webPlayer, .dv-player-container, .rendererContainer",
        containerSelector: "body, #dv-web-container, #webPlayerContainer",
        navigationDetection: "mutationobserver",
        reinitDelay: 1200
      },
      sonyliv: {
        id: "sonyliv",
        name: "SonyLIV",
        videoSelector: "video",
        playerContainerSelector: ".player-container, [class*='player']",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      zee5: {
        id: "zee5",
        name: "Zee5",
        videoSelector: "video",
        playerContainerSelector: ".player-wrapper, [class*='player']",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      hulu: {
        id: "hulu",
        name: "Hulu",
        videoSelector: "video",
        playerContainerSelector: ".player-container, .hulu-player",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      max: {
        id: "max",
        name: "Max / HBO",
        videoSelector: "video",
        playerContainerSelector: "[class*='player'], .video-container",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1200
      },
      appletv: {
        id: "appletv",
        name: "Apple TV+",
        videoSelector: "video",
        playerContainerSelector: ".web-player, .player-container",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1200
      },
      peacock: {
        id: "peacock",
        name: "Peacock",
        videoSelector: "video",
        playerContainerSelector: ".peacock-player, .player-container",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1200
      },
      paramount: {
        id: "paramount",
        name: "Paramount+",
        videoSelector: "video",
        playerContainerSelector: ".player-container, .video-player",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1200
      },
      crunchyroll: {
        id: "crunchyroll",
        name: "Crunchyroll",
        videoSelector: "video",
        playerContainerSelector: ".video-player-wrapper, #vilos-player, .crunchyroll-player",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      twitch: {
        id: "twitch",
        name: "Twitch",
        videoSelector: "video",
        playerContainerSelector: ".video-player, .player-jw, .twitch-player",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 800
      },
      generic: {
        id: "generic",
        name: "Generic Site",
        videoSelector: "video",
        playerContainerSelector: "body",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      }
    };
  }

  /**
   * Identifies the current platform by checking the window hostname.
   * Falls back to 'generic' configuration if domain is unmatched.
   * @returns {Object} Configuration object for the detected platform.
   */
  static getDetectedPlatform() {
    const hostname = window.location.hostname.toLowerCase();
    const configs = this.CONFIGS;

    if (hostname.includes("youtube.com") || hostname.includes("youtube-nocookie.com")) {
      return configs.youtube;
    }
    if (hostname.includes("netflix.com")) {
      return configs.netflix;
    }
    if (hostname.includes("jiocinema.com") || hostname.includes("jiohotstar.com")) {
      return configs.jiohotstar;
    }
    if (hostname.includes("disneyplus.com") || hostname.includes("hotstar.com")) {
      return configs.disneyplus;
    }
    if (hostname.includes("primevideo.com") || hostname === "amazon.com" || hostname.endsWith(".amazon.com") || hostname.endsWith(".amazon.co.uk") || hostname.endsWith(".amazon.de") || hostname.endsWith(".amazon.co.jp") || hostname.endsWith(".amazon.in")) {
      return configs.primevideo;
    }
    if (hostname.includes("sonyliv.com")) {
      return configs.sonyliv;
    }
    if (hostname.includes("zee5.com")) {
      return configs.zee5;
    }
    if (hostname.includes("hulu.com")) {
      return configs.hulu;
    }
    if (hostname.includes("max.com") || hostname.includes("hbomax.com")) {
      return configs.max;
    }
    if (hostname.includes("tv.apple.com")) {
      return configs.appletv;
    }
    if (hostname.includes("peacocktv.com")) {
      return configs.peacock;
    }
    if (hostname.includes("paramountplus.com")) {
      return configs.paramount;
    }
    if (hostname.includes("crunchyroll.com")) {
      return configs.crunchyroll;
    }
    if (hostname.includes("twitch.tv")) {
      return configs.twitch;
    }

    // Generic site fallback
    return configs.generic;
  }
}

// Make globally accessible in content script environment
window.PlatformDetector = PlatformDetector;
