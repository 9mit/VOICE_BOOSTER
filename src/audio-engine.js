/**
 * Universal Volume Booster Pro - Audio Engine Module (v4.0 Fixed)
 * 
 * Manages the Web Audio API Context and the Digital Signal Processing (DSP) routing chain.
 * Utilizes a WeakMap cache to guarantee a video is intercepted exactly once.
 * Implements smooth gain transitions using AudioParam.setTargetAtTime.
 * 
 * v4.0 Changes (Critical Audio Fix):
 * - FIXED: Reordered DSP chain so GainNode is BEFORE limiter (was being squashed)
 * - FIXED: Brickwall limiter threshold now scales dynamically with boost level
 * - FIXED: Each profile has independent voice presence & clarity values
 * - FIXED: Compressor operates on boosted signal for proper dynamics control
 * - FIXED: Profile EQ contrast dramatically increased for audible differences
 * 
 * DSP Routing Pipeline (CORRECTED):
 * [MediaElementSourceNode]
 *         │
 *         ▼
 *  [Bass Filter]  (BiquadFilterNode - lowshelf @ 150Hz)
 *         │
 *         ▼
 *  [Speech Filter] (BiquadFilterNode - peaking @ 2.2kHz)
 *         │
 *         ▼
 *  [Voice Presence Filter] (BiquadFilterNode - peaking @ 3.2kHz)
 *         │
 *         ▼
 *  [Voice Clarity Filter] (BiquadFilterNode - highshelf @ 5kHz)
 *         │
 *         ▼
 *  [De-Esser Filter] (BiquadFilterNode - peaking @ 6.8kHz, dynamic negative gain)
 *         │
 *         ▼
 *  [Treble Filter] (BiquadFilterNode - highshelf @ 7kHz)
 *         │
 *         ▼
 *  [GainNode]  (Output Booster Gain - Perceptual Curve)
 *         │
 *         ▼
 *  [DynamicsCompressorNode]  (Profile Dynamics — operates on BOOSTED signal)
 *         │
 *         ▼
 *  [DynamicsCompressorNode]  (Brickwall Limiter: dynamic threshold, safety ceiling)
 *         │
 *         ▼
 *  [AudioContext.destination]
 */

class AudioEngine {
  constructor() {
    this.state = {
      boostLevel: 1.0,
      isEnabled: true,
      audioProfile: "flat",
      isConflictDetected: false,
      
      // Node references
      audioContext: null,
      sourceNode: null,
      gainNode: null,
      
      // EQ Filters
      bassFilter: null,
      speechFilter: null,
      trebleFilter: null,
      
      // Voice Enhancement Filters
      voicePresenceFilter: null,
      voiceClarityFilter: null,
      deEsserFilter: null,
      
      // Profile Dynamics Compressor
      compressorNode: null,
      
      // Brickwall Limiter
      brickwallLimiter: null,
      
      graphConnected: false
    };

    // Keep track of connected video elements using a WeakMap.
    // Web Audio API throws a fatal InvalidStateError if createMediaElementSource is called twice.
    this.connectedVideos = new WeakMap();

    // Constant configurations
    this.PARAMS = {
      BOOST_MIN: 1.0,
      BOOST_MAX: 5.0,
      BOOST_SMOOTH_TIME: 0.04, // seconds to ramp gain changes to prevent clicks
      MAX_SAFE_GAIN: 55.0, // absolute gain ceiling (~34.8dB) to allow for extreme profiles
      BASS_FREQ: 150,
      SPEECH_FREQ: 2200,
      VOICE_PRESENCE_FREQ: 3200,
      VOICE_CLARITY_FREQ: 5000,
      DE_ESSER_FREQ: 6800,
      TREBLE_FREQ: 7000,
      BYPASS_CROSSFADE_TIME: 0.015, // 15ms click-free bypass switching
      
      // Compressor presets — now operates on the BOOSTED signal (post-gain).
      // Tuned for meaningful dynamic control that doesn't fight the gain.
      compPresets: {
        flat:    { threshold: -6,  knee: 30, ratio: 1.2, attack: 0.01,  release: 0.15 },
        cinema:  { threshold: -12, knee: 10, ratio: 2.5, attack: 0.01,  release: 0.25 },
        speech:  { threshold: -10, knee: 8,  ratio: 3.0, attack: 0.003, release: 0.1  },
        night:   { threshold: -20, knee: 15, ratio: 8.0, attack: 0.003, release: 0.35 },
        bass:    { threshold: -10, knee: 10, ratio: 2.0, attack: 0.015, release: 0.25 }
      }
    };

    // EQ profile definitions (Biquad Gains in dB)
    // Each profile has independent values for every filter.
    // Tuned to be CLEARLY audible and distinct from each other.
    this.PROFILES = {
      flat: {
        bass: 0.0,
        speech: 0.0,
        voicePresence: 0.0,
        voiceClarity: 0.0,
        treble: 0.0,
        deEsser: 0.0
      },
      cinema: {
        bass: 14.0,        // Deep cinematic rumble
        speech: 3.0,       // Slight dialog push
        voicePresence: 2.0, // Subtle presence
        voiceClarity: 1.0,  // Light air
        treble: 10.0,      // Bright sparkly highs
        deEsser: -3.0      // Mild sibilance taming
      },
      speech: {
        bass: -8.0,         // Cut bass to reduce rumble/music
        speech: 16.0,       // Massive vocal boost at 2.2kHz
        voicePresence: 10.0, // Strong 3.2kHz presence for clarity
        voiceClarity: 8.0,   // High shelf for airiness
        treble: 2.0,        // Gentle top-end
        deEsser: -6.0       // Strong sibilance control
      },
      night: {
        bass: -6.0,         // Reduce low-end rumble
        speech: 10.0,       // Boost dialog significantly
        voicePresence: 6.0, // Push presence so whispers are clear
        voiceClarity: 4.0,  // Add clarity
        treble: -6.0,       // Reduce harsh highs for comfort
        deEsser: -4.0       // Moderate de-essing
      },
      bass: {
        bass: 24.0,         // Earth-shattering sub-bass
        speech: -2.0,       // Slight vocal dip (let bass dominate)
        voicePresence: 0.0, // Neutral
        voiceClarity: 0.0,  // Neutral
        treble: 6.0,        // Crisp highs to balance the bass weight
        deEsser: 0.0
      }
    };

    // Binding helper context
    this.resumeAudioContext = this.resumeAudioContext.bind(this);
  }

