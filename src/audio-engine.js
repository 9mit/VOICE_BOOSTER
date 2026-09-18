/**
 * Universal Volume Booster Pro - Audio Engine Module (v4.0 Fixed)
 * 
 * Manages the Web Audio API Context and the Digital Signal Processing (DSP) routing chain.
 * Utilizes a WeakMap cache to guarantee a video is intercepted exactly once.
 * Implements smooth gain transitions using AudioParam.setTargetAtTime.
 * 
 * v4.1 Changes (Dolby Spatial & Anti-Burst Protection):
 * - ADDED: Zero-Latency Anti-Burst Soft-Clipper (WaveShaperNode with 4x oversampling & Hermite curve)
 *   Guarantees true-peak levels never exceed -0.35dBFS (0.96 linear), completely preventing hard digital DAC clipping
 * - ADDED: Dolby Mid/Side (M/S) Spatial Widener with 150Hz Spatial Bass Lock
 *   Decomposes stereo into Mid (dialogue/punch) and Side (ambiance/reverb) for holographic 3D soundstage expansion
 * 
 * DSP Routing Pipeline:
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
 *  [DynamicsCompressorNode]  (Profile Dynamics — operates on pre-boosted signal)
 *         │
 *         ▼
 *  [CompressorCompensatorNode]
 *         │
 *         ▼
 *  [GainNode]  (Output Booster Gain - Perceptual Curve)
 *         │
 *         ▼
 *  [DynamicsCompressorNode]  (Brickwall Limiter: safety dynamic ceiling)
 *         │
 *         ▼
 *  [CompensatorNode] (GainNode - Limiter makeup gain compensation)
 *         │
 *         ▼
 *  [Dolby Spatial Widener] (Mid/Side M/S Matrix with 150Hz Bass Lock)
 *         │
 *         ▼
 *  [Anti-Burst Soft-Clipper] (WaveShaperNode - 4x oversampled Hermite soft-knee ceiling @ 0.96)
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
      
      // Makeup Gain Compensator
      compensatorNode: null,
      compressorCompensatorNode: null,

      // Dolby Spatial Widener Nodes (Mid/Side Matrix)
      spatialSplitter: null,
      midGainL: null,
      midGainR: null,
      midSum: null,
      sideGainL: null,
      sideGainR: null,
      sideSum: null,
      sideHpFilter: null,
      sideWidthGain: null,
      sideToLeft: null,
      sideToRight: null,
      spatialMerger: null,

      // Zero-Latency Anti-Burst Soft Clipper
      antiBurstClipper: null,
      
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
      
      // Compressor presets — master maximizer/limiter.
      compPresets: {
        flat:    { threshold: 0, knee: 30, ratio: 1.0, attack: 0.010, release: 0.25 },
        cinema:  { threshold: -12, knee: 30, ratio: 2.5, attack: 0.010, release: 0.25 },
        speech:  { threshold: -10, knee: 25, ratio: 3.0, attack: 0.003, release: 0.20 },
        night:   { threshold: -18, knee: 30, ratio: 5.0, attack: 0.003, release: 0.30 },
        bass:    { threshold: -12, knee: 30, ratio: 2.0, attack: 0.015, release: 0.25 }
      },

      // Dolby Spatial Widener (Mid/Side stereo expansion multipliers)
      spatialPresets: {
        flat:    1.00, // Bit-perfect transparent stereo
        cinema:  1.45, // Immersive theatrical 3D soundstage widening
        speech:  0.85, // Center-focused dialogue clarity
        night:   1.15, // Comfortable ambient spaciousness
        bass:    1.25  // Wide stereo instruments with centered sub-bass
      },
      SPATIAL_BASS_LOCK_FREQ: 150, // Highpass on Side channel to prevent bass phase cancellation
      TRUE_PEAK_CEILING: 0.96     // -0.35 dBFS TruePeak ceiling to prevent DAC clipping
    };

    // Precomputed transfer curves for Anti-Burst Soft-Clipper
    this.antiBurstCurve = this._generateAntiBurstCurve(8192);
    this.linearCurve = new Float32Array([-1, 1]);

    // EQ profile definitions (Biquad Gains in dB)
    // Each profile has independent values for every filter and a preamp offset to prevent clipping (VLC method).
    // Tuned to be CLEARLY audible and distinct from each other.
    this.PROFILES = {
      flat: {
        preamp: 0.0,
        bass: 0.0,
        speech: 0.0,
        voicePresence: 0.0,
        voiceClarity: 0.0,
        treble: 0.0,
        deEsser: 0.0
      },
      cinema: {
        preamp: -3.0,       // Preamp attenuation to compensate for boosts
        bass: 10.0,        // Cinema bass rumble (controlled)
        speech: 2.0,       // Slight dialog push
        voicePresence: 1.0, // Subtle presence
        voiceClarity: 0.5,  // Light air
        treble: 6.0,       // Bright sparkly highs
        deEsser: -2.0      // Mild sibilance taming
      },
      speech: {
        preamp: -5.0,       // Preamp to compensate for vocal boost (+12dB)
        bass: -4.0,         // Cut bass to reduce rumble/music
        speech: 12.0,       // Vocal boost at 2.2kHz
        voicePresence: 8.0,  // Strong 3.2kHz presence for clarity
        voiceClarity: 6.0,   // High shelf for airiness
        treble: 1.0,        // Gentle top-end
        deEsser: -4.0       // Strong sibilance control
      },
      night: {
        preamp: -3.0,       // Preamp to compensate for vocal boost (+8dB)
        bass: -4.0,         // Reduce low-end rumble
        speech: 8.0,        // Boost dialog significantly
        voicePresence: 4.0, // Push presence so whispers are clear
        voiceClarity: 2.0,  // Add clarity
        treble: -4.0,       // Reduce harsh highs for comfort
        deEsser: -3.0       // Moderate de-essing
      },
      bass: {
        preamp: -5.0,       // Preamp attenuation (VLC method) to prevent distortion
        bass: 12.0,         // Clean, solid bass boost
        speech: -1.0,       // Slight vocal dip
        voicePresence: 0.0, // Neutral
        voiceClarity: 0.0,  // Neutral
        treble: 3.0,        // Crisp highs to balance
        deEsser: 0.0
      }
    };


    // Binding helper context
    this.resumeAudioContext = this.resumeAudioContext.bind(this);
  }

  // ─── Zero-Latency Anti-Burst Transfer Curve ────────────────────────────────

  /**
   * Generates a zero-latency Hermite soft-knee saturation transfer curve.
   * 
   * Mathematically guarantees:
   * 1. 100% linear pass-through (|f(x)| = |x|) for all signals with |x| <= 0.70 (0% THD on standard audio).
   * 2. Smooth C^1 continuous soft-knee saturation between 0.70 and 1.00.
   * 3. Zero slope (f'(1.0) = 0.0) at the boundaries, eliminating sharp derivative corners.
   * 4. Hard ceiling strictly bounded at +/-0.96 (-0.35dBFS True Peak headroom).
   * 
   * Combined with WaveShaperNode oversample = "4x", this completely prevents
   * DAC hard-clipping and driver bursting under extreme volume boost.
   * 
   * @param {number} length - Number of curve sample points (default 8192)
   * @returns {Float32Array} The computed transfer curve
   */
  _generateAntiBurstCurve(length = 8192) {
    const curve = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const x = (i / (length - 1)) * 2 - 1; // Maps index linearly across [-1.0, +1.0]
      const absX = Math.abs(x);
      if (absX <= 0.70) {
        curve[i] = x;
      } else {
        const u = (absX - 0.70) / 0.30;
        // Hermite cubic polynomial: h(0) = 0, h'(0) = 0.3, h(1) = 0.26, h'(1) = 0
        const h = -0.22 * u * u * u + 0.18 * u * u + 0.30 * u;
        const y = 0.70 + h;
        curve[i] = x < 0 ? -y : y;
      }
    }
    return curve;
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

    // Polynomial curve to match comment targets:
    // 1.0 -> 0.0dB (1.00x), 2.0 -> 12.0dB (3.98x), 3.0 -> 21.0dB (11.22x), 5.0 -> 29.5dB (29.85x)
    const x = safeBoost - 1.0;
    const db = 13.54 * x - 1.54 * x * x;
    const gain = Math.pow(10, db / 20);
    return Math.min(gain, this.PARAMS.MAX_SAFE_GAIN);
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

    const gestureResume = () => {
      this.resumeAudioContext();
    };
    window.addEventListener("click", gestureResume, { capture: true, passive: true, once: true });
    window.addEventListener("keydown", gestureResume, { capture: true, passive: true, once: true });
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
      this.state.compressorNode,
      this.state.brickwallLimiter,
      this.state.spatialMerger,
      this.state.antiBurstClipper
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
        this.state.brickwallLimiter.threshold.value = -1.0;
        this.state.brickwallLimiter.knee.value = 2.0;
        this.state.brickwallLimiter.ratio.value = 20.0;
        this.state.brickwallLimiter.attack.value = 0.001;
        this.state.brickwallLimiter.release.value = 0.05;
      }

      // 3b. Initialize Makeup Gain Compensator
      if (!this.state.compensatorNode) {
        this.state.compensatorNode = ctx.createGain();
      }

      // 3c. Initialize Compressor Makeup Gain Compensator
      if (!this.state.compressorCompensatorNode) {
        this.state.compressorCompensatorNode = ctx.createGain();
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

      // 6b. Initialize Dolby Spatial Widener (Mid/Side Matrix)
      if (!this.state.spatialSplitter) {
        this.state.spatialSplitter = ctx.createChannelSplitter(2);
        this.state.midGainL = ctx.createGain();
        this.state.midGainL.gain.value = 0.5;
        this.state.midGainR = ctx.createGain();
        this.state.midGainR.gain.value = 0.5;
        this.state.midSum = ctx.createGain();
        this.state.midSum.gain.value = 1.0;

        this.state.sideGainL = ctx.createGain();
        this.state.sideGainL.gain.value = 0.5;
        this.state.sideGainR = ctx.createGain();
        this.state.sideGainR.gain.value = -0.5;
        this.state.sideSum = ctx.createGain();
        this.state.sideSum.gain.value = 1.0;

        this.state.sideHpFilter = ctx.createBiquadFilter();
        this.state.sideHpFilter.type = "highpass";
        this.state.sideHpFilter.frequency.value = this.PARAMS.SPATIAL_BASS_LOCK_FREQ;
        this.state.sideHpFilter.Q.value = 0.707;

        this.state.sideWidthGain = ctx.createGain();
        this.state.sideWidthGain.gain.value = 1.0;

        this.state.sideToLeft = ctx.createGain();
        this.state.sideToLeft.gain.value = 1.0;
        this.state.sideToRight = ctx.createGain();
        this.state.sideToRight.gain.value = -1.0;

        this.state.spatialMerger = ctx.createChannelMerger(2);
      }

      // 6c. Initialize Zero-Latency Anti-Burst Soft-Clipper
      if (!this.state.antiBurstClipper) {
        this.state.antiBurstClipper = ctx.createWaveShaper();
        this.state.antiBurstClipper.curve = this.antiBurstCurve;
        this.state.antiBurstClipper.oversample = "4x";
      }

      // 7. Connect the linear DSP pipeline (exactly once)
      //    Source → EQ → Compressor → CompressorCompensator → GainNode → Limiter → Compensator → Dolby Spatial Widener → Anti-Burst Soft-Clipper → Destination
      if (!this.state.graphConnected) {
        // EQ Series
        this.state.bassFilter.connect(this.state.speechFilter);
        this.state.speechFilter.connect(this.state.voicePresenceFilter);
        this.state.voicePresenceFilter.connect(this.state.voiceClarityFilter);
        this.state.voiceClarityFilter.connect(this.state.deEsserFilter);
        this.state.deEsserFilter.connect(this.state.trebleFilter);

        // Treble → Compressor → CompressorCompensator → GainNode → Limiter → Compensator
        this.state.trebleFilter.connect(this.state.compressorNode);
        this.state.compressorNode.connect(this.state.compressorCompensatorNode);
        this.state.compressorCompensatorNode.connect(this.state.gainNode);
        this.state.gainNode.connect(this.state.brickwallLimiter);
        this.state.brickwallLimiter.connect(this.state.compensatorNode);

        // Compensator → Dolby Spatial Widener (Mid/Side Matrix)
        this.state.compensatorNode.connect(this.state.spatialSplitter);

        // Mid matrix: M = 0.5 * L + 0.5 * R (dialogue & center focus)
        this.state.spatialSplitter.connect(this.state.midGainL, 0);
        this.state.spatialSplitter.connect(this.state.midGainR, 1);
        this.state.midGainL.connect(this.state.midSum);
        this.state.midGainR.connect(this.state.midSum);
        this.state.midSum.connect(this.state.spatialMerger, 0, 0); // Mid to Left
        this.state.midSum.connect(this.state.spatialMerger, 0, 1); // Mid to Right

        // Side matrix: S = 0.5 * L - 0.5 * R (with 150Hz Spatial Bass Lock)
        this.state.spatialSplitter.connect(this.state.sideGainL, 0);
        this.state.spatialSplitter.connect(this.state.sideGainR, 1);
        this.state.sideGainL.connect(this.state.sideSum);
        this.state.sideGainR.connect(this.state.sideSum);
        this.state.sideSum.connect(this.state.sideHpFilter);
        this.state.sideHpFilter.connect(this.state.sideWidthGain);
        this.state.sideWidthGain.connect(this.state.sideToLeft);
        this.state.sideWidthGain.connect(this.state.sideToRight);
        this.state.sideToLeft.connect(this.state.spatialMerger, 0, 0); // +S to Left
        this.state.sideToRight.connect(this.state.spatialMerger, 0, 1); // -S to Right

        // Dolby Spatial Output → Anti-Burst Soft-Clipper → AudioContext.destination
        this.state.spatialMerger.connect(this.state.antiBurstClipper);
        this.state.antiBurstClipper.connect(ctx.destination);

        this.state.graphConnected = true;
      }

      // 8. Connect source node securely - with conflict bypass
      let videoSource = null;
      
      if (this.connectedVideos.has(video)) {
        const cached = this.connectedVideos.get(video);
        videoSource = cached.sourceNode;
        if (cached.isFallback) {
          this.state.isConflictDetected = true;
        }
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
            this.state.isConflictDetected = true;
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

        // Attempt immediate resume in case video is already playing or user has interacted
        this.resumeAudioContext();
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

    // Resume context on user interaction/settings application
    this.resumeAudioContext();

    const ctx = this.state.audioContext;
    const now = ctx.currentTime;
    const t = 0.05;

    const isActive = this.state.isEnabled && !this.state.isConflictDetected;

    // Load active EQ profile
    const safeProfile = ["flat", "cinema", "speech", "night", "bass"].includes(this.state.audioProfile)
      ? this.state.audioProfile
      : "flat";
    const profileGains = this.PROFILES[safeProfile];

    // 1. Output Boost Volume (Master Volume Boost)
    const rawBoost = isActive ? this.state.boostLevel : 1.0;
    const computedGain = this._computePerceptualGain(rawBoost);
    const targetGain = Math.min(computedGain, this.PARAMS.MAX_SAFE_GAIN);

    if (this.state.gainNode) {
      this.state.gainNode.gain.cancelScheduledValues(now);
      this.state.gainNode.gain.setTargetAtTime(targetGain, now, this.PARAMS.BOOST_SMOOTH_TIME);
    }

    // 2. EQ Filter Processing with Preamp Headroom (VLC method)
    // We add the negative preampDb to all filters to scale down the signal before the compressor/limiter
    const preampDb = isActive ? (profileGains.preamp || 0.0) : 0.0;

    let bass = isActive ? (profileGains.bass + preampDb) : 0.0;
    let speech = isActive ? (profileGains.speech + preampDb) : 0.0;
    let voicePresence = isActive ? (profileGains.voicePresence + preampDb) : 0.0;
    let voiceClarity = isActive ? (profileGains.voiceClarity + preampDb) : 0.0;
    let treble = isActive ? (profileGains.treble + preampDb) : 0.0;
    let deEsserGain = isActive ? ((profileGains.deEsser || 0.0) + preampDb) : 0.0;

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

    // 3. Compressor — operates on the pre-gain signal
    let compCompensationGain = 1.0;
    let limiterCompensationGain = 1.0;
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
      if (this.state.brickwallLimiter) {
        this.state.brickwallLimiter.threshold.cancelScheduledValues(now);
        this.state.brickwallLimiter.threshold.setTargetAtTime(-1.0, now, t);
        this.state.brickwallLimiter.knee.cancelScheduledValues(now);
        this.state.brickwallLimiter.knee.setTargetAtTime(2.0, now, t);
        this.state.brickwallLimiter.ratio.cancelScheduledValues(now);
        this.state.brickwallLimiter.ratio.setTargetAtTime(20.0, now, t);
        this.state.brickwallLimiter.attack.cancelScheduledValues(now);
        this.state.brickwallLimiter.attack.setTargetAtTime(0.001, now, t);
        this.state.brickwallLimiter.release.cancelScheduledValues(now);
        this.state.brickwallLimiter.release.setTargetAtTime(0.05, now, t);
      }

      // Compute automatic makeup gains:
      const preset = this.PARAMS.compPresets[safeProfile];
      const compMakeupDb = -0.5 * preset.threshold * (1.0 - 1.0 / preset.ratio);
      
      const limiterThreshold = -1.0;
      const limiterRatio = 20.0;
      const limiterMakeupDb = -0.5 * limiterThreshold * (1.0 - 1.0 / limiterRatio);

      compCompensationGain = Math.pow(10, -compMakeupDb / 20);
      limiterCompensationGain = Math.pow(10, -limiterMakeupDb / 20);
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

    if (this.state.compressorCompensatorNode) {
      this.state.compressorCompensatorNode.gain.cancelScheduledValues(now);
      this.state.compressorCompensatorNode.gain.setTargetAtTime(compCompensationGain, now, t);
    }

    if (this.state.compensatorNode) {
      this.state.compensatorNode.gain.cancelScheduledValues(now);
      this.state.compensatorNode.gain.setTargetAtTime(limiterCompensationGain, now, t);
    }

    // 4. Dolby Spatial Widener (Mid/Side stereo width control)
    const targetWidth = isActive
      ? (this.PARAMS.spatialPresets[safeProfile] || 1.0)
      : 1.0;
    const hpFreq = isActive ? this.PARAMS.SPATIAL_BASS_LOCK_FREQ : 10;

    if (this.state.sideWidthGain) {
      this.state.sideWidthGain.gain.cancelScheduledValues(now);
      this.state.sideWidthGain.gain.setTargetAtTime(targetWidth, now, t);
    }
    if (this.state.sideHpFilter) {
      this.state.sideHpFilter.frequency.cancelScheduledValues(now);
      this.state.sideHpFilter.frequency.setTargetAtTime(hpFreq, now, t);
    }

    // 5. Zero-Latency Anti-Burst Soft-Clipper (curve selection)
    if (this.state.antiBurstClipper) {
      this.state.antiBurstClipper.curve = isActive
        ? this.antiBurstCurve
        : this.linearCurve;
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
      // Transparent compensator
      if (this.state.compensatorNode) {
        this.state.compensatorNode.gain.cancelScheduledValues(now);
        this.state.compensatorNode.gain.setTargetAtTime(1.0, now, t);
      }
      // Transparent compressor compensator
      if (this.state.compressorCompensatorNode) {
        this.state.compressorCompensatorNode.gain.cancelScheduledValues(now);
        this.state.compressorCompensatorNode.gain.setTargetAtTime(1.0, now, t);
      }
      // Transparent Dolby Spatial Widener
      if (this.state.sideWidthGain) {
        this.state.sideWidthGain.gain.cancelScheduledValues(now);
        this.state.sideWidthGain.gain.setTargetAtTime(1.0, now, t);
      }
      if (this.state.sideHpFilter) {
        this.state.sideHpFilter.frequency.cancelScheduledValues(now);
        this.state.sideHpFilter.frequency.setTargetAtTime(10, now, t);
      }
      // Transparent Anti-Burst Soft-Clipper
      if (this.state.antiBurstClipper) {
        this.state.antiBurstClipper.curve = this.linearCurve;
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
    this.state.compensatorNode = null;
    this.state.compressorCompensatorNode = null;
    this.state.spatialSplitter = null;
    this.state.midGainL = null;
    this.state.midGainR = null;
    this.state.midSum = null;
    this.state.sideGainL = null;
    this.state.sideGainR = null;
    this.state.sideSum = null;
    this.state.sideHpFilter = null;
    this.state.sideWidthGain = null;
    this.state.sideToLeft = null;
    this.state.sideToRight = null;
    this.state.spatialMerger = null;
    this.state.antiBurstClipper = null;
    this.state.graphConnected = false;
    this.state.isConflictDetected = false;
  }
}

// Make globally accessible in content script environment
window.AudioEngine = AudioEngine;
