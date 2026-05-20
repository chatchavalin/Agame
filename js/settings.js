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
    // SECTION A — 🎮 Game Setup (restart-required settings live here)
    // ──────────────────────────────────────────────────────────────────
    addSectionHeader('🎮', 'Game Setup');

    // Game Mode
    const modeRow = document.createElement('div');
    modeRow.className = 'settings-row';
    modeRow.innerHTML =
      '<div class="settings-label" style="display:block;margin-bottom:6px">' +
      '<span>Game Mode</span> <span class="settings-badge-restart">needs new game</span>' +
      '</div>' +
      '<select id="setting-game-mode" class="settings-select">' +
      '<option value="player_vs_ai"' + (current.gameMode === 'player_vs_ai' ? ' selected' : '') + '>Player vs AI (default)</option>' +
      '<option value="ai_vs_ai"' + (current.gameMode === 'ai_vs_ai' ? ' selected' : '') + '>AI vs AI (spectator)</option>' +
      '</select>' +
      '<p class="settings-hint">AI vs AI: watch two AIs play. You can pause and control speed.</p>';
    dialog.appendChild(modeRow);

    // Tile Set
    const tileSetRow = document.createElement('div');
    tileSetRow.className = 'settings-row';
    tileSetRow.innerHTML =
      '<div class="settings-label" style="display:block;margin-bottom:6px">' +
      '<span>Tile Set Edition</span> <span class="settings-badge-restart">needs new game</span>' +
      '</div>' +
      '<select id="setting-tile-set" class="settings-select">' +
      '<option value="prathom"' + (current.tileSet === 'prathom' ? ' selected' : '') + '>ประถม Prathom (70 tiles — child-friendly)</option>' +
      '<option value="mathayom"' + (current.tileSet === 'mathayom' ? ' selected' : '') + '>มัธยม Mathayom (100 tiles — standard)</option>' +
      '</select>' +
      '<p class="settings-hint">ประถม: fewer tiles, no 17/18/19, simpler operators. มัธยม: full 100-tile standard set.</p>';
    dialog.appendChild(tileSetRow);

    // Chess clock toggle
    const clockRow = document.createElement('div');
    clockRow.className = 'settings-row';
    clockRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-chess-clock"' +
      (current.chessClockEnabled ? ' checked' : '') +
      '>' +
      '<span>Enable chess clock (22 min/player)</span> <span class="settings-badge-restart">needs new game</span>' +
      '</label>' +
      '<p class="settings-hint">When off: no time limit, no time penalty.</p>';
    dialog.appendChild(clockRow);

    // ──────────────────────────────────────────────────────────────────
    // SECTION B — 🎨 Display (live-applied visual settings)
    // ──────────────────────────────────────────────────────────────────
    addSectionHeader('🎨', 'Display');

    // Theme
    const themeRow = document.createElement('div');
    themeRow.className = 'settings-row';
    themeRow.innerHTML =
      '<div class="settings-label" style="display:block;margin-bottom:6px">' +
      '<span>Theme</span> <span class="settings-badge-live">applies instantly</span>' +
      '</div>' +
      '<select id="setting-theme" class="settings-select">' +
      '<option value="capture"' + (current.theme === 'capture' ? ' selected' : '') + '>Capture (default — clean, with coordinates)</option>' +
      '<option value="modern"' + (current.theme === 'modern' ? ' selected' : '') + '>Clean & Modern</option>' +
      '<option value="physical"' + (current.theme === 'physical' ? ' selected' : '') + '>Match Physical Board</option>' +
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
      '>' +
      '<span>Show AI hand (for learning/debugging)</span> <span class="settings-badge-live">applies instantly</span>' +
      '</label>' +
      '<p class="settings-hint">When ON, AI rack faces are visible. In AI vs AI mode, both AI racks visible.</p>';
    dialog.appendChild(showAiHandRow);

    // ──────────────────────────────────────────────────────────────────
    // SECTION C — 🤖 AI Behavior
    // ──────────────────────────────────────────────────────────────────
    addSectionHeader('🤖', 'AI Behavior');

    // AI Think Time
    const thinkRow = document.createElement('div');
    thinkRow.className = 'settings-row';
    thinkRow.innerHTML =
      '<label class="settings-label" for="setting-ai-think-time">' +
      '<span>AI Thinking Time</span> <span class="settings-badge-live">applies on AI\'s next turn</span>' +
      '</label>' +
      '<select id="setting-ai-think-time" class="settings-select">' +
      '<option value="30"' + (current.aiThinkSeconds === 30 ? ' selected' : '') + '>30 seconds (fastest)</option>' +
      '<option value="60"' + (current.aiThinkSeconds === 60 ? ' selected' : '') + '>1 minute</option>' +
      '<option value="120"' + (current.aiThinkSeconds === 120 ? ' selected' : '') + '>2 minutes</option>' +
      '<option value="180"' + (current.aiThinkSeconds === 180 ? ' selected' : '') + '>3 minutes (default — best for Bingo finding)</option>' +
      '<option value="300"' + (current.aiThinkSeconds === 300 ? ' selected' : '') + '>5 minutes (extremely thorough)</option>' +
      '</select>' +
      '<p class="settings-hint">How long the AI can think per turn. More time = better Bingos, especially with BLANKs.</p>';
    dialog.appendChild(thinkRow);

    // AI Swap Strategy
    const brainRow = document.createElement('div');
    brainRow.className = 'settings-row';
    brainRow.innerHTML =
      '<label class="settings-label" for="setting-ai-swap-brain">' +
      '<span>AI Swap Strategy</span> <span class="settings-badge-live">applies on AI\'s next turn</span>' +
      '</label>' +
      '<select id="setting-ai-swap-brain" class="settings-select">' +
      '<option value="brain1"' + (current.aiSwapBrain === 'brain1' ? ' selected' : '') + '>Brain 1 — Seed Keeping (stable)</option>' +
      '<option value="brain2"' + (current.aiSwapBrain === 'brain2' ? ' selected' : '') + '>Brain 2 — Probability (experimental)</option>' +
      '</select>' +
      '<p class="settings-hint">Brain 1 keeps a fixed seed template. Brain 2 computes expected score for many candidates.</p>';
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
      '>' +
      '<span>Enable sound effects</span> <span class="settings-badge-live">applies instantly</span>' +
      '</label>' +
      '<p class="settings-hint">Tile click, submit, bingo fanfare, etc.</p>';
    dialog.appendChild(soundRow);

    // Trash-talk
    const ttRow = document.createElement('div');
    ttRow.className = 'settings-row';
    ttRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-trash-talk"' +
      (current.trashTalkEnabled ? ' checked' : '') +
      '>' +
      '<span>Enable AI trash-talk messages</span> <span class="settings-badge-live">applies instantly</span>' +
      '</label>' +
      '<p class="settings-hint">AI taunts/comments during the game. Includes โค้ชตี๋ and friends.</p>';
    dialog.appendChild(ttRow);

    // Trash-talk language
    const ttLangRow = document.createElement('div');
    ttLangRow.className = 'settings-row';
    ttLangRow.innerHTML =
      '<label class="settings-label">' +
      '<span>Trash-talk language</span> <span class="settings-badge-live">applies instantly</span>' +
      '<select id="setting-trash-talk-lang" class="settings-select">' +
      '<option value="th"' + (current.trashTalkLanguage === 'th' ? ' selected' : '') + '>Thai only (ภาษาไทย)</option>' +
      '<option value="en"' + (current.trashTalkLanguage === 'en' ? ' selected' : '') + '>English only</option>' +
      '<option value="both"' + (current.trashTalkLanguage === 'both' ? ' selected' : '') + '>Both / ทั้งสอง</option>' +
      '</select>' +
      '</label>' +
      '<p class="settings-hint">Filter trash-talk messages by language. Default: Thai.</p>';
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
