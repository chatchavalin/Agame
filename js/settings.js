/**
 * A-Math Game — Settings
 *
 * Manages user-configurable game settings. Persisted in browser localStorage,
 * so settings survive page refresh and even browser restart.
 */

(function () {
  const STORAGE_KEY = 'amath_settings_v1';

  // Default settings (all configurable in the menu)
  const DEFAULTS = {
    chessClockEnabled: true,    // If false, timer doesn't count down, no penalty
    chessClockMinutes: 22,
    theme: 'capture',           // 'modern' | 'physical' | 'dark' | 'playful' | 'capture'
    trashTalkEnabled: true,     // AI shows trash-talk messages
    trashTalkLanguage: 'th',    // 'th' (Thai), 'en' (English), 'both' — language filter for trash-talk
    gameMode: 'player_vs_ai',   // 'player_vs_ai' | 'ai_vs_ai'
    soundEnabled: true,         // Play sound effects
    tileSet: 'prathom',         // 'prathom' (70 tiles) | 'mathayom' (100 tiles)
    showAiHand: true,           // Show AI rack faces (debugging/learning aid)
    showBoardTilePoints: false, // Show point values on tiles placed on the board (off by default — cleaner board)
    educationMode: false,       // If true, warns player about suboptimal moves and suggests better ones
    disableSixPassEnd: false,   // If true, game does NOT auto-end after 6 consecutive non-scoring turns
                                // (the official rule). Default false → rule remains ACTIVE.
    hideBlankFaceOnBoard: false,// If true, blank tiles placed on the board render with no text
                                // and no dashed marker — visually identical to regular tiles.
                                // Default false → current behavior (show assigned face + dashed orange border).
    aiSwapBrain: 'brain1',      // 'brain1' (seed-keeping, stable) | 'brain2' (probability, experimental)
    aiThinkSeconds: 180,        // AI thinking time per turn in seconds (30, 60, 120, 180, 300)
  };

  let current = null;

  function load() {
    if (current) return current;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        current = Object.assign({}, DEFAULTS, parsed);
      } else {
        current = Object.assign({}, DEFAULTS);
      }
    } catch (e) {
      console.warn('Failed to load settings, using defaults:', e);
      current = Object.assign({}, DEFAULTS);
    }
    return current;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.warn('Failed to save settings:', e);
    }
  }

  function get(key) {
    load();
    return current[key];
  }

  function set(key, value) {
    load();
    current[key] = value;
    save();
  }

  function getAll() {
    load();
    return Object.assign({}, current);
  }

  /**
   * Apply theme by setting a class on the body.
   */
  function applyTheme(themeName) {
    const body = document.body;
    body.classList.remove('theme-modern', 'theme-physical', 'theme-dark', 'theme-playful', 'theme-capture');
    body.classList.add('theme-' + themeName);
  }

  // Apply current theme as soon as this module loads
  document.addEventListener('DOMContentLoaded', function () {
    load();
    applyTheme(current.theme);
    // Apply sound setting
    if (window.AMath.sounds) window.AMath.sounds.setEnabled(current.soundEnabled);
  });

  /**
   * Show the settings popup.
   * @param onClose: callback after settings popup closes (so caller can re-render if needed)
   */
  function showPopup(onClose) {
    load();

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'settings-dialog';

    const title = document.createElement('h2');
    title.textContent = 'Settings';
    title.className = 'settings-title';
    dialog.appendChild(title);

    // Helper: create a section heading divider in the dialog
    function addSectionHeader(emoji, text) {
      const h = document.createElement('div');
      h.className = 'settings-section-header';
      h.innerHTML = '<span class="settings-section-icon">' + emoji +
                    '</span><span>' + text + '</span>';
      dialog.appendChild(h);
    }

    // ──────────────────────────────────────────────────────────────────
    // SECTION A — 🎮 Game Setup
    // ──────────────────────────────────────────────────────────────────
    addSectionHeader('🎮', 'Game Setup');

    // Game Mode
    const modeRow = document.createElement('div');
    modeRow.className = 'settings-row';
    modeRow.innerHTML =
      '<div class="settings-label-block">Game Mode</div>' +
      '<select id="setting-game-mode" class="settings-select">' +
      '<option value="player_vs_ai"' + (current.gameMode === 'player_vs_ai' ? ' selected' : '') + '>Player vs AI</option>' +
      '<option value="ai_vs_ai"' + (current.gameMode === 'ai_vs_ai' ? ' selected' : '') + '>AI vs AI (spectator)</option>' +
      '</select>';
    dialog.appendChild(modeRow);

    // Tile Set
    const tileSetRow = document.createElement('div');
    tileSetRow.className = 'settings-row';
    tileSetRow.innerHTML =
      '<div class="settings-label-block">Tile Set</div>' +
      '<select id="setting-tile-set" class="settings-select">' +
      '<option value="prathom"' + (current.tileSet === 'prathom' ? ' selected' : '') + '>ประถม Prathom (70 tiles)</option>' +
      '<option value="mathayom"' + (current.tileSet === 'mathayom' ? ' selected' : '') + '>มัธยม Mathayom (100 tiles)</option>' +
      '</select>';
    dialog.appendChild(tileSetRow);

    // Chess clock
    const clockRow = document.createElement('div');
    clockRow.className = 'settings-row';
    clockRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-chess-clock"' +
      (current.chessClockEnabled ? ' checked' : '') +
      '><span>Chess clock (22 min/player)</span>' +
      '</label>';
    dialog.appendChild(clockRow);

    // Disable the 6-consecutive-passes auto-end rule — when ON, the game
    // will NOT end after 6 non-scoring turns. Default OFF → the official
    // A-Math rule remains active. Lives in the Game section as it changes
    // game-end behavior, not visual prefs.
    const disableSixPassRow = document.createElement('div');
    disableSixPassRow.className = 'settings-row';
    disableSixPassRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-disable-six-pass-end"' +
      (current.disableSixPassEnd ? ' checked' : '') +
      '><span>Disable 6-consecutive-passes game end</span>' +
      '</label>';
    dialog.appendChild(disableSixPassRow);

    // Education mode — when ON, the game warns about suboptimal moves
    // and suggests better alternatives before committing the player's action.
    const educationRow = document.createElement('div');
    educationRow.className = 'settings-row';
    educationRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-education-mode"' +
      (current.educationMode ? ' checked' : '') +
      '><span>Education mode (suggest better moves)</span>' +
      '</label>';
    dialog.appendChild(educationRow);

    // ──────────────────────────────────────────────────────────────────
    // SECTION B — 🎨 Display
    // ──────────────────────────────────────────────────────────────────
    addSectionHeader('🎨', 'Display');

    // Theme
    const themeRow = document.createElement('div');
    themeRow.className = 'settings-row';
    themeRow.innerHTML =
      '<div class="settings-label-block">Theme</div>' +
      '<select id="setting-theme" class="settings-select">' +
      '<option value="capture"' + (current.theme === 'capture' ? ' selected' : '') + '>Capture (with coordinates)</option>' +
      '<option value="modern"' + (current.theme === 'modern' ? ' selected' : '') + '>Clean & Modern</option>' +
      '<option value="physical"' + (current.theme === 'physical' ? ' selected' : '') + '>Physical Board</option>' +
      '<option value="dark"' + (current.theme === 'dark' ? ' selected' : '') + '>Dark Mode</option>' +
      '<option value="playful"' + (current.theme === 'playful' ? ' selected' : '') + '>Bright & Playful</option>' +
      '</select>';
    dialog.appendChild(themeRow);

    // Show AI Hand
    const showAiHandRow = document.createElement('div');
    showAiHandRow.className = 'settings-row';
    showAiHandRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-show-ai-hand"' +
      (current.showAiHand ? ' checked' : '') +
      '><span>Show AI hand</span>' +
      '</label>';
    dialog.appendChild(showAiHandRow);

    // Show tile points on board
    const showPointsRow = document.createElement('div');
    showPointsRow.className = 'settings-row';
    showPointsRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-show-board-points"' +
      (current.showBoardTilePoints ? ' checked' : '') +
      '><span>Show tile points on board</span>' +
      '</label>';
    dialog.appendChild(showPointsRow);

    // Hide blank tile face on board — when ON, blanks placed on the board
    // look exactly like regular tiles (no text, no dashed marker).
    // Default OFF → keep the current behavior (assigned letter + dashed orange).
    const hideBlankFaceRow = document.createElement('div');
    hideBlankFaceRow.className = 'settings-row';
    hideBlankFaceRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-hide-blank-face"' +
      (current.hideBlankFaceOnBoard ? ' checked' : '') +
      '><span>Hide BLANK face</span>' +
      '</label>';
    dialog.appendChild(hideBlankFaceRow);

    // ──────────────────────────────────────────────────────────────────
    // SECTION C — 🤖 AI Behavior
    // ──────────────────────────────────────────────────────────────────
    addSectionHeader('🤖', 'AI Behavior');

    // AI Think Time
    const thinkRow = document.createElement('div');
    thinkRow.className = 'settings-row';
    thinkRow.innerHTML =
      '<div class="settings-label-block">AI Thinking Time</div>' +
      '<select id="setting-ai-think-time" class="settings-select">' +
      '<option value="30"' + (current.aiThinkSeconds === 30 ? ' selected' : '') + '>30 seconds</option>' +
      '<option value="60"' + (current.aiThinkSeconds === 60 ? ' selected' : '') + '>1 minute</option>' +
      '<option value="120"' + (current.aiThinkSeconds === 120 ? ' selected' : '') + '>2 minutes</option>' +
      '<option value="180"' + (current.aiThinkSeconds === 180 ? ' selected' : '') + '>3 minutes</option>' +
      '<option value="300"' + (current.aiThinkSeconds === 300 ? ' selected' : '') + '>5 minutes</option>' +
      '</select>';
    dialog.appendChild(thinkRow);

    // AI Swap Strategy
    const brainRow = document.createElement('div');
    brainRow.className = 'settings-row';
    brainRow.innerHTML =
      '<div class="settings-label-block">AI Swap Strategy</div>' +
      '<select id="setting-ai-swap-brain" class="settings-select">' +
      '<option value="brain1"' + (current.aiSwapBrain === 'brain1' ? ' selected' : '') + '>Brain 1 — Seed Keeping</option>' +
      '<option value="brain2"' + (current.aiSwapBrain === 'brain2' ? ' selected' : '') + '>Brain 2 — Probability</option>' +
      '</select>';
    dialog.appendChild(brainRow);

    // ──────────────────────────────────────────────────────────────────
    // SECTION D — 💬 Audio & Banter
    // ──────────────────────────────────────────────────────────────────
    addSectionHeader('💬', 'Audio & Banter');

    // Sound
    const soundRow = document.createElement('div');
    soundRow.className = 'settings-row';
    soundRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-sound"' +
      (current.soundEnabled ? ' checked' : '') +
      '><span>Sound effects</span>' +
      '</label>';
    dialog.appendChild(soundRow);

    // Trash-talk
    const ttRow = document.createElement('div');
    ttRow.className = 'settings-row';
    ttRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-trash-talk"' +
      (current.trashTalkEnabled ? ' checked' : '') +
      '><span>AI trash-talk</span>' +
      '</label>';
    dialog.appendChild(ttRow);

    // Trash-talk language
    const ttLangRow = document.createElement('div');
    ttLangRow.className = 'settings-row';
    ttLangRow.innerHTML =
      '<div class="settings-label-block">Trash-talk language</div>' +
      '<select id="setting-trash-talk-lang" class="settings-select">' +
      '<option value="th"' + (current.trashTalkLanguage === 'th' ? ' selected' : '') + '>Thai only</option>' +
      '<option value="en"' + (current.trashTalkLanguage === 'en' ? ' selected' : '') + '>English only</option>' +
      '<option value="both"' + (current.trashTalkLanguage === 'both' ? ' selected' : '') + '>Both</option>' +
      '</select>';
    dialog.appendChild(ttLangRow);

    // Save + Close buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'settings-buttons';

    const btnSave = document.createElement('button');
    btnSave.className = 'btn btn-primary';
    btnSave.textContent = 'Save';
    btnSave.addEventListener('click', function () {
      // Read settings from the form
      const modeSelect = document.getElementById('setting-game-mode');
      const clockCheckbox = document.getElementById('setting-chess-clock');
      const themeSelect = document.getElementById('setting-theme');
      const tileSetSelect = document.getElementById('setting-tile-set');
      const ttCheckbox = document.getElementById('setting-trash-talk');
      const soundCheckbox = document.getElementById('setting-sound');
      const showAiHandCheckbox = document.getElementById('setting-show-ai-hand');
      const showPointsCheckbox = document.getElementById('setting-show-board-points');
      const hideBlankFaceCheckbox = document.getElementById('setting-hide-blank-face');
      const disableSixPassCheckbox = document.getElementById('setting-disable-six-pass-end');
      const educationCheckbox = document.getElementById('setting-education-mode');
      const brainSelect = document.getElementById('setting-ai-swap-brain');
      const thinkSelect = document.getElementById('setting-ai-think-time');
      const ttLangSelect = document.getElementById('setting-trash-talk-lang');

      // Snapshot OLD values to detect what changed
      const old = Object.assign({}, current);

      // Apply NEW values
      current.gameMode = modeSelect.value;
      current.chessClockEnabled = clockCheckbox.checked;
      current.theme = themeSelect.value;
      current.tileSet = tileSetSelect.value;
      current.trashTalkEnabled = ttCheckbox.checked;
      current.soundEnabled = soundCheckbox.checked;
      current.showAiHand = showAiHandCheckbox.checked;
      if (showPointsCheckbox) current.showBoardTilePoints = showPointsCheckbox.checked;
      if (hideBlankFaceCheckbox) current.hideBlankFaceOnBoard = hideBlankFaceCheckbox.checked;
      if (educationCheckbox) current.educationMode = educationCheckbox.checked;
      if (disableSixPassCheckbox) current.disableSixPassEnd = disableSixPassCheckbox.checked;
      if (brainSelect) current.aiSwapBrain = brainSelect.value;
      if (thinkSelect) current.aiThinkSeconds = parseInt(thinkSelect.value, 10);
      if (ttLangSelect) current.trashTalkLanguage = ttLangSelect.value;
      save();

      // === Apply live settings immediately ===
      // Theme: just swap the body class — no restart needed
      applyTheme(current.theme);
      // Sound: enable/disable the audio engine
      if (window.AMath.sounds) window.AMath.sounds.setEnabled(current.soundEnabled);

      // === Categorise what changed ===
      // Settings that REQUIRE a new game to take effect.
      // Everything else is live and was either applied above or will be picked up
      // at the next decision/render naturally.
      const RESTART_REQUIRED_KEYS = ['gameMode', 'tileSet', 'chessClockEnabled'];
      const restartChanged = RESTART_REQUIRED_KEYS.filter(k => old[k] !== current[k]);

      // Tell live-changed settings to anyone listening (main.js may want to
      // re-render the AI rack if showAiHand toggled, refresh status text if
      // trash-talk toggled, etc.).
      const liveChanged = [];
      const ALL_KEYS = Object.keys(current);
      for (const k of ALL_KEYS) {
        if (RESTART_REQUIRED_KEYS.indexOf(k) !== -1) continue;
        if (old[k] !== current[k]) liveChanged.push(k);
      }

      overlay.remove();
      if (onClose) {
        onClose({
          saved: true,
          restartChanged: restartChanged,   // keys that need a new game
          liveChanged: liveChanged,         // keys that applied immediately
        });
      }
    });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-secondary';
    btnCancel.textContent = 'Cancel';
    btnCancel.addEventListener('click', function () {
      overlay.remove();
      if (onClose) onClose({ saved: false, restartChanged: [], liveChanged: [] });
    });

    btnRow.appendChild(btnSave);
    btnRow.appendChild(btnCancel);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  window.AMath = window.AMath || {};
  window.AMath.settings = {
    get: get,
    set: set,
    getAll: getAll,
    showPopup: showPopup,
  };
})();
