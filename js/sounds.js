/**
 * A-Math Game — Sound Effects
 *
 * Uses Web Audio API to synthesize sounds programmatically.
 * No audio files needed — works offline, loads instantly.
 *
 * All sounds respect the soundEnabled setting.
 */

(function () {
  let audioCtx = null;
  let enabled = true;

  /**
   * Lazy-init AudioContext on first sound (required by browser autoplay policies).
   */
  function getCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('Web Audio API not supported');
      }
    }
    // Resume if suspended (browser autoplay policy)
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function setEnabled(v) {
    enabled = !!v;
  }

  /**
   * Play a simple tone with envelope.
   * @param freq: frequency in Hz
   * @param duration: in seconds
   * @param type: 'sine' | 'square' | 'triangle' | 'sawtooth'
   * @param volume: 0-1
   */
  function tone(freq, duration, type, volume) {
    if (!enabled) return;
    const ctx = getCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0;

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    const v = volume !== undefined ? volume : 0.15;

    // Envelope: quick attack, exponential decay
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(v, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  /**
   * Play a chord (multiple tones simultaneously).
   */
  function chord(freqs, duration, type, volume) {
    for (const f of freqs) tone(f, duration, type, volume);
  }

  /**
   * Play a sequence of tones (arpeggio).
   * @param notes: array of {freq, duration, delay}
   */
  function arpeggio(notes, type, volume) {
    if (!enabled) return;
    for (const n of notes) {
      setTimeout(() => tone(n.freq, n.duration, type, volume), n.delay * 1000);
    }
  }

  /**
   * Play a short burst of filtered noise — the percussive transient that
   * gives a sound its "physical" character (a tile clacking, not a beep).
   * Envelope is baked into the buffer (fast exponential decay) so it reads
   * as a sharp clack rather than a sustained hiss.
   *
   * @param duration: seconds (keep short, e.g. 0.02–0.06)
   * @param filterType: 'bandpass' | 'highpass' | 'lowpass'
   * @param filterFreq: filter center/cutoff in Hz
   * @param q: filter resonance (bandpass sharpness)
   * @param volume: 0-1 peak
   */
  function noiseBurst(duration, filterType, filterFreq, q, volume) {
    if (!enabled) return;
    const ctx = getCtx();
    if (!ctx) return;

    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // White noise shaped by a steep decay envelope (cubic) → clack, not hiss.
      const env = Math.pow(1 - i / len, 3);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filt = ctx.createBiquadFilter();
    filt.type = filterType || 'bandpass';
    filt.frequency.value = filterFreq || 2000;
    if (q !== undefined) filt.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.value = volume !== undefined ? volume : 0.2;

    src.connect(filt);
    filt.connect(gain);
    gain.connect(ctx.destination);

    src.start();
    src.stop(ctx.currentTime + duration + 0.02);
  }

  // ============================================================================
  // SOUND EFFECTS
  // ============================================================================

  function tileClick() {
    // Picking up / selecting a tile: a light, high plastic "tick".
    // Short bright noise transient + a faint high body tap.
    noiseBurst(0.026, 'highpass', 3200, 0.7, 0.10);
    tone(340, 0.03, 'triangle', 0.05);
  }

  function tilePlace() {
    // Placing a tile on the board: the satisfying physical "clack" of a
    // plastic tile hitting the board. A sharp mid-band noise transient
    // (the contact click) layered over a low triangle "tok" (the body
    // resonance / hollow board thunk).
    noiseBurst(0.045, 'bandpass', 2600, 1.2, 0.22);
    tone(168, 0.07, 'triangle', 0.11);
  }

  function submitSuccess() {
    arpeggio([
      { freq: 523, duration: 0.1, delay: 0 },     // C5
      { freq: 659, duration: 0.1, delay: 0.08 },  // E5
      { freq: 784, duration: 0.15, delay: 0.16 }, // G5
    ], 'sine', 0.18);
  }

  function submitFail() {
    tone(220, 0.15, 'sawtooth', 0.12);
    setTimeout(() => tone(180, 0.2, 'sawtooth', 0.12), 100);
  }

  function bingo() {
    // Triumphant fanfare
    arpeggio([
      { freq: 523, duration: 0.15, delay: 0 },     // C5
      { freq: 659, duration: 0.15, delay: 0.1 },   // E5
      { freq: 784, duration: 0.15, delay: 0.2 },   // G5
      { freq: 1047, duration: 0.4, delay: 0.3 },   // C6 sustained
    ], 'triangle', 0.2);
    // Add a second voice for richness
    setTimeout(() => {
      arpeggio([
        { freq: 392, duration: 0.4, delay: 0 },    // G4
      ], 'sine', 0.1);
    }, 300);
  }

  function aiPlay() {
    tone(440, 0.12, 'triangle', 0.1);
  }

  function aiThinking() {
    // Subtle indicator
    tone(300, 0.06, 'sine', 0.05);
  }

  function gameEnd() {
    // Bittersweet descending chord
    chord([523, 659, 784], 0.6, 'sine', 0.15); // C major
  }

  function buttonClick() {
    tone(900, 0.03, 'square', 0.05);
  }

  function swap() {
    // Shuffle/whoosh sound
    arpeggio([
      { freq: 400, duration: 0.06, delay: 0 },
      { freq: 500, duration: 0.06, delay: 0.05 },
      { freq: 350, duration: 0.06, delay: 0.1 },
      { freq: 450, duration: 0.06, delay: 0.15 },
    ], 'triangle', 0.1);
  }

  function pass() {
    // Descending two-note — meh
    tone(440, 0.12, 'sine', 0.1);
    setTimeout(() => tone(330, 0.15, 'sine', 0.1), 120);
  }

  function undo() {
    // Rewind sound — descending arpeggio
    arpeggio([
      { freq: 784, duration: 0.08, delay: 0 },
      { freq: 659, duration: 0.08, delay: 0.06 },
      { freq: 523, duration: 0.08, delay: 0.12 },
      { freq: 392, duration: 0.12, delay: 0.18 },
    ], 'sine', 0.12);
  }

  function challenge() {
    // Dramatic hit
    chord([330, 415, 523], 0.3, 'sawtooth', 0.08);
    setTimeout(() => tone(262, 0.4, 'sine', 0.15), 200);
  }

  function timerWarning() {
    // Urgent beep-beep
    tone(880, 0.08, 'square', 0.12);
    setTimeout(() => tone(880, 0.08, 'square', 0.12), 150);
  }

  function x9Score() {
    // Dramatic explosion — big score
    arpeggio([
      { freq: 262, duration: 0.2, delay: 0 },
      { freq: 330, duration: 0.2, delay: 0.1 },
      { freq: 392, duration: 0.2, delay: 0.2 },
      { freq: 523, duration: 0.3, delay: 0.3 },
      { freq: 784, duration: 0.5, delay: 0.4 },
    ], 'triangle', 0.2);
    setTimeout(() => chord([523, 659, 784, 1047], 0.6, 'sine', 0.12), 500);
  }

  function error() {
    // Buzzer
    tone(150, 0.25, 'sawtooth', 0.1);
  }

  function turnStart() {
    // Gentle ping — your turn
    tone(660, 0.1, 'sine', 0.08);
  }

  // ============================================================================
  // EXPOSE
  // ============================================================================

  window.AMath = window.AMath || {};
  window.AMath.sounds = {
    setEnabled: setEnabled,
    tileClick: tileClick,
    tilePlace: tilePlace,
    submitSuccess: submitSuccess,
    submitFail: submitFail,
    bingo: bingo,
    aiPlay: aiPlay,
    aiThinking: aiThinking,
    gameEnd: gameEnd,
    buttonClick: buttonClick,
    swap: swap,
    pass: pass,
    undo: undo,
    challenge: challenge,
    timerWarning: timerWarning,
    x9Score: x9Score,
    error: error,
    turnStart: turnStart,
  };
})();
