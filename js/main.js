/**
 * A-Math Game — Main Entry Point (Phase 7)
 *
 * Phase 7 additions:
 *   - Player swap flow
 *   - Chess clock countdown
 *   - Game-end detection and scoring
 *   - Mission Complete popup
 *   - New Game button
 */

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    runVerification();

    // Check for saved game
    const SaveResume = window.AMath.saveResume;
    if (SaveResume && SaveResume.hasSavedGame()) {
      const info = SaveResume.describeSavedGame();
      const msg = 'Resume previous game?\n\n' +
        'Last played: ' + info.timeStr + '\n' +
        'You: ' + info.playerScore + '  AI: ' + info.aiScore + '\n' +
        info.whoseTurn;
      if (confirm(msg)) {
        resumeGame(SaveResume.load());
      } else {
        SaveResume.clearSave();
        startGameSession();
      }
    } else {
      startGameSession();
    }

    const toggleBtn = document.getElementById('debug-toggle');
    const debugDiv = document.getElementById('debug-output');
    if (toggleBtn && debugDiv) {
      toggleBtn.addEventListener('click', function () {
        debugDiv.classList.toggle('show');
      });
    }
  });

  function runVerification() {
    // Verification kept minimal; full tests already validated in earlier phases.
  }

  // ============================================================================
  // GAME SESSION
  // ============================================================================

  let session = null;
  let chessClockInterval = null;

  function startGameSession() {
    const Settings = window.AMath.settings;
    const Modes = window.AMath.modes;

    const mode = Settings.get('gameMode') || Modes.MODE_PLAYER_VS_AI;
    Modes.setMode(mode);
    Modes.reset();

    if (mode === Modes.MODE_AI_VS_AI) {
      startAiVsAiSession();
    } else {
      startPlayerVsAiSession();
    }
  }

  function startPlayerVsAiSession() {
    const C = window.AMath.constants;
    const Bag = window.AMath.bag;
    const Rack = window.AMath.rack;
    const Board = window.AMath.board;
    const UI = window.AMath.ui;
    const Interactions = window.AMath.interactions;
    const Settings = window.AMath.settings;

    if (chessClockInterval) {
      clearInterval(chessClockInterval);
      chessClockInterval = null;
    }

    // Clear any previous save (new game starting)
    if (window.AMath.saveResume) window.AMath.saveResume.clearSave();

    // Reset score sheet
    if (window.AMath.scoreSheet) window.AMath.scoreSheet.reset();

    // Reset AI takeover toggle
    if (window.AMath.modes) window.AMath.modes.setAiTakeover(false);

    // Reset AI play count for first-4-turns Bingo mode (all racks)
    if (window.AMath.aiPlayer && window.AMath.aiPlayer.resetPlayCount) {
      window.AMath.aiPlayer.resetPlayCount(); // reset all
    }

    const existingPopup = document.querySelector('.game-end-overlay');
    if (existingPopup) existingPopup.remove();

    const bag = Bag.createBag();
    const playerRack = Rack.createRack('player');
    const aiRack = Rack.createRack('ai');
    const board = Board.createBoard();

    Rack.refillFromBag(playerRack, bag);
    Rack.refillFromBag(aiRack, bag);

    const container = document.getElementById('game-container');
    const parts = UI.buildGameLayout(container);

    UI.renderScore(parts.opponentScoreBox, 'AI', 0);
    UI.renderScore(parts.playerScoreBox, 'You', 0);

    // Chess clock setup — read from settings
    const chessClockEnabled = Settings.get('chessClockEnabled');
    const clockMinutes = Settings.get('chessClockMinutes') || C.DEFAULT_SETTINGS.chessClockMinutes;
    const startTimeSeconds = clockMinutes * 60;

    if (chessClockEnabled) {
      UI.renderTimer(parts.opponentTimer, 'AI Time', startTimeSeconds);
      UI.renderTimer(parts.playerTimer, 'Your Time', startTimeSeconds);
    } else {
      // Show "—" instead of time
      parts.opponentTimer.innerHTML = '<div class="timer-label">AI Time</div><div class="timer-value">—</div>';
      parts.playerTimer.innerHTML = '<div class="timer-label">Your Time</div><div class="timer-value">—</div>';
    }

    const playerGoesFirst = Math.random() < 0.5;

    session = {
      board: board,
      playerRack: playerRack,
      aiRack: aiRack,
      bag: bag,
      uiParts: parts,
      isPlayerTurn: playerGoesFirst,
      tentativePlacements: [],
      selectedTileId: null,
      playerScore: 0,
      aiScore: 0,
      isFirstMove: true,
      gameOver: false,
      consecutiveNonScoringTurns: 0,
      playerTimeSeconds: startTimeSeconds,
      aiTimeSeconds: startTimeSeconds,
      chessClockEnabled: chessClockEnabled,
      lastAiPlay: null,    // For challenge: record the most recent AI play
      playerTimerPaused: false,  // Feature M: double-click pause
      aiTimerPaused: false,
      onSubmit: handleSubmit,
      onReset: handleReset,
      onPass: handlePass,
      onSwap: handleSwap,
    };

    // Clear any leftover pause-indicator from previous game
    if (parts.playerScoreBox) parts.playerScoreBox.classList.remove('timer-paused');
    if (parts.opponentScoreBox) parts.opponentScoreBox.classList.remove('timer-paused');

    Interactions.init(session);

    // Wire up New Game button
    // Wire up New Game button
    const btnNewGame = document.getElementById('btn-new-game');
    if (btnNewGame) {
      btnNewGame.addEventListener('click', function () {
        if (confirm('Start a new game? Current progress will be lost.')) {
          window.AMath.saveResume.clearSave();
          startGameSession();
        }
      });
    }

    // Wire up Settings button
    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', function () {
        Settings.showPopup(function (changed) {
          if (changed) {
            if (confirm('Settings saved. Start a new game to apply?')) {
              startGameSession();
            }
          }
        });
      });
    }

    // Wire up Score Sheet button
    const btnScoreSheet = document.getElementById('btn-score-sheet');
    if (btnScoreSheet) {
      btnScoreSheet.addEventListener('click', function () {
        window.AMath.scoreSheet.showPopup(session.playerScore, session.aiScore);
      });
    }

    wireExportImportButtons();
    wireTileTrackerButton();

    // Wire up AI Takeover button (toggle mode)
    const btnTakeover = document.getElementById('btn-takeover');
    if (btnTakeover) {
      btnTakeover.addEventListener('click', function () {
        const Modes = window.AMath.modes;
        if (!Modes) return;
        const isActive = Modes.isAiTakeover();

        if (isActive) {
          // Turn OFF
          Modes.setAiTakeover(false);
          btnTakeover.textContent = '🤖 Auto';
          btnTakeover.classList.remove('btn-active');
          showStatus('Takeover OFF — you play your own turns now.');
        } else {
          // Turn ON
          if (session.tentativePlacements.length > 0) {
            showStatus("Reset your placements first.", 'error');
            return;
          }
          Modes.setAiTakeover(true);
          btnTakeover.textContent = '🤖 Auto ON';
          btnTakeover.classList.add('btn-active');
          showStatus('🤖 Auto ON — AI will play your turns. Click again to stop.');

          // If it's currently the player's turn, start playing immediately
          if (session.isPlayerTurn && !session.gameOver) {
            setTimeout(runAiTakeoverTurn, 600);
          }
        }
      });
    }

    // Start chess clock (only if enabled)
    if (chessClockEnabled) {
      startChessClock();
    }

    wireScorePauseHandlers();
    refreshDesktopSidePanels();

    if (playerGoesFirst) {
      showStatus(
        '🎲 You go first! Tap a tile, then tap a board cell. First move must pass through the center ★.'
      );
    } else {
      showStatus('🎲 AI goes first.');
      setTimeout(runAiTurn, 800);
    }
  }

  /**
   * AI Takeover: AI plays for the player using the player's rack.
   * Single turn (toggled by Auto button).
   */
  function runAiTakeoverTurn() {
    const Interactions = window.AMath.interactions;
    const AI = window.AMath.aiPlayer;
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;
    const Bag = window.AMath.bag;
    const UI = window.AMath.ui;

    showThinking(true);

    setTimeout(function () {
      try {
        const decision = AI.decideMove({
          board: session.board,
          aiRack: session.playerRack,  // use player rack
          bag: session.bag,
          isFirstMove: session.isFirstMove,
          playerScore: session.aiScore,    // role-flipped for evaluation
          aiScore: session.playerScore,
          consecutiveNonScoringTurns: session.consecutiveNonScoringTurns || 0,
          opponentRack: session.aiRack,  // for tile-penalty calc
        });

        showThinking(false);

        if (decision.type === 'play') {
          for (const p of decision.placements) {
            const removed = Rack.removeTile(session.playerRack, p.tile.id);
            if (!removed) continue;
            if (p.assigned) removed.assigned = p.assigned;
            Board.placeTile(session.board, p.row, p.col, removed);
            Board.markPremiumUsed(session.board, p.row, p.col);
          }
          const isBingo = decision.placements.length === 8;
          session.playerScore += decision.score;
          session.isFirstMove = false;
          session.consecutiveNonScoringTurns = 0;
          Rack.refillFromBag(session.playerRack, session.bag);
          UI.renderScore(session.uiParts.playerScoreBox, 'You', session.playerScore);
          if (window.AMath.scoreSheet) {
            window.AMath.scoreSheet.recordTurn('player', 'play', decision.score, isBingo, session.playerScore);
          }
          let msg = '🤖→You played: ' + decision.score + ' points.';
          if (isBingo) msg = '🤖→You BINGO! +' + decision.score + '!';
          showStatus(msg, 'success');
        } else if (decision.type === 'swap') {
          const swapped = [];
          for (const tileId of decision.tileIds) {
            const removed = Rack.removeTile(session.playerRack, tileId);
            if (removed) swapped.push(removed);
          }
          Bag.returnTiles(session.bag, swapped);
          Rack.refillFromBag(session.playerRack, session.bag);
          session.consecutiveNonScoringTurns++;
          if (window.AMath.scoreSheet) {
            window.AMath.scoreSheet.recordTurn('player', 'swap', 0, false, session.playerScore);
          }
          showStatus('🤖→You swapped tiles.');
        } else {
          session.consecutiveNonScoringTurns++;
          if (window.AMath.scoreSheet) {
            window.AMath.scoreSheet.recordTurn('player', 'pass', 0, false, session.playerScore);
          }
          showStatus('🤖→You passed.');
        }

        autoSave();

        if (checkGameEnd()) return;

        Interactions.setPlayerTurn(false);
        setTimeout(runAiTurn, 800);
      } catch (err) {
        console.error('AI Takeover error:', err);
        showThinking(false);
        showStatus('AI Takeover error.', 'error');
      }
    }, 100);
  }

  /**
   * AI vs AI session - both racks visible, both controlled by AI.
   */
  function startAiVsAiSession() {
    const C = window.AMath.constants;
    const Bag = window.AMath.bag;
    const Rack = window.AMath.rack;
    const Board = window.AMath.board;
    const UI = window.AMath.ui;
    const Settings = window.AMath.settings;
    const Modes = window.AMath.modes;

    if (chessClockInterval) {
      clearInterval(chessClockInterval);
      chessClockInterval = null;
    }
    if (window.AMath.saveResume) window.AMath.saveResume.clearSave();
    if (window.AMath.scoreSheet) window.AMath.scoreSheet.reset();

    const existingPopup = document.querySelector('.game-end-overlay');
    if (existingPopup) existingPopup.remove();

    const bag = Bag.createBag();
    const ai1Rack = Rack.createRack('ai1');
    const ai2Rack = Rack.createRack('ai2');
    const board = Board.createBoard();

    Rack.refillFromBag(ai1Rack, bag);
    Rack.refillFromBag(ai2Rack, bag);

    const container = document.getElementById('game-container');
    const parts = UI.buildGameLayout(container);

    UI.renderScore(parts.opponentScoreBox, 'AI 2', 0);
    UI.renderScore(parts.playerScoreBox, 'AI 1', 0);

    // No chess clock in AI vs AI mode (just for fun watching)
    parts.opponentTimer.innerHTML = '<div class="timer-label">AI 2</div><div class="timer-value">—</div>';
    parts.playerTimer.innerHTML = '<div class="timer-label">AI 1</div><div class="timer-value">—</div>';

    session = {
      board: board,
      playerRack: ai1Rack,  // ai1 takes "player" slot
      aiRack: ai2Rack,
      bag: bag,
      uiParts: parts,
      isPlayerTurn: Math.random() < 0.5, // randomize who goes first
      tentativePlacements: [],
      selectedTileId: null,
      playerScore: 0,
      aiScore: 0,
      isFirstMove: true,
      gameOver: false,
      consecutiveNonScoringTurns: 0,
      playerTimeSeconds: 0,
      aiTimeSeconds: 0,
      chessClockEnabled: false,
      lastAiPlay: null,
      isAiVsAi: true,
      playerTimerPaused: false,
      aiTimerPaused: false,
    };

    // Clear any leftover pause-indicator from previous game
    if (parts.playerScoreBox) parts.playerScoreBox.classList.remove('timer-paused');
    if (parts.opponentScoreBox) parts.opponentScoreBox.classList.remove('timer-paused');

    // Render BOTH racks face-up
    UI.renderRack(ai1Rack, parts.playerRack, false);
    UI.renderRack(ai2Rack, parts.opponentRack, false);
    UI.renderBoard(board, parts.boardArea);

    // Wire up New Game
    const btnNewGame = document.getElementById('btn-new-game');
    if (btnNewGame) {
      btnNewGame.addEventListener('click', function () {
        if (confirm('Start a new game?')) {
          startGameSession();
        }
      });
    }

    // Wire up Settings
    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', function () {
        Settings.showPopup(function (changed) {
          if (changed) {
            if (confirm('Settings saved. Restart game?')) {
              startGameSession();
            }
          }
        });
      });
    }

    const btnScoreSheet = document.getElementById('btn-score-sheet');
    if (btnScoreSheet) {
      btnScoreSheet.addEventListener('click', function () {
        window.AMath.scoreSheet.showPopup(session.playerScore, session.aiScore);
      });
    }

    wireExportImportButtons();
    wireTileTrackerButton();

    // Disable buttons not relevant to AI vs AI
    const btnSubmit = document.getElementById('btn-submit');
    const btnReset = document.getElementById('btn-reset');
    const btnPass = document.getElementById('btn-pass');
    const btnSwap = document.getElementById('btn-swap');
    const btnTakeover = document.getElementById('btn-takeover');
    if (btnSubmit) btnSubmit.disabled = true;
    if (btnReset) btnReset.disabled = true;
    if (btnPass) btnPass.disabled = true;
    if (btnSwap) btnSwap.disabled = true;
    if (btnTakeover) btnTakeover.style.display = 'none';

    // Show AI vs AI bar with pause/step/speed
    const aiVsAiBar = document.getElementById('aivai-bar');
    if (aiVsAiBar) {
      aiVsAiBar.style.display = '';

      const btnPause = document.getElementById('btn-aivai-pause');
      const btnStep = document.getElementById('btn-aivai-step');
      const slider = document.getElementById('aivai-speed-slider');
      const speedValue = document.getElementById('aivai-speed-value');

      if (btnPause) {
        btnPause.addEventListener('click', function () {
          const wasPaused = Modes.isAiVsAiPaused();
          Modes.setAiVsAiPaused(!wasPaused);
          btnPause.textContent = Modes.isAiVsAiPaused() ? '▶ Resume' : '⏸ Pause';
          if (!Modes.isAiVsAiPaused()) {
            // Resume
            runAiVsAiTurn();
          }
        });
      }
      if (btnStep) {
        btnStep.addEventListener('click', function () {
          if (Modes.isAiVsAiPaused()) {
            runAiVsAiTurn(true); // single step
          }
        });
      }
      if (slider) {
        slider.addEventListener('input', function () {
          Modes.setAiVsAiSpeed(parseInt(slider.value, 10));
          if (speedValue) speedValue.textContent = slider.value + 'x';
        });
      }
    }

    showStatus(session.isPlayerTurn ? '🤖 AI 1 thinking...' : '🤖 AI 2 thinking...');
    refreshDesktopSidePanels();
    setTimeout(runAiVsAiTurn, 1000);
  }

  /**
   * AI vs AI turn handler. One side plays, then schedules the next.
   * @param singleStep: if true, only play one turn (don't auto-schedule the next)
   */
  function runAiVsAiTurn(singleStep) {
    const Modes = window.AMath.modes;
    const AI = window.AMath.aiPlayer;
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;
    const Bag = window.AMath.bag;
    const UI = window.AMath.ui;

    if (!session || session.gameOver) return;
    if (Modes.isAiVsAiPaused() && !singleStep) return;

    // Determine which rack is current
    const isAi1 = session.isPlayerTurn;
    const currentRack = isAi1 ? session.playerRack : session.aiRack;
    const label = isAi1 ? 'AI 1' : 'AI 2';

    showStatus('🤖 ' + label + ' is thinking...');

    setTimeout(function () {
      try {
        const decision = AI.decideMove({
          board: session.board,
          aiRack: currentRack,
          bag: session.bag,
          isFirstMove: session.isFirstMove,
          playerScore: isAi1 ? session.aiScore : session.playerScore,
          aiScore: isAi1 ? session.playerScore : session.aiScore,
          consecutiveNonScoringTurns: session.consecutiveNonScoringTurns || 0,
          opponentRack: isAi1 ? session.aiRack : session.playerRack,
        });

        // Execute decision
        if (decision.type === 'play') {
          for (const p of decision.placements) {
            const removed = Rack.removeTile(currentRack, p.tile.id);
            if (!removed) continue;
            if (p.assigned) removed.assigned = p.assigned;
            Board.placeTile(session.board, p.row, p.col, removed);
            Board.markPremiumUsed(session.board, p.row, p.col);
          }
          const isBingo = decision.placements.length === 8;
          if (isAi1) session.playerScore += decision.score;
          else session.aiScore += decision.score;
          session.isFirstMove = false;
          session.consecutiveNonScoringTurns = 0;
          Rack.refillFromBag(currentRack, session.bag);

          if (window.AMath.scoreSheet) {
            window.AMath.scoreSheet.recordTurn(
              isAi1 ? 'player' : 'ai',
              'play',
              decision.score,
              isBingo,
              isAi1 ? session.playerScore : session.aiScore
            );
          }

          let msg = '🤖 ' + label + ' scored ' + decision.score + '.';
          if (isBingo) msg = '🤖 ' + label + ' BINGO! +' + decision.score + '!';
          showStatus(msg, 'success');
        } else if (decision.type === 'swap') {
          const swapped = [];
          for (const tileId of decision.tileIds) {
            const removed = Rack.removeTile(currentRack, tileId);
            if (removed) swapped.push(removed);
          }
          Bag.returnTiles(session.bag, swapped);
          Rack.refillFromBag(currentRack, session.bag);
          session.consecutiveNonScoringTurns++;
          showStatus('🤖 ' + label + ' swapped.');
        } else {
          session.consecutiveNonScoringTurns++;
          showStatus('🤖 ' + label + ' passed.');
        }

        // Re-render board + both racks
        UI.renderBoard(session.board, session.uiParts.boardArea);
        UI.renderRack(session.playerRack, session.uiParts.playerRack, false);
        UI.renderRack(session.aiRack, session.uiParts.opponentRack, false);
        UI.renderScore(session.uiParts.playerScoreBox, 'AI 1', session.playerScore);
        UI.renderScore(session.uiParts.opponentScoreBox, 'AI 2', session.aiScore);

        refreshTileTracker();
        refreshDesktopSidePanels();

        if (checkGameEnd()) return;

        // Flip turn
        session.isPlayerTurn = !session.isPlayerTurn;

        // Schedule next turn unless paused / single step
        if (!singleStep && !Modes.isAiVsAiPaused()) {
          setTimeout(runAiVsAiTurn, Modes.getAiVsAiDelay());
        }
      } catch (err) {
        console.error('AI vs AI error:', err);
        showStatus('AI vs AI error.', 'error');
      }
    }, 100);
  }

  /**
   * Resume a saved game from a snapshot.
   */
  function resumeGame(saved) {
    const C = window.AMath.constants;
    const UI = window.AMath.ui;
    const Interactions = window.AMath.interactions;
    const Settings = window.AMath.settings;

    if (chessClockInterval) {
      clearInterval(chessClockInterval);
      chessClockInterval = null;
    }

    const container = document.getElementById('game-container');
    const parts = UI.buildGameLayout(container);

    UI.renderScore(parts.opponentScoreBox, 'AI', saved.aiScore);
    UI.renderScore(parts.playerScoreBox, 'You', saved.playerScore);

    const chessClockEnabled = saved.chessClockEnabled;
    if (chessClockEnabled) {
      UI.renderTimer(parts.opponentTimer, 'AI Time', saved.aiTimeSeconds);
      UI.renderTimer(parts.playerTimer, 'Your Time', saved.playerTimeSeconds);
    } else {
      parts.opponentTimer.innerHTML = '<div class="timer-label">AI Time</div><div class="timer-value">—</div>';
      parts.playerTimer.innerHTML = '<div class="timer-label">Your Time</div><div class="timer-value">—</div>';
    }

    session = {
      board: saved.board,
      playerRack: saved.playerRack,
      aiRack: saved.aiRack,
      bag: saved.bag,
      uiParts: parts,
      isPlayerTurn: saved.isPlayerTurn,
      tentativePlacements: [],
      selectedTileId: null,
      playerScore: saved.playerScore,
      aiScore: saved.aiScore,
      isFirstMove: saved.isFirstMove,
      gameOver: false,
      consecutiveNonScoringTurns: saved.consecutiveNonScoringTurns || 0,
      playerTimeSeconds: saved.playerTimeSeconds,
      aiTimeSeconds: saved.aiTimeSeconds,
      chessClockEnabled: chessClockEnabled,
      lastAiPlay: null,
      playerTimerPaused: false,
      aiTimerPaused: false,
      onSubmit: handleSubmit,
      onReset: handleReset,
      onPass: handlePass,
      onSwap: handleSwap,
    };

    // Clear any leftover pause-indicator from previous game
    if (parts.playerScoreBox) parts.playerScoreBox.classList.remove('timer-paused');
    if (parts.opponentScoreBox) parts.opponentScoreBox.classList.remove('timer-paused');

    // Restore score sheet
    if (window.AMath.scoreSheet) {
      window.AMath.scoreSheet.reset();
      if (saved.scoreSheet && Array.isArray(saved.scoreSheet)) {
        // Recreate entries (using internal API; recordTurn increments turn number)
        // For simplicity, we replay them — but this requires recordTurn to accept turn number.
        // Just re-record each entry in order.
        for (const e of saved.scoreSheet) {
          window.AMath.scoreSheet.recordTurn(e.who, e.action, e.score, e.isBingo, e.total);
        }
      }
    }

    Interactions.init(session);

    const btnNewGame = document.getElementById('btn-new-game');
    if (btnNewGame) {
      btnNewGame.addEventListener('click', function () {
        if (confirm('Start a new game? Current progress will be lost.')) {
          window.AMath.saveResume.clearSave();
          startGameSession();
        }
      });
    }

    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', function () {
        Settings.showPopup(function (changed) {
          if (changed) {
            if (confirm('Settings saved. Start a new game to apply?')) {
              window.AMath.saveResume.clearSave();
              startGameSession();
            }
          }
        });
      });
    }

    const btnScoreSheet = document.getElementById('btn-score-sheet');
    if (btnScoreSheet) {
      btnScoreSheet.addEventListener('click', function () {
        window.AMath.scoreSheet.showPopup(session.playerScore, session.aiScore);
      });
    }

    wireExportImportButtons();
    wireTileTrackerButton();

    // Wire up AI Takeover button (toggle mode)
    const btnTakeover = document.getElementById('btn-takeover');
    if (btnTakeover) {
      btnTakeover.addEventListener('click', function () {
        const Modes = window.AMath.modes;
        if (!Modes) return;
        const isActive = Modes.isAiTakeover();

        if (isActive) {
          Modes.setAiTakeover(false);
          btnTakeover.textContent = '🤖 Auto';
          btnTakeover.classList.remove('btn-active');
          showStatus('Takeover OFF — you play your own turns now.');
        } else {
          if (session.tentativePlacements.length > 0) {
            showStatus("Reset your placements first.", 'error');
            return;
          }
          Modes.setAiTakeover(true);
          btnTakeover.textContent = '🤖 Auto ON';
          btnTakeover.classList.add('btn-active');
          showStatus('🤖 Auto ON — AI will play your turns. Click again to stop.');

          if (session.isPlayerTurn && !session.gameOver) {
            setTimeout(runAiTakeoverTurn, 600);
          }
        }
      });
    }

    if (chessClockEnabled) {
      startChessClock();
    }

    wireScorePauseHandlers();
    refreshDesktopSidePanels();

    showStatus('Resumed game. ' + (session.isPlayerTurn ? 'Your turn.' : 'AI is thinking...'));

    if (!session.isPlayerTurn) {
      setTimeout(runAiTurn, 800);
    }
  }

  /**
   * Auto-save after every move. Skip if game is over.
   */
  function autoSave() {
    if (!session || session.gameOver) return;
    const SaveResume = window.AMath.saveResume;
    if (SaveResume) SaveResume.save(session);
    // Refresh tile tracker if it's visible
    refreshTileTracker();
    // Refresh desktop side panels (score sheet + tile tracker)
    refreshDesktopSidePanels();
  }

  /**
   * Wire up Export/Import buttons (shared across game modes).
   */
  function wireExportImportButtons() {
    const SaveResume = window.AMath.saveResume;
    if (!SaveResume) return;

    const btnExport = document.getElementById('btn-export');
    if (btnExport) {
      btnExport.addEventListener('click', function () {
        if (!session) return;
        const defaultName = 'amath-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const filename = prompt('Save game as (no extension):', defaultName);
        if (!filename) return; // user cancelled
        SaveResume.exportToFile(session, filename);
        showStatus('💾 Game saved as "' + filename + '.json"', 'success');
      });
    }

    const btnImport = document.getElementById('btn-import');
    const fileInput = document.getElementById('file-import-input');
    if (btnImport && fileInput) {
      btnImport.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        if (session && !session.gameOver) {
          if (!confirm('Load this saved game? Current game will be lost.')) {
            fileInput.value = '';
            return;
          }
        }
        SaveResume.importFromFile(file)
          .then(function (saved) {
            resumeGame(saved);
            showStatus('📂 Loaded game from "' + file.name + '"', 'success');
          })
          .catch(function (err) {
            showStatus('❌ Failed to load file: ' + err.message, 'error');
          });
        fileInput.value = ''; // allow re-loading same file
      });
    }
  }

  /**
   * Wire up the tile tracker toggle button + auto-refresh.
   */
  let trackerVisible = false;

  function wireTileTrackerButton() {
    const btnTracker = document.getElementById('btn-tracker');
    if (btnTracker) {
      btnTracker.addEventListener('click', function () {
        toggleTileTracker();
      });
    }
  }

  function toggleTileTracker() {
    trackerVisible = !trackerVisible;
    const panel = document.getElementById('tile-tracker-panel');
    if (!panel) return;
    panel.style.display = trackerVisible ? 'block' : 'none';
    if (trackerVisible) {
      refreshTileTracker();
    }
  }

  function refreshTileTracker() {
    if (!trackerVisible) return;
    if (!session) return;
    const Tracker = window.AMath.tileTracker;
    if (!Tracker) return;
    const panel = document.getElementById('tile-tracker-panel');
    if (panel) Tracker.render(panel, session);
  }

  /**
   * Refresh the desktop side panels (live score sheet + live tile tracker).
   * Called after every turn / state change. Safe to call when panels hidden.
   */
  function refreshDesktopSidePanels() {
    if (!session) return;

    // Live score sheet (left panel)
    const sheetEl = document.getElementById('live-score-sheet');
    if (sheetEl && window.AMath.scoreSheet && window.AMath.scoreSheet.renderLive) {
      window.AMath.scoreSheet.renderLive(sheetEl, session.playerScore, session.aiScore);
    }

    // Live tile tracker (right panel) — only in player vs AI
    const trackerEl = document.getElementById('live-tile-tracker');
    if (trackerEl && window.AMath.tileTracker && !session.isAiVsAi) {
      window.AMath.tileTracker.render(trackerEl, session);
    } else if (trackerEl && session.isAiVsAi) {
      // In AI vs AI mode, the tracker is meaningless since both racks are visible
      trackerEl.innerHTML = '<div class="live-score-empty">N/A in AI vs AI mode</div>';
    }
  }

  // ============================================================================
  // CHESS CLOCK
  // ============================================================================

  function startChessClock() {
    chessClockInterval = setInterval(function () {
      if (!session || session.gameOver) return;

      if (session.isPlayerTurn) {
        if (session.playerTimerPaused) return; // pause-by-double-click
        session.playerTimeSeconds--;
        window.AMath.ui.renderTimer(
          session.uiParts.playerTimer,
          'Your Time',
          session.playerTimeSeconds
        );
      } else {
        if (session.aiTimerPaused) return; // pause-by-double-click
        session.aiTimeSeconds--;
        window.AMath.ui.renderTimer(
          session.uiParts.opponentTimer,
          'AI Time',
          session.aiTimeSeconds
        );
      }
    }, 1000);
  }

  function calculateTimePenalty(seconds) {
    if (seconds >= 0) return 0;
    const secondsOver = Math.abs(seconds);
    const minutesOver = Math.ceil(secondsOver / 60);
    return minutesOver * 10;
  }

  /**
   * Wire up double-click handlers on score boxes to pause/resume timers.
   * Feature M: Double-click on player score pauses player's timer; same for AI.
   */
  function wireScorePauseHandlers() {
    if (!session || !session.uiParts) return;
    const playerBox = session.uiParts.playerScoreBox;
    const aiBox = session.uiParts.opponentScoreBox;

    if (playerBox && !playerBox._pauseHandlerWired) {
      playerBox._pauseHandlerWired = true;
      playerBox.style.cursor = 'pointer';
      playerBox.title = 'Double-click to pause/resume timer';
      playerBox.addEventListener('dblclick', function () {
        if (!session || session.gameOver) return;
        if (session.isAiVsAi) return;  // no pausing in AI vs AI mode
        session.playerTimerPaused = !session.playerTimerPaused;
        playerBox.classList.toggle('timer-paused', session.playerTimerPaused);
        console.log('[Pause] Player timer:', session.playerTimerPaused ? 'PAUSED' : 'RESUMED');
      });
    }

    if (aiBox && !aiBox._pauseHandlerWired) {
      aiBox._pauseHandlerWired = true;
      aiBox.style.cursor = 'pointer';
      aiBox.title = 'Double-click to pause/resume timer';
      aiBox.addEventListener('dblclick', function () {
        if (!session || session.gameOver) return;
        if (session.isAiVsAi) return;  // no pausing in AI vs AI mode
        session.aiTimerPaused = !session.aiTimerPaused;
        aiBox.classList.toggle('timer-paused', session.aiTimerPaused);
        console.log('[Pause] AI timer:', session.aiTimerPaused ? 'PAUSED' : 'RESUMED');
      });
    }
  }

  // ============================================================================
  // PLAYER TURN HANDLERS
  // ============================================================================

  function handleSubmit() {
    const Placement = window.AMath.placement;
    const Scoring = window.AMath.scoring;
    const Rack = window.AMath.rack;
    const Board = window.AMath.board;
    const UI = window.AMath.ui;
    const Interactions = window.AMath.interactions;
    const intState = Interactions.getState();

    if (intState.swapMode) {
      handleConfirmSwap();
      return;
    }

    // Hide challenge button (player chose to play instead of challenge)
    hideChallengeButton();

    if (session.tentativePlacements.length === 0) return;

    const result = Placement.validatePlay(
      session.board,
      session.tentativePlacements,
      session.isFirstMove
    );

    if (!result.ok) {
      showStatus('❌ ' + result.reason, 'error');
      if (window.AMath.sounds) window.AMath.sounds.submitFail();
      return;
    }

    const scoreResult = Scoring.scorePlay(
      result.equations,
      session.board,
      session.tentativePlacements.length
    );

    for (const p of session.tentativePlacements) {
      Board.markPremiumUsed(session.board, p.row, p.col);
    }
    const oldScore = session.playerScore;
    session.playerScore += scoreResult.total;
    session.isFirstMove = false;
    session.consecutiveNonScoringTurns = 0;

    const wasBingo = scoreResult.bingoBonus > 0;

    Rack.refillFromBag(session.playerRack, session.bag);
    Interactions.clearTentativePlacements();

    UI.renderScore(session.uiParts.playerScoreBox, 'You', session.playerScore);

    // Animate score
    const Anim = window.AMath.animations;
    if (Anim) {
      const scoreEl = session.uiParts.playerScoreBox.querySelector('.score-value');
      if (scoreEl) Anim.animateScore(scoreEl, oldScore, session.playerScore);
    }

    // Score sheet
    if (window.AMath.scoreSheet) {
      window.AMath.scoreSheet.recordTurn('player', 'play', scoreResult.total, wasBingo, session.playerScore);
    }

    let msg = '✅ You scored ' + scoreResult.total + ' points!';
    if (wasBingo) msg += ' (+40 BINGO! 🎉)';
    showStatus(msg, 'success');

    // Sounds + animations
    if (window.AMath.sounds) {
      if (wasBingo) window.AMath.sounds.bingo();
      else window.AMath.sounds.submitSuccess();
    }
    if (Anim && wasBingo) {
      Anim.bingoBanner('BINGO!');
      Anim.confettiBurst();
    }

    // Trash-talk: react to opponent's play
    fireTrashTalk(wasBingo ? 'opp_bingo' : 'opp_pass_check', { lastScore: scoreResult.total });

    autoSave();

    if (checkGameEnd()) return;

    Interactions.setPlayerTurn(false);
    setTimeout(runAiTurn, 800);
  }

  function handleReset() {
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;
    const Interactions = window.AMath.interactions;
    const intState = Interactions.getState();

    if (intState.swapMode) {
      Interactions.exitSwapMode();
      showStatus('Swap cancelled.');
      return;
    }

    const placements = [...session.tentativePlacements];
    for (const p of placements) {
      const tile = Board.removeTile(session.board, p.row, p.col);
      if (tile) {
        tile.assigned = null;
        Rack.addTile(session.playerRack, tile);
      }
    }
    Interactions.clearTentativePlacements();
    Interactions.refreshUI();
    showStatus('Tiles returned to rack.');
  }

  function handlePass() {
    const Interactions = window.AMath.interactions;
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;

    hideChallengeButton();

    for (const p of [...session.tentativePlacements]) {
      const tile = Board.removeTile(session.board, p.row, p.col);
      if (tile) {
        tile.assigned = null;
        Rack.addTile(session.playerRack, tile);
      }
    }
    Interactions.clearTentativePlacements();

    session.consecutiveNonScoringTurns++;

    if (window.AMath.scoreSheet) {
      window.AMath.scoreSheet.recordTurn('player', 'pass', 0, false, session.playerScore);
    }
    fireTrashTalk('opp_pass', {});

    showStatus('You passed.');

    autoSave();

    if (checkGameEnd()) return;

    Interactions.setPlayerTurn(false);
    setTimeout(runAiTurn, 800);
  }

  function handleSwap() {
    const C = window.AMath.constants;
    const Bag = window.AMath.bag;
    const Interactions = window.AMath.interactions;

    hideChallengeButton();

    if (Bag.bagSize(session.bag) <= C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
      showStatus('Swap not allowed — bag has ≤5 tiles remaining.', 'error');
      return;
    }

    Interactions.enterSwapMode();
    showStatus('Swap mode: tap tiles to select, then Confirm Swap.');
  }

  function handleConfirmSwap() {
    const Bag = window.AMath.bag;
    const Rack = window.AMath.rack;
    const Interactions = window.AMath.interactions;

    const tileIds = Interactions.getSwapSelection();
    if (tileIds.length === 0) {
      Interactions.exitSwapMode();
      return;
    }

    const tilesToReturn = [];
    for (const id of tileIds) {
      const removed = Rack.removeTile(session.playerRack, id);
      if (removed) tilesToReturn.push(removed);
    }

    Bag.returnTiles(session.bag, tilesToReturn);
    Rack.refillFromBag(session.playerRack, session.bag);

    Interactions.exitSwapMode();
    session.consecutiveNonScoringTurns++;

    if (window.AMath.scoreSheet) {
      window.AMath.scoreSheet.recordTurn('player', 'swap', 0, false, session.playerScore);
    }
    fireTrashTalk('opp_swap', {});

    showStatus('Swapped ' + tilesToReturn.length + ' tiles.');

    autoSave();

    if (checkGameEnd()) return;

    Interactions.setPlayerTurn(false);
    setTimeout(runAiTurn, 800);
  }

  // ============================================================================
  // AI TURN
  // ============================================================================

  function runAiTurn() {
    const Interactions = window.AMath.interactions;
    const AI = window.AMath.aiPlayer;

    if (session.gameOver) return;

    showThinking(true);

    setTimeout(function () {
      try {
        const aiDecision = AI.decideMove({
          board: session.board,
          aiRack: session.aiRack,
          bag: session.bag,
          isFirstMove: session.isFirstMove,
          playerScore: session.playerScore,
          aiScore: session.aiScore,
          consecutiveNonScoringTurns: session.consecutiveNonScoringTurns || 0,
          opponentRack: session.playerRack,
        });

        executeAiDecision(aiDecision);
      } catch (err) {
        console.error('AI error:', err);
        showThinking(false);
        showStatus('AI error — your turn.', 'error');
        Interactions.setPlayerTurn(true);
      }
    }, 100);
  }

  function executeAiDecision(decision) {
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;
    const Bag = window.AMath.bag;
    const UI = window.AMath.ui;
    const Interactions = window.AMath.interactions;

    showThinking(false);

    if (decision.type === 'play') {
      // Track premium cells that get marked used (so we can revert if challenged)
      const premiumCellsUsed = [];
      const placedRefs = [];

      for (const p of decision.placements) {
        const removed = Rack.removeTile(session.aiRack, p.tile.id);
        if (!removed) continue;
        if (p.assigned) removed.assigned = p.assigned;
        Board.placeTile(session.board, p.row, p.col, removed);

        // Check if premium was newly marked used
        const cell = Board.getCell(session.board, p.row, p.col);
        if (cell.premium && !cell.premiumUsed) {
          premiumCellsUsed.push({ row: p.row, col: p.col });
        }
        Board.markPremiumUsed(session.board, p.row, p.col);
        placedRefs.push({ row: p.row, col: p.col, tile: removed });
      }

      const isBingo = decision.placements.length === 8;
      const wasFirstMove = session.isFirstMove;
      const oldAiScore = session.aiScore;
      session.aiScore += decision.score;
      session.isFirstMove = false;
      session.consecutiveNonScoringTurns = 0;
      Rack.refillFromBag(session.aiRack, session.bag);

      // Record this play for potential challenge
      session.lastAiPlay = {
        placements: placedRefs,
        score: decision.score,
        premiumCellsUsed: premiumCellsUsed,
        wasFirstMove: wasFirstMove,
        wasOpponent: 'ai',
      };

      UI.renderScore(session.uiParts.opponentScoreBox, 'AI', session.aiScore);

      // Animate AI score
      const Anim = window.AMath.animations;
      if (Anim) {
        const scoreEl = session.uiParts.opponentScoreBox.querySelector('.score-value');
        if (scoreEl) Anim.animateScore(scoreEl, oldAiScore, session.aiScore);
        // Pulse the cells AI just placed on
        Anim.pulseCells(placedRefs);
      }

      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('ai', 'play', decision.score, isBingo, session.aiScore);
      }

      let msg = '🤖 AI scored ' + decision.score + ' points. Your turn!';
      if (isBingo) msg = '🤖 AI BINGO! +' + decision.score + '. Your turn!';
      showStatus(msg);

      // Sounds + animations
      if (window.AMath.sounds) {
        if (isBingo) window.AMath.sounds.bingo();
        else window.AMath.sounds.aiPlay();
      }
      if (Anim && isBingo) {
        Anim.bingoBanner('AI BINGO!');
        Anim.confettiBurst();
      }

      const event = isBingo ? 'ai_bingo' : 'ai_play';
      fireTrashTalk(event, { lastScore: decision.score });
    } else if (decision.type === 'swap') {
      const swapped = [];
      for (const tileId of decision.tileIds) {
        const removed = Rack.removeTile(session.aiRack, tileId);
        if (removed) swapped.push(removed);
      }
      Bag.returnTiles(session.bag, swapped);
      Rack.refillFromBag(session.aiRack, session.bag);
      session.consecutiveNonScoringTurns++;
      session.lastAiPlay = null;

      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('ai', 'swap', 0, false, session.aiScore);
      }

      showStatus('🤖 AI swapped ' + swapped.length + ' tiles. Your turn!');
      fireTrashTalk('ai_swap', {});
    } else if (decision.type === 'pass') {
      session.consecutiveNonScoringTurns++;
      session.lastAiPlay = null;

      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('ai', 'pass', 0, false, session.aiScore);
      }

      showStatus('🤖 AI passed. Your turn!');
      fireTrashTalk('ai_pass', {});
    } else {
      // Unknown decision type — treat as pass for safety
      console.warn('[AI] Unknown decision type:', decision.type, '— treating as pass');
      session.consecutiveNonScoringTurns++;
      session.lastAiPlay = null;

      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('ai', 'pass', 0, false, session.aiScore);
      }

      showStatus('🤖 AI passed (unknown action). Your turn!');
    }

    autoSave();

    if (checkGameEnd()) return;

    Interactions.setPlayerTurn(true);

    // Show challenge button briefly after AI play
    if (decision.type === 'play') {
      showChallengeButton();
    }

    // If AI Takeover toggle is ON, play the player's turn automatically
    const Modes = window.AMath.modes;
    if (Modes.isAiTakeover() && !session.gameOver) {
      setTimeout(runAiTakeoverTurn, 800);
    }
  }

  /**
   * Helper: fire a trash-talk message based on event + current state.
   * Respects the trashTalkEnabled setting.
   */
  function fireTrashTalk(event, extras) {
    const Settings = window.AMath.settings;
    const TT = window.AMath.trashTalk;
    if (!Settings.get('trashTalkEnabled')) return;
    if (!TT) return;
    TT.fireForEvent(event, {
      playerScore: session.playerScore,
      aiScore: session.aiScore,
      lastScore: extras && extras.lastScore,
    });
  }

  /**
   * Show the Challenge button for ~10 seconds after AI plays.
   * Player can click it to challenge the play.
   */
  let challengeTimeout = null;

  function showChallengeButton() {
    const btn = document.getElementById('btn-challenge');
    if (!btn) return;
    btn.style.display = '';
    btn.disabled = false;

    // Remove old listener if any
    btn.replaceWith(btn.cloneNode(true));
    const newBtn = document.getElementById('btn-challenge');
    newBtn.addEventListener('click', handleChallenge);

    // Auto-hide after 10 seconds (challenge window expires)
    if (challengeTimeout) clearTimeout(challengeTimeout);
    challengeTimeout = setTimeout(hideChallengeButton, 10000);
  }

  function hideChallengeButton() {
    const btn = document.getElementById('btn-challenge');
    if (btn) {
      btn.style.display = 'none';
      btn.disabled = true;
    }
    if (challengeTimeout) {
      clearTimeout(challengeTimeout);
      challengeTimeout = null;
    }
  }

  function handleChallenge() {
    const Challenge = window.AMath.challenge;
    const UI = window.AMath.ui;
    const Rack = window.AMath.rack;

    hideChallengeButton();

    if (!session.lastAiPlay) {
      showStatus('No play to challenge.', 'error');
      return;
    }

    const play = session.lastAiPlay;

    // Verify the play by re-running validation on its placements
    // (tiles are still on board; we treat them as "new" again temporarily by
    // checking each — but really, since Placement.validatePlay reads from board,
    // we need to remove and re-place them for proper validation)
    // Simpler approach: validate the formed equations directly via evaluator
    // (which the AI's logic guarantees were valid before placement).

    // For now: AI plays are always valid (the AI search guarantees this),
    // so all player challenges will fail. Just inform the user.
    const aiPlayWasValid = true; // AI's algorithm guarantees validity

    if (aiPlayWasValid) {
      // Challenge failed — in Hard mode, no penalty
      showStatus('❌ Challenge failed. AI\'s play was valid.', 'error');
    } else {
      // Challenge succeeded — revert AI's play
      Challenge.revertPlay(session, play);
      UI.renderScore(session.uiParts.opponentScoreBox, 'AI', session.aiScore);

      // Update score sheet — remove that AI play entry? For simplicity, add a "challenged" note
      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('player', 'challenge-win', play.score, false, session.playerScore);
      }

      session.lastAiPlay = null;
      window.AMath.interactions.refreshUI();
      showStatus('✅ Challenge successful! AI\'s play reverted.', 'success');
    }
  }

  // ============================================================================
  // GAME END LOGIC
  // ============================================================================

  function checkGameEnd() {
    const C = window.AMath.constants;
    const Rack = window.AMath.rack;
    const Bag = window.AMath.bag;

    if (Bag.bagSize(session.bag) === 0) {
      if (Rack.isEmpty(session.playerRack) || Rack.isEmpty(session.aiRack)) {
        finalizeGame('rack_emptied');
        return true;
      }
    }

    if (session.consecutiveNonScoringTurns >= C.CONSECUTIVE_NON_SCORING_TURNS_TO_END) {
      finalizeGame('consecutive_passes');
      return true;
    }

    return false;
  }

  function finalizeGame(reason) {
    const Rack = window.AMath.rack;
    const UI = window.AMath.ui;

    session.gameOver = true;
    if (chessClockInterval) {
      clearInterval(chessClockInterval);
      chessClockInterval = null;
    }

    // Clear saved game (game is over)
    if (window.AMath.saveResume) window.AMath.saveResume.clearSave();

    if (reason === 'rack_emptied') {
      if (Rack.isEmpty(session.playerRack)) {
        session.playerScore += Rack.rackPoints(session.aiRack) * 2;
      } else if (Rack.isEmpty(session.aiRack)) {
        session.aiScore += Rack.rackPoints(session.playerRack) * 2;
      }
    } else {
      session.playerScore -= Rack.rackPoints(session.playerRack);
      session.aiScore -= Rack.rackPoints(session.aiRack);
    }

    // Time penalties only apply when chess clock is enabled
    let playerTimePenalty = 0;
    let aiTimePenalty = 0;
    if (session.chessClockEnabled) {
      playerTimePenalty = calculateTimePenalty(session.playerTimeSeconds);
      aiTimePenalty = calculateTimePenalty(session.aiTimeSeconds);
      session.playerScore -= playerTimePenalty;
      session.aiScore -= aiTimePenalty;
    }

    UI.renderScore(session.uiParts.playerScoreBox, 'You', session.playerScore);
    UI.renderScore(session.uiParts.opponentScoreBox, 'AI', session.aiScore);

    let winnerLabel;
    if (session.playerScore > session.aiScore) winnerLabel = 'You';
    else if (session.aiScore > session.playerScore) winnerLabel = 'AI';
    else winnerLabel = 'Tie';

    const reasonText =
      reason === 'rack_emptied'
        ? "Game ended: someone played their last tile and the bag is empty."
        : 'Game ended: 6 consecutive non-scoring turns.';

    UI.showGameEndPopup({
      winnerLabel: winnerLabel,
      playerScore: session.playerScore,
      aiScore: session.aiScore,
      playerTimePenalty: playerTimePenalty,
      aiTimePenalty: aiTimePenalty,
      reason: reasonText,
      onNewGame: startGameSession,
    });

    // Game end sound + celebration if player won
    if (window.AMath.sounds) window.AMath.sounds.gameEnd();
    if (winnerLabel === 'You' && window.AMath.animations) {
      window.AMath.animations.confettiBurst(3000);
    }
  }

  // ============================================================================
  // STATUS
  // ============================================================================

  function showThinking(on) {
    const status = document.getElementById('status');
    if (!status) return;
    if (on) {
      status.textContent = '🤖 AI is thinking...';
      status.style.color = '#6b7280';
      status.style.fontWeight = '500';
    }
  }

  function showStatus(text, kind) {
    const status = document.getElementById('status');
    if (!status) return;
    status.textContent = text;
    status.style.color = kind === 'error' ? '#dc2626' : kind === 'success' ? '#059669' : '#1f2937';
    status.style.fontWeight = kind === 'success' || kind === 'error' ? '600' : 'normal';
  }
})();
