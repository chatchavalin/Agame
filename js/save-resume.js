/**
 * A-Math Game — Save / Resume
 *
 * Auto-saves the game state to localStorage after every move. On app load,
 * if a saved game exists, offers to resume.
 *
 * Per Master Spec §13: full state serialization.
 */

(function () {
  const STORAGE_KEY = 'amath_savegame_v1';

  /**
   * Save the current game state.
   * @param state: the session object (board, racks, bag, scores, etc.)
   */
  function save(state) {
    try {
      const snapshot = {
        version: 1,
        timestamp: Date.now(),
        board: state.board,
        playerRack: state.playerRack,
        aiRack: state.aiRack,
        bag: state.bag,
        playerScore: state.playerScore,
        aiScore: state.aiScore,
        isPlayerTurn: state.isPlayerTurn,
        isFirstMove: state.isFirstMove,
        consecutiveNonScoringTurns: state.consecutiveNonScoringTurns,
        aiActualPlayCount: state.aiActualPlayCount || 0,
        lastOpponentAction: state.lastOpponentAction || null,
        playerTimeSeconds: state.playerTimeSeconds,
        aiTimeSeconds: state.aiTimeSeconds,
        chessClockEnabled: state.chessClockEnabled,
        // Save score sheet too
        scoreSheet: window.AMath.scoreSheet ? window.AMath.scoreSheet.getAllEntries() : [],
        // Save the in-progress move recording (per-turn tile placements) so a
        // resumed game can still be sent to Analysis with full detail.
        recording: window.AMath.replayRecorder && window.AMath.replayRecorder.snapshot
                   ? window.AMath.replayRecorder.snapshot() : null,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('Failed to save game:', e);
    }
  }

  /**
   * Load saved game state, or null if none.
   */
  function load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (parsed.version !== 1) return null;
      // Backfill slotMap on older saves (saved before position-stable racks).
      // Without this, tilesBySlot would return all-nulls and the rack would
      // render empty even though tiles exist.
      ensureSlotMap(parsed.playerRack);
      ensureSlotMap(parsed.aiRack);
      return parsed;
    } catch (e) {
      console.warn('Failed to load game:', e);
      return null;
    }
  }

  /**
   * If a rack has no slotMap (older save format), assign each tile to the
   * slot index corresponding to its position in the packed tiles array.
   */
  function ensureSlotMap(rack) {
    if (!rack || !rack.tiles) return;
    if (rack.slotMap && Object.keys(rack.slotMap).length > 0) return;
    rack.slotMap = {};
    for (let i = 0; i < rack.tiles.length; i++) {
      if (rack.tiles[i]) rack.slotMap[rack.tiles[i].id] = i;
    }
  }

  function hasSavedGame() {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  function clearSave() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear save:', e);
    }
    // Also clear the cross-device server copy, if logged in. Best-effort:
    // every clearSave() site (new game, game over, settings reset) is a point
    // where the in-progress game has genuinely ended, so the server copy
    // should go too. Centralized here so all call sites are covered.
    try {
      if (window.AMathBridge && window.AMathBridge.clearInProgressGame) {
        window.AMathBridge.clearInProgressGame();
      }
    } catch (e) { /* non-fatal */ }
  }

  /**
   * Overwrite the local save slot with a raw pre-serialized JSON string
   * (used to seed a newer copy pulled from the server before the resume
   * prompt). Returns true on success.
   */
  function saveRaw(jsonString) {
    try {
      localStorage.setItem(STORAGE_KEY, jsonString);
      return true;
    } catch (e) {
      console.warn('Failed to saveRaw:', e);
      return false;
    }
  }

  /**
   * Returns a brief description of the saved game (for UI display).
   */
  function describeSavedGame() {
    const data = load();
    if (!data) return null;
    const timeStr = new Date(data.timestamp).toLocaleString();
    return {
      timestamp: data.timestamp,
      timeStr: timeStr,
      playerScore: data.playerScore,
      aiScore: data.aiScore,
      whoseTurn: data.isPlayerTurn ? 'Your turn' : "AI's turn",
    };
  }

  /**
   * Serialize the current session state to a JSON string (for export).
   */
  function serialize(state) {
    const snapshot = {
      version: 1,
      timestamp: Date.now(),
      board: state.board,
      playerRack: state.playerRack,
      aiRack: state.aiRack,
      bag: state.bag,
      playerScore: state.playerScore,
      aiScore: state.aiScore,
      isPlayerTurn: state.isPlayerTurn,
      isFirstMove: state.isFirstMove,
      consecutiveNonScoringTurns: state.consecutiveNonScoringTurns,
      aiActualPlayCount: state.aiActualPlayCount || 0,
      lastOpponentAction: state.lastOpponentAction || null,
      playerTimeSeconds: state.playerTimeSeconds,
      aiTimeSeconds: state.aiTimeSeconds,
      chessClockEnabled: state.chessClockEnabled,
      scoreSheet: window.AMath.scoreSheet ? window.AMath.scoreSheet.getAllEntries() : [],
      recording: window.AMath.replayRecorder && window.AMath.replayRecorder.snapshot
                 ? window.AMath.replayRecorder.snapshot() : null,
    };
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Export the current game state as a downloadable .json file.
   * @param state: session object
   * @param filename: optional custom filename (without extension)
   */
  function exportToFile(state, filename) {
    const json = serialize(state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = (filename || 'amath-game-' + Date.now()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Release the URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Import a saved game from a File object (from <input type="file">).
   * Returns a promise that resolves with the parsed game state, or rejects on error.
   */
  function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (parsed.version !== 1) {
            reject(new Error('Unsupported save file version'));
            return;
          }
          if (!parsed.board || !parsed.playerRack || !parsed.aiRack) {
            reject(new Error('Invalid save file: missing required fields'));
            return;
          }
          ensureSlotMap(parsed.playerRack);
          ensureSlotMap(parsed.aiRack);
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse save file: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  window.AMath = window.AMath || {};
  window.AMath.saveResume = {
    save: save,
    load: load,
    hasSavedGame: hasSavedGame,
    clearSave: clearSave,
    saveRaw: saveRaw,
    describeSavedGame: describeSavedGame,
    serialize: serialize,
    exportToFile: exportToFile,
    importFromFile: importFromFile,
  };
})();
