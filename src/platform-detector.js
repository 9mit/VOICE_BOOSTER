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
        playerContainerSelector: ".video-player-wrapper, #vilos-player, .crunchyroll-player, [data-testid='vilos-player'], body",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      funimation: {
        id: "funimation",
        name: "Funimation",
        videoSelector: "video, #funimation-player video",
        playerContainerSelector: "#funimation-player, .video-js, .player-container, body",
        containerSelector: "body, #root",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      hidive: {
        id: "hidive",
        name: "HIDIVE",
        videoSelector: "video, #player video",
        playerContainerSelector: ".player-container, #player-container, #player, body",
        containerSelector: "body, #app",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      bilibili: {
        id: "bilibili",
        name: "Bilibili",
        videoSelector: ".bpx-player-video-wrap video, .bilibili-player-video video, video",
        playerContainerSelector: ".bpx-player-container, .bilibili-player, .player-mobile-wrapper, body",
        containerSelector: "body, #app, #biliMainHeader",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      hianime: {
        id: "hianime",
        name: "HiAnime",
        videoSelector: "video, #player video, .jw-video, .vjs-tech",
        playerContainerSelector: "#player-wrapper, #iframe-embed, .player-frame, body",
        containerSelector: "body, #wrapper",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      aniwatch: {
        id: "aniwatch",
        name: "AniWatch",
        videoSelector: "video, #player video, .jw-video, .vjs-tech",
        playerContainerSelector: "#player-wrapper, .player-frame, body",
        containerSelector: "body, #wrapper",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      animepahe: {
        id: "animepahe",
        name: "AnimePahe",
        videoSelector: "video, #player video",
        playerContainerSelector: ".theatre-container, #player, .embed-responsive, body",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      aniwave: {
        id: "aniwave",
        name: "AniWave",
        videoSelector: "video, #player video",
        playerContainerSelector: "#player, #player-wrapper, .player-frame, body",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      gogoanime: {
        id: "gogoanime",
        name: "Gogoanime",
        videoSelector: "video, .play-video video",
        playerContainerSelector: ".play-video, #load, .anime_video_body, body",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      animeflv: {
        id: "animeflv",
        name: "AnimeFLV",
        videoSelector: "video, #video_player video",
        playerContainerSelector: ".player-container, #video_player, body",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      kickassanime: {
        id: "kickassanime",
        name: "KickAssAnime",
        videoSelector: "video, #player video",
        playerContainerSelector: "#player, .ka-player, body",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      retrocrush: {
        id: "retrocrush",
        name: "RetroCrush",
        videoSelector: "video, .vjs-tech",
        playerContainerSelector: ".vjs-tech, .video-player, body",
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
      spotify: {
        id: "spotify",
        name: "Spotify",
        videoSelector: "audio, video",
        playerContainerSelector: "[data-testid='now-playing-widget'], .Root__now-playing-bar, footer, body",
        containerSelector: "body, #main, .Root__main-view",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      },
      generic: {
        id: "generic",
        name: "Generic Site",
        videoSelector: "video, audio",
        playerContainerSelector: "body",
        containerSelector: "body",
        navigationDetection: "mutationobserver",
        reinitDelay: 1000
      }
    };
  }

  /**
   * Identifies the current platform by checking the window hostname or supplied URL.
   * Falls back to 'generic' configuration if domain is unmatched.
   * @param {string} [urlOrHostname] - Optional URL or hostname to evaluate.
   * @returns {Object} Configuration object for the detected platform.
   */
  static getDetectedPlatform(urlOrHostname) {
    let hostname = "";
    if (typeof urlOrHostname === "string" && urlOrHostname.length > 0) {
      try {
        if (urlOrHostname.includes("://")) {
          hostname = new URL(urlOrHostname).hostname.toLowerCase();
        } else {
          hostname = urlOrHostname.toLowerCase();
        }
      } catch (e) {
        hostname = urlOrHostname.toLowerCase();
      }
    } else if (typeof window !== "undefined" && window.location && window.location.hostname) {
      hostname = window.location.hostname.toLowerCase();
    }
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
    if (hostname.includes("primevideo.com") || /(^|\.)amazon\.(com|co\.uk|de|co\.jp|in)$/.test(hostname)) {
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
    if (hostname.includes("funimation.com")) {
      return configs.funimation;
    }
    if (hostname.includes("hidive.com")) {
      return configs.hidive;
    }
    if (hostname.includes("bilibili.tv") || hostname.includes("bilibili.com")) {
      return configs.bilibili;
    }
    if (hostname.includes("hianime") || hostname.includes("hianimes")) {
      return configs.hianime;
    }
    if (hostname.includes("aniwatch") || hostname.includes("zoro")) {
      return configs.aniwatch;
    }
    if (hostname.includes("animepahe") || hostname.includes("pahe.")) {
      return configs.animepahe;
    }
    if (hostname.includes("aniwave") || hostname.includes("9anime")) {
      return configs.aniwave;
    }
    if (hostname.includes("gogoanime") || hostname.includes("anitaku")) {
      return configs.gogoanime;
    }
    if (hostname.includes("kickassanime") || hostname.includes("kaas.am")) {
      return configs.kickassanime;
    }
    if (hostname.includes("animeflv")) {
      return configs.animeflv;
    }
    if (hostname.includes("retrocrush")) {
      return configs.retrocrush;
    }
    if (hostname.includes("megacloud") || hostname.includes("rapid-cloud") || hostname.includes("rapidcloud")) {
      return configs.hianime;
    }
    if (hostname.includes("twitch.tv")) {
      return configs.twitch;
    }
    if (hostname.includes("spotify.com")) {
      return configs.spotify;
    }

    // Generic site fallback with dynamically extracted website name
    const detectedName = this.formatWebsiteName(hostname);
    return {
      ...configs.generic,
      name: detectedName
    };
  }

  /**
   * Formats a raw hostname or URL into a clean, human-readable website name.
   * Accurately extracts branding for popular and custom sites.
   * @param {string} rawHost - Raw hostname or URL string
   * @returns {string} Clean website name (e.g. "Reddit", "Vimeo", "YouTube")
   */
  static formatWebsiteName(rawHost) {
    if (!rawHost || typeof rawHost !== "string") {
      return "Generic Site";
    }

    let host = rawHost.trim().toLowerCase();
    try {
      if (host.includes("://")) {
        host = new URL(host).hostname.toLowerCase();
      } else {
        host = host.split("/")[0].split(":")[0];
      }
    } catch (e) {
      host = host.split("/")[0].split(":")[0];
    }

    // Strip common subdomains
    host = host.replace(/^(www\d?|m|mobile|web|open|app|play|watch|en)\./i, "");

    // Direct platform dictionary
    const PLATFORM_NAMES = {
      "youtube.com": "YouTube",
      "youtube-nocookie.com": "YouTube",
      "youtu.be": "YouTube",
      "netflix.com": "Netflix",
      "jiocinema.com": "JioCinema",
      "jiohotstar.com": "JioHotstar",
      "hotstar.com": "Disney+ Hotstar",
      "disneyplus.com": "Disney+",
      "primevideo.com": "Prime Video",
      "amazon.com": "Amazon Prime Video",
      "amazon.co.uk": "Amazon Prime Video",
      "amazon.de": "Amazon Prime Video",
      "amazon.in": "Amazon Prime Video",
      "sonyliv.com": "SonyLIV",
      "zee5.com": "Zee5",
      "hulu.com": "Hulu",
      "max.com": "Max",
      "hbomax.com": "HBO Max",
      "apple.com": "Apple TV+",
      "peacocktv.com": "Peacock",
      "paramountplus.com": "Paramount+",
      "crunchyroll.com": "Crunchyroll",
      "funimation.com": "Funimation",
      "hidive.com": "HIDIVE",
      "bilibili.com": "Bilibili",
      "bilibili.tv": "Bilibili",
      "twitch.tv": "Twitch",
      "spotify.com": "Spotify",
      "reddit.com": "Reddit",
      "vimeo.com": "Vimeo",
      "soundcloud.com": "SoundCloud",
      "dailymotion.com": "Dailymotion",
      "tiktok.com": "TikTok",
      "twitter.com": "Twitter",
      "x.com": "X",
      "facebook.com": "Facebook",
      "instagram.com": "Instagram",
      "coursera.org": "Coursera",
      "udemy.com": "Udemy",
      "khanacademy.org": "Khan Academy",
      "ted.com": "TED",
      "rumble.com": "Rumble",
      "bitchute.com": "BitChute",
      "patreon.com": "Patreon",
      "audiomack.com": "Audiomack",
      "mixcloud.com": "Mixcloud",
      "bandcamp.com": "Bandcamp",
      "deezer.com": "Deezer",
      "tunein.com": "TuneIn",
      "bbc.co.uk": "BBC iPlayer",
      "bbc.com": "BBC"
    };

    for (const [domain, name] of Object.entries(PLATFORM_NAMES)) {
      if (host.includes(domain)) {
        return name;
      }
    }

    // Dynamic brand extraction from domain name
    const parts = host.split(".").filter(Boolean);
    if (parts.length >= 2) {
      // Account for two-part country TLDs (e.g. .co.uk, .com.au)
      const isTwoPartTld = parts.length > 2 && ["co", "com", "org", "net", "edu", "gov", "ac"].includes(parts[parts.length - 2]);
      const brandIndex = isTwoPartTld ? parts.length - 3 : parts.length - 2;
      const brand = parts[brandIndex >= 0 ? brandIndex : 0];
      if (brand && brand.length > 1) {
        return brand
          .replace(/[-_]+/g, " ")
          .split(" ")
          .filter(Boolean)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }
    }

    if (host && host.length > 0 && host !== "localhost") {
      return host.charAt(0).toUpperCase() + host.slice(1);
    }

    return "Generic Site";
  }
}

// Make globally accessible in content script and popup environments
if (typeof window !== "undefined") {
  window.PlatformDetector = PlatformDetector;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { PlatformDetector };
}
