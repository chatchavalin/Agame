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
    theme: 'modern',            // 'physical' | 'modern' | 'dark' | 'playful'
    trashTalkEnabled: true,     // AI shows trash-talk messages
    gameMode: 'player_vs_ai',   // 'player_vs_ai' | 'ai_vs_ai'
    soundEnabled: true,         // Play sound effects
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
    body.classList.remove('theme-modern', 'theme-physical', 'theme-dark', 'theme-playful');
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

    // Setting 1: Game Mode
    const modeRow = document.createElement('div');
    modeRow.className = 'settings-row';
    modeRow.innerHTML =
      '<div class="settings-label" style="display:block;margin-bottom:6px"><span>Game Mode</span></div>' +
      '<select id="setting-game-mode" class="settings-select">' +
      '<option value="player_vs_ai"' + (current.gameMode === 'player_vs_ai' ? ' selected' : '') + '>Player vs AI (default)</option>' +
      '<option value="ai_vs_ai"' + (current.gameMode === 'ai_vs_ai' ? ' selected' : '') + '>AI vs AI (spectator)</option>' +
      '</select>' +
      '<p class="settings-hint">AI vs AI: watch two AIs play. You can pause and control speed.</p>';
    dialog.appendChild(modeRow);

    // Setting 2: Chess clock toggle
    const clockRow = document.createElement('div');
    clockRow.className = 'settings-row';
    clockRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-chess-clock"' +
      (current.chessClockEnabled ? ' checked' : '') +
      '>' +
      '<span>Enable chess clock (22 min/player)</span>' +
      '</label>' +
      '<p class="settings-hint">When off: no time limit, no time penalty.</p>';
    dialog.appendChild(clockRow);

    // Setting 2: Theme
    const themeRow = document.createElement('div');
    themeRow.className = 'settings-row';
    themeRow.innerHTML =
      '<div class="settings-label" style="display:block;margin-bottom:6px"><span>Theme</span></div>' +
      '<select id="setting-theme" class="settings-select">' +
      '<option value="modern"' + (current.theme === 'modern' ? ' selected' : '') + '>Clean & Modern (default)</option>' +
      '<option value="physical"' + (current.theme === 'physical' ? ' selected' : '') + '>Match Physical Board</option>' +
      '<option value="dark"' + (current.theme === 'dark' ? ' selected' : '') + '>Dark Mode</option>' +
      '<option value="playful"' + (current.theme === 'playful' ? ' selected' : '') + '>Bright & Playful</option>' +
      '</select>';
    dialog.appendChild(themeRow);

    // Setting: Trash-talk
    const ttRow = document.createElement('div');
    ttRow.className = 'settings-row';
    ttRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-trash-talk"' +
      (current.trashTalkEnabled ? ' checked' : '') +
      '>' +
      '<span>Enable AI trash-talk messages</span>' +
      '</label>' +
      '<p class="settings-hint">AI taunts/comments during the game.</p>';
    dialog.appendChild(ttRow);

    // Setting: Sound
    const soundRow = document.createElement('div');
    soundRow.className = 'settings-row';
    soundRow.innerHTML =
      '<label class="settings-label">' +
      '<input type="checkbox" id="setting-sound"' +
      (current.soundEnabled ? ' checked' : '') +
      '>' +
      '<span>Enable sound effects</span>' +
      '</label>' +
      '<p class="settings-hint">Tile click, submit, bingo fanfare, etc.</p>';
    dialog.appendChild(soundRow);

    // Save + Close buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'settings-buttons';

    const btnSave = document.createElement('button');
    btnSave.className = 'btn btn-primary';
    btnSave.textContent = 'Save & Apply (starts new game)';
    btnSave.addEventListener('click', function () {
      // Read settings from the form
      const modeSelect = document.getElementById('setting-game-mode');
      const clockCheckbox = document.getElementById('setting-chess-clock');
      const themeSelect = document.getElementById('setting-theme');
      const ttCheckbox = document.getElementById('setting-trash-talk');
      const soundCheckbox = document.getElementById('setting-sound');
      current.gameMode = modeSelect.value;
      current.chessClockEnabled = clockCheckbox.checked;
      current.theme = themeSelect.value;
      current.trashTalkEnabled = ttCheckbox.checked;
      current.soundEnabled = soundCheckbox.checked;
      save();
      applyTheme(current.theme);
      // Apply sound setting immediately
      if (window.AMath.sounds) window.AMath.sounds.setEnabled(current.soundEnabled);
      overlay.remove();
      if (onClose) onClose(true);
    });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-secondary';
    btnCancel.textContent = 'Cancel';
    btnCancel.addEventListener('click', function () {
      overlay.remove();
      if (onClose) onClose(false);
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