  // ─── Perceptual Gain Curve ──────────────────────────────────────────────────

  /**
   * Computes a perceptually tuned gain value from a boost level (1.0-5.0).
   *
   * The slider is mapped in dB, then converted back to linear Web Audio gain.
   * This keeps the UI percentages from behaving like weak linear multipliers
   * and gives the major presets clearly separated loudness targets:
   *   100% -> 0.0dB  -> 1.00x
   *   200% -> 12.0dB -> 3.98x
   *   300% -> 21.0dB -> 11.22x
   *   500% -> 29.5dB -> 29.85x
   *
   * @param {number} boost - Raw boost level (1.0 to 5.0)
   * @returns {number} Computed gain multiplier
   */
  _computePerceptualGain(boost) {
    const safeBoost = Number.isFinite(boost)
      ? Math.max(this.PARAMS.BOOST_MIN, Math.min(this.PARAMS.BOOST_MAX, boost))
      : this.PARAMS.BOOST_MIN;

    const dbAnchors = [
      { boost: 1.0, db: 0.0 },
      { boost: 1.5, db: 8.0 },
      { boost: 2.0, db: 16.0 },
      { boost: 3.0, db: 25.0 },
      { boost: 5.0, db: 34.0 }
    ];

    for (let i = 1; i < dbAnchors.length; i++) {
      const start = dbAnchors[i - 1];
      const end = dbAnchors[i];

      if (safeBoost <= end.boost) {
        const range = end.boost - start.boost;
        const t = (safeBoost - start.boost) / range;
        const smoothT = t * t * (3 - 2 * t);
        const db = start.db + ((end.db - start.db) * smoothT);
        const gain = Math.pow(10, db / 20);
        return Math.min(gain, this.PARAMS.MAX_SAFE_GAIN);
      }
    }

    return this.PARAMS.MAX_SAFE_GAIN;
  }

  /**
   * Computes the dB value of the current gain for limiter threshold calculation.
   * @param {number} boost - Raw boost level (1.0 to 5.0)
   * @returns {number} Gain in dB
   */
  _computeGainInDb(boost) {
    const gain = this._computePerceptualGain(boost);
    if (gain <= 0) return 0;
    return 20 * Math.log10(gain);
  }

