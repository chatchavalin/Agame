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

  // ============================================================================
  // SOUND EFFECTS
  // ============================================================================

  function tileClick() {
    tone(800, 0.05, 'square', 0.08);
  }

  function tilePlace() {
    tone(600, 0.08, 'sine', 0.12);
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
  };
})();
