/**
 * A-Math Game — UI Rendering
 *
 * Functions that build and update the visual elements (DOM).
 * For Phase 4: just rendering. No interactions yet (Phase 5).
 */

(function () {
  const C = window.AMath.constants;
  const U = window.AMath.utils;

  // =============================================================================
  // BOARD RENDERING
  // =============================================================================

  /**
   * Creates the 15×15 board DOM and inserts it into the given container.
   * Each cell has classes for premium type, and center has a star.
   */
  function renderBoard(board, container) {
    container.innerHTML = '';

    // Wrapper that holds an optional ruler row/column plus the board grid.
    // Ruler is invisible in non-capture themes (display:none via CSS) so it
    // adds zero visual impact to normal play.
    const wrap = document.createElement('div');
    wrap.className = 'amath-board-with-ruler';

    // Top ruler: 16 cells (a blank corner + 15 column numbers 0..14)
    const topRuler = document.createElement('div');
    topRuler.className = 'amath-ruler amath-ruler-top';
    const topCorner = document.createElement('div');
    topCorner.className = 'amath-ruler-corner';
    topRuler.appendChild(topCorner);
    for (let c = 0; c < C.BOARD_SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'amath-ruler-cell';
      // Highlight the three "×9 lines": columns 0, 7, 14
      if (c === 0 || c === 7 || c === 14) cell.classList.add('ruler-major');
      cell.textContent = c;
      topRuler.appendChild(cell);
    }
    wrap.appendChild(topRuler);

    // Middle row: left ruler (15 row numbers) + board grid
    const middle = document.createElement('div');
    middle.className = 'amath-board-middle';

    const leftRuler = document.createElement('div');
    leftRuler.className = 'amath-ruler amath-ruler-left';
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      const cell = document.createElement('div');
      cell.className = 'amath-ruler-cell';
      if (r === 0 || r === 7 || r === 14) cell.classList.add('ruler-major');
      cell.textContent = r;
      leftRuler.appendChild(cell);
    }
    middle.appendChild(leftRuler);

    const grid = document.createElement('div');
    grid.className = 'amath-board';
    grid.id = 'amath-board';

    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = board.cells[r][c];
        const cellEl = document.createElement('div');
        cellEl.className = 'amath-cell';
        cellEl.dataset.row = r;
        cellEl.dataset.col = c;

        // Highlight cells on the ×9 lines (rows 0/7/14, cols 0/7/14)
        // — visible only in capture theme via CSS
        if (r === 0 || r === 7 || r === 14 || c === 0 || c === 7 || c === 14) {
          cellEl.classList.add('on-x9-line');
        }

        // Premium square class
        if (cell.premium) {
          cellEl.classList.add('premium-' + cell.premium);

          // Premium label
          const label = document.createElement('span');
          label.className = 'premium-label';
          label.textContent = premiumLabelText(cell.premium);
          cellEl.appendChild(label);
        }

        // Coordinate label — visible only in capture theme via CSS.
        // Format: "r,c" e.g. "14,13". Always present in DOM regardless of theme.
        const coordLabel = document.createElement('span');
        coordLabel.className = 'coord-label';
        coordLabel.textContent = r + ',' + c;
        cellEl.appendChild(coordLabel);

        // Center star
        if (r === C.CENTER_CELL.row && c === C.CENTER_CELL.col) {
          cellEl.classList.add('center-cell');
          const star = document.createElement('span');
          star.className = 'center-star';
          star.textContent = '★';
          cellEl.appendChild(star);
        }

        // If a tile is placed, render it (onBoard=true → suppress points subscript)
        if (cell.tile) {
          const tileEl = renderTile(cell.tile, false, true);
          cellEl.appendChild(tileEl);
        }

        grid.appendChild(cellEl);
      }
    }

    middle.appendChild(grid);
    wrap.appendChild(middle);

    container.appendChild(wrap);
  }

  function premiumLabelText(p) {
    // Display labels matching the physical board: "3X" with sub-text
    if (p === '3E') return '3X';
    if (p === '2E') return '2X';
    if (p === '3T') return '3X';
    if (p === '2T') return '2X';
    return '';
  }

  // =============================================================================
  // TILE RENDERING
  // =============================================================================

  /**
   * Creates a tile DOM element.
   * If faceDown is true, shows tile-back graphic (used for opponent rack).
   * If onBoard is true, suppresses the point-value subscript (the tile is
   * already placed on the board, so its score is committed and the small
   * number adds visual noise).
   */
  function renderTile(tile, faceDown, onBoard) {
    const el = document.createElement('div');
    el.className = 'amath-tile';
    el.dataset.tileId = tile.id;

    if (faceDown) {
      el.classList.add('tile-back');
      // No content — styled with pattern via CSS
      return el;
    }

    // Face-up tile
    el.classList.add('tile-' + tile.type);

    // Determine display face (assigned takes precedence for BLANK and choice tiles)
    const displayFace = tile.assigned || tile.face;
    el.classList.add('face-' + sanitizeFaceClass(displayFace));

    const faceEl = document.createElement('span');
    faceEl.className = 'tile-face';
    faceEl.textContent = formatFace(displayFace);
    el.appendChild(faceEl);

    // Show point value as small subscript — ONLY when tile is in a rack
    // (not when placed on the board). Once placed, the score is already
    // counted; the subscript becomes visual clutter.
    if (!onBoard && tile.points > 0) {
      const ptsEl = document.createElement('span');
      ptsEl.className = 'tile-points';
      ptsEl.textContent = tile.points;
      el.appendChild(ptsEl);
    }

    // BLANK indicator (if not yet assigned)
    if (tile.type === 'blank' && !tile.assigned) {
      el.classList.add('tile-blank-unassigned');
    }

    return el;
  }

  // Convert face to a CSS-safe class suffix
  function sanitizeFaceClass(face) {
    const map = {
      '+': 'plus',
      '-': 'minus',
      '×': 'mul',
      '÷': 'div',
      '+/-': 'plusminus',
      '×/÷': 'muldiv',
      '=': 'equals',
      BLANK: 'blank',
    };
    return map[face] || 'num';
  }

  // Format face for display (mostly identity, but for clarity)
  function formatFace(face) {
    if (face === 'BLANK') return '?';
    return face;
  }

  // =============================================================================
  // RACK RENDERING
  // =============================================================================

  /**
   * Shows the Mission Complete popup with final scores and winner.
   * @param info: {
   *   winnerLabel: 'You' | 'AI' | 'Tie',
   *   playerScore, aiScore,
   *   playerTimePenalty, aiTimePenalty,
   *   reason: explanation of how game ended,
   *   onNewGame: callback
   * }
   */
  function showGameEndPopup(info) {
    // Remove existing popup if any
    const existing = document.querySelector('.game-end-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'game-end-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'game-end-dialog';

    const winnerEl = document.createElement('div');
    winnerEl.className = 'game-end-winner';
    if (info.winnerLabel === 'Tie') {
      winnerEl.textContent = 'Tie Game!';
    } else {
      winnerEl.textContent = info.winnerLabel + ' WIN';
    }
    dialog.appendChild(winnerEl);

    const scoresEl = document.createElement('div');
    scoresEl.className = 'game-end-scores';
    scoresEl.innerHTML =
      '<div class="score-row"><span>You:</span><span>' + info.playerScore + '</span></div>' +
      '<div class="score-row"><span>AI:</span><span>' + info.aiScore + '</span></div>';
    dialog.appendChild(scoresEl);

    if (info.reason) {
      const reasonEl = document.createElement('div');
      reasonEl.className = 'game-end-reason';
      reasonEl.textContent = info.reason;
      dialog.appendChild(reasonEl);
    }

    // Time penalty info (if any)
    if (info.playerTimePenalty || info.aiTimePenalty) {
      const penaltyEl = document.createElement('div');
      penaltyEl.className = 'game-end-penalty';
      const lines = [];
      if (info.playerTimePenalty) lines.push('You: −' + info.playerTimePenalty + ' time penalty');
      if (info.aiTimePenalty) lines.push('AI: −' + info.aiTimePenalty + ' time penalty');
      penaltyEl.innerHTML = lines.join('<br>');
      dialog.appendChild(penaltyEl);
    }

    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'New Game';
    btn.addEventListener('click', function () {
      overlay.remove();
      if (info.onNewGame) info.onNewGame();
    });
    dialog.appendChild(btn);

    // View Score Sheet button
    const scoreSheetBtn = document.createElement('button');
    scoreSheetBtn.className = 'btn btn-secondary';
    scoreSheetBtn.textContent = 'View Score Sheet';
    scoreSheetBtn.style.marginTop = '8px';
    scoreSheetBtn.style.width = '100%';
    scoreSheetBtn.addEventListener('click', function () {
      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.showPopup(info.playerScore, info.aiScore);
      }
    });
    dialog.appendChild(scoreSheetBtn);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }
  function renderRack(rack, container, isOpponent) {
    container.innerHTML = '';
    container.classList.add('amath-rack');
    container.classList.add(isOpponent ? 'rack-opponent' : 'rack-player');

    // Check if Show AI Hand setting is ON
    let showAiHand = false;
    try {
      if (window.AMath && window.AMath.settings && window.AMath.settings.get) {
        showAiHand = window.AMath.settings.get('showAiHand') === true;
      }
    } catch (e) {}

    // If isOpponent (AI rack) AND showAiHand is ON, render face-up
    const faceDown = isOpponent && !showAiHand;

    // Always render 8 slots — empty slots are visible too
    for (let i = 0; i < C.RACK_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'amath-rack-slot';
      slot.dataset.slotIndex = i;

      if (i < rack.tiles.length) {
        const tile = rack.tiles[i];
        const tileEl = renderTile(tile, faceDown);
        slot.appendChild(tileEl);
      }

      container.appendChild(slot);
    }
  }

  // =============================================================================
  // SCORE & TIMER RENDERING
  // =============================================================================

  function renderScore(container, label, score) {
    container.innerHTML = '';
    const labelEl = document.createElement('div');
    labelEl.className = 'score-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const scoreEl = document.createElement('div');
    scoreEl.className = 'score-value';
    scoreEl.textContent = U.formatScore(score);
    container.appendChild(scoreEl);
  }

  function renderTimer(container, label, seconds) {
    container.innerHTML = '';
    const labelEl = document.createElement('div');
    labelEl.className = 'timer-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const timeEl = document.createElement('div');
    timeEl.className = 'timer-value';
    if (seconds < 0) timeEl.classList.add('timer-negative');
    timeEl.textContent = U.formatTime(seconds);
    container.appendChild(timeEl);
  }

  // =============================================================================
  // BUILDS THE COMPLETE GAME LAYOUT
  // =============================================================================

  /**
   * Builds the entire game UI structure inside the given root element.
   * Returns references to the parts so other functions can update them.
   */
  function buildGameLayout(root) {
    root.innerHTML = '';
    root.className = 'amath-app';

    // Opponent (AI) section
    const opponentArea = document.createElement('div');
    opponentArea.className = 'opponent-area';

    const opponentScoreBox = document.createElement('div');
    opponentScoreBox.className = 'score-box opponent-score';
    opponentArea.appendChild(opponentScoreBox);

    const opponentRack = document.createElement('div');
    opponentArea.appendChild(opponentRack);

    const opponentTimer = document.createElement('div');
    opponentTimer.className = 'timer-box opponent-timer';
    opponentArea.appendChild(opponentTimer);

    root.appendChild(opponentArea);

    // Board area
    const boardArea = document.createElement('div');
    boardArea.className = 'board-area';
    root.appendChild(boardArea);

    // Player section
    const playerArea = document.createElement('div');
    playerArea.className = 'player-area';

    const playerScoreBox = document.createElement('div');
    playerScoreBox.className = 'score-box player-score';
    playerArea.appendChild(playerScoreBox);

    const playerRack = document.createElement('div');
    playerArea.appendChild(playerRack);

    const playerTimer = document.createElement('div');
    playerTimer.className = 'timer-box player-timer';
    playerArea.appendChild(playerTimer);

    root.appendChild(playerArea);

    // Mobile-only bottom timer bar. On desktop it's hidden via CSS
    // (.timer-bar { display: none }). On mobile, the inline timers next to
    // each rack are hidden and these mirrors are shown instead, so the racks
    // can claim full row width — which lets the BOARD claim full screen width.
    const timerBar = document.createElement('div');
    timerBar.className = 'timer-bar';
    const timerBarAi = document.createElement('div');
    timerBarAi.className = 'timer-box timer-bar-slot opponent-timer-mobile';
    const timerBarPlayer = document.createElement('div');
    timerBarPlayer.className = 'timer-box timer-bar-slot player-timer-mobile';
    timerBar.appendChild(timerBarAi);
    timerBar.appendChild(timerBarPlayer);
    root.appendChild(timerBar);

    // Action buttons
    const buttonBar = document.createElement('div');
    buttonBar.className = 'button-bar';
    buttonBar.innerHTML = `
      <button class="btn btn-primary" id="btn-submit" disabled>Submit</button>
      <button class="btn btn-secondary" id="btn-reset" disabled>Reset</button>
      <button class="btn btn-secondary" id="btn-pass" disabled>Pass</button>
      <button class="btn btn-secondary" id="btn-swap" disabled>Swap</button>
      <button class="btn btn-secondary" id="btn-challenge" disabled style="display:none">Challenge</button>
      <button class="btn btn-tertiary" id="btn-takeover" title="Let AI play your turn">🤖 Auto</button>
      <button class="btn btn-tertiary" id="btn-new-game">New Game</button>
      <button class="btn btn-icon" id="btn-export" title="Save game as file">💾</button>
      <button class="btn btn-icon" id="btn-import" title="Load game from file">📂</button>
      <button class="btn btn-icon" id="btn-tracker" title="Tile Tracker">🔍</button>
      <button class="btn btn-icon" id="btn-score-sheet" title="Score Sheet">📋</button>
      <button class="btn btn-icon" id="btn-settings" title="Settings">⚙️</button>
      <input type="file" id="file-import-input" accept=".json" style="display:none">
    `;
    root.appendChild(buttonBar);

    // Tile tracker panel (hidden by default)
    const trackerPanel = document.createElement('div');
    trackerPanel.id = 'tile-tracker-panel';
    trackerPanel.style.display = 'none';
    root.appendChild(trackerPanel);

    // AI vs AI control bar (hidden by default)
    const aiVsAiBar = document.createElement('div');
    aiVsAiBar.className = 'aivai-bar';
    aiVsAiBar.id = 'aivai-bar';
    aiVsAiBar.style.display = 'none';
    aiVsAiBar.innerHTML = `
      <button class="btn btn-secondary" id="btn-aivai-pause">⏸ Pause</button>
      <button class="btn btn-secondary" id="btn-aivai-step">⏭ Step</button>
      <label class="aivai-speed">Speed:
        <input type="range" id="aivai-speed-slider" min="1" max="10" value="1">
        <span id="aivai-speed-value">1x</span>
      </label>
    `;
    root.appendChild(aiVsAiBar);

    return {
      root: root,
      boardArea: boardArea,
      opponentScoreBox: opponentScoreBox,
      opponentRack: opponentRack,
      opponentTimer: opponentTimer,
      opponentTimerMobile: timerBarAi,
      playerScoreBox: playerScoreBox,
      playerRack: playerRack,
      playerTimer: playerTimer,
      playerTimerMobile: timerBarPlayer,
      buttonBar: buttonBar,
    };
  }

  // =============================================================================
  // EXPOSE
  // =============================================================================

  window.AMath = window.AMath || {};
  window.AMath.ui = {
    buildGameLayout: buildGameLayout,
    renderBoard: renderBoard,
    renderRack: renderRack,
    renderTile: renderTile,
    renderScore: renderScore,
    renderTimer: renderTimer,
    showGameEndPopup: showGameEndPopup,
  };
})();
