/**
 * A-Math Game — Interactions
 *
 * Handles all user input on the game UI:
 *  - Tap/click rack tile → select
 *  - Tap/click empty board cell → place selected tile (with picker popup for special tiles)
 *  - Tap/click placed (uncommitted) tile → return to rack
 *  - Drag tile from rack to board cell
 *  - Drag tile from board cell back to rack
 *
 * Maintains a "tentative placements" list — tiles placed this turn but not yet submitted.
 */

(function () {
  const C = window.AMath.constants;
  const UI = window.AMath.ui;
  const Board = window.AMath.board;
  const Rack = window.AMath.rack;

  // Interaction state (within a single turn)
  let state = null;

  /**
   * Initializes interactions for a game session.
   * @param sessionState: {
   *   board, playerRack, aiRack, bag,
   *   isPlayerTurn,
   *   tentativePlacements,   // array of {row, col, tile, originalRackIndex}
   *   selectedTileId,        // currently selected tile ID (null if none)
   *   uiParts,
   *   onSubmit, onReset, onPass, onSwap
   * }
   */
  function init(sessionState) {
    state = sessionState;
    // Swap mode state
    state.swapMode = false;
    state.swapSelected = new Set(); // tile IDs selected for swap
    attachBoardHandlers();
    attachRackHandlers();
    attachButtonHandlers();
    refreshUI();
  }

  // ============================================================================
  // CLICK HANDLERS
  // ============================================================================

  function attachBoardHandlers() {
    const boardEl = document.getElementById('amath-board');
    if (!boardEl) return;

    boardEl.addEventListener('click', function (e) {
      const cellEl = e.target.closest('.amath-cell');
      if (!cellEl) return;
      const row = parseInt(cellEl.dataset.row, 10);
      const col = parseInt(cellEl.dataset.col, 10);
      onBoardCellClick(row, col);
    });

    // Drag-over: allow drop
    boardEl.addEventListener('dragover', function (e) {
      const cellEl = e.target.closest('.amath-cell');
      if (cellEl) {
        e.preventDefault();
      }
    });

    // Drop on board
    boardEl.addEventListener('drop', function (e) {
      e.preventDefault();
      const cellEl = e.target.closest('.amath-cell');
      if (!cellEl) return;
      const row = parseInt(cellEl.dataset.row, 10);
      const col = parseInt(cellEl.dataset.col, 10);
      const tileId = e.dataTransfer.getData('text/plain');
      if (tileId) {
        onTileDroppedOnBoard(tileId, row, col);
      }
    });
  }

  function attachRackHandlers() {
    const rackEl = state.uiParts.playerRack;
    if (!rackEl) return;

    rackEl.addEventListener('click', function (e) {
      const tileEl = e.target.closest('.amath-tile');
      if (!tileEl) return;
      const tileId = tileEl.dataset.tileId;
      if (tileId) onRackTileClick(tileId);
    });

    // Drop on rack:
    //   - If tile came from board (tentative) → return to rack
    //   - If tile came from rack → reorder
    rackEl.addEventListener('dragover', function (e) {
      e.preventDefault();
    });
    rackEl.addEventListener('drop', function (e) {
      e.preventDefault();
      const tileId = e.dataTransfer.getData('text/plain');
      if (!tileId) return;

      // Detect the slot being dropped on (for reordering)
      const slotEl = e.target.closest('.amath-rack-slot');
      const targetIndex = slotEl ? parseInt(slotEl.dataset.slotIndex, 10) : -1;

      // Is the tile currently on the rack? (reorder)
      const fromRackIdx = state.playerRack.tiles.findIndex((t) => t.id === tileId);
      if (fromRackIdx !== -1) {
        // Reorder within rack
        if (targetIndex !== -1 && targetIndex !== fromRackIdx) {
          reorderRackTile(fromRackIdx, targetIndex);
        }
        return;
      }

      // Otherwise it's a tile from the board (tentative) → return to rack
      onTileDroppedOnRack(tileId);
    });
  }

  /**
   * Reorders tiles within the player's rack (purely cosmetic).
   * @param fromIdx: current index of the tile being moved
   * @param toIdx: target slot index (0-7)
   */
  function reorderRackTile(fromIdx, toIdx) {
    if (!state.isPlayerTurn) return;
    const tiles = state.playerRack.tiles;
    if (fromIdx < 0 || fromIdx >= tiles.length) return;
    if (toIdx < 0 || toIdx >= state.uiParts.playerRack.children.length) return;

    // Remove tile from current position
    const [tile] = tiles.splice(fromIdx, 1);

    // Clamp target index to valid range after removal
    const insertAt = Math.min(toIdx, tiles.length);
    tiles.splice(insertAt, 0, tile);

    refreshUI();
  }

  function attachButtonHandlers() {
    const btnSubmit = document.getElementById('btn-submit');
    const btnReset = document.getElementById('btn-reset');
    const btnPass = document.getElementById('btn-pass');
    const btnSwap = document.getElementById('btn-swap');

    if (btnSubmit) btnSubmit.addEventListener('click', function () { state.onSubmit && state.onSubmit(); });
    if (btnReset) btnReset.addEventListener('click', function () { state.onReset && state.onReset(); });
    if (btnPass) btnPass.addEventListener('click', function () { state.onPass && state.onPass(); });
    if (btnSwap) btnSwap.addEventListener('click', function () { state.onSwap && state.onSwap(); });
  }

  // ============================================================================
  // CORE INTERACTION LOGIC
  // ============================================================================

  function onRackTileClick(tileId) {
    // NOTE: we do NOT gate on isPlayerTurn here. Rack rearrangement
    // (click-to-swap two rack tiles) is allowed at any time, including
    // while the AI is thinking — so the player can organize tiles while
    // waiting. Placement on the board is still gated by turn (see
    // onBoardCellClick).

    // Sound feedback
    if (window.AMath.sounds) window.AMath.sounds.tileClick();

    // SWAP MODE (entered via the Swap button): toggle inclusion in swap-set
    if (state.swapMode) {
      // Only allow during player's turn (swap is a turn action, requires bag tiles)
      if (!state.isPlayerTurn) return;
      if (state.swapSelected.has(tileId)) {
        state.swapSelected.delete(tileId);
      } else {
        state.swapSelected.add(tileId);
      }
      refreshUI();
      return;
    }

    // NORMAL MODE
    // - First click selects a rack tile.
    // - Second click on a DIFFERENT rack tile → swap their positions.
    // - Second click on the SAME tile → deselect.
    if (state.selectedTileId === null) {
      // Nothing selected → select this tile.
      // (During AI's turn we still allow this so the player can begin a
      // rearrangement; the second click does the swap.)
      state.selectedTileId = tileId;
      refreshUI();
      return;
    }

    if (state.selectedTileId === tileId) {
      // Click the same tile again → deselect.
      state.selectedTileId = null;
      refreshUI();
      return;
    }

    // Different tile clicked while one is already selected → SWAP positions
    // in the rack. Works regardless of whose turn it is.
    const Rack = window.AMath.rack;
    const swapped = Rack.swapTiles(state.playerRack, state.selectedTileId, tileId);
    state.selectedTileId = null;
    if (swapped) {
      refreshUI();
      if (state.onRackChanged) state.onRackChanged();
    }
  }

  function onBoardCellClick(row, col) {
    if (!state.isPlayerTurn) return;

    const cell = Board.getCell(state.board, row, col);
    if (!cell) return;

    // If clicking a tile that's tentatively placed (newly placed this turn), return it to rack
    const tentativeIdx = state.tentativePlacements.findIndex(
      (p) => p.row === row && p.col === col
    );
    if (tentativeIdx !== -1) {
      returnTileToRack(tentativeIdx);
      return;
    }

    // If cell already has a tile (committed from previous turns), do nothing
    if (cell.tile !== null) return;

    // Empty cell + tile selected → place it
    if (state.selectedTileId) {
      placeTileFromRack(state.selectedTileId, row, col);
    }
  }

  function placeTileFromRack(tileId, row, col) {
    const tile = Rack.findTile(state.playerRack, tileId);
    if (!tile) return;

    // Check if this tile needs the picker (BLANK, +/-, ×/÷)
    if (needsPicker(tile)) {
      showPicker(tile, function (assignedValue) {
        if (assignedValue === null) return; // user cancelled
        // Clone tile with assigned value
        const placedTile = Object.assign({}, tile, { assigned: assignedValue });
        commitPlacement(tileId, placedTile, row, col);
      });
      return;
    }

    commitPlacement(tileId, tile, row, col);
  }

  function commitPlacement(tileId, tile, row, col) {
    // Remove from rack
    const removed = Rack.removeTile(state.playerRack, tileId);
    if (!removed) return;

    // If tile object has 'assigned' from picker, copy to the actual rack tile
    if (tile.assigned && tile !== removed) {
      removed.assigned = tile.assigned;
    }
    Board.placeTile(state.board, row, col, removed);

    // Record in tentative placements
    state.tentativePlacements.push({
      row: row,
      col: col,
      tile: removed,
    });

    // Play sound
    if (window.AMath.sounds) window.AMath.sounds.tilePlace();

    // Clear selection
    state.selectedTileId = null;
    refreshUI();
  }

  function returnTileToRack(tentativeIdx) {
    const placement = state.tentativePlacements[tentativeIdx];
    if (!placement) return;

    // Remove from board
    const tile = Board.removeTile(state.board, placement.row, placement.col);
    if (!tile) return;

    // Clear assigned value (so blank/choice can be re-chosen if needed)
    tile.assigned = null;

    // Return to rack
    Rack.addTile(state.playerRack, tile);

    // Remove from tentative list
    state.tentativePlacements.splice(tentativeIdx, 1);

    refreshUI();
  }

  // ============================================================================
  // DRAG-AND-DROP
  // ============================================================================

  function onTileDroppedOnBoard(tileId, row, col) {
    if (!state.isPlayerTurn) return;

    const cell = Board.getCell(state.board, row, col);
    if (!cell || cell.tile !== null) return; // can't drop on occupied cell

    // Is tile from rack?
    if (Rack.findTile(state.playerRack, tileId)) {
      placeTileFromRack(tileId, row, col);
      return;
    }

    // Is tile from board (tentatively placed)?
    const fromIdx = state.tentativePlacements.findIndex((p) => p.tile.id === tileId);
    if (fromIdx !== -1) {
      // Move from one board cell to another
      const placement = state.tentativePlacements[fromIdx];
      const tile = Board.removeTile(state.board, placement.row, placement.col);
      if (tile) {
        Board.placeTile(state.board, row, col, tile);
        placement.row = row;
        placement.col = col;
        refreshUI();
      }
    }
  }

  function onTileDroppedOnRack(tileId) {
    if (!state.isPlayerTurn) return;

    const tentativeIdx = state.tentativePlacements.findIndex((p) => p.tile.id === tileId);
    if (tentativeIdx !== -1) {
      returnTileToRack(tentativeIdx);
    }
  }

  // ============================================================================
  // PICKER POPUP (for BLANK and +/- ×/÷ tiles)
  // ============================================================================

  function needsPicker(tile) {
    return tile.type === 'blank' || tile.type === 'choice';
  }

  function showPicker(tile, callback) {
    // Build picker overlay
    const overlay = document.createElement('div');
    overlay.className = 'picker-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'picker-dialog';

    const title = document.createElement('div');
    title.className = 'picker-title';

    let options;
    if (tile.type === 'choice') {
      title.textContent = 'Choose: ' + tile.face;
      // Split "+/-" into ["+", "-"], etc.
      options = tile.face.split('/');
    } else {
      // BLANK can be anything: 0-20, +, -, ×, ÷, =
      // But in ประถม edition: 0-16 + 20 only (no 17, 18, 19)
      // And no standalone ×, ÷ (only ×/÷ choice tile, but BLANK assignment still allows them)
      title.textContent = 'BLANK tile — choose what it becomes:';
      options = [];
      // Determine which numbers are allowed based on tile set
      let tileSet = 'prathom';
      try {
        if (window.AMath && window.AMath.settings && window.AMath.settings.get) {
          tileSet = window.AMath.settings.get('tileSet') || 'prathom';
        }
      } catch (e) {}
      if (tileSet === 'prathom') {
        // 0-16 + 20 (skip 17, 18, 19)
        for (let i = 0; i <= 16; i++) options.push(String(i));
        options.push('20');
      } else {
        // มัธยม: 0-20 full range
        for (let i = 0; i <= 20; i++) options.push(String(i));
      }
      options.push('+', '-', '×', '÷', '=');
    }

    dialog.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'picker-grid';

    options.forEach(function (opt) {
      const btn = document.createElement('button');
      btn.className = 'picker-option';
      btn.textContent = opt;
      btn.addEventListener('click', function () {
        document.body.removeChild(overlay);
        callback(opt);
      });
      grid.appendChild(btn);
    });

    dialog.appendChild(grid);

    const cancel = document.createElement('button');
    cancel.className = 'picker-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () {
      document.body.removeChild(overlay);
      callback(null);
    });
    dialog.appendChild(cancel);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  // ============================================================================
  // UI REFRESH (call after any state change)
  // ============================================================================

  /**
   * Toggle the .is-active-turn class on the player/opponent row based on
   * whose turn it is. The CSS handles the visual glow/pulse.
   *
   * Detection: we check `state.isPlayerTurn`. In AI vs AI mode the user is
   * just a spectator and we should NOT highlight either row (both are bots).
   * We can detect that case by checking the body class — `body.is-aivai`
   * is set when the AI vs AI bar is shown, OR by checking if the modes
   * module reports the current mode.
   */
  function updateActiveTurnHighlight() {
    const playerArea = document.querySelector('.player-area');
    const opponentArea = document.querySelector('.opponent-area');
    if (!playerArea || !opponentArea) return;

    // Detect AI vs AI mode — skip the highlight since user is spectating.
    let isSpectator = false;
    try {
      const Modes = window.AMath.modes;
      if (Modes && Modes.getMode && Modes.MODE_AI_VS_AI) {
        isSpectator = (Modes.getMode() === Modes.MODE_AI_VS_AI);
      }
    } catch (e) {}

    if (isSpectator) {
      playerArea.classList.remove('is-active-turn');
      opponentArea.classList.remove('is-active-turn');
      return;
    }

    if (state.isPlayerTurn) {
      playerArea.classList.add('is-active-turn');
      opponentArea.classList.remove('is-active-turn');
    } else {
      playerArea.classList.remove('is-active-turn');
      opponentArea.classList.add('is-active-turn');
    }
  }

  function refreshUI() {
    // Re-render board, rack, and update selection highlight
    UI.renderBoard(state.board, state.uiParts.boardArea);
    UI.renderRack(state.playerRack, state.uiParts.playerRack, false);
    UI.renderRack(state.aiRack, state.uiParts.opponentRack, true);

    // Re-attach board handlers since we just re-rendered
    attachBoardHandlers();

    // Add draggable + dragstart to rack tiles and tentatively placed tiles
    makeRackTilesDraggable();
    makeTentativeTilesDraggable();

    // Apply the active-turn highlight to the row of whoever is currently
    // playing. The CSS handles the glow/pulse visuals; we just toggle a
    // class. In AI vs AI spectator mode we skip the highlight — both
    // players are bots and the user has no turn to wait for.
    updateActiveTurnHighlight();

    // Highlight selected tile (normal mode)
    if (state.selectedTileId && !state.swapMode) {
      const tileEl = state.uiParts.playerRack.querySelector(
        '.amath-tile[data-tile-id="' + state.selectedTileId + '"]'
      );
      if (tileEl) tileEl.classList.add('tile-selected');
    }

    // Highlight tiles selected for swap (swap mode)
    if (state.swapMode) {
      for (const tileId of state.swapSelected) {
        const tileEl = state.uiParts.playerRack.querySelector(
          '.amath-tile[data-tile-id="' + tileId + '"]'
        );
        if (tileEl) tileEl.classList.add('tile-swap-selected');
      }
    }

    // Mark tentative placements visually
    for (const p of state.tentativePlacements) {
      const cellEl = document.querySelector(
        '.amath-cell[data-row="' + p.row + '"][data-col="' + p.col + '"]'
      );
      if (cellEl) {
        const tileEl = cellEl.querySelector('.amath-tile');
        if (tileEl) tileEl.classList.add('tile-tentative');
      }
    }

    // Highlight the AI's most recent play with a colored border so the
    // player can see at a glance what just landed. The highlight stays
    // until the player's next move (submit/pass/swap), which clears
    // state.lastAiPlay back to null in main.js.
    if (state.lastAiPlay && state.lastAiPlay.placements) {
      for (const p of state.lastAiPlay.placements) {
        const cellEl = document.querySelector(
          '.amath-cell[data-row="' + p.row + '"][data-col="' + p.col + '"]'
        );
        if (cellEl) {
          const tileEl = cellEl.querySelector('.amath-tile');
          if (tileEl) tileEl.classList.add('tile-ai-last-play');
        }
      }
    }

    // Update button states
    updateButtonStates();
  }

  function makeRackTilesDraggable() {
    const tiles = state.uiParts.playerRack.querySelectorAll('.amath-tile');
    tiles.forEach(function (tileEl) {
      tileEl.setAttribute('draggable', 'true');
      tileEl.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', tileEl.dataset.tileId);
        e.dataTransfer.effectAllowed = 'move';
        tileEl.classList.add('tile-dragging');
      });
      tileEl.addEventListener('dragend', function () {
        tileEl.classList.remove('tile-dragging');
      });
    });
  }

  function makeTentativeTilesDraggable() {
    for (const p of state.tentativePlacements) {
      const cellEl = document.querySelector(
        '.amath-cell[data-row="' + p.row + '"][data-col="' + p.col + '"]'
      );
      if (!cellEl) continue;
      const tileEl = cellEl.querySelector('.amath-tile');
      if (!tileEl) continue;
      tileEl.setAttribute('draggable', 'true');
      tileEl.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', tileEl.dataset.tileId);
        e.dataTransfer.effectAllowed = 'move';
        tileEl.classList.add('tile-dragging');
      });
      tileEl.addEventListener('dragend', function () {
        tileEl.classList.remove('tile-dragging');
      });
    }
  }

  function updateButtonStates() {
    const btnSubmit = document.getElementById('btn-submit');
    const btnReset = document.getElementById('btn-reset');
    const btnPass = document.getElementById('btn-pass');
    const btnSwap = document.getElementById('btn-swap');

    // Education mode: always ensure verify button when it's player's turn
    if (state.isPlayerTurn && window.AMath.education && window.AMath.settings &&
        window.AMath.settings.get('educationMode')) {
      window.AMath.education.ensureVerifyButton();
    }

    if (!state.isPlayerTurn) {
      if (btnSubmit) btnSubmit.disabled = true;
      if (btnReset) btnReset.disabled = true;
      if (btnPass) btnPass.disabled = true;
      if (btnSwap) btnSwap.disabled = true;
      // Hide verify button during AI/opponent turn
      if (window.AMath.education) window.AMath.education.hideVerifyButton();
      return;
    }

    // Swap mode: Submit = confirm swap, Reset = cancel swap mode
    if (state.swapMode) {
      if (btnSubmit) {
        btnSubmit.disabled = state.swapSelected.size === 0;
        btnSubmit.textContent = 'Confirm Swap (' + state.swapSelected.size + ')';
      }
      if (btnReset) {
        btnReset.disabled = false;
        btnReset.textContent = 'Cancel';
      }
      if (btnPass) btnPass.disabled = true;
      if (btnSwap) btnSwap.disabled = true;
      return;
    }

    // Normal mode
    if (btnSubmit) {
      btnSubmit.textContent = 'Submit';
      btnSubmit.disabled = state.tentativePlacements.length === 0;
    }
    if (btnReset) {
      btnReset.textContent = 'Reset';
      btnReset.disabled = state.tentativePlacements.length === 0;
    }
    if (btnPass) btnPass.disabled = false;

    if (btnSwap) {
      const bagSize = state.bag.tiles.length;
      btnSwap.disabled =
        state.tentativePlacements.length > 0 || bagSize <= C.SWAP_FORBIDDEN_BAG_THRESHOLD;
    }
  }

  // ============================================================================
  // EXTERNAL ACCESSORS (so main.js can read/update interaction state)
  // ============================================================================

  function getTentativePlacements() {
    return state.tentativePlacements;
  }

  function clearTentativePlacements() {
    state.tentativePlacements = [];
  }

  function setPlayerTurn(isPlayerTurn) {
    state.isPlayerTurn = isPlayerTurn;
    state.selectedTileId = null;
    refreshUI();
  }

  function getState() {
    return state;
  }

  function enterSwapMode() {
    state.swapMode = true;
    state.swapSelected = new Set();
    state.selectedTileId = null;
    refreshUI();
  }

  function exitSwapMode() {
    state.swapMode = false;
    state.swapSelected = new Set();
    refreshUI();
  }

  function getSwapSelection() {
    return Array.from(state.swapSelected);
  }

  window.AMath = window.AMath || {};
  window.AMath.interactions = {
    init: init,
    refreshUI: refreshUI,
    getTentativePlacements: getTentativePlacements,
    clearTentativePlacements: clearTentativePlacements,
    setPlayerTurn: setPlayerTurn,
    getState: getState,
    enterSwapMode: enterSwapMode,
    exitSwapMode: exitSwapMode,
    getSwapSelection: getSwapSelection,
    commitPlacement: commitPlacement,
  };
})();
