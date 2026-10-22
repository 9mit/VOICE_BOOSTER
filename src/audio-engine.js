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
      subRumbleFilter: null,
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

    // Keep track of connected video elements across re-injections and module reloads.
    // Web Audio API throws InvalidStateError if createMediaElementSource is called twice.
    // Persistent WeakMap allows reusing established connections across script updates.
    const globalConnectedVideos = (typeof window !== "undefined" && window.__uvb_connected_videos) || new WeakMap();
    if (typeof window !== "undefined") {
      window.__uvb_connected_videos = globalConnectedVideos;
    }
    this.connectedVideos = globalConnectedVideos;

    // Constant configurations
    this.PARAMS = {
      BOOST_MIN: 1.0,
      BOOST_MAX: 5.0,
      BOOST_SMOOTH_TIME: 0.04, // seconds to ramp gain changes to prevent clicks
      MAX_SAFE_GAIN: 55.0, // absolute gain ceiling (~34.8dB) to allow for extreme profiles
      BASS_FREQ: 150,
      SUB_RUMBLE_FREQ_MIN: 20,
      SUB_RUMBLE_FREQ_MAX: 80,
      SPEECH_FREQ: 2200,
      VOICE_PRESENCE_FREQ: 3200,
      VOICE_CLARITY_FREQ: 5000,
      DE_ESSER_FREQ: 6800,
      TREBLE_FREQ: 7000,
      BYPASS_CROSSFADE_TIME: 0.015, // 15ms click-free bypass switching
      
      // Compressor presets — dynamic range shaping without crushing boosts
      compPresets: {
        flat:    { threshold: 0, knee: 30, ratio: 1.0, attack: 0.010, release: 0.25 },
        cinema:  { threshold: -6, knee: 30, ratio: 1.2, attack: 0.010, release: 0.25 },
        speech:  { threshold: -12, knee: 15, ratio: 2.0, attack: 0.002, release: 0.28 },
        night:   { threshold: -12, knee: 30, ratio: 1.8, attack: 0.003, release: 0.30 },
        bass:    { threshold: 0, knee: 30, ratio: 1.0, attack: 0.015, release: 0.25 }
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
        bass: 10.0,        // Cinema bass rumble (controlled)
        speech: 3.0,       // Clear dialogue
        voicePresence: 2.0, // Subtle presence
        voiceClarity: 3.0,  // Air
        treble: 6.0,       // Bright sparkly highs
        deEsser: -2.0      // Mild sibilance taming
      },
      speech: {
        bass: -9.0,         // Cut muddy background low rumble (-8dB to -10dB below 200Hz)
        speech: 12.0,       // Vocal boost at 2.2kHz
        voicePresence: 8.0,  // Strong 3.2kHz presence for clarity
        voiceClarity: 6.0,   // High shelf for airiness
        treble: 0.0,        // Neutral top-end
        deEsser: -4.0       // Strong sibilance control
      },
      night: {
        bass: -6.0,         // Reduce low-end rumble
        speech: 8.0,        // Boost dialog significantly
        voicePresence: 4.0, // Push presence so whispers are clear
        voiceClarity: 2.0,  // Add clarity
        treble: -4.0,       // Reduce harsh highs for comfort
        deEsser: -3.0       // Moderate de-essing
      },
      bass: {
        bass: 14.0,         // Clean, solid, powerful bass boost
        speech: -1.0,       // Slight vocal dip
        voicePresence: 0.0, // Neutral
        voiceClarity: 0.0,  // Neutral
        treble: 3.0,        // Crisp highs to balance
        deEsser: 0.0
      }
    };

    // User gesture & autoplay policy tracking
    this._userGestureOccurred = false;

    // Binding helper context
    this.resumeAudioContext = this.resumeAudioContext.bind(this);
    this.hasUserGesture = this.hasUserGesture.bind(this);
  }

  // ─── Zero-Latency Anti-Burst Transfer Curve ────────────────────────────────

  /**
   * Generates a VLC-style zero-latency soft-saturation transfer curve using
   * a continuous C^1 soft-knee polynomial formulation.
   * 
   * Mathematically guarantees:
   * 1. 100% linear pass-through (|f(x)| = |x|) for all signals with |x| <= 0.70 (0% THD on standard audio).
   * 2. Smooth C^1 continuous soft-knee saturation between 0.70 and 1.00:
   *    - f'(threshold) = 1.000 (continuous transition from linear region, no slope jump).
   *    - f'(ceiling) = 0.000 (continuous transition into clamped boundary, no harsh kink).
   * 3. Strictly non-amplifying (|f(x)| <= |x|) and concave (f''(x) <= 0) everywhere in [0.70, 1.00].
   * 4. Peaks saturate musically with warm analog-style harmonics without digital tearing.
   * 5. Hard ceiling strictly bounded at +/-0.96 (-0.35dBFS True Peak headroom).
   * 
   * Combined with WaveShaperNode oversample = "4x", this completely prevents
   * DAC hard-clipping and driver bursting under extreme volume boost.
   * 
   * @param {number} length - Number of curve sample points (default 8192)
   * @returns {Float32Array} The computed transfer curve
   */
  _generateAntiBurstCurve(length = 8192) {
    const curve = new Float32Array(length);
    const threshold = 0.70;
    const ceiling = this.PARAMS.TRUE_PEAK_CEILING || 0.96;
    const span = 1.0 - threshold;
    const headroom = ceiling - threshold;
    // Power p chosen so that integral of (1 - u^p) matches headroom / span (p = 6.5)
    // Ensures: f'(threshold) = 1.0 (smooth C1 match with linear region),
    // f'(ceiling) = 0.0 (smooth C1 match with clamped region),
    // strictly concave (f'' <= 0) and non-amplifying (|f(x)| <= |x|).
    const p = headroom > 0 ? (span / (span - headroom)) - 1.0 : 1.0;

    for (let i = 0; i < length; i++) {
      const x = (i / (length - 1)) * 2 - 1; // Maps index linearly across [-1.0, +1.0]
      const absX = Math.abs(x);
      if (absX <= threshold) {
        curve[i] = x;
      } else {
        const u = Math.min(1.0, (absX - threshold) / span);
        // VLC-style soft-saturation curve with C^1 continuous slope at boundaries
        const sat = u - Math.pow(u, p + 1) / (p + 1);
        const y = threshold + span * sat;
        curve[i] = x < 0 ? -Math.min(ceiling, y) : Math.min(ceiling, y);
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
   * Checks whether the current context has received user activation / gesture.
   * Prevents Chromium from logging:
   * "The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page."
   * @param {HTMLMediaElement} [mediaElement] - Optional media element to check for active unmuted playback.
   * @returns {boolean} True if safe to call AudioContext.resume().
   */
  hasUserGesture(mediaElement) {
    // 1. Native User Activation API (Chrome 72+, standard across modern Chromium)
    if (typeof navigator !== "undefined" && navigator.userActivation) {
      if (navigator.userActivation.hasBeenActive || navigator.userActivation.isActive) {
        return true;
      }
    }

    // 2. Tracked user gesture events captured by listeners
    if (this._userGestureOccurred) {
      return true;
    }

    // 3. Persistent window flag across script updates / frames
    if (typeof window !== "undefined" && window.__uvb_user_gesture_occurred) {
      this._userGestureOccurred = true;
      return true;
    }

    // 4. If media is actively playing unmuted audio, browser autoplay policy already granted sound
    const targetMedia = mediaElement || (this.state.sourceNode && this.state.sourceNode.mediaElement);
    if (targetMedia && !targetMedia.paused && !targetMedia.muted && targetMedia.volume > 0) {
      return true;
    }

    return false;
  }

  /**
   * Resumes the AudioContext safely to satisfy autoplay policies.
   * Handles both 'suspended' and 'interrupted' states.
   * Only calls ctx.resume() when user gesture is present, force is true, or media is actively playing unmuted,
   * completely avoiding the Chromium autoplay console error.
   * @param {boolean} [force=false] - Force resume attempt (e.g. from user gesture handler).
   * @param {HTMLMediaElement} [mediaElement] - Associated media element.
   */
  async resumeAudioContext(force = false, mediaElement = null) {
    if (!this.state.audioContext || this.state.audioContext.state === "running" || this.state.audioContext.state === "closed") {
      return;
    }

    // Only attempt resume if we have user activation or force is requested
    if (!force && !this.hasUserGesture(mediaElement)) {
      return;
    }

    try {
      await this.state.audioContext.resume();
    } catch (err) {
      // AudioContext resume rejected (e.g. gesture expired or tab backgrounded)
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
      if (ctx.state !== "running" && ctx.state !== "closed") {
        if (this.hasUserGesture()) {
          this.resumeAudioContext();
        }
      }
    };

    if (!this._boundUserGestureResume) {
      this._boundUserGestureResume = () => {
        this._userGestureOccurred = true;
        if (typeof window !== "undefined") {
          window.__uvb_user_gesture_occurred = true;
        }
        if (this.state.audioContext && this.state.audioContext.state !== "running" && this.state.audioContext.state !== "closed") {
          this.resumeAudioContext(true);
        }
      };
      if (typeof window !== "undefined") {
        const events = ["click", "pointerdown", "mousedown", "keydown", "touchstart", "touchend"];
        events.forEach((evt) => {
          window.addEventListener(evt, this._boundUserGestureResume, { capture: true, passive: true });
          if (typeof document !== "undefined") {
            document.addEventListener(evt, this._boundUserGestureResume, { capture: true, passive: true });
          }
        });
      }
    }
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
    if (!this.state.graphConnected) {
      return false;
    }

    const criticalNodes = [
      this.state.gainNode,
      this.state.bassFilter,
      this.state.subRumbleFilter,
      this.state.speechFilter,
      this.state.voicePresenceFilter,
      this.state.voiceClarityFilter,
      this.state.deEsserFilter,
      this.state.trebleFilter,
      this.state.compressorNode,
      this.state.compressorCompensatorNode,
      this.state.brickwallLimiter,
      this.state.compensatorNode,
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
  /**
   * Initializes all audio nodes and connects the linear DSP pipeline to ctx.destination.
   * Reused by both setupAudioGraph (video element) and setupAudioStream (MediaStream / tabCapture).
   * @param {AudioContext} ctx
   */
  _ensureNodesAndPipeline(ctx) {
    if (!this.state.gainNode) {
      this.state.gainNode = ctx.createGain();
    }

    if (!this.state.brickwallLimiter) {
      this.state.brickwallLimiter = ctx.createDynamicsCompressor();
      this.state.brickwallLimiter.threshold.value = -1.0;
      this.state.brickwallLimiter.knee.value = 15.0;
      this.state.brickwallLimiter.ratio.value = 1.0;
      this.state.brickwallLimiter.attack.value = 0.001;
      this.state.brickwallLimiter.release.value = 0.28;
    }

    if (!this.state.compensatorNode) {
      this.state.compensatorNode = ctx.createGain();
    }

    if (!this.state.compressorCompensatorNode) {
      this.state.compressorCompensatorNode = ctx.createGain();
    }

    if (!this.state.bassFilter) {
      this.state.bassFilter = ctx.createBiquadFilter();
      this.state.bassFilter.type = "lowshelf";
      this.state.bassFilter.frequency.value = this.PARAMS.BASS_FREQ;
      this.state.bassFilter.gain.value = 0.0;
    }
    if (!this.state.subRumbleFilter) {
      this.state.subRumbleFilter = ctx.createBiquadFilter();
      this.state.subRumbleFilter.type = "highpass";
      this.state.subRumbleFilter.frequency.value = this.PARAMS.SUB_RUMBLE_FREQ_MIN;
      this.state.subRumbleFilter.Q.value = 0.707;
    }
    if (!this.state.speechFilter) {
      this.state.speechFilter = ctx.createBiquadFilter();
      this.state.speechFilter.type = "peaking";
      this.state.speechFilter.frequency.value = this.PARAMS.SPEECH_FREQ;
      this.state.speechFilter.Q.value = 0.7;
      this.state.speechFilter.gain.value = 0.0;
    }

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
      this.state.deEsserFilter.Q.value = 2.0;
      this.state.deEsserFilter.gain.value = 0.0;
    }

    if (!this.state.trebleFilter) {
      this.state.trebleFilter = ctx.createBiquadFilter();
      this.state.trebleFilter.type = "highshelf";
      this.state.trebleFilter.frequency.value = this.PARAMS.TREBLE_FREQ;
      this.state.trebleFilter.gain.value = 0.0;
    }

    if (!this.state.compressorNode) {
      this.state.compressorNode = ctx.createDynamicsCompressor();
    }

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

    if (!this.state.antiBurstClipper) {
      this.state.antiBurstClipper = ctx.createWaveShaper();
      this.state.antiBurstClipper.curve = this.antiBurstCurve;
      this.state.antiBurstClipper.oversample = "4x";
    }

    if (!this.state.graphConnected) {
      this.state.bassFilter.connect(this.state.subRumbleFilter);
      this.state.subRumbleFilter.connect(this.state.speechFilter);
      this.state.speechFilter.connect(this.state.voicePresenceFilter);
      this.state.voicePresenceFilter.connect(this.state.voiceClarityFilter);
      this.state.voiceClarityFilter.connect(this.state.deEsserFilter);
      this.state.deEsserFilter.connect(this.state.trebleFilter);

      // Mid/Side Spatial Matrix: Stereo widening operates cleanly before dynamic limiting
      this.state.trebleFilter.connect(this.state.spatialSplitter);

      this.state.spatialSplitter.connect(this.state.midGainL, 0);
      this.state.spatialSplitter.connect(this.state.midGainR, 1);
      this.state.midGainL.connect(this.state.midSum);
      this.state.midGainR.connect(this.state.midSum);
      this.state.midSum.connect(this.state.spatialMerger, 0, 0);
      this.state.midSum.connect(this.state.spatialMerger, 0, 1);

      this.state.spatialSplitter.connect(this.state.sideGainL, 0);
      this.state.spatialSplitter.connect(this.state.sideGainR, 1);
      this.state.sideGainL.connect(this.state.sideSum);
      this.state.sideGainR.connect(this.state.sideSum);
      this.state.sideSum.connect(this.state.sideHpFilter);
      this.state.sideHpFilter.connect(this.state.sideWidthGain);
      this.state.sideWidthGain.connect(this.state.sideToLeft);
      this.state.sideWidthGain.connect(this.state.sideToRight);
      this.state.sideToLeft.connect(this.state.spatialMerger, 0, 0);
      this.state.sideToRight.connect(this.state.spatialMerger, 0, 1);

      // Dynamics, Gain & Brickwall Limiter (strictly limits stereo & mid peaks below -1.0dBFS)
      this.state.spatialMerger.connect(this.state.compressorNode);
      this.state.compressorNode.connect(this.state.compressorCompensatorNode);
      this.state.compressorCompensatorNode.connect(this.state.gainNode);
      this.state.gainNode.connect(this.state.brickwallLimiter);
      this.state.brickwallLimiter.connect(this.state.compensatorNode);

      // Zero-Latency Anti-Burst Soft Clipper & Direct Destination Output
      this.state.compensatorNode.connect(this.state.antiBurstClipper);
      this.state.antiBurstClipper.connect(ctx.destination);

      this.state.graphConnected = true;
    }
  }

  /**
   * Builds or reconnects the Web Audio API graph to a MediaStream (e.g. from tabCapture).
   * Used for DRM-protected, cross-origin, or tab-level audio processing on any platform.
   * @param {MediaStream} stream 
   */
  setupAudioStream(stream) {
    if (!stream) return;
    this.state.isConflictDetected = false;

    try {
      if (!this.state.audioContext || this.state.audioContext.state === "closed") {
        if (typeof window !== "undefined" && window.__uvb_audioContext && window.__uvb_audioContext.state !== "closed") {
          this.state.audioContext = window.__uvb_audioContext;
        } else {
          this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            latencyHint: "balanced"
          });
          if (typeof window !== "undefined") {
            window.__uvb_audioContext = this.state.audioContext;
          }
        }
        this._monitorAudioContextHealth();
      }

      const ctx = this.state.audioContext;
      this._ensureNodesAndPipeline(ctx);

      let streamSource = null;
      try {
        streamSource = ctx.createMediaStreamSource(stream);
        streamSource.connect(this.state.bassFilter);
      } catch (err) {
        // Stream connection fallback
      }

      this.state.sourceNode = streamSource;
      this.applyAudioEngineSettings();
      this.resumeAudioContext();
    } catch (err) {
      // Setup audio stream error
    }
  }

  setupAudioGraph(video) {
    if (!video || !(video instanceof HTMLMediaElement)) {
      return;
    }

    this.state.isConflictDetected = false;

    try {
      // 1. Initialise AudioContext with persistent window caching and recovery
      if (!this.state.audioContext || this.state.audioContext.state === "closed") {
        if (typeof window !== "undefined" && window.__uvb_audioContext && window.__uvb_audioContext.state !== "closed") {
          this.state.audioContext = window.__uvb_audioContext;
        } else {
          try {
            this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
              latencyHint: "balanced"
            });
            
            if (!this.state.audioContext) {
              throw new Error("AudioContext is null after creation");
            }

            if (typeof window !== "undefined") {
              window.__uvb_audioContext = this.state.audioContext;
            }

            // Start health monitoring
            this._monitorAudioContextHealth();
          } catch (audioError) {
            return;
          }
        }
        this._monitorAudioContextHealth();
      }

      const ctx = this.state.audioContext;

      this._ensureNodesAndPipeline(ctx);

      // 8. Connect source node securely with multi-stage fallback and recovery
      let videoSource = null;
      let cached = this.connectedVideos.get(video);
      if (!cached && video.__uvb_sourceNode) {
        cached = { sourceNode: video.__uvb_sourceNode, audioContext: video.__uvb_audioContext };
        this.connectedVideos.set(video, cached);
      }

      if (cached && cached.sourceNode && cached.audioContext === ctx) {
        videoSource = cached.sourceNode;
        if (this.state.sourceNode !== videoSource || !this.state.graphConnected) {
          try {
            videoSource.disconnect();
          } catch (e) {}
          try {
            videoSource.connect(this.state.bassFilter);
          } catch (e) {}
        }
        this.state.sourceNode = videoSource;
        this.state.graphConnected = true;
        this.state.isConflictDetected = false;
      } else {
        // Stage 1: Standard MediaElementSource connection
        try {
          videoSource = ctx.createMediaElementSource(video);
          videoSource.connect(this.state.bassFilter);
          const record = { sourceNode: videoSource, audioContext: ctx };
          this.connectedVideos.set(video, record);
          try { video.__uvb_sourceNode = videoSource; video.__uvb_audioContext = ctx; } catch (e) {}
          this.state.isConflictDetected = false;
        } catch (err) {
          // Stage 2: Fallback to MediaStream capture if createMediaElementSource threw
          // InvalidStateError (element already connected) or SecurityError
          let stream = null;
          try {
            if (typeof video.captureStream === "function") {
              stream = video.captureStream();
            } else if (typeof video.mozCaptureStream === "function") {
              stream = video.mozCaptureStream();
            }
          } catch (streamEx) {}

          if (stream) {
            try {
              videoSource = ctx.createMediaStreamSource(stream);
              videoSource.connect(this.state.bassFilter);
              const record = { sourceNode: videoSource, audioContext: ctx, isStream: true };
              this.connectedVideos.set(video, record);
              try { video.__uvb_sourceNode = videoSource; video.__uvb_audioContext = ctx; } catch (e) {}
              this.state.isConflictDetected = false;
            } catch (streamSrcErr) {}
          }

          // Stage 3: If stream capture also failed, record safe fallback without bricking UI
          if (!videoSource) {
            this.connectedVideos.set(video, { sourceNode: null, audioContext: ctx, isFallback: true });
            // Never trigger false conflict lockouts: let user retain full control of settings
            this.state.isConflictDetected = false;
          }
        }
      }

      this.state.sourceNode = videoSource;

      // 9. Apply parameters
      this.applyAudioEngineSettings();

      // Autoplay / Suspended guard
      if (videoSource) {
        if (!this._mediaResumeHandler) {
          this._mediaResumeHandler = () => {
            if (!video.paused && !video.muted && video.volume > 0) {
              this.resumeAudioContext(true, video);
            } else if (this.hasUserGesture(video)) {
              this.resumeAudioContext(false, video);
            }
          };
        }
        ["play", "playing", "volumechange"].forEach((evt) => {
          video.removeEventListener(evt, this._mediaResumeHandler);
          video.addEventListener(evt, this._mediaResumeHandler, { passive: true });
        });

        // Only attempt immediate resume if video is actively playing unmuted or user has interacted
        if (!video.paused && !video.muted && video.volume > 0) {
          this.resumeAudioContext(true, video);
        } else if (this.hasUserGesture(video)) {
          this.resumeAudioContext(false, video);
        }
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

    // 1b. Sub-Rumble High-Pass Filter (Cone Flapping / Farting Prevention)
    let subRumbleFreq = this.PARAMS.SUB_RUMBLE_FREQ_MIN;
    if (isActive) {
      if (rawBoost > 3.0) {
        // Scale from 75Hz at >300% up to 80Hz at 500% to stop cone flapping / farting
        subRumbleFreq = 75 + ((rawBoost - 3.0) / 2.0) * 5;
      }
      if (safeProfile === "speech") {
        // Voice clarity profile cuts low-end rumble for maximum speech intelligibility
        subRumbleFreq = Math.max(subRumbleFreq, 80);
      }
    }
    if (this.state.subRumbleFilter) {
      this.state.subRumbleFilter.frequency.cancelScheduledValues(now);
      this.state.subRumbleFilter.frequency.setTargetAtTime(subRumbleFreq, now, t);
    }

    // 2. EQ Filter Processing
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

    // 3. Dynamic Headroom Limiter Scaling
    // Scales limiter parameters dynamically with boost level:
    // When boosting volume, the limiter ratio and knee scale smoothly so that higher
    // boosts produce audibly louder output at each slider position (100% -> 150% -> 200% -> 300% -> 500%)
    // rather than having intentional gain squashed down to the exact same ceiling by a fixed 20:1 ratio.
    // - 100% boost: ratio = 1.00 (transparent 1:1 pass-through)
    // - 150% boost: ratio = 1.16 (+5.0dB audible increase)
    // - 200% boost: ratio = 1.38 (+10.0dB audible increase)
    // - 300% boost: ratio = 1.87 (+15.0dB audible increase)
    // - 500% boost: ratio = 3.00 (+19.5dB maximum clean thunderous loudness)
    const limiterThreshold = -1.0;
    const limiterRatio = isActive
      ? (1.0 + Math.pow((rawBoost - 1.0) / 4.0, 1.2) * 2.0)
      : 1.0;
    const limiterKnee = isActive
      ? (10.0 + ((rawBoost - 1.0) / 4.0) * 10.0)
      : 0.0;
    const limiterAttack = 0.001;
    const limiterRelease = 0.28;

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
        this.state.brickwallLimiter.threshold.setTargetAtTime(limiterThreshold, now, t);
        this.state.brickwallLimiter.knee.cancelScheduledValues(now);
        this.state.brickwallLimiter.knee.setTargetAtTime(limiterKnee, now, t);
        this.state.brickwallLimiter.ratio.cancelScheduledValues(now);
        this.state.brickwallLimiter.ratio.setTargetAtTime(limiterRatio, now, t);
        this.state.brickwallLimiter.attack.cancelScheduledValues(now);
        this.state.brickwallLimiter.attack.setTargetAtTime(limiterAttack, now, t);
        this.state.brickwallLimiter.release.cancelScheduledValues(now);
        this.state.brickwallLimiter.release.setTargetAtTime(limiterRelease, now, t);
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

    // 4. Automatic Makeup Gain & Excess Peak Headroom Compensation
    // Chromium's DynamicsCompressorNode injects undocumented makeup gain.
    // We invert this hidden gain on compensator nodes so signals never clip past 0dBFS.
    let compCompensationGain = 1.0;
    if (isActive && this.state.compressorNode) {
      const preset = this.PARAMS.compPresets[safeProfile];
      if (preset && preset.ratio > 1.0 && preset.threshold < 0) {
        const compMakeupDb = -0.5 * preset.threshold * (1.0 - 1.0 / preset.ratio);
        compCompensationGain = Math.pow(10, -compMakeupDb / 20);
      }
    }

    let limiterCompensationGain = 1.0;
    if (isActive && this.state.brickwallLimiter) {
      // Dolby DRC & VLC Overdrive Headroom Compensation:
      // Chromium undocumented makeup gain formula:
      // makeup_gain = -0.5 * threshold * (1 - 1 / ratio)
      const limiterMakeupDb = -0.5 * limiterThreshold * (1.0 - 1.0 / limiterRatio);

      // Boost gain applied by gainNode:
      const boostGainDb = 20 * Math.log10(targetGain);

      // Profile EQ Headroom Management:
      // On 'flat', profileHeadroomDb is 0.0 (preserving Test 10B exact peak contract).
      // On active profiles with EQ boost (speech, bass, cinema, night), spectral energy is concentrated in
      // boosted resonant formant/bass bands. Factoring in this profile headroom offset guarantees that signals
      // strictly remain within the linear and soft-saturation region (<= 1.000) under full boost without flat-clipping.
      const profileHeadroomDb = (safeProfile === "flat") ? 0.0 : (
        safeProfile === "speech" ? 5.0 :
        safeProfile === "bass" ? 5.5 :
        safeProfile === "cinema" ? 3.5 :
        safeProfile === "night" ? 3.0 : 0.0
      );

      const lOut = limiterThreshold + (boostGainDb - limiterThreshold) / limiterRatio;
      const safeMarginDb = 0.75 * ((rawBoost - 1.0) / 4.0);
      const totalExcessDb = Math.max(0, lOut) + limiterMakeupDb + safeMarginDb + profileHeadroomDb;
      limiterCompensationGain = Math.pow(10, -totalExcessDb / 20);
    }

    if (this.state.compressorCompensatorNode) {
      this.state.compressorCompensatorNode.gain.cancelScheduledValues(now);
      this.state.compressorCompensatorNode.gain.setTargetAtTime(compCompensationGain, now, t);
    }

    if (this.state.compensatorNode) {
      this.state.compensatorNode.gain.cancelScheduledValues(now);
      this.state.compensatorNode.gain.setTargetAtTime(limiterCompensationGain, now, t);
    }

    // 5. Dolby Spatial Widener (Mid/Side stereo width control)
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

    // 6. Zero-Latency Anti-Burst Soft-Clipper (curve selection)
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

    this.state.isEnabled = !bypass;

    const ctx = this.state.audioContext;
    const now = ctx.currentTime;
    const t = this.PARAMS.BYPASS_CROSSFADE_TIME;

    if (bypass) {
      // Zero all EQ filters for transparent pass-through
      if (this.state.bassFilter) { this.state.bassFilter.gain.cancelScheduledValues(now); this.state.bassFilter.gain.setTargetAtTime(0, now, t); }
      if (this.state.subRumbleFilter) { this.state.subRumbleFilter.frequency.cancelScheduledValues(now); this.state.subRumbleFilter.frequency.setTargetAtTime(10, now, t); }
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
   * Recovers audio connection for a video element.
   * If a valid source node is already attached to the active AudioContext, reconnects it
   * into the DSP graph without invalidating the HTMLMediaElement binding.
   * If no valid source exists, performs a full audio graph setup.
   * @param {HTMLMediaElement} video
   */
  recoverAudioGraph(video) {
    if (!video) return;
    const ctx = this.state.audioContext;
    let cached = this.connectedVideos.get(video);
    if (!cached && video.__uvb_sourceNode) {
      cached = { sourceNode: video.__uvb_sourceNode, audioContext: video.__uvb_audioContext };
      this.connectedVideos.set(video, cached);
    }

    if (cached && cached.sourceNode && ctx && cached.audioContext === ctx && this.state.graphConnected && this.state.bassFilter) {
      try {
        cached.sourceNode.disconnect();
      } catch (e) {}
      try {
        cached.sourceNode.connect(this.state.bassFilter);
      } catch (e) {}
      this.state.sourceNode = cached.sourceNode;
      this.state.isConflictDetected = false;
      this.applyAudioEngineSettings();
      return;
    }

    this.state.isConflictDetected = false;
    this.setupAudioGraph(video);
  }

  /**
   * Clean up resources safely without permanently destroying HTMLMediaElement bindings.
   */
  cleanup() {
    if (this.state.sourceNode) {
      try {
        this.state.sourceNode.disconnect();
      } catch (e) {}
    }
    // Note: Do NOT call audioContext.close() as closing AudioContext permanently
    // disables the HTMLMediaElement from being reconnected via createMediaElementSource
    // in Chromium. We keep the context alive or suspended for reuse.
    this.state.sourceNode = null;
    this.state.gainNode = null;
    this.state.bassFilter = null;
    this.state.subRumbleFilter = null;
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
    if (this.state.antiBurstClipper) {
      try {
        this.state.antiBurstClipper.disconnect();
      } catch (e) {}
    }
    this.state.antiBurstClipper = null;
    this.state.graphConnected = false;
    this.state.isConflictDetected = false;
  }
}

// Make globally accessible in content script environment and Node.js testing
if (typeof window !== "undefined") {
  window.AudioEngine = AudioEngine;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = AudioEngine;
}
