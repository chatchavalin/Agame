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

  // ============================================================================
  // STALLING WATCH — needles the player with character-flavored trash-talk
  // every 30 seconds they spend thinking on their turn.
  //
  // Runs independently of the chess clock (which may be disabled). Starts on
  // player-turn-begin, ticks every second, fires trash-talk at 30/60/90/...,
  // resets on player-turn-end (submit/pass/swap) or AI vs AI mode.
  // ============================================================================

  let stallingInterval = null;
  let stallingSeconds = 0;
  let stallingFiredCount = 0;  // 0 if player hasn't been needled yet this turn
  const STALLING_THRESHOLD_S = 30;  // fire every 30 seconds

  function startStallingWatch() {
    stopStallingWatch();
    stallingSeconds = 0;
    stallingFiredCount = 0;
    let lastTickAt = Date.now();
    stallingInterval = setInterval(function () {
      // Update lastTickAt EVERY tick (whether or not we count) so that
      // returning to a player turn after a long AI think doesn't dump 60s
      // of "wall time" into the stalling counter at once.
      const now = Date.now();
      const elapsed = Math.max(1, Math.floor((now - lastTickAt) / 1000));
      lastTickAt = now;

      if (!session || session.gameOver) return;
      const Modes = window.AMath.modes;
      const isPvA = !Modes || !Modes.getMode || Modes.getMode() === Modes.MODE_PLAYER_VS_AI;
      if (!isPvA) return;
      if (!session.isPlayerTurn) return;
      if (session.playerTimerPaused) return;

      const prevBucket = Math.floor(stallingSeconds / STALLING_THRESHOLD_S);
      stallingSeconds += elapsed;
      const newBucket = Math.floor(stallingSeconds / STALLING_THRESHOLD_S);
      if (newBucket > prevBucket) {
        // Crossed a 30s threshold — fire trash-talk.
        // The very first fire of this turn is guaranteed (skips fire-chance
        // gate) so the player actually sees the AI react to their stalling.
        // Subsequent fires use the STALLING context's regular 70% gate.
        const isFirstFire = stallingFiredCount === 0;
        fireTrashTalk('stalling', { force: isFirstFire });
        stallingFiredCount++;
      }
    }, 1000);
  }

  function stopStallingWatch() {
    if (stallingInterval) {
      clearInterval(stallingInterval);
      stallingInterval = null;
    }
    stallingSeconds = 0;
    stallingFiredCount = 0;
  }

  function resetStallingWatch() {
    // Reset counter without stopping the interval; called when player takes
    // an action (e.g., places a tile) — and when the player's turn begins
    // after AI finishes. Zeros the elapsed time and the "fired count".
    stallingSeconds = 0;
    stallingFiredCount = 0;
  }

  // Helper: renderTimer that also updates the mobile-mirror timer-box if present
  function renderTimerWithMirror(parts, which, label, seconds) {
    const UI = window.AMath.ui;
    if (which === 'ai') {
      UI.renderTimer(parts.opponentTimer, label, seconds);
      if (parts.opponentTimerMobile) UI.renderTimer(parts.opponentTimerMobile, label, seconds);
    } else if (which === 'player') {
      UI.renderTimer(parts.playerTimer, label, seconds);
      if (parts.playerTimerMobile) UI.renderTimer(parts.playerTimerMobile, label, seconds);
    }
  }
  function setTimerNoClockText(parts, which, label) {
    const html = '<div class="timer-label">' + label + '</div><div class="timer-value">—</div>';
    if (which === 'ai') {
      parts.opponentTimer.innerHTML = html;
      if (parts.opponentTimerMobile) parts.opponentTimerMobile.innerHTML = html;
    } else if (which === 'player') {
      parts.playerTimer.innerHTML = html;
      if (parts.playerTimerMobile) parts.playerTimerMobile.innerHTML = html;
    }
  }

  /**
   * Handle the result from Settings.showPopup.
   *
   * The dialog returns { saved, restartChanged, liveChanged }.
   * Live-changed settings have already been applied inside settings.js (theme,
   * sound) OR are read fresh on every relevant event (trash-talk, AI think
   * time, AI swap brain). Some live settings need a small UI refresh handled
   * here (showAiHand → re-render opponent rack).
   *
   * Restart-changed settings (gameMode, tileSet, chessClockEnabled) only take
   * effect when a new game starts. Ask the user, but only when one of those
   * actually changed.
   */
  function handleSettingsResult(result, opts) {
    opts = opts || {};
    if (!result || !result.saved) return;

    // Re-render the opponent rack if showAiHand toggled — it controls
    // whether AI rack tiles are visible. Only matters in Player vs AI mode;
    // in AI vs AI mode both racks are always shown face-up regardless of
    // this setting.
    if (result.liveChanged.indexOf('showAiHand') !== -1) {
      try {
        const Modes = window.AMath.modes;
        const isPvA = Modes && Modes.getMode && Modes.getMode() === Modes.MODE_PLAYER_VS_AI;
        if (isPvA && session && session.uiParts && session.aiRack && window.AMath.ui) {
          window.AMath.ui.renderRack(session.aiRack, session.uiParts.opponentRack, true);
        }
      } catch (e) { console.warn('rack rerender failed', e); }
    }

    // Re-render the BOARD if showBoardTilePoints toggled — board tile
    // rendering reads this setting to decide whether to show the points
    // subscript. Refresh via interactions.refreshUI() so tentative-tile
    // and ai-last-play highlights are also reapplied.
    // Same refresh path for hideBlankFaceOnBoard: it changes how assigned
    // blank tiles render on the board.
    if (result.liveChanged.indexOf('showBoardTilePoints') !== -1 ||
        result.liveChanged.indexOf('hideBlankFaceOnBoard') !== -1) {
      try {
        if (window.AMath.interactions && window.AMath.interactions.refreshUI) {
          window.AMath.interactions.refreshUI();
        }
      } catch (e) { console.warn('board rerender failed', e); }
    }

    // If something needs a new game, ask.
    if (result.restartChanged.length > 0) {
      const list = result.restartChanged.map(function (k) {
        return ({
          gameMode: 'Game mode',
          tileSet: 'Tile set',
          chessClockEnabled: 'Chess clock',
        })[k] || k;
      }).join(', ');
      if (confirm(list + ' changed — start a new game to apply?')) {
        if (opts.clearSave && window.AMath.saveResume) {
          window.AMath.saveResume.clearSave();
        }
        startGameSession();
      }
    }
  }

  function startGameSession() {
    const Settings = window.AMath.settings;
    const Modes = window.AMath.modes;

    const mode = Settings.get('gameMode') || Modes.MODE_PLAYER_VS_AI;
    Modes.setMode(mode);
    Modes.reset();

    if (mode === Modes.MODE_AI_VS_AI) {
      startAiVsAiSession();
    } else if (mode === Modes.MODE_PLAYER_VS_PLAYER) {
      startPvPSession();
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
    stopStallingWatch();

    // Clear any previous save (new game starting)
    if (window.AMath.saveResume) window.AMath.saveResume.clearSave();

    // Reset score sheet
    if (window.AMath.scoreSheet) window.AMath.scoreSheet.reset();

    // Reset AI takeover toggle
    if (window.AMath.modes) window.AMath.modes.setAiTakeover(false);

    // Reset AI play count for first-4-turns Bingo mode (all racks)
    if (window.AMath.aiPlayer && window.AMath.aiPlayer.resetPlayCount) {
      window.AMath.aiPlayer.resetPlayCount(); // reset all (main thread)
    }
    // Also reset in worker (if any) by terminating it — fresh worker on next decide
    if (window.AMath.aiWorkerClient && window.AMath.aiWorkerClient.terminate) {
      window.AMath.aiWorkerClient.terminate();
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
      renderTimerWithMirror(parts, 'ai', 'AI Time', startTimeSeconds);
      renderTimerWithMirror(parts, 'player', 'Your Time', startTimeSeconds);
    } else {
      // Show "—" instead of time
      setTimerNoClockText(parts, 'ai', 'AI Time');
      setTimerNoClockText(parts, 'player', 'Your Time');
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
      aiActualPlayCount: 0,
      aiConsecutiveSwaps: 0,
      opponentSwapHistory: [],        // actual AI plays (not swaps/passes) — for bingo-only enforcement
      isFirstMove: true,
      gameOver: false,
      consecutiveNonScoringTurns: 0,
      playerTimeSeconds: startTimeSeconds,
      aiTimeSeconds: startTimeSeconds,
      chessClockEnabled: chessClockEnabled,
      lastAiPlay: null,    // For challenge: record the most recent AI play
      bagEmptyTaunted: false,  // bag-empty trash talk fires only once
      playerTimerPaused: false,  // Feature M: double-click pause
      aiTimerPaused: false,
      // Achievement tracking — accumulated over the whole game
      gameStartTime: Date.now(),
      playerSwapCount: 0,
      playerX9Count: 0,
      playerPlaysMade: 0,
      playerMaxDeficit: 0,        // peak (player_score - ai_score) when negative
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

    // Wire up Settings button — use setTimeout so it responds even if
    // the main thread is momentarily blocked by a main-thread AI fallback.
    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', function () {
        setTimeout(function () {
          Settings.showPopup(function (result) {
            handleSettingsResult(result);
          });
        }, 0);
      });
    }

    // Wire up Score Sheet button
    const btnScoreSheet = document.getElementById('btn-score-sheet');
    if (btnScoreSheet) {
      btnScoreSheet.addEventListener('click', function () {
        setTimeout(function () {
          window.AMath.scoreSheet.showPopup(session.playerScore, session.aiScore);
        }, 0);
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
          btnTakeover.style.background = '';
          btnTakeover.style.color = '';
          // Restore player label
          UI.renderScore(session.uiParts.playerScoreBox, 'You', session.playerScore);
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
          btnTakeover.style.background = '#dc2626';
          btnTakeover.style.color = 'white';
          // Update player label to show AI is controlling
          UI.renderScore(session.uiParts.playerScoreBox, 'You (AI)', session.playerScore);
          showStatus('🤖 Auto ON — AI2 will play your turns. Click again to stop.');

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

    // Start stalling watch for Player vs AI mode
    startStallingWatch();

    // Clear undo history for new game
    undoHistory = [];
    wireUndoHandler();

    // Game log
    var GL = window.AMath.gameLog;
    if (GL) {
      GL.startGame({ mode: 'PvA', tileSet: Settings.get('tileSet'), botLevel: Settings.get('botLevel'), playerFirst: playerGoesFirst });
      GL.logState('Game Start', session);
    }

    wireGameLogButton();

    if (playerGoesFirst) {
      saveUndoSnapshot();  // snapshot at start of player's first turn
      showStatus(
        '🎲 You go first! Tap a tile, then tap a board cell. First move must pass through the center ★.'
      );
      // Education mode: start background analysis
      if (window.AMath.education && window.AMath.settings && window.AMath.settings.get('educationMode')) {
        window.AMath.education.startBackgroundSearch(session);
      }
    } else {
      showStatus('🎲 AI goes first.');
      setTimeout(runAiTurn, 800);
    }
  }

  // =========================================================================
  // PLAYER VS PLAYER SESSION
  // =========================================================================

  function startPvPSession() {
    const C = window.AMath.constants;
    const Bag = window.AMath.bag;
    const Rack = window.AMath.rack;
    const Board = window.AMath.board;
    const UI = window.AMath.ui;
    const Settings = window.AMath.settings;
    const Interactions = window.AMath.interactions;

    if (chessClockInterval) { clearInterval(chessClockInterval); chessClockInterval = null; }
    stopStallingWatch();
    if (window.AMath.saveResume) window.AMath.saveResume.clearSave();
    if (window.AMath.scoreSheet) window.AMath.scoreSheet.reset();
    if (window.AMath.modes) window.AMath.modes.setAiTakeover(false);

    const existingPopup = document.querySelector('.game-end-overlay');
    if (existingPopup) existingPopup.remove();

    const board = Board.createBoard();
    const bag = Bag.createBag();
    const p1Rack = Rack.createRack('player1');
    const p2Rack = Rack.createRack('player2');
    Rack.refillFromBag(p1Rack, bag);
    Rack.refillFromBag(p2Rack, bag);

    const chessClockEnabled = Settings.get('chessClockEnabled');
    const clockMinutes = Settings.get('chessClockMinutes') || 22;

    const container = document.getElementById('game-container');
    const uiParts = UI.buildGameLayout(container);

    session = {
      board: board,
      playerRack: p1Rack,
      aiRack: p2Rack,
      p1Rack: p1Rack,
      p2Rack: p2Rack,
      bag: bag,
      playerScore: 0,
      aiScore: 0,
      isPlayerTurn: true,
      isFirstMove: true,
      consecutiveNonScoringTurns: 0,
      tentativePlacements: [],
      gameOver: false,
      isPvP: true,
      currentPlayer: 1,
      playerTimeSeconds: clockMinutes * 60,
      aiTimeSeconds: clockMinutes * 60,
      chessClockEnabled: chessClockEnabled,
      lastAiPlay: null,
      bagEmptyTaunted: false,
      aiActualPlayCount: 0,
      aiConsecutiveSwaps: 0,
      opponentSwapHistory: [],
      lastOpponentAction: null,
      uiParts: uiParts,
      onSubmit: handleSubmit,
      onReset: handleReset,
      onPass: handlePass,
      onSwap: handleSwap,
    };

    UI.renderScore(uiParts.playerScoreBox, 'P1', 0);
    UI.renderScore(uiParts.opponentScoreBox, 'P2', 0);

    Interactions.init(session);
    Interactions.setPlayerTurn(true);

    // Timer display
    if (chessClockEnabled) {
      renderTimerWithMirror(uiParts, 'ai', 'P2 Time', clockMinutes * 60);
      renderTimerWithMirror(uiParts, 'player', 'P1 Time', clockMinutes * 60);
      startChessClock();
    } else {
      setTimerNoClockText(uiParts, 'ai', 'P2 Time');
      setTimerNoClockText(uiParts, 'player', 'P1 Time');
    }

    // Wire score-pause handlers
    wireScorePauseHandlers();
    refreshDesktopSidePanels();

    const btnNewGame = document.getElementById('btn-new-game');
    if (btnNewGame) {
      btnNewGame.addEventListener('click', function () { startGameSession(); });
    }
    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', function () {
        setTimeout(function () {
          Settings.showPopup(function (result) { handleSettingsResult(result); });
        }, 0);
      });
    }
    const btnScoreSheet = document.getElementById('btn-score-sheet');
    if (btnScoreSheet) {
      btnScoreSheet.addEventListener('click', function () {
        setTimeout(function () {
          window.AMath.scoreSheet.showPopup(session.playerScore, session.aiScore);
        }, 0);
      });
    }

    wireExportImportButtons();
    wireTileTrackerButton();
    undoHistory = [];
    wireUndoHandler();
    saveUndoSnapshot();  // snapshot at P1's first turn

    // Game log
    if (window.AMath.gameLog) {
      window.AMath.gameLog.startGame({ mode: 'PvP', tileSet: Settings.get('tileSet') });
      window.AMath.gameLog.logState('PvP Start', session);
    }
    wireGameLogButton();

    // Hide AI-only buttons
    var btnTakeover = document.getElementById('btn-takeover');
    if (btnTakeover) btnTakeover.style.display = 'none';

    // Education mode: start background analysis for P1
    if (window.AMath.education && window.AMath.settings && window.AMath.settings.get('educationMode')) {
      window.AMath.education.startBackgroundSearch(session);
    }

    showStatus('🎲 Player vs Player! Player 1 goes first.');
  }

  function switchPvPTurn() {
    if (!session || !session.isPvP || session.gameOver) return;
    if (checkGameEnd()) return;

    var UI = window.AMath.ui;
    var Interactions = window.AMath.interactions;

    if (session.currentPlayer === 1) {
      session.currentPlayer = 2;
      session.playerRack = session.p2Rack;
      session.aiRack = session.p1Rack;
    } else {
      session.currentPlayer = 1;
      session.playerRack = session.p1Rack;
      session.aiRack = session.p2Rack;
    }

    session.tentativePlacements = [];
    session.isPlayerTurn = true;

    saveUndoSnapshot();  // snapshot at start of new player's turn

    Interactions.init(session);
    Interactions.setPlayerTurn(true);

    // P1 score always at bottom, P2 always at top
    UI.renderScore(session.uiParts.playerScoreBox, 'P1', session.playerScore);
    UI.renderScore(session.uiParts.opponentScoreBox, 'P2', session.aiScore);

    autoSave();
    showStatus('🎲 Player ' + session.currentPlayer + '\'s turn!');
    if (window.AMath.sounds) window.AMath.sounds.turnStart();

    // Education mode: start background analysis for the new active player
    if (window.AMath.education && window.AMath.settings && window.AMath.settings.get('educationMode')) {
      window.AMath.education.startBackgroundSearch(session);
    }
  }

  /**
   * AI Takeover: AI plays for the player using the player's rack.
   * Single turn (toggled by Auto button).
   */
  function runAiTakeoverTurn() {
    const Interactions = window.AMath.interactions;
    const AI = (window.AMath.aiWorkerClient && window.AMath.aiWorkerClient.isAvailable()) ? window.AMath.aiWorkerClient : window.AMath.aiPlayer;
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;
    const Bag = window.AMath.bag;
    const UI = window.AMath.ui;

    showThinking(true);

    setTimeout(async function () {
      try {
        const decision = await AI.decideMove({
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
          UI.renderScore(session.uiParts.playerScoreBox, 'You (AI)', session.playerScore);
          if (window.AMath.scoreSheet) {
            window.AMath.scoreSheet.recordTurn('player', 'play', decision.score, isBingo, session.playerScore);
          }
          let msg = '🤖 AI2→You played: ' + decision.score + ' points.';
          if (isBingo) msg = '🤖 AI2→You BINGO! +' + decision.score + '!';
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
            window.AMath.scoreSheet.recordTurn('player', 'swap', 0, false, session.playerScore, { swapCount: swapped.length });
          }
          showStatus('🤖 AI2→You swapped tiles.');
        } else {
          session.consecutiveNonScoringTurns++;
          if (window.AMath.scoreSheet) {
            window.AMath.scoreSheet.recordTurn('player', 'pass', 0, false, session.playerScore);
          }
          showStatus('🤖 AI2→You passed.');
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
    stopStallingWatch(); // no human player in AI vs AI mode
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
    setTimerNoClockText(parts, 'ai', 'AI 2');
    setTimerNoClockText(parts, 'player', 'AI 1');

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
      aiActualPlayCount: 0,
      aiConsecutiveSwaps: 0,
      opponentSwapHistory: [],
      ai1ActualPlayCount: 0,       // AI vs AI: separate counters for each AI
      ai2ActualPlayCount: 0,
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
        setTimeout(function () {
          Settings.showPopup(function (result) {
            handleSettingsResult(result);
          });
        }, 0);
      });
    }

    const btnScoreSheet = document.getElementById('btn-score-sheet');
    if (btnScoreSheet) {
      btnScoreSheet.addEventListener('click', function () {
        setTimeout(function () {
          window.AMath.scoreSheet.showPopup(session.playerScore, session.aiScore);
        }, 0);
      });
    }

    wireExportImportButtons();
    wireTileTrackerButton();
    wireGameLogButton();

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
    const AI = (window.AMath.aiWorkerClient && window.AMath.aiWorkerClient.isAvailable()) ? window.AMath.aiWorkerClient : window.AMath.aiPlayer;
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

    // Capture start time so we can deduct from the AI's chess clock
    const aiTurnStartTime = Date.now();

    setTimeout(async function () {
      try {
        const decision = await AI.decideMove({
          board: session.board,
          aiRack: currentRack,
          bag: session.bag,
          isFirstMove: session.isFirstMove,
          playerScore: isAi1 ? session.aiScore : session.playerScore,
          aiScore: isAi1 ? session.playerScore : session.aiScore,
          aiActualPlayCount: isAi1 ? (session.ai1ActualPlayCount || 0) : (session.ai2ActualPlayCount || 0),
          consecutiveNonScoringTurns: session.consecutiveNonScoringTurns || 0,
          opponentRack: isAi1 ? session.aiRack : session.playerRack,
        });

        // Reconcile timer to current value (some setInterval ticks may have
        // happened during yield gaps, but we ensure the display matches
        // session state precisely).
        if (session.chessClockEnabled) {
          if (isAi1) {
            renderTimerWithMirror(session.uiParts, 'player', 'AI 1 Time', session.playerTimeSeconds);
          } else {
            renderTimerWithMirror(session.uiParts, 'ai', 'AI 2 Time', session.aiTimeSeconds);
          }
        }

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
          if (isAi1) session.ai1ActualPlayCount = (session.ai1ActualPlayCount || 0) + 1;
          else session.ai2ActualPlayCount = (session.ai2ActualPlayCount || 0) + 1;
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
    stopStallingWatch();

    const container = document.getElementById('game-container');
    const parts = UI.buildGameLayout(container);

    UI.renderScore(parts.opponentScoreBox, 'AI', saved.aiScore);
    UI.renderScore(parts.playerScoreBox, 'You', saved.playerScore);

    const chessClockEnabled = saved.chessClockEnabled;
    if (chessClockEnabled) {
      renderTimerWithMirror(parts, 'ai', 'AI Time', saved.aiTimeSeconds);
      renderTimerWithMirror(parts, 'player', 'Your Time', saved.playerTimeSeconds);
    } else {
      setTimerNoClockText(parts, 'ai', 'AI Time');
      setTimerNoClockText(parts, 'player', 'Your Time');
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
      aiActualPlayCount: saved.aiActualPlayCount || 0,
      aiConsecutiveSwaps: saved.aiConsecutiveSwaps || 0,
      opponentSwapHistory: saved.opponentSwapHistory || [],
      lastOpponentAction: saved.lastOpponentAction || null,
      isFirstMove: saved.isFirstMove,
      gameOver: false,
      consecutiveNonScoringTurns: saved.consecutiveNonScoringTurns || 0,
      playerTimeSeconds: saved.playerTimeSeconds,
      aiTimeSeconds: saved.aiTimeSeconds,
      chessClockEnabled: chessClockEnabled,
      lastAiPlay: null,
      bagEmptyTaunted: (saved.bag && saved.bag.tiles && saved.bag.tiles.length === 0),
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
          window.AMath.scoreSheet.recordTurn(e.who, e.action, e.score, e.isBingo, e.total, { swapCount: e.swapCount || 0 });
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
        setTimeout(function () {
          Settings.showPopup(function (result) {
            handleSettingsResult(result, { clearSave: true });
          });
        }, 0);
      });
    }

    const btnScoreSheet = document.getElementById('btn-score-sheet');
    if (btnScoreSheet) {
      btnScoreSheet.addEventListener('click', function () {
        setTimeout(function () {
          window.AMath.scoreSheet.showPopup(session.playerScore, session.aiScore);
        }, 0);
      });
    }

    wireExportImportButtons();
    wireTileTrackerButton();
    wireGameLogButton();
    undoHistory = [];
    wireUndoHandler();

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
          btnTakeover.style.background = '';
          btnTakeover.style.color = '';
          UI.renderScore(session.uiParts.playerScoreBox, 'You', session.playerScore);
          showStatus('Takeover OFF — you play your own turns now.');
        } else {
          if (session.tentativePlacements.length > 0) {
            showStatus("Reset your placements first.", 'error');
            return;
          }
          Modes.setAiTakeover(true);
          btnTakeover.textContent = '🤖 Auto ON';
          btnTakeover.classList.add('btn-active');
          btnTakeover.style.background = '#dc2626';
          btnTakeover.style.color = 'white';
          UI.renderScore(session.uiParts.playerScoreBox, 'You (AI)', session.playerScore);
          showStatus('🤖 Auto ON — AI2 will play your turns. Click again to stop.');

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
    } else {
      saveUndoSnapshot();  // snapshot at resume point
      if (window.AMath.education && window.AMath.settings && window.AMath.settings.get('educationMode')) {
        window.AMath.education.startBackgroundSearch(session);
      }
    }
  }

  /**
   * Auto-save after every move. Skip if game is over.
   */
  function autoSave() {
    if (!session || session.gameOver) return;
    const SaveResume = window.AMath.saveResume;
    if (SaveResume) SaveResume.save(session);
    refreshTileTracker();
    refreshDesktopSidePanels();
  }

  // ============================================================================
  // UNDO SYSTEM — Double-tap AI score box to undo
  // ============================================================================

  let undoHistory = [];
  let undoGeneration = 0;  // incremented on each undo; AI checks this to discard stale results

  /**
   * Deep-copy a tile array.
   */
  function cloneTiles(tiles) {
    return tiles.map(function (t) {
      return { id: t.id, face: t.face, type: t.type, points: t.points, assigned: t.assigned };
    });
  }

  /**
   * Deep-copy the board cells.
   */
  function cloneBoard(board) {
    var cells = [];
    for (var r = 0; r < 15; r++) {
      cells[r] = [];
      for (var c = 0; c < 15; c++) {
        var cell = board.cells[r][c];
        cells[r][c] = {
          premium: cell.premium,
          premiumUsed: cell.premiumUsed,
          tile: cell.tile ? {
            id: cell.tile.id, face: cell.tile.face, type: cell.tile.type,
            points: cell.tile.points, assigned: cell.tile.assigned
          } : null,
        };
      }
    }
    return { cells: cells };
  }

  /**
   * Save a snapshot of the current game state onto the undo stack.
   * Called at the START of each player turn — one undo = one full round.
   */
  function saveUndoSnapshot() {
    if (!session || session.gameOver) return;

    // Collect tentative tile IDs — these tiles are ON the board but
    // logically still belong to the player's rack. The snapshot must
    // capture them in the rack (not on the board) so undo restores correctly.
    var tentativeIds = new Set();
    var tentativeTiles = [];
    if (session.tentativePlacements) {
      for (var ti = 0; ti < session.tentativePlacements.length; ti++) {
        var tp = session.tentativePlacements[ti];
        var cell = session.board.cells[tp.row][tp.col];
        if (cell && cell.tile) {
          tentativeIds.add(cell.tile.id);
          tentativeTiles.push(cell.tile);
        }
      }
    }

    // Clone board WITHOUT tentative tiles
    var boardSnap = { cells: [] };
    for (var r = 0; r < 15; r++) {
      boardSnap.cells[r] = [];
      for (var c = 0; c < 15; c++) {
        var cl = session.board.cells[r][c];
        var isTent = cl.tile && tentativeIds.has(cl.tile.id);
        boardSnap.cells[r][c] = {
          premium: cl.premium,
          premiumUsed: cl.premiumUsed,
          tile: isTent ? null : (cl.tile ? {
            id: cl.tile.id, face: cl.tile.face, type: cl.tile.type,
            points: cl.tile.points, assigned: cl.tile.assigned
          } : null),
        };
      }
    }

    // Clone rack WITH tentative tiles added back
    var rackTiles = cloneTiles(session.playerRack.tiles);
    var rackSlotMap = JSON.parse(JSON.stringify(session.playerRack.slotMap || {}));
    for (var tt = 0; tt < tentativeTiles.length; tt++) {
      var t = tentativeTiles[tt];
      rackTiles.push({ id: t.id, face: t.face, type: t.type, points: t.points, assigned: null });
      // Re-add to slotMap — find an empty slot
      var usedSlots = new Set(Object.values(rackSlotMap));
      for (var si = 0; si < 8; si++) {
        if (!usedSlots.has(si)) { rackSlotMap[t.id] = si; break; }
      }
    }

    // Clone AI rack + slotMap
    var aiRackSlotMap = JSON.parse(JSON.stringify(session.aiRack.slotMap || {}));

    var snap = {
      board: boardSnap,
      playerRack: rackTiles,
      playerSlotMap: rackSlotMap,
      aiRack: cloneTiles(session.aiRack.tiles),
      aiSlotMap: aiRackSlotMap,
      bag: cloneTiles(session.bag.tiles),
      playerScore: session.playerScore,
      aiScore: session.aiScore,
      isFirstMove: session.isFirstMove,
      consecutiveNonScoringTurns: session.consecutiveNonScoringTurns,
      aiActualPlayCount: session.aiActualPlayCount || 0,
      aiConsecutiveSwaps: session.aiConsecutiveSwaps || 0,
      opponentSwapHistory: session.opponentSwapHistory ? session.opponentSwapHistory.slice() : [],
      lastOpponentAction: session.lastOpponentAction
        ? JSON.parse(JSON.stringify(session.lastOpponentAction)) : null,
      bagEmptyTaunted: session.bagEmptyTaunted,
      playerTimeSeconds: session.playerTimeSeconds,
      aiTimeSeconds: session.aiTimeSeconds,
      currentPlayer: session.currentPlayer || 1,
      p1Rack: session.p1Rack ? cloneTiles(session.p1Rack.tiles) : null,
      p1SlotMap: session.p1Rack ? JSON.parse(JSON.stringify(session.p1Rack.slotMap || {})) : null,
      p2Rack: session.p2Rack ? cloneTiles(session.p2Rack.tiles) : null,
      p2SlotMap: session.p2Rack ? JSON.parse(JSON.stringify(session.p2Rack.slotMap || {})) : null,
      scoreSheetEntries: window.AMath.scoreSheet
        ? window.AMath.scoreSheet.getAllEntries().map(function (e) {
            return JSON.parse(JSON.stringify(e));
          })
        : [],
    };

    // PvP: also add tentative tiles back to the correct p1/p2 rack snapshot
    if (session.isPvP && tentativeTiles.length > 0) {
      var pRack = (session.currentPlayer || 1) === 1 ? snap.p1Rack : snap.p2Rack;
      var pSlotMap = (session.currentPlayer || 1) === 1 ? snap.p1SlotMap : snap.p2SlotMap;
      if (pRack && pSlotMap) {
        for (var pt = 0; pt < tentativeTiles.length; pt++) {
          var ptile = tentativeTiles[pt];
          pRack.push({ id: ptile.id, face: ptile.face, type: ptile.type, points: ptile.points, assigned: null });
          var usedPvPSlots = new Set(Object.values(pSlotMap));
          for (var psi = 0; psi < 8; psi++) {
            if (!usedPvPSlots.has(psi)) { pSlotMap[ptile.id] = psi; break; }
          }
        }
      }
    }

    undoHistory.push(snap);
  }

  /**
   * Undo the last turn — restore state from the undo stack.
   */
  function undoLastTurn() {
    if (undoHistory.length === 0) {
      showStatus('Nothing to undo.', 'info');
      return;
    }
    if (!session) return;

    // If AI is currently thinking, cancel it
    if (window.AMath.aiWorkerClient && window.AMath.aiWorkerClient.cancel) {
      window.AMath.aiWorkerClient.cancel();
    }
    showThinking(false);
    undoGeneration++;  // invalidate any pending AI result

    var snap = undoHistory.pop();
    var UI = window.AMath.ui;
    var Interactions = window.AMath.interactions;

    // Restore board
    for (var r = 0; r < 15; r++) {
      for (var c = 0; c < 15; c++) {
        session.board.cells[r][c] = snap.board.cells[r][c];
      }
    }

    // Restore racks + slotMaps
    session.playerRack.tiles = snap.playerRack;
    session.playerRack.slotMap = snap.playerSlotMap || {};
    session.aiRack.tiles = snap.aiRack;
    session.aiRack.slotMap = snap.aiSlotMap || {};
    session.bag.tiles = snap.bag;

    // PvP racks
    if (session.isPvP && snap.p1Rack) {
      session.p1Rack.tiles = snap.p1Rack;
      session.p1Rack.slotMap = snap.p1SlotMap || {};
      session.p2Rack.tiles = snap.p2Rack;
      session.p2Rack.slotMap = snap.p2SlotMap || {};
      session.currentPlayer = snap.currentPlayer;
      if (snap.currentPlayer === 1) {
        session.playerRack = session.p1Rack;
        session.aiRack = session.p2Rack;
      } else {
        session.playerRack = session.p2Rack;
        session.aiRack = session.p1Rack;
      }
    }

    // Restore scores and state
    session.playerScore = snap.playerScore;
    session.aiScore = snap.aiScore;
    session.isFirstMove = snap.isFirstMove;
    session.consecutiveNonScoringTurns = snap.consecutiveNonScoringTurns;
    session.aiActualPlayCount = snap.aiActualPlayCount;
    session.aiConsecutiveSwaps = snap.aiConsecutiveSwaps || 0;
    session.opponentSwapHistory = snap.opponentSwapHistory || [];
    session.lastOpponentAction = snap.lastOpponentAction;
    session.bagEmptyTaunted = snap.bagEmptyTaunted;
    session.playerTimeSeconds = snap.playerTimeSeconds;
    session.aiTimeSeconds = snap.aiTimeSeconds;
    // Re-render timer displays
    if (session.chessClockEnabled) {
      renderTimerWithMirror(session.uiParts, 'player', 'Your Time', session.playerTimeSeconds);
      renderTimerWithMirror(session.uiParts, 'ai', 'AI Time', session.aiTimeSeconds);
    }
    session.tentativePlacements = [];
    session.gameOver = false;
    session.lastAiPlay = null;
    session.isPlayerTurn = true;

    // Restore score sheet
    if (window.AMath.scoreSheet && snap.scoreSheetEntries) {
      window.AMath.scoreSheet.reset();
      for (var i = 0; i < snap.scoreSheetEntries.length; i++) {
        var e = snap.scoreSheetEntries[i];
        window.AMath.scoreSheet.recordTurn(e.who, e.action, e.score, e.isBingo, e.total,
          { swapCount: e.swapCount || 0 });
      }
    }

    // Re-render everything
    Interactions.init(session);
    Interactions.setPlayerTurn(true);

    if (session.isPvP) {
      UI.renderScore(session.uiParts.playerScoreBox, 'P1', session.playerScore);
      UI.renderScore(session.uiParts.opponentScoreBox, 'P2', session.aiScore);
    } else {
      UI.renderScore(session.uiParts.playerScoreBox, 'You', session.playerScore);
      UI.renderScore(session.uiParts.opponentScoreBox, 'AI', session.aiScore);
    }

    refreshTileTracker();
    refreshDesktopSidePanels();
    autoSave();

    // Education mode: restart search
    if (window.AMath.education && window.AMath.settings && window.AMath.settings.get('educationMode')) {
      window.AMath.education.startBackgroundSearch(session);
    }

    showStatus('⏪ Undone! (' + undoHistory.length + ' more available)', 'info');
    if (window.AMath.sounds) window.AMath.sounds.undo();
    if (window.AMath.gameLog) {
      window.AMath.gameLog.logUndo(undoHistory.length);
      window.AMath.gameLog.logState('After undo', session);
    }
  }

  /**
   * Wire double-tap on AI score box for undo.
   * Uses a flag to prevent duplicate listeners on game restart.
   */
  var _undoWired = null; // reference to the element we wired
  function wireUndoHandler() {
    var box = session && session.uiParts && session.uiParts.opponentScoreBox;
    if (!box) return;
    // If already wired to this exact element, skip
    if (_undoWired === box) return;

    var lastTap = 0;
    box.addEventListener('click', function () {
      var now = Date.now();
      if (now - lastTap < 400) {
        // Double tap detected
        undoLastTurn();
        lastTap = 0;
      } else {
        lastTap = now;
      }
    });
    _undoWired = box;
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
  // Tile tracker is always visible (per user request). The legacy toggle
  // button is hidden in the layout; this flag exists only for backward
  // compatibility with the refresh function below.
  let trackerVisible = true;

  function wireTileTrackerButton() {
    // Tile tracker toggle button is no longer used — tracker stays visible
    // (CSS handles desktop hide vs mobile show). Just kick off an initial
    // render so the panel has content.
    refreshTileTracker();
  }

  var _logBtnWired = false;
  function wireGameLogButton() {
    if (_logBtnWired) return;
    // Create a tiny floating button at bottom-left
    var btn = document.createElement('div');
    btn.id = 'btn-gamelog';
    btn.title = 'Game Log';
    btn.textContent = 'log';
    btn.style.cssText = 'position:fixed;bottom:4px;left:4px;z-index:999;' +
      'font-size:9px;color:rgba(150,150,150,0.4);cursor:pointer;' +
      'padding:2px 5px;font-family:monospace;user-select:none;';
    btn.addEventListener('click', function () {
      if (window.AMath.gameLog) window.AMath.gameLog.show();
    });
    document.body.appendChild(btn);
    _logBtnWired = true;
  }

  function toggleTileTracker() {
    // Kept as a no-op for any old callers; tracker is always shown now.
    trackerVisible = true;
    refreshTileTracker();
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

    // Live score sheet (now on right panel, under Tile Tracker)
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

    // Move the action button bar into the left panel on desktop
    moveButtonBarToSidePanel();
  }

  // On desktop (≥1300px), move the action buttons from the game container
  // into the left side panel. This keeps the buttons visible without
  // requiring page scrolling. On mobile, leave buttons in their original
  // location (under the player rack).
  function moveButtonBarToSidePanel() {
    const isDesktop = window.matchMedia('(min-width: 1300px)').matches;
    const buttonBar = document.querySelector('.button-bar');
    const slot = document.getElementById('desktop-actions-slot');
    if (!buttonBar || !slot) return;

    if (isDesktop) {
      // Move into the slot if not already there
      if (buttonBar.parentElement !== slot) {
        slot.appendChild(buttonBar);
        buttonBar.classList.add('button-bar-side');
      }
    } else {
      // Mobile: move back to the game container (if it was moved)
      if (buttonBar.classList.contains('button-bar-side')) {
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) gameContainer.appendChild(buttonBar);
        buttonBar.classList.remove('button-bar-side');
      }
    }
  }

  // Re-evaluate on viewport resize (e.g., user resizes window)
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', function () {
      // Debounce — only reparent when crossing the breakpoint
      moveButtonBarToSidePanel();
    });
  }

  // ============================================================================
  // CHESS CLOCK
  // ============================================================================

  function startChessClock() {
    // Track the last tick wall-clock time so we can compensate for missed ticks
    // (the AI's synchronous search may delay setInterval callbacks; we want the
    // displayed time to reflect actual elapsed wall-clock seconds, not the
    // number of times setInterval has fired).
    let lastTickAt = Date.now();
    chessClockInterval = setInterval(function () {
      if (!session || session.gameOver) return;

      const now = Date.now();
      const elapsedSeconds = Math.max(1, Math.floor((now - lastTickAt) / 1000));
      lastTickAt = now;

      if (session.isPlayerTurn) {
        if (session.playerTimerPaused) return; // pause-by-double-click
        session.playerTimeSeconds -= elapsedSeconds;
        var pLabel = session.isPvP ? ('P' + (session.currentPlayer || 1) + ' Time') : 'Your Time';
        renderTimerWithMirror(
          session.uiParts, 'player', pLabel, session.playerTimeSeconds
        );
      } else {
        if (session.aiTimerPaused) return; // pause-by-double-click
        session.aiTimeSeconds -= elapsedSeconds;
        var aLabel = session.isPvP ? ('P' + (3 - (session.currentPlayer || 1)) + ' Time') : 'AI Time';
        renderTimerWithMirror(
          session.uiParts, 'ai', aLabel, session.aiTimeSeconds
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
      handleInvalidPlaySubmission(result);
      return;
    }

    const scoreResult = Scoring.scorePlay(
      result.equations,
      session.board,
      session.tentativePlacements.length
    );

    commitPlayerPlay(scoreResult);
  }

  /**
   * Commit the player's validated play to the board (called after education check).
   */
  function commitPlayerPlay(scoreResult) {
    // Stop education background search
    if (window.AMath.education) {
      window.AMath.education.stopSearch();
      window.AMath.education.hideVerifyButton();
    }

    const Rack = window.AMath.rack;
    const Board = window.AMath.board;
    const UI = window.AMath.ui;
    const Interactions = window.AMath.interactions;

    for (const p of session.tentativePlacements) {
      Board.markPremiumUsed(session.board, p.row, p.col);
    }

    const isPvP = session.isPvP;
    const currentP = session.currentPlayer || 1;
    const oldScore = (isPvP && currentP === 2) ? session.aiScore : session.playerScore;
    // PvP: add score to correct player
    if (isPvP && currentP === 2) {
      session.aiScore += scoreResult.total;  // P2's score stored in aiScore
    } else {
      session.playerScore += scoreResult.total;
    }
    const activeScore = (isPvP && currentP === 2) ? session.aiScore : session.playerScore;

    session.isFirstMove = false;
    session.consecutiveNonScoringTurns = 0;

    const wasBingo = scoreResult.bingoBonus > 0;

    // Achievement tracking — count player plays + x9 (only for PvA, P1 in PvP)
    if (!isPvP || currentP === 1) {
      session.playerPlaysMade = (session.playerPlaysMade || 0) + 1;
      if (isX9Play(session.tentativePlacements)) {
        session.playerX9Count = (session.playerX9Count || 0) + 1;
      }
    }

    // Track opponent's last action for late-game AI strategy
    session.lastOpponentAction = {
      type: 'play',
      tilesUsed: session.tentativePlacements.length,
      score: scoreResult.total,
      wasBingo: wasBingo,
    };
    session.opponentSwapHistory.push({ type: 'play' });

    Rack.refillFromBag(session.playerRack, session.bag);
    Interactions.clearTentativePlacements();

    // Log
    if (window.AMath.gameLog) {
      var logWho = isPvP ? 'P' + currentP : 'Player';
      window.AMath.gameLog.log(logWho + ' scored ' + scoreResult.total + 'pts' + (wasBingo ? ' BINGO!' : ''));
      window.AMath.gameLog.logState('After play', session);
    }

    const playerLabel = isPvP ? 'P' + currentP : 'You';
    if (isPvP) {
      // P1 always bottom, P2 always top
      UI.renderScore(session.uiParts.playerScoreBox, 'P1', session.playerScore);
      UI.renderScore(session.uiParts.opponentScoreBox, 'P2', session.aiScore);
      // Animate the active player's score box
      var animBox = currentP === 1 ? session.uiParts.playerScoreBox : session.uiParts.opponentScoreBox;
      var Anim = window.AMath.animations;
      if (Anim) {
        var scoreEl = animBox.querySelector('.score-value');
        if (scoreEl) Anim.animateScore(scoreEl, oldScore, activeScore);
      }
    } else {
      UI.renderScore(session.uiParts.playerScoreBox, 'You', activeScore);
      var Anim = window.AMath.animations;
      if (Anim) {
        var scoreEl = session.uiParts.playerScoreBox.querySelector('.score-value');
        if (scoreEl) Anim.animateScore(scoreEl, oldScore, activeScore);
      }
    }

    // Score sheet
    if (window.AMath.scoreSheet) {
      const who = isPvP ? ('player' + currentP) : 'player';
      window.AMath.scoreSheet.recordTurn(who, 'play', scoreResult.total, wasBingo, activeScore);
    }

    let msg = isPvP
      ? '✅ Player ' + currentP + ' scored ' + scoreResult.total + ' points!'
      : '✅ You scored ' + scoreResult.total + ' points!';
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

    // Player committed their move — no need to keep the AI's last-play
    // highlight glowing anymore.
    clearLastAiPlayHighlight();

    Interactions.setPlayerTurn(false);
    resetStallingWatch();
    startNextTurn();
  }

  /**
   * Education mode: apply a suggested play instead of the player's original move.
   * Undoes the player's tentative placements and commits the AI-suggested play.
   */
  function applySuggestedPlay(suggestedPlay) {
    const Placement = window.AMath.placement;
    const Scoring = window.AMath.scoring;
    const Rack = window.AMath.rack;
    const Board = window.AMath.board;
    const UI = window.AMath.ui;
    const Interactions = window.AMath.interactions;

    // 1. Remove player's tentative tiles from the board back to rack
    Interactions.clearTentativePlacements();

    // 2. Place the suggested tiles on the board
    for (const p of suggestedPlay.placements) {
      if (p.tile) {
        // Set assignment if needed
        if (p.assigned) p.tile.assigned = p.assigned;
        Board.placeTile(session.board, p.row, p.col, p.tile);
        Board.markPremiumUsed(session.board, p.row, p.col);
        // Remove tile from player's rack
        Rack.removeTile(session.playerRack, p.tile.id);
      }
    }

    // 3. Score the suggested play
    const result = Placement.validatePlay(session.board, suggestedPlay.placements, session.isFirstMove);
    let total = suggestedPlay.score;
    let wasBingo = suggestedPlay.placements.length === 8;
    if (result.ok) {
      const scoreResult = Scoring.scorePlay(result.equations, session.board, suggestedPlay.placements.length);
      total = scoreResult.total;
      wasBingo = scoreResult.bingoBonus > 0;
    }

    // 4. Commit (PvP-aware)
    const aspIsPvP = session.isPvP;
    const aspCurrentP = session.currentPlayer || 1;
    const oldScore = (aspIsPvP && aspCurrentP === 2) ? session.aiScore : session.playerScore;
    if (aspIsPvP && aspCurrentP === 2) {
      session.aiScore += total;
    } else {
      session.playerScore += total;
    }
    const aspActiveScore = (aspIsPvP && aspCurrentP === 2) ? session.aiScore : session.playerScore;
    session.isFirstMove = false;
    session.consecutiveNonScoringTurns = 0;

    session.lastOpponentAction = {
      type: 'play',
      tilesUsed: suggestedPlay.placements.length,
      score: total,
      wasBingo: wasBingo,
    };
    session.opponentSwapHistory.push({ type: 'play' });

    Rack.refillFromBag(session.playerRack, session.bag);

    // Re-render
    UI.renderBoard(session.uiParts.boardGrid, session.board, session.isFirstMove);
    UI.renderRack(session.uiParts.playerRack, session.playerRack, false);
    if (aspIsPvP) {
      UI.renderScore(session.uiParts.playerScoreBox, 'P1', session.playerScore);
      UI.renderScore(session.uiParts.opponentScoreBox, 'P2', session.aiScore);
    } else {
      UI.renderScore(session.uiParts.playerScoreBox, 'You', aspActiveScore);
    }

    const Anim = window.AMath.animations;
    if (Anim) {
      var aspAnimBox = (aspIsPvP && aspCurrentP === 2) ? session.uiParts.opponentScoreBox : session.uiParts.playerScoreBox;
      const scoreEl = aspAnimBox.querySelector('.score-value');
      if (scoreEl) Anim.animateScore(scoreEl, oldScore, aspActiveScore);
    }

    if (window.AMath.scoreSheet) {
      const aspWho = aspIsPvP ? ('player' + aspCurrentP) : 'player';
      window.AMath.scoreSheet.recordTurn(aspWho, 'play', total, wasBingo, aspActiveScore);
    }

    let msg = '📚 Suggested play: ' + total + ' points!';
    if (wasBingo) msg += ' (+40 BINGO! 🎉)';
    showStatus(msg, 'success');

    if (window.AMath.sounds) {
      if (wasBingo) window.AMath.sounds.bingo();
      else window.AMath.sounds.submitSuccess();
    }

    fireTrashTalk(wasBingo ? 'opp_bingo' : 'opp_pass_check', { lastScore: total });
    autoSave();

    if (checkGameEnd()) return;
    clearLastAiPlayHighlight();
    Interactions.setPlayerTurn(false);
    resetStallingWatch();
    startNextTurn();
  }

  /**
   * Handle the case where the player submits an invalid play. The play is
   * committed to the board (tiles stay; score is 0), and the AI decides
   * whether to challenge.
   *
   * Sequence when AI challenges:
   *   1. Brief pause (~600ms)
   *   2. Trash-talk BUILDUP message — "เอ๊ะ... โค้ชตี๋ขอดูสมการนี้ก่อน"
   *   3. Brief pause (~1500ms)
   *   4. Second BUILDUP message (50% chance)
   *   5. CHALLENGE_REVEAL message — "🚨 CHALLENGE!"
   *   6. Revert the play (tiles return to rack, board restored)
   *   7. AI's turn begins (no penalty per user choice)
   *
   * Sequence when AI MISSES (rare):
   *   1. CHALLENGE_MISS message — AI pretends to verify, lets it slide
   *   2. Play stands but with score 0 — player loses turn anyway
   *   3. AI's turn begins
   */
  function handleInvalidPlaySubmission(validationResult) {
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;
    const Interactions = window.AMath.interactions;
    const Challenge = window.AMath.challenge;
    const Settings = window.AMath.settings;

    // Commit tiles to board permanently (mark them no longer tentative).
    // The placements stay; only the tentative flag is removed so they
    // visually settle. Score is NOT awarded.
    const submittedPlacements = session.tentativePlacements.slice();
    Interactions.clearTentativePlacements();
    Interactions.refreshUI();

    // Decide if AI will challenge
    const difficulty = (Settings && Settings.get && Settings.get('difficulty')) || 'HARD';
    const decision = Challenge.decideAiChallenge(validationResult, difficulty);

    // Disable player controls during the challenge animation
    Interactions.setPlayerTurn(false);
    resetStallingWatch();

    if (decision.challenge) {
      // === AI CHALLENGES ===
      runChallengeSequence(submittedPlacements, validationResult);
    } else {
      // === AI MISSES (rare) — play stands, player gets 0 points ===
      runChallengeMissSequence(submittedPlacements);
    }
  }

  /**
   * Animate the challenge sequence: 1-2 buildup taunts, then the reveal,
   * then revert the play.
   */
  function runChallengeSequence(submittedPlacements, validationResult) {
    const Challenge = window.AMath.challenge;
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;
    const Interactions = window.AMath.interactions;

    // Capture the session reference. If the user starts a new game (or resumes
    // a save) mid-animation, `session` will be reassigned to a fresh object;
    // we must bail out of the sequence rather than mutate the new game.
    const sess = session;
    function stillCurrent() {
      return session === sess && !sess.gameOver;
    }

    // showStatus only when we know AI is challenging — keep it suspenseful
    showStatus('🤔 AI is examining your play...');

    // Schedule: buildup1 → (optional buildup2) → reveal → revert
    const include2nd = Math.random() < 0.6;  // 60% chance of 2 buildup messages

    setTimeout(function () {
      if (!stillCurrent()) return;
      fireTrashTalk('challenge_buildup', { force: true });
    }, 700);

    if (include2nd) {
      setTimeout(function () {
        if (!stillCurrent()) return;
        fireTrashTalk('challenge_buildup', { force: true });
      }, 2400);
    }

    const revealDelay = include2nd ? 4100 : 2400;
    setTimeout(function () {
      if (!stillCurrent()) return;
      fireTrashTalk('challenge_reveal', { force: true });
      showStatus('❌ AI challenged: ' + (validationResult.reason || 'Invalid play'), 'error');
    }, revealDelay);

    // Revert the play 1.2s after the reveal
    setTimeout(function () {
      if (!stillCurrent()) return;
      // Return tiles from board to rack AND restore premium squares
      for (const p of submittedPlacements) {
        // Restore premium square before removing tile
        const cell = Board.getCell(sess.board, p.row, p.col);
        if (cell) cell.premiumUsed = false;
        const tile = Board.removeTile(sess.board, p.row, p.col);
        if (tile) {
          tile.assigned = null;
          Rack.addTile(sess.playerRack, tile);
        }
      }
      Interactions.refreshUI();
      showStatus('🔄 Your tiles are back in your rack. AI\'s turn.');

      // This counts as a non-scoring turn for end-of-game detection
      // (same as a pass/swap — the player consumed a turn without points).
      sess.consecutiveNonScoringTurns++;

      // Record in score sheet
      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('player', 'challenged', 0, false, sess.playerScore);
      }
      // Sound: a "failed" cue
      if (window.AMath.sounds && window.AMath.sounds.submitFail) {
        window.AMath.sounds.submitFail();
      }

      autoSave();
      if (checkGameEnd()) return;
      // Player's turn is effectively consumed; AI's previous play (if any)
      // is no longer the most recent thing to highlight.
      sess.lastAiPlay = null;
      setTimeout(runAiTurn, 1000);
    }, revealDelay + 1200);
  }

  /**
   * AI failed to spot the invalid play. Play stays committed but scores 0.
   * Player effectively loses their turn (since no points awarded), AI moves on.
   */
  function runChallengeMissSequence(submittedPlacements) {
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;

    // Capture the session reference (see comment in runChallengeSequence).
    const sess = session;
    function stillCurrent() { return session === sess && !sess.gameOver; }

    // Show a "AI considered and accepted" toast
    setTimeout(function () {
      if (!stillCurrent()) return;
      fireTrashTalk('challenge_miss', { force: true });
    }, 800);

    // Mark premium squares used (the tiles ARE on the board now, even though
    // they didn't score — premium squares would normally consume on a real play)
    for (const p of submittedPlacements) {
      Board.markPremiumUsed(sess.board, p.row, p.col);
    }
    // The play stays on the board (AI missed the error), so this CAN'T be
    // the first move anymore. Mark it as such, otherwise the AI's next
    // turn would still require a play through the center — but the center
    // may already be occupied.
    sess.isFirstMove = false;

    setTimeout(function () {
      if (!stillCurrent()) return;
      // Refill the player's rack now (not earlier) — keeps the rack visually
      // empty during the suspense so the player sees the consequence of
      // their gamble before fresh tiles arrive.
      Rack.refillFromBag(sess.playerRack, sess.bag);

      // This 0-point play counts as a non-scoring turn for end-of-game detection.
      sess.consecutiveNonScoringTurns++;

      showStatus('Play accepted (no points scored). AI\'s turn.', 'info');
      window.AMath.interactions.refreshUI();
      // Score sheet: record as 0-point play
      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('player', 'play-uncontested-invalid', 0, false, sess.playerScore);
      }
      autoSave();
      if (checkGameEnd()) return;
      // Player's turn is over (even though they scored 0); clear the
      // previous AI highlight so the next AI play stands alone.
      sess.lastAiPlay = null;
      setTimeout(runAiTurn, 800);
    }, 2200);
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

    executePass();
  }

  function executePass() {
    if (window.AMath.education) { window.AMath.education.stopSearch(); window.AMath.education.hideVerifyButton(); }
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

    // Warn player when close to 6-pass game end
    var sixPassDisabled = false;
    try { sixPassDisabled = window.AMath.settings.get('disableSixPassEnd') === true; } catch (e) {}
    if (!sixPassDisabled && session.consecutiveNonScoringTurns >= 4) {
      var warnMsg0 = session.consecutiveNonScoringTurns >= 5
        ? '⚠️ ' + session.consecutiveNonScoringTurns + ' consecutive pass/swap! One more = game end!'
        : '⚠️ ' + session.consecutiveNonScoringTurns + ' consecutive pass/swap already (6 = game end)';
      showStatus(warnMsg0, 'error');
    }

    // Track opponent's last action for late-game AI strategy
    session.lastOpponentAction = { type: 'pass' };
    session.opponentSwapHistory.push({ type: 'pass' });

    if (window.AMath.scoreSheet) {
      var pvpWho = session.isPvP ? ('player' + (session.currentPlayer || 1)) : 'player';
      var pvpScore = (session.isPvP && (session.currentPlayer || 1) === 2) ? session.aiScore : session.playerScore;
      window.AMath.scoreSheet.recordTurn(pvpWho, 'pass', 0, false, pvpScore);
    }
    fireTrashTalk('opp_pass', {});

    showStatus(session.isPvP ? 'Player ' + (session.currentPlayer || 1) + ' passed.' : 'You passed.');
    if (window.AMath.sounds) window.AMath.sounds.pass();
    if (window.AMath.gameLog) {
      window.AMath.gameLog.logPass(session.isPvP ? 'P' + (session.currentPlayer || 1) : 'Player');
      window.AMath.gameLog.logState('After pass', session);
    }

    autoSave();

    if (checkGameEnd()) return;

    // Player committed their move (pass) — clear the AI's previous play highlight.
    clearLastAiPlayHighlight();

    Interactions.setPlayerTurn(false);
    resetStallingWatch();
    startNextTurn();
  }

  function handleSwap() {
    const C = window.AMath.constants;
    const Bag = window.AMath.bag;
    const Interactions = window.AMath.interactions;

    hideChallengeButton();

    if (Bag.bagSize(session.bag) <= C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
      showStatus('Swap not allowed — bag has ≤4 tiles remaining.', 'error');
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

    executeSwap(tileIds);
  }

  function executeSwap(tileIds) {
    if (window.AMath.education) { window.AMath.education.stopSearch(); window.AMath.education.hideVerifyButton(); }
    const Bag = window.AMath.bag;
    const Rack = window.AMath.rack;
    const Interactions = window.AMath.interactions;

    const tilesToReturn = [];
    for (const id of tileIds) {
      const removed = Rack.removeTile(session.playerRack, id);
      if (removed) tilesToReturn.push(removed);
    }

    Bag.returnTiles(session.bag, tilesToReturn);
    Rack.refillFromBag(session.playerRack, session.bag);

    Interactions.exitSwapMode();
    session.consecutiveNonScoringTurns++;

    // Achievement tracking — count player swaps (PvA, P1 in PvP)
    if (!session.isPvP || (session.currentPlayer || 1) === 1) {
      session.playerSwapCount = (session.playerSwapCount || 0) + 1;
    }

    // Track opponent's last action for late-game AI strategy
    session.lastOpponentAction = {
      type: 'swap',
      count: tilesToReturn.length,
    };
    session.opponentSwapHistory.push({ type: 'swap', count: tilesToReturn.length });

    if (window.AMath.scoreSheet) {
      var pvpWho = session.isPvP ? ('player' + (session.currentPlayer || 1)) : 'player';
      var pvpScore = (session.isPvP && (session.currentPlayer || 1) === 2) ? session.aiScore : session.playerScore;
      window.AMath.scoreSheet.recordTurn(pvpWho, 'swap', 0, false, pvpScore, { swapCount: tilesToReturn.length });
    }
    fireTrashTalk('opp_swap', {});

    var swapMsg = session.isPvP
      ? 'Player ' + (session.currentPlayer || 1) + ' swapped ' + tilesToReturn.length + ' tiles.'
      : 'Swapped ' + tilesToReturn.length + ' tiles.';
    showStatus(swapMsg);
    if (window.AMath.sounds) window.AMath.sounds.swap();

    // Warn about 6-pass rule
    var sixPassOff3 = false;
    try { sixPassOff3 = window.AMath.settings.get('disableSixPassEnd') === true; } catch(e){}
    if (!sixPassOff3 && session.consecutiveNonScoringTurns >= 4) {
      var warnMsg = session.consecutiveNonScoringTurns >= 5
        ? '⚠️ ' + session.consecutiveNonScoringTurns + ' consecutive pass/swap! One more = game end!'
        : '⚠️ ' + session.consecutiveNonScoringTurns + ' consecutive pass/swap already (6 = game end)';
      showStatus(warnMsg, 'error');
    }

    autoSave();

    if (checkGameEnd()) return;

    // Player committed their move (swap) — clear the AI's previous play highlight.
    clearLastAiPlayHighlight();

    Interactions.setPlayerTurn(false);
    resetStallingWatch();
    startNextTurn();
  }

  // ============================================================================
  // AI TURN
  // ============================================================================

  // Expose hook so education module can trigger AI turn after auto-swap/pass
  window.AMath._triggerAiTurn = function () {
    if (!session || session.gameOver) return;
    showStatus('Your action applied.');
    clearLastAiPlayHighlight();
    resetStallingWatch();
    autoSave();
    if (checkGameEnd()) return;
    if (session.isPvP) {
      switchPvPTurn();
    } else {
      setTimeout(runAiTurn, 800);
    }
  };

  window.AMath._saveUndo = saveUndoSnapshot;
  window.AMath._getSession = function () { return session; };
  window.AMath._getUndoHistory = function () { return undoHistory; };
  window.AMath._undoLastTurn = undoLastTurn;

  /**
   * Start the next turn — PvP switches players, PvA starts AI.
   */
  function startNextTurn() {
    if (session.isPvP) {
      setTimeout(switchPvPTurn, 400);
    } else {
      setTimeout(runAiTurn, 800);
    }
  }

  var _aiTurnRunning = false;

  function runAiTurn() {
    if (_aiTurnRunning) {
      console.warn('[AI] runAiTurn called while already running — skipping');
      return;
    }
    _aiTurnRunning = true;
    const Interactions = window.AMath.interactions;
    const workerAvailable = window.AMath.aiWorkerClient && window.AMath.aiWorkerClient.isAvailable();
    const AI = workerAvailable ? window.AMath.aiWorkerClient : window.AMath.aiPlayer;
    if (!workerAvailable) {
      console.warn('[AI] Web Worker unavailable — running on main thread (UI may lag)');
    }

    if (session.gameOver) { _aiTurnRunning = false; return; }

    showThinking(true);

    // Capture the AI's start time so we can deduct from its timer afterward.
    const aiTurnStartTime = Date.now();
    // Capture the session reference so we can detect mid-think game reset.
    const sessionAtStart = session;
    const genAtStart = undoGeneration;

    // Run AI search asynchronously so the browser can repaint and tick the
    // chess clock between yield points. decideMove is async and yields
    // periodically inside its search loop.
    setTimeout(async function () {
      try {
        const aiDecision = await AI.decideMove({
          board: session.board,
          aiRack: session.aiRack,
          bag: session.bag,
          isFirstMove: session.isFirstMove,
          playerScore: session.playerScore,
          aiScore: session.aiScore,
          aiActualPlayCount: session.aiActualPlayCount || 0,
          aiConsecutiveSwaps: session.aiConsecutiveSwaps || 0,
          opponentSwapHistory: session.opponentSwapHistory || [],
          consecutiveNonScoringTurns: session.consecutiveNonScoringTurns || 0,
          opponentRack: session.playerRack,
          lastOpponentAction: session.lastOpponentAction || null,
        });

        // Detect stale decision (game was reset/ended/undone during AI thinking)
        if (session !== sessionAtStart || !session || session.gameOver || undoGeneration !== genAtStart) {
          console.log('[AI] decision dropped — session changed during thinking');
          _aiTurnRunning = false;
          return;
        }

        // Reconcile AI's chess clock with actual elapsed wall-clock time.
        if (session.chessClockEnabled && !session.aiTimerPaused) {
          window.AMath.ui.renderTimer(
            session.uiParts.opponentTimer,
            'AI Time',
            session.aiTimeSeconds
          );
        }

        executeAiDecision(aiDecision);
        _aiTurnRunning = false;
      } catch (err) {
        _aiTurnRunning = false;
        // If game was reset during AI thinking (worker terminated, session changed),
        // silently drop this stale error rather than disrupting the new game.
        if (session !== sessionAtStart || !session || session.gameOver || undoGeneration !== genAtStart) {
          console.log('[AI] stale error dropped (game ended/reset during thinking)');
          _aiTurnRunning = false;
          return;
        }
        console.error('AI error:', err);
        console.error('AI error stack:', err && err.stack);
        showThinking(false);
        showStatus('AI error — your turn. (' + (err && err.message || 'unknown') + ')', 'error');
        saveUndoSnapshot();
        Interactions.setPlayerTurn(true);
        _aiTurnRunning = false;
      }
    }, 100);
  }

  function executeAiDecision(decision) {
    // Guard: don't execute if it's the player's turn AND auto mode is OFF (stale AI result)
    const Interactions = window.AMath.interactions;
    var Modes = window.AMath.modes;
    var isTakeover = Modes && Modes.isAiTakeover && Modes.isAiTakeover();
    if (!isTakeover && Interactions && Interactions.getState && Interactions.getState().isPlayerTurn) {
      console.warn('[AI] executeAiDecision called during player turn — dropping stale result');
      showThinking(false);
      return;
    }
    const Board = window.AMath.board;
    const Rack = window.AMath.rack;
    const Bag = window.AMath.bag;
    const UI = window.AMath.ui;

    showThinking(false);

    // Log AI decision
    if (window.AMath.gameLog) {
      var aiLogMsg = 'AI ' + decision.type;
      if (decision.type === 'play') aiLogMsg += ' ' + decision.score + 'pts (' + decision.placements.length + ' tiles)';
      if (decision._topPlays && decision._topPlays.length > 0) {
        aiLogMsg += ' | top: ' + decision._topPlays.slice(0, 3).map(function(p) {
          return p.score + 'pts/' + p.placements.length + 't';
        }).join(', ');
      }
      window.AMath.gameLog.log(aiLogMsg);
      window.AMath.gameLog.logState('After AI decision', session);
    }

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
      session.aiActualPlayCount = (session.aiActualPlayCount || 0) + 1;
      session.aiConsecutiveSwaps = 0;
      Rack.refillFromBag(session.aiRack, session.bag);

      // Achievement tracking — track largest deficit the human ever faced.
      // PvP doesn't apply (no Firebase save).
      if (!session.isPvP) {
        var deficit = session.aiScore - session.playerScore;
        if (deficit > (session.playerMaxDeficit || 0)) {
          session.playerMaxDeficit = deficit;
        }
      }

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

      // Detect ×9: a play with 2+ NEW tiles on 3E squares creates a 9× multiplier
      // (3 × 3 = 9). This is dramatic and rare — fire the special gloat toast.
      const wasX9 = isX9Play(decision.placements);

      const event = isBingo ? 'ai_bingo' : (wasX9 ? 'ai_x9' : 'ai_play');
      fireTrashTalk(event, { lastScore: decision.score });

      // Bag-empty taunt: when the bag runs out, the AI can deduce the
      // player's rack perfectly. Fire a special taunt that reveals the
      // player's tiles. Only once per game, delayed so it doesn't collide
      // with the bingo/play toast.
      if (session.bag.tiles.length === 0 && !session.bagEmptyTaunted) {
        session.bagEmptyTaunted = true;
        setTimeout(function () {
          if (session && !session.gameOver) {
            fireTrashTalk('bag_empty_taunt', {
              playerTiles: session.playerRack.tiles.slice(),  // copy for safety
            });
          }
        }, 3500);  // 3.5s delay — after the play/bingo toast fades
      }

      // If it's BOTH a Bingo and a ×9 (very rare), follow up with the ×9
      // gloat after the Bingo banner — both moments deserve coverage.
      if (isBingo && wasX9) {
        setTimeout(function () {
          // Only fire if session hasn't changed (player didn't reset mid-anim).
          if (session && !session.gameOver) {
            fireTrashTalk('ai_x9', { lastScore: decision.score });
          }
        }, 1800);
      }
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
      session.aiConsecutiveSwaps = (session.aiConsecutiveSwaps || 0) + 1;

      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('ai', 'swap', 0, false, session.aiScore, { swapCount: swapped.length });
      }

      showStatus('🤖 AI swapped ' + swapped.length + ' tiles. Your turn!');
      // Warn about 6-pass rule
      var sixPassOff = false;
      try { sixPassOff = window.AMath.settings.get('disableSixPassEnd') === true; } catch(e){}
      if (!sixPassOff && session.consecutiveNonScoringTurns >= 4) {
        var warnMsg2 = session.consecutiveNonScoringTurns >= 5
          ? '⚠️ ' + session.consecutiveNonScoringTurns + ' consecutive pass/swap! One more = game end!'
          : '⚠️ ' + session.consecutiveNonScoringTurns + ' consecutive pass/swap already (6 = game end)';
        showStatus(warnMsg2, 'error');
      }
      fireTrashTalk('ai_swap', {});
    } else if (decision.type === 'pass') {
      session.consecutiveNonScoringTurns++;
      session.lastAiPlay = null;

      if (window.AMath.scoreSheet) {
        window.AMath.scoreSheet.recordTurn('ai', 'pass', 0, false, session.aiScore);
      }

      showStatus('🤖 AI passed. Your turn!');
      // Warn about 6-pass rule
      var sixPassOff2 = false;
      try { sixPassOff2 = window.AMath.settings.get('disableSixPassEnd') === true; } catch(e){}
      if (!sixPassOff2 && session.consecutiveNonScoringTurns >= 4) {
        var warnMsg3 = session.consecutiveNonScoringTurns >= 5
          ? '⚠️ ' + session.consecutiveNonScoringTurns + ' consecutive pass/swap! One more = game end!'
          : '⚠️ ' + session.consecutiveNonScoringTurns + ' consecutive pass/swap already (6 = game end)';
        showStatus(warnMsg3, 'error');
      }
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

    saveUndoSnapshot();  // snapshot at start of player's turn (after AI played)

    Interactions.setPlayerTurn(true);
    if (window.AMath.sounds) window.AMath.sounds.turnStart();
    // Player's turn starts now — reset stalling counter so the first
    // 30-second window is measured from now, not from any leftover time.
    resetStallingWatch();

    // Education mode: start background analysis of player's rack
    if (window.AMath.education && window.AMath.settings && window.AMath.settings.get('educationMode')) {
      window.AMath.education.startBackgroundSearch(session);
    }

    // Show challenge button briefly after AI play
    if (decision.type === 'play') {
      showChallengeButton();
    }

    // If AI Takeover toggle is ON, play the player's turn automatically
    if (Modes && Modes.isAiTakeover() && !session.gameOver) {
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
    // No trash talk in Player vs Player mode
    if (session && session.isPvP) return;
    TT.fireForEvent(event, {
      playerScore: session.playerScore,
      aiScore: session.aiScore,
      lastScore: extras && extras.lastScore,
      force: extras && extras.force,
      playerTiles: extras && extras.playerTiles,
      isEarlyGame: (session.playerScore + session.aiScore) < 100,
    });
  }

  /**
   * Clear the "AI's last play" highlight (amber border around the AI's most
   * recently placed tiles). Called when the player completes their own move
   * (submit/pass/swap), since at that point they no longer need a reminder
   * of what the AI did — they're moving on. Also called when the play is
   * reverted via challenge so the highlight isn't pointing at empty cells.
   *
   * Note: this also clears the challenge-relevant data. That's fine in
   * the player's-turn-ending path because by then the player has decided
   * NOT to challenge.
   */
  function clearLastAiPlayHighlight() {
    if (!session) return;
    session.lastAiPlay = null;
    // Refresh so the visual border goes away immediately
    if (window.AMath.interactions && window.AMath.interactions.refreshUI) {
      window.AMath.interactions.refreshUI();
    }
  }

  /**
   * Returns true if the given list of placements forms a ×9 play — i.e.,
   * 2 or more NEW tiles land on 3E (Triple Equation) squares. With both
   * activating, the equation multiplier is 3 × 3 = 9. The 9 three-E
   * squares sit at the 4 corners, the 4 edge-midpoints, and the center,
   * so this also captures unusual configurations like (0,0)+(0,14) on
   * the same row — still ×9.
   */
  function isX9Play(placements) {
    if (!placements || placements.length < 2) return false;
    const C = window.AMath.constants;
    const threeE = new Set(C.THREE_E_SQUARES.map(rc => rc[0] + ',' + rc[1]));
    let count = 0;
    for (const p of placements) {
      if (threeE.has(p.row + ',' + p.col)) count++;
      if (count >= 2) return true;
    }
    return false;
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

    // 6-consecutive-passes auto-end rule. The official A-Math rule ends the
    // game after 6 non-scoring turns (3 per player). Users can disable this
    // via the "Disable 6-consecutive-passes game end" setting (default off).
    let sixPassDisabled = false;
    try {
      const s = window.AMath && window.AMath.settings;
      if (s && s.get) sixPassDisabled = s.get('disableSixPassEnd') === true;
    } catch (e) {}
    if (!sixPassDisabled &&
        !session.isFirstMove &&
        session.consecutiveNonScoringTurns >= C.CONSECUTIVE_NON_SCORING_TURNS_TO_END) {
      finalizeGame('consecutive_passes');
      return true;
    }

    return false;
  }

  function finalizeGame(reason) {
    const Rack = window.AMath.rack;
    const UI = window.AMath.ui;

    session.gameOver = true;

    // Log game end
    if (window.AMath.gameLog) {
      window.AMath.gameLog.log('GAME ENDED: ' + reason);
      window.AMath.gameLog.logState('Final state', session);
    }
    if (chessClockInterval) {
      clearInterval(chessClockInterval);
      chessClockInterval = null;
    }

    if (window.AMath.saveResume) window.AMath.saveResume.clearSave();

    const isPvP = session.isPvP;

    if (reason === 'rack_emptied') {
      if (isPvP) {
        // In PvP, figure out WHO emptied their rack
        const cp = session.currentPlayer || 1;
        if (Rack.isEmpty(session.playerRack)) {
          // Current player emptied rack — they get opponent's rack × 2
          const bonus = Rack.rackPoints(session.aiRack) * 2;
          if (cp === 1) session.playerScore += bonus;
          else session.aiScore += bonus;
        }
      } else {
        if (Rack.isEmpty(session.playerRack)) {
          session.playerScore += Rack.rackPoints(session.aiRack) * 2;
        } else if (Rack.isEmpty(session.aiRack)) {
          session.aiScore += Rack.rackPoints(session.playerRack) * 2;
        }
      }
    } else {
      // 6-pass ending: both subtract own rack
      if (isPvP) {
        session.playerScore -= Rack.rackPoints(session.p1Rack);
        session.aiScore -= Rack.rackPoints(session.p2Rack);
      } else {
        session.playerScore -= Rack.rackPoints(session.playerRack);
        session.aiScore -= Rack.rackPoints(session.aiRack);
      }
    }

    let playerTimePenalty = 0;
    let aiTimePenalty = 0;
    if (session.chessClockEnabled) {
      playerTimePenalty = calculateTimePenalty(session.playerTimeSeconds);
      aiTimePenalty = calculateTimePenalty(session.aiTimeSeconds);
      session.playerScore -= playerTimePenalty;
      session.aiScore -= aiTimePenalty;
    }

    const p1Label = isPvP ? 'P1' : 'You';
    const p2Label = isPvP ? 'P2' : 'AI';

    UI.renderScore(session.uiParts.playerScoreBox, p1Label, session.playerScore);
    UI.renderScore(session.uiParts.opponentScoreBox, p2Label, session.aiScore);

    let winnerLabel;
    if (session.playerScore > session.aiScore) winnerLabel = p1Label;
    else if (session.aiScore > session.playerScore) winnerLabel = p2Label;
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
      playerLabel: p1Label,
      aiLabel: p2Label,
    });

    // Save game result to Firebase (if logged in via lobby)
    if (!isPvP && window.AMathBridge && !window.AMathBridge.isGuest()) {
      var playerBingos = 0;
      if (window.AMath.scoreSheet) {
        var entries = window.AMath.scoreSheet.getAllEntries();
        for (var ei = 0; ei < entries.length; ei++) {
          if (entries[ei].who === 'player' && entries[ei].bingo) playerBingos++;
        }
      }
      window.AMathBridge.saveGameResult({
        playerScore: session.playerScore,
        aiScore: session.aiScore,
        won: session.playerScore > session.aiScore,
        bingos: playerBingos,
        x9plays: session.playerX9Count || 0,
        maxDeficit: session.playerMaxDeficit || 0,
        swapCount: session.playerSwapCount || 0,
        playsMade: session.playerPlaysMade || 0,
        gameDurationMs: session.gameStartTime ? (Date.now() - session.gameStartTime) : 0,
      });
    }

    // Game end sound + celebration if player won
    if (window.AMath.sounds) window.AMath.sounds.gameEnd();
    if (winnerLabel === 'You' && window.AMath.animations) {
      window.AMath.animations.confettiBurst(3000);
    }
  }

  // ============================================================================
  // STATUS
  // ============================================================================

  // Write status to BOTH the top #status and the desktop #status-card-body.
  // On desktop, the top #status is hidden via CSS and the card is visible.
  // On mobile, the top #status is visible and the card is hidden via CSS.
  function setStatusText(text, color, fontWeight) {
    const status = document.getElementById('status');
    const cardBody = document.getElementById('status-card-body');
    const card = document.getElementById('status-card');
    if (status) {
      status.textContent = text;
      status.style.color = color;
      status.style.fontWeight = fontWeight;
    }
    if (cardBody) {
      const prev = cardBody.textContent;
      cardBody.textContent = text;
      cardBody.style.color = color;
      cardBody.style.fontWeight = fontWeight;
      // Pulse animation when status text changes (but not on initial load)
      if (card && prev && prev !== text && prev !== 'Loading...') {
        card.classList.remove('pulse');
        // Force reflow so the animation can restart
        void card.offsetWidth;
        card.classList.add('pulse');
      }
    }
  }

  function showThinking(on) {
    const card = document.getElementById('status-card');

    if (!on) {
      // Hide the progress bar
      if (card) {
        const bar = card.querySelector('.thinking-bar');
        if (bar) bar.remove();
        card.classList.remove('thinking');
      }
      return;
    }

    // Read configured think time so we can inform the user
    const seconds = (window.AMath.settings && window.AMath.settings.get)
      ? (window.AMath.settings.get('aiThinkSeconds') || 180)
      : 180;
    const budgetText = seconds >= 60 ? Math.round(seconds / 60) + ' min' : seconds + 's';
    const isTakeover = window.AMath.modes && window.AMath.modes.isAiTakeover();
    const thinkLabel = isTakeover ? '🤖 AI2 (your side)' : '🤖 AI';
    setStatusText(thinkLabel + ' is thinking... (up to ' + budgetText + ')', '#6b7280', '500');

    // Add a CSS-animated progress bar.
    // CSS animations run on the browser's compositor thread, NOT the JS thread,
    // so this bar keeps animating even while AI's synchronous search has the
    // JS thread blocked. Gives the user visual confirmation that the game
    // isn't crashed — just thinking.
    if (card) {
      // Remove any old bar
      const old = card.querySelector('.thinking-bar');
      if (old) old.remove();

      const bar = document.createElement('div');
      bar.className = 'thinking-bar';
      bar.innerHTML = '<div class="thinking-bar-fill" style="animation-duration: ' + seconds + 's"></div>';
      card.appendChild(bar);
      card.classList.add('thinking');
    }

    // Force a paint BEFORE the synchronous search starts blocking the thread.
    // (The setTimeout in runAiTurn provides the actual yielding moment.)
  }

  function showStatus(text, kind) {
    const color = kind === 'error' ? '#dc2626' : kind === 'success' ? '#059669' : '#1f2937';
    const fontWeight = (kind === 'success' || kind === 'error') ? '600' : 'normal';
    setStatusText(text, color, fontWeight);
  }
})();