  /**
   * Resumes the AudioContext safely to satisfy autoplay policies.
   */
  async resumeAudioContext() {
    if (this.state.audioContext && this.state.audioContext.state === "suspended") {
      try {
        await this.state.audioContext.resume();
      } catch (err) {
        // Silent failure - audio context may be unavailable
      }
    }
  }

  // ─── AudioContext Health Monitor ──────────────────────────────────────────

  /**
   * Monitors AudioContext state and automatically recovers from
   * 'suspended' or 'interrupted' states. This prevents silent audio
   * after tab switching, screen lock, or system sleep.
   */
  _monitorAudioContextHealth() {
    if (!this.state.audioContext) return;
    const ctx = this.state.audioContext;
    
    ctx.onstatechange = () => {
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    };
  }

  // ─── Graph Integrity Validation ──────────────────────────────────────────

  /**
   * Validates that all critical audio nodes are still connected and functional.
   * @returns {boolean} True if the graph appears intact.
   */
  _validateGraphIntegrity() {
    if (!this.state.audioContext || this.state.audioContext.state === 'closed') {
      return false;
    }

    const criticalNodes = [
      this.state.gainNode,
      this.state.bassFilter,
      this.state.compressorNode
    ];

    for (const node of criticalNodes) {
      if (!node) {
        return false;
      }
    }

    return true;
  }

  /**
   * Builds or reconnects the Web Audio API graph to a HTML5 video element.
   * @param {HTMLVideoElement} video 
   */
  setupAudioGraph(video) {
    if (!video || !(video instanceof HTMLMediaElement)) {
      return;
    }

    this.state.isConflictDetected = false;

    try {
      // 1. Initialise AudioContext with comprehensive error handling
      if (!this.state.audioContext) {
        try {
          this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: "balanced"
          });
          
          if (!this.state.audioContext) {
            throw new Error("AudioContext is null after creation");
          }

          // Start health monitoring
          this._monitorAudioContextHealth();
        } catch (audioError) {
          if (audioError.message && audioError.message.includes("CORS")) {
            this.state.isConflictDetected = true;
          }
          return;
        }
      }

      const ctx = this.state.audioContext;

      // 2. Initialize GainNode (Amplification)
      if (!this.state.gainNode) {
        this.state.gainNode = ctx.createGain();
      }

      // 3. Initialize Brickwall Limiter (clipping protection — LAST in chain)
      if (!this.state.brickwallLimiter) {
        this.state.brickwallLimiter = ctx.createDynamicsCompressor();
        // Threshold is set dynamically in applyAudioEngineSettings()
        this.state.brickwallLimiter.threshold.value = -1.0;
        this.state.brickwallLimiter.knee.value = 2.0;
        this.state.brickwallLimiter.ratio.value = 20.0;
        this.state.brickwallLimiter.attack.value = 0.001;
        this.state.brickwallLimiter.release.value = 0.05;
      }

      // 4. Initialize Equalizer BiquadFilters
      if (!this.state.bassFilter) {
        this.state.bassFilter = ctx.createBiquadFilter();
        this.state.bassFilter.type = "lowshelf";
        this.state.bassFilter.frequency.value = this.PARAMS.BASS_FREQ;
        this.state.bassFilter.gain.value = 0.0;
      }
      if (!this.state.speechFilter) {
        this.state.speechFilter = ctx.createBiquadFilter();
        this.state.speechFilter.type = "peaking";
        this.state.speechFilter.frequency.value = this.PARAMS.SPEECH_FREQ;
        this.state.speechFilter.Q.value = 0.7;
        this.state.speechFilter.gain.value = 0.0;
      }

      // 5. Initialize Voice Enhancement Filters
      if (!this.state.voicePresenceFilter) {
        this.state.voicePresenceFilter = ctx.createBiquadFilter();
        this.state.voicePresenceFilter.type = "peaking";
        this.state.voicePresenceFilter.frequency.value = this.PARAMS.VOICE_PRESENCE_FREQ;
        this.state.voicePresenceFilter.Q.value = 1.2;
        this.state.voicePresenceFilter.gain.value = 0.0;
      }
      if (!this.state.voiceClarityFilter) {
        this.state.voiceClarityFilter = ctx.createBiquadFilter();
        this.state.voiceClarityFilter.type = "highshelf";
        this.state.voiceClarityFilter.frequency.value = this.PARAMS.VOICE_CLARITY_FREQ;
        this.state.voiceClarityFilter.gain.value = 0.0;
      }
      if (!this.state.deEsserFilter) {
        this.state.deEsserFilter = ctx.createBiquadFilter();
        this.state.deEsserFilter.type = "peaking";
        this.state.deEsserFilter.frequency.value = this.PARAMS.DE_ESSER_FREQ;
        this.state.deEsserFilter.Q.value = 4.0;
        this.state.deEsserFilter.gain.value = 0.0;
      }

