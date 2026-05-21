/**
 * A-Math Game — Game Modes
 *
 * Manages selection between:
 *   - Player vs AI (default)
 *   - AI vs AI (spectator mode)
 *
 * Also handles AI Takeover toggle within Player vs AI mode.
 */

(function () {
  const MODE_PLAYER_VS_AI = 'player_vs_ai';
  const MODE_AI_VS_AI = 'ai_vs_ai';

  let currentMode = MODE_PLAYER_VS_AI;
  let aiTakeover = false;  // If true, AI plays for the player too
  let aiVsAiSpeed = 1;      // 1x to 10x speed multiplier
  let aiVsAiPaused = false;

  function getMode() { return currentMode; }
  function setMode(m) { currentMode = m; }

  function isAiTakeover() { return aiTakeover; }
  function setAiTakeover(v) { aiTakeover = !!v; }

  function getAiVsAiSpeed() { return aiVsAiSpeed; }
  function setAiVsAiSpeed(s) {
    s = Math.max(1, Math.min(10, parseInt(s, 10) || 1));
    aiVsAiSpeed = s;
  }

  function isAiVsAiPaused() { return aiVsAiPaused; }
  function setAiVsAiPaused(p) { aiVsAiPaused = !!p; }

  function reset() {
    aiTakeover = false;
    aiVsAiSpeed = 1;
    aiVsAiPaused = false;
  }

  /**
   * Compute delay between AI turns in AI vs AI mode based on speed setting.
   * Speed 1 = 1500ms, Speed 10 = 150ms (linear interpolation)
   */
  function getAiVsAiDelay() {
    const baseMs = 1500;
    return Math.max(150, Math.round(baseMs / aiVsAiSpeed));
  }

  window.AMath = window.AMath || {};
  window.AMath.modes = {
    MODE_PLAYER_VS_AI: MODE_PLAYER_VS_AI,
    MODE_AI_VS_AI: MODE_AI_VS_AI,
    getMode: getMode,
    setMode: setMode,
    isAiTakeover: isAiTakeover,
    setAiTakeover: setAiTakeover,
    getAiVsAiSpeed: getAiVsAiSpeed,
    setAiVsAiSpeed: setAiVsAiSpeed,
    isAiVsAiPaused: isAiVsAiPaused,
    setAiVsAiPaused: setAiVsAiPaused,
    getAiVsAiDelay: getAiVsAiDelay,
    reset: reset,
  };
})();