      if (!this.state.trebleFilter) {
        this.state.trebleFilter = ctx.createBiquadFilter();
        this.state.trebleFilter.type = "highshelf";
        this.state.trebleFilter.frequency.value = this.PARAMS.TREBLE_FREQ;
        this.state.trebleFilter.gain.value = 0.0;
      }

      // 6. Initialize Profile Dynamics Compressor
      if (!this.state.compressorNode) {
        this.state.compressorNode = ctx.createDynamicsCompressor();
      }

      // 7. Connect the CORRECTED linear DSP pipeline (exactly once)
      //    Source → EQ → GainNode → Compressor → Limiter → Destination
      //
      //    KEY FIX: GainNode is now BEFORE the limiter, not after.
      //    The limiter threshold is set dynamically to allow boosted signal through.
      if (!this.state.graphConnected) {
        // EQ Series
        this.state.bassFilter.connect(this.state.speechFilter);
        this.state.speechFilter.connect(this.state.voicePresenceFilter);
        this.state.voicePresenceFilter.connect(this.state.voiceClarityFilter);
        this.state.voiceClarityFilter.connect(this.state.deEsserFilter);
        this.state.deEsserFilter.connect(this.state.trebleFilter);

        // Treble → Gain → Compressor → Limiter → Destination
        this.state.trebleFilter.connect(this.state.gainNode);
        this.state.gainNode.connect(this.state.compressorNode);
        this.state.compressorNode.connect(this.state.brickwallLimiter);
        this.state.brickwallLimiter.connect(ctx.destination);

        this.state.graphConnected = true;
      }

      // 8. Connect source node securely - with conflict bypass
      let videoSource = null;
      
      if (this.connectedVideos.has(video)) {
        const cached = this.connectedVideos.get(video);
        videoSource = cached.sourceNode;
      } else {
        try {
          videoSource = ctx.createMediaElementSource(video);
          videoSource.connect(this.state.bassFilter);
          this.connectedVideos.set(video, { sourceNode: videoSource });
        } catch (err) {
          const errMsg = (err && err.message) || "";
          const errName = (err && err.name) || "";
          // Chrome: "already connected", Firefox: "InvalidStateError"
          if (errMsg.includes("already connected") || errName === "InvalidStateError") {
            this.connectedVideos.set(video, { sourceNode: null, isFallback: true });
          } else {
            throw err;
          }
        }
      }

      this.state.sourceNode = videoSource;

      // 9. Apply parameters
      this.applyAudioEngineSettings();

      // Autoplay / Suspended guard
      if (videoSource) {
        video.removeEventListener("play", this.resumeAudioContext);
        video.addEventListener("play", this.resumeAudioContext);
        video.removeEventListener("playing", this.resumeAudioContext);
        video.addEventListener("playing", this.resumeAudioContext);
      }

    } catch (err) {
      if (err.message && !err.message.includes("already connected")) {
        // Audio setup error - continue with silent failure
      }
    }
  }

  /**
   * Applies the current DSP settings onto the respective Audio Nodes.
   * This is the core function that makes boost and profiles actually work.
   */
  applyAudioEngineSettings() {
    if (!this.state.audioContext || this.state.audioContext.state === 'closed') return;

    const ctx = this.state.audioContext;
    const now = ctx.currentTime;
    const t = 0.05;

    const isActive = this.state.isEnabled && !this.state.isConflictDetected;

    // 1. Output Boost Volume
    const rawBoost = isActive ? this.state.boostLevel : 1.0;
    const computedGain = this._computePerceptualGain(rawBoost);
    const targetGain = Math.min(computedGain, this.PARAMS.MAX_SAFE_GAIN);
    if (this.state.gainNode) {
      this.state.gainNode.gain.cancelScheduledValues(now);
      this.state.gainNode.gain.setTargetAtTime(targetGain, now, this.PARAMS.BOOST_SMOOTH_TIME);
    }

    // 2. EQ Filter Processing — each profile has independent values for all filters
    const safeProfile = ["flat", "cinema", "speech", "night", "bass"].includes(this.state.audioProfile)
      ? this.state.audioProfile
      : "flat";
    const profileGains = this.PROFILES[safeProfile];

    let bass = isActive ? profileGains.bass : 0.0;
    let speech = isActive ? profileGains.speech : 0.0;
    let voicePresence = isActive ? profileGains.voicePresence : 0.0;
    let voiceClarity = isActive ? profileGains.voiceClarity : 0.0;
    let treble = isActive ? profileGains.treble : 0.0;
    let deEsserGain = isActive ? (profileGains.deEsser || 0.0) : 0.0;

    // Clamping limits — generous to allow dramatic differences
    bass = Math.max(-15, Math.min(30, bass));
    speech = Math.max(-15, Math.min(20, speech));
    treble = Math.max(-15, Math.min(20, treble));
    voicePresence = Math.max(-12, Math.min(15, voicePresence));
    voiceClarity = Math.max(-12, Math.min(15, voiceClarity));
    deEsserGain = Math.max(-12, Math.min(0, deEsserGain));

    if (this.state.bassFilter) { this.state.bassFilter.gain.cancelScheduledValues(now); this.state.bassFilter.gain.setTargetAtTime(bass, now, t); }
    if (this.state.speechFilter) { this.state.speechFilter.gain.cancelScheduledValues(now); this.state.speechFilter.gain.setTargetAtTime(speech, now, t); }
    if (this.state.voicePresenceFilter) { this.state.voicePresenceFilter.gain.cancelScheduledValues(now); this.state.voicePresenceFilter.gain.setTargetAtTime(voicePresence, now, t); }
    if (this.state.voiceClarityFilter) { this.state.voiceClarityFilter.gain.cancelScheduledValues(now); this.state.voiceClarityFilter.gain.setTargetAtTime(voiceClarity, now, t); }
    if (this.state.deEsserFilter) { this.state.deEsserFilter.gain.cancelScheduledValues(now); this.state.deEsserFilter.gain.setTargetAtTime(deEsserGain, now, t); }
    if (this.state.trebleFilter) { this.state.trebleFilter.gain.cancelScheduledValues(now); this.state.trebleFilter.gain.setTargetAtTime(treble, now, t); }

    // 3. Compressor — operates on the BOOSTED signal
    if (isActive) {
      if (this.state.compressorNode) {
        const preset = this.PARAMS.compPresets[safeProfile];
        this.state.compressorNode.threshold.cancelScheduledValues(now);
        this.state.compressorNode.threshold.setTargetAtTime(preset.threshold, now, t);
        this.state.compressorNode.knee.cancelScheduledValues(now);
        this.state.compressorNode.knee.setTargetAtTime(preset.knee, now, t);
        this.state.compressorNode.ratio.cancelScheduledValues(now);
        this.state.compressorNode.ratio.setTargetAtTime(preset.ratio, now, t);
        this.state.compressorNode.attack.cancelScheduledValues(now);
        this.state.compressorNode.attack.setTargetAtTime(preset.attack, now, t);
        this.state.compressorNode.release.cancelScheduledValues(now);
        this.state.compressorNode.release.setTargetAtTime(preset.release, now, t);
      }

      // 4. Brickwall Limiter — DYNAMIC threshold that scales with boost
      //
      //    KEY FIX: The limiter threshold must allow the boosted signal through.
      //    At 100% (0dB gain), threshold = -1dBFS (standard ceiling).
      //    At 200% (~12dB gain), threshold = ~8dBFS — lets the boost through,
      //    only clipping extreme transient peaks that exceed the boost target.
      //    At 500% (~34dB gain), threshold = ~28dBFS.
      //
      //    Formula: limiterThreshold = gainInDb - headroomDb
      //    headroomDb is the safety margin (6dB) to prevent only extreme peaks.
      if (this.state.brickwallLimiter) {
        const gainDb = this._computeGainInDb(rawBoost);
        const headroom = 6.0; // dB of headroom above the target gain
        const limiterThreshold = Math.max(-1.0, gainDb - headroom);
        
        this.state.brickwallLimiter.threshold.cancelScheduledValues(now);
        this.state.brickwallLimiter.threshold.setTargetAtTime(limiterThreshold, now, t);
        this.state.brickwallLimiter.ratio.cancelScheduledValues(now);
        this.state.brickwallLimiter.ratio.setTargetAtTime(20.0, now, t);
      }
    } else {
      // Completely transparent when disabled
      if (this.state.compressorNode) {
        this.state.compressorNode.threshold.cancelScheduledValues(now);
        this.state.compressorNode.threshold.setTargetAtTime(0, now, t);
        this.state.compressorNode.ratio.cancelScheduledValues(now);
        this.state.compressorNode.ratio.setTargetAtTime(1.0, now, t);
      }
      if (this.state.brickwallLimiter) {
        this.state.brickwallLimiter.threshold.cancelScheduledValues(now);
        this.state.brickwallLimiter.threshold.setTargetAtTime(0, now, t);
        this.state.brickwallLimiter.ratio.cancelScheduledValues(now);
        this.state.brickwallLimiter.ratio.setTargetAtTime(1.0, now, t);
      }
    }
  }

  // ─── Instant Bypass Toggle ──────────────────────────────────────────────────

  /**
   * Instantly bypasses or re-engages the entire DSP chain with a
   * click-free 15ms crossfade.
   * 
   * @param {boolean} bypass - True to bypass all processing, false to re-engage.
   */
  setBypassMode(bypass) {
    if (!this.state.audioContext || this.state.audioContext.state === 'closed') return;

    const ctx = this.state.audioContext;
    const now = ctx.currentTime;
    const t = this.PARAMS.BYPASS_CROSSFADE_TIME;

    if (bypass) {
      // Zero all EQ filters for transparent pass-through
      if (this.state.bassFilter) { this.state.bassFilter.gain.cancelScheduledValues(now); this.state.bassFilter.gain.setTargetAtTime(0, now, t); }
      if (this.state.speechFilter) { this.state.speechFilter.gain.cancelScheduledValues(now); this.state.speechFilter.gain.setTargetAtTime(0, now, t); }
      if (this.state.voicePresenceFilter) { this.state.voicePresenceFilter.gain.cancelScheduledValues(now); this.state.voicePresenceFilter.gain.setTargetAtTime(0, now, t); }
      if (this.state.voiceClarityFilter) { this.state.voiceClarityFilter.gain.cancelScheduledValues(now); this.state.voiceClarityFilter.gain.setTargetAtTime(0, now, t); }
      if (this.state.deEsserFilter) { this.state.deEsserFilter.gain.cancelScheduledValues(now); this.state.deEsserFilter.gain.setTargetAtTime(0, now, t); }
      if (this.state.trebleFilter) { this.state.trebleFilter.gain.cancelScheduledValues(now); this.state.trebleFilter.gain.setTargetAtTime(0, now, t); }
      
      // Set gain to unity
      if (this.state.gainNode) { this.state.gainNode.gain.cancelScheduledValues(now); this.state.gainNode.gain.setTargetAtTime(1.0, now, t); }
      
      // Transparent compressor
      if (this.state.compressorNode) {
        this.state.compressorNode.threshold.cancelScheduledValues(now);
        this.state.compressorNode.threshold.setTargetAtTime(0, now, t);
        this.state.compressorNode.ratio.cancelScheduledValues(now);
        this.state.compressorNode.ratio.setTargetAtTime(1.0, now, t);
      }
      // Transparent limiter
      if (this.state.brickwallLimiter) {
        this.state.brickwallLimiter.threshold.cancelScheduledValues(now);
        this.state.brickwallLimiter.threshold.setTargetAtTime(0, now, t);
        this.state.brickwallLimiter.ratio.cancelScheduledValues(now);
        this.state.brickwallLimiter.ratio.setTargetAtTime(1.0, now, t);
      }
    } else {
      // Re-engage DSP: apply all stored settings
      this.applyAudioEngineSettings();
    }
  }

  /**
   * Public accessor for graph integrity validation.
   * Returns true if the audio graph appears intact and functional.
   * @returns {boolean}
   */
  validateGraphIntegrity() {
    return this._validateGraphIntegrity();
  }

  /**
   * Clean up resources.
   */
  cleanup() {
    if (this.state.audioContext && this.state.audioContext.state !== 'closed') {
      this.state.audioContext.close().catch(() => {});
    }
    this.state.audioContext = null;
    this.state.sourceNode = null;
    this.state.gainNode = null;
    this.state.bassFilter = null;
    this.state.speechFilter = null;
    this.state.trebleFilter = null;
    this.state.voicePresenceFilter = null;
    this.state.voiceClarityFilter = null;
    this.state.deEsserFilter = null;
    this.state.compressorNode = null;
    this.state.brickwallLimiter = null;
    this.state.graphConnected = false;
    this.state.isConflictDetected = false;
  }
}

// Make globally accessible in content script environment
window.AudioEngine = AudioEngine;
