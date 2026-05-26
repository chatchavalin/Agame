/**
 * A-Math Online Game Controller
 *
 * Runs INSIDE online.html. Bridges the existing game core (board, rack, ui,
 * interactions, evaluator, placement, scoring) with Firestore-based realtime
 * sync.
 *
 * Architecture:
 *   - HOST creates the room (via lobby), then on online.html load, if no game
 *     state exists in the room doc yet AND a guest has joined, host calls
 *     `seedInitialState()` to generate bag + racks and write to the doc.
 *   - Both sides subscribe via onSnapshot. Whenever the doc changes, we
 *     reconstruct the local session from the doc's `gameState` snapshot
 *     and re-render.
 *   - Submit/Pass/Swap: validate locally, then write the post-move state to
 *     the doc (host or guest, doesn't matter — both have write access via
 *     Firestore rules).
 *
 * Sync model:
 *   The room doc carries the ENTIRE game state under `gameState`, not deltas.
 *   This is wasteful but trivial to keep consistent. Doc is well under 100KB
 *   even at game end.
 *
 * gameState shape (inside room doc):
 *   {
 *     board: [[{tile?, premium?, premiumUsed?}, ...] x 15] x 15,
 *     bag: { tiles: [{id, face, type, points, assigned?}] },
 *     hostRack: { owner: 'host', tiles: [...] },
 *     guestRack: { owner: 'guest', tiles: [...] },
 *     hostScore, guestScore,
 *     turn: 'host' | 'guest',
 *     isFirstMove: bool,
 *     consecutiveNonScoring: 0,
 *     lastMove: { who, type, score, placements, equations, timestamp },
 *     gameOver: false,
 *     winner?, endReason?,
 *   }
 */

(function () {
  'use strict';

  var roomCode = null;
  var myRole = null;             // 'host' | 'guest'
  var myUid = null;
  var roomData = null;           // latest snapshot of the room doc
  var localSession = null;       // session object compatible with interactions.js
  var unsubscribe = null;
  var seeding = false;           // prevent double-seed race
  var lastAppliedMoveId = null;  // dedup re-applying our own moves
  var selectedTileId = null;     // currently-selected rack tile (for placement)
  var tentativePlacements = [];  // tiles placed but not yet submitted
  var submitInFlight = false;    // prevent double-submit
  var myMaxDeficit = 0;          // peak score gap when I was behind
  var statsFinalized = false;    // prevent double-save of game-end stats
  var swapMode = false;          // PvA-parity inline swap state
  var swapSelected = {};         // { tileId: true } in swap mode
  var _gameStartedHook = false;  // ran one-time init (game-log, score-sheet) yet?
  var _lastSeenMoveCount = -1;   // detect when opponent plays so we fire sounds/animations

  // -----------------------------------------------------------------------
  // BOOT
  // -----------------------------------------------------------------------

  async function boot() {
    var params = new URLSearchParams(window.location.search);
    roomCode = params.get('room');
    myRole = params.get('role');
    if (!roomCode || (myRole !== 'host' && myRole !== 'guest')) {
      showError('Invalid room URL.');
      return;
    }
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
      return setTimeout(boot, 200);
    }
    var user = firebase.auth().currentUser;
    if (!user) {
      await new Promise(function (resolve) {
        var unsubAuth = firebase.auth().onAuthStateChanged(function (u) {
          unsubAuth(); resolve(u);
        });
        setTimeout(resolve, 1500);
      });
      user = firebase.auth().currentUser;
    }
    if (!user) {
      showError('Please sign in via the lobby first.');
      return;
    }
    myUid = user.uid;

    if (!window.AMath || !window.AMath.onlineRoom) {
      showError('Online module not loaded.');
      return;
    }

    unsubscribe = window.AMath.onlineRoom.subscribe(roomCode, onRoomUpdate, function (err) {
      showError('Sync error: ' + err.message);
    });
  }

  function showError(msg) {
    var el = document.getElementById('room-status');
    if (el) {
      el.innerHTML = '❌ ' + escapeHtml(msg) +
        ' <a href="lobby.html" style="color:#fbbf24;">Back to lobby</a>';
    }
  }

  // -----------------------------------------------------------------------
  // ROOM DOC HANDLERS
  // -----------------------------------------------------------------------

  function onRoomUpdate(data) {
    roomData = data;
    renderHeader(data);

    // If host and no game state yet and guest has joined → seed
    if (myRole === 'host' && data.status === 'waiting' && data.guestUid && !data.gameState && !seeding) {
      seeding = true;
      seedInitialState().then(function () {
        seeding = false;
      }).catch(function (err) {
        seeding = false;
        console.error('Seed failed', err);
        showError('Failed to start game: ' + err.message);
      });
      return;
    }

    if (data.status === 'playing' && data.gameState) {
      // One-time hook the first time we see 'playing' status. Resets the
      // shared modules (game log, score sheet, tile tracker) and logs
      // game start. Without this they'd carry state from any previous
      // PvA game on the same tab.
      if (!_gameStartedHook) {
        _gameStartedHook = true;
        if (window.AMath.gameLog) {
          try {
            window.AMath.gameLog.startGame({ mode: 'PvP-Online', tileSet: 'prathom' });
          } catch (e) { /* gameLog may not be loaded — non-fatal */ }
        }
        if (window.AMath.scoreSheet) {
          try { window.AMath.scoreSheet.reset(); } catch (e) {}
        }
      }
      rebuildLocalSession(data.gameState);
      // Detect opponent move arrival (moveCount increased AND last move was
      // NOT mine) so we can fire sound/animation/score-sheet for it.
      var gs = data.gameState;
      var newMoveCount = gs.moveCount || 0;
      if (_lastSeenMoveCount !== -1 && newMoveCount > _lastSeenMoveCount
          && gs.lastMove && gs.lastMove.who && gs.lastMove.who !== myRole) {
        handleOpponentMoveArrived(gs);
      }
      _lastSeenMoveCount = newMoveCount;
      renderGameUI();
    }

    if (data.status === 'finished' && data.gameState) {
      rebuildLocalSession(data.gameState);
      renderGameUI();
      renderGameEnd(data);
      // Fire-and-forget achievements + stats — guarded by statsFinalized so
      // it only runs once per session even though onSnapshot may deliver the
      // 'finished' doc multiple times.
      if (!statsFinalized) {
        statsFinalized = true;
        finalizeOnlineStats(data.gameState, data);
      }
    }
  }

  // -----------------------------------------------------------------------
  // HOST: SEED INITIAL STATE
  // -----------------------------------------------------------------------

  async function seedInitialState() {
    var C = window.AMath.constants;
    var Bag = window.AMath.bag;
    var Rack = window.AMath.rack;
    var Board = window.AMath.board;

    var bag = Bag.createBag();
    var hostRack = Rack.createRack('host');
    var guestRack = Rack.createRack('guest');
    Rack.refillFromBag(hostRack, bag);
    Rack.refillFromBag(guestRack, bag);

    var board = Board.createBoard();
    // Plain serialization: keep `cells` as nested arrays.

    // Host goes first (simple rule).
    var initialState = {
      board: serializeBoard(board),
      bag: { tiles: bag.tiles },
      hostRack: { owner: 'host', tiles: hostRack.tiles, slotMap: hostRack.slotMap || {} },
      guestRack: { owner: 'guest', tiles: guestRack.tiles, slotMap: guestRack.slotMap || {} },
      hostScore: 0,
      guestScore: 0,
      turn: 'host',
      isFirstMove: true,
      consecutiveNonScoring: 0,
      gameOver: false,
      lastMove: null,
      moveCount: 0,
      moves: [],
      startedAt: Date.now(),
      hostBingos: 0,
      guestBingos: 0,
      chat: [],          // append-only [{ from, text, ts }], pruned to last 50
    };

    await window.AMath.onlineRoom.updateRoom(roomCode, {
      status: 'playing',
      gameState: initialState,
      turn: 'host',
      hostScore: 0,
      guestScore: 0,
    });
  }

  /**
   * Called from onSnapshot when the opponent just made a move (moveCount
   * increased and lastMove.who is not us). Fires the UX side effects that
   * PvA fires when AI moves: sound, score-sheet entry, game-log entry,
   * animation cue.
   *
   * Note: my OWN moves trigger these effects locally in onSubmitClick /
   * onPassClick / onSwapClick, so this function only handles opponent
   * moves to avoid double-firing.
   */
  function handleOpponentMoveArrived(gs) {
    var lm = gs.lastMove || {};
    var oppName = (myRole === 'host')
      ? (roomData && roomData.guestName || 'Opponent')
      : (roomData && roomData.hostName || 'Opponent');
    var oppRole = (myRole === 'host') ? 'guest' : 'host';
    var oppScoreField = (oppRole === 'host') ? 'hostScore' : 'guestScore';
    var oppScore = gs[oppScoreField] || 0;

    // Sound effect
    if (window.AMath.sounds) {
      try {
        if (lm.type === 'play') {
          // Use the AI-play sound for opponent play (it's a positive cue)
          if (window.AMath.sounds.aiPlay) window.AMath.sounds.aiPlay();
          else if (window.AMath.sounds.submitSuccess) window.AMath.sounds.submitSuccess();
        } else if (lm.type === 'pass' || lm.type === 'swap') {
          if (window.AMath.sounds.pass) window.AMath.sounds.pass();
        } else if (lm.type === 'challenge_failed') {
          if (window.AMath.sounds.submitFail) window.AMath.sounds.submitFail();
        }
      } catch (e) {}
    }

    // Score sheet entry — use 'ai' as the 'who' field for opponent moves
    // so the score-sheet's 3-column rendering puts them in the opposite
    // column from my plays (which use 'player').
    if (window.AMath.scoreSheet) {
      try {
        if (lm.type === 'play') {
          var bingo = !!lm.bingo;
          window.AMath.scoreSheet.recordTurn('ai', 'play', lm.score || 0, bingo, oppScore);
        } else if (lm.type === 'pass') {
          window.AMath.scoreSheet.recordTurn('ai', 'pass', 0, false, oppScore);
        } else if (lm.type === 'swap') {
          window.AMath.scoreSheet.recordTurn('ai', 'swap', 0, false, oppScore,
            { swapCount: lm.count || 0 });
        } else if (lm.type === 'challenge_failed') {
          window.AMath.scoreSheet.recordTurn('ai', 'challenge-failed', 0, false, oppScore);
        }
      } catch (e) {}
    }

    // Game log entry
    if (window.AMath.gameLog) {
      try {
        if (lm.type === 'play') {
          window.AMath.gameLog.log(oppName + ' played +' + (lm.score || 0)
            + 'pts (' + ((lm.placements || []).length) + ' tiles)'
            + (lm.bingo ? ' 🎉 BINGO' : ''));
        } else if (lm.type === 'pass') {
          window.AMath.gameLog.log(oppName + ' passed');
        } else if (lm.type === 'swap') {
          window.AMath.gameLog.log(oppName + ' swapped ' + (lm.count || 0) + ' tiles');
        } else if (lm.type === 'challenge_failed') {
          window.AMath.gameLog.log(oppName + ' failed challenge - forfeit turn');
        }
      } catch (e) {}
    }
  }

  /**
   * Serialize board for Firestore. CRITICAL: Firestore rejects nested arrays,
   * so we cannot store cells as a 2D array. Instead we flatten to a 1D array
   * of cell objects each carrying their {r, c} indices. rebuildLocalSession
   * reconstructs the 2D grid client-side.
   */
  function serializeBoard(board) {
    var out = { cells: [] };
    for (var r = 0; r < board.cells.length; r++) {
      for (var c = 0; c < board.cells[r].length; c++) {
        var cell = board.cells[r][c];
        out.cells.push({
          r: r, c: c,
          premium: cell.premium || null,
          premiumUsed: !!cell.premiumUsed,
          tile: cell.tile || null,
        });
      }
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // STATE → LOCAL SESSION
  // -----------------------------------------------------------------------

  function rebuildLocalSession(gs) {
    var C = window.AMath.constants;
    var Board = window.AMath.board;

    // Reconstruct board from serialized form. The doc stores cells as a flat
    // 1D array (Firestore disallows nested arrays). Reassemble into the 2D
    // grid the Board module expects.
    var board = Board.createBoard();
    var flatCells = (gs.board && gs.board.cells) || [];
    for (var fi = 0; fi < flatCells.length; fi++) {
      var saved = flatCells[fi];
      if (!saved) continue;
      // Support both new flat shape ({r,c}) and any legacy 2D shape ([r][c])
      var rr = (saved.r != null) ? saved.r : null;
      var cc = (saved.c != null) ? saved.c : null;
      if (rr == null || cc == null) continue;
      var live = board.cells[rr] && board.cells[rr][cc];
      if (!live) continue;
      live.tile = saved.tile || null;
      live.premiumUsed = !!saved.premiumUsed;
    }

    // Determine which rack is mine, which is opponent
    var myRack, oppRack;
    if (myRole === 'host') {
      myRack = gs.hostRack;
      oppRack = gs.guestRack;
    } else {
      myRack = gs.guestRack;
      oppRack = gs.hostRack;
    }
    // Ensure slotMap exists
    if (!myRack.slotMap) myRack.slotMap = {};
    if (!oppRack.slotMap) oppRack.slotMap = {};

    var myScore = (myRole === 'host') ? gs.hostScore : gs.guestScore;
    var oppScore = (myRole === 'host') ? gs.guestScore : gs.hostScore;
    var myTurn = (gs.turn === myRole);

    // Track largest deficit I ever faced — used by Comeback King achievement.
    // Run this on every snapshot so it captures the peak even if the lead
    // changes hands multiple times during the game.
    var deficit = oppScore - myScore;
    if (deficit > myMaxDeficit) myMaxDeficit = deficit;

    // If a new move came in (moveCount went up), drop any tentative placements
    // — server-truth has changed.
    var prevMoveCount = (localSession && localSession._rawGameState
                        && localSession._rawGameState.moveCount) || 0;
    var newMoveCount = gs.moveCount || 0;
    if (newMoveCount > prevMoveCount) {
      tentativePlacements = [];
      selectedTileId = null;
    }

    localSession = {
      board: board,
      bag: gs.bag,
      playerRack: myRack,
      aiRack: oppRack,
      isOnline: true,
      onlineRole: myRole,
      tentativePlacements: tentativePlacements,
      selectedTileId: selectedTileId,
      playerScore: myScore,
      aiScore: oppScore,
      isFirstMove: gs.isFirstMove,
      gameOver: gs.gameOver,
      consecutiveNonScoringTurns: gs.consecutiveNonScoring || 0,
      isPlayerTurn: myTurn,
      lastMove: gs.lastMove || null,
      _rawGameState: gs,
    };

    // Re-apply tentative placements onto the rebuilt local board so the UI
    // shows them. They are NOT in the server-truth board; they overlay it.
    for (var i = 0; i < tentativePlacements.length; i++) {
      var p = tentativePlacements[i];
      var c2 = board.cells[p.row][p.col];
      if (!c2.tile) c2.tile = p.tile;
    }
  }

  // -----------------------------------------------------------------------
  // RENDER
  // -----------------------------------------------------------------------

  function renderHeader(data) {
    // Delegate to online.html's renderHeader which manages the host/guest
    // cards + room status. Defined in the inline script in online.html.
    if (window.AMathOnlineHeader && window.AMathOnlineHeader.render) {
      window.AMathOnlineHeader.render(data);
    }
    // While playing, the PvA-style layout below has its own player score
    // boxes — hide the duplicate cards + status to avoid visual redundancy.
    var playersRow = document.getElementById('players-row');
    var roomStatus = document.getElementById('room-status');
    var inGame = (data.status === 'playing' || data.status === 'finished') && data.gameState;
    if (playersRow) playersRow.style.display = inGame ? 'none' : '';
    if (roomStatus) roomStatus.style.display = inGame ? 'none' : '';
  }

  var _uiBuilt = false;
  var _uiParts = null;

  function renderGameUI() {
    var UI = window.AMath.ui;
    var container = document.getElementById('room-content');
    if (!container) return;

    // Preserve a chat-input value if the panel is already mounted (re-renders
    // happen on every onSnapshot). Otherwise the user loses what they're typing.
    var preservedChatInput = '';
    var existingInput = document.getElementById('online-chat-input');
    if (existingInput) preservedChatInput = existingInput.value;

    if (!_uiBuilt) {
      buildOnlineUI(container);
      _uiBuilt = true;
    }

    // Update the PvA-style layout sub-regions from current state
    if (UI && UI.renderBoard) UI.renderBoard(localSession.board, _uiParts.boardArea);
    // My rack via the standard PvA rack renderer (slot-stable, themed tiles)
    if (UI && UI.renderRack) UI.renderRack(localSession.playerRack, _uiParts.playerRack, false);
    // Opponent rack: render via the same renderer with isOpponent=true so it
    // displays face-down tiles, matching the PvA visual exactly
    if (UI && UI.renderRack) UI.renderRack(localSession.aiRack, _uiParts.opponentRack, true);
    // Scores
    var myName = (myRole === 'host')
      ? (roomData && roomData.hostName || 'You')
      : (roomData && roomData.guestName || 'You');
    var oppName = (myRole === 'host')
      ? (roomData && roomData.guestName || 'Opponent')
      : (roomData && roomData.hostName || 'Opponent');
    if (UI && UI.renderScore) {
      UI.renderScore(_uiParts.playerScoreBox, myName, localSession.playerScore);
      UI.renderScore(_uiParts.opponentScoreBox, oppName, localSession.aiScore);
    }

    // Re-wire board click + drag because renderBoard wipes children & handlers
    wireBoardClicks(_uiParts.boardArea);
    highlightTentativeCells(_uiParts.boardArea);

    // Re-wire rack tile drag/click (renderRack also wiped them)
    wireRackTileHandlers();

    // Turn indicator — matches PvA's interactions.js .is-active-turn class.
    // The CSS handles the visual glow/pulse on whichever area has the class.
    var playerArea = document.querySelector('.player-area');
    var opponentArea = document.querySelector('.opponent-area');
    if (playerArea && opponentArea) {
      if (localSession.isPlayerTurn && !localSession.gameOver) {
        playerArea.classList.add('is-active-turn');
        opponentArea.classList.remove('is-active-turn');
      } else if (!localSession.gameOver) {
        opponentArea.classList.add('is-active-turn');
        playerArea.classList.remove('is-active-turn');
      } else {
        playerArea.classList.remove('is-active-turn');
        opponentArea.classList.remove('is-active-turn');
      }
    }

    // Action button state
    updateActionButtonStates();

    // Last-move text + chat
    renderLastMove();
    renderChatMessages();
    wireChatInput(preservedChatInput);
  }

  /**
   * First-time mount: insert PvA-style layout into the room-content container,
   * append our chat panel below it, hide PvA-only buttons that don't belong
   * in online play, and wire all action handlers.
   */
  function buildOnlineUI(container) {
    var UI = window.AMath.ui;
    container.innerHTML = '';

    // Container that the PvA layout will fill
    var gameRoot = document.createElement('div');
    gameRoot.id = 'online-game-root';
    container.appendChild(gameRoot);

    _uiParts = UI.buildGameLayout(gameRoot);

    // Hide PvA-only action buttons that don't make sense in 2P online
    var hideIds = ['btn-takeover', 'btn-new-game', 'btn-export', 'btn-import',
                   'btn-score-sheet', 'btn-settings', 'file-import-input'];
    for (var hi = 0; hi < hideIds.length; hi++) {
      var el = document.getElementById(hideIds[hi]);
      if (el) el.style.display = 'none';
    }
    // Show challenge button (PvA layout hides it by default)
    var chBtn = document.getElementById('btn-challenge');
    if (chBtn) chBtn.style.display = '';
    // Add a "Back to lobby" button so players can leave the room
    var lobbyBtn = document.getElementById('btn-lobby');
    if (lobbyBtn) lobbyBtn.style.display = '';

    // Wire action buttons. PvA's interactions.js does this normally; we own
    // it ourselves in online mode.
    var submitBtn = document.getElementById('btn-submit');
    var resetBtn = document.getElementById('btn-reset');
    var passBtn = document.getElementById('btn-pass');
    var swapBtn = document.getElementById('btn-swap');
    var challengeBtn = document.getElementById('btn-challenge');
    if (submitBtn) submitBtn.onclick = onSubmitClick;
    if (resetBtn) resetBtn.onclick = onResetClick;
    if (passBtn) passBtn.onclick = onPassClick;
    if (swapBtn) swapBtn.onclick = onSwapClick;
    if (challengeBtn) challengeBtn.onclick = onChallengeClick;

    // Chat panel sits below everything else — same look as before
    var chatHtml =
      '<div id="online-chat" style="margin:14px 0;background:#1e293b;border-radius:8px;' +
        'border:1px solid #334155;overflow:hidden;">' +
        '<div id="online-chat-header" onclick="window.AMath.onlineGame.toggleChat()" ' +
            'style="padding:10px 12px;cursor:pointer;display:flex;justify-content:space-between;' +
                   'align-items:center;background:#0f172a;font-size:13px;color:#e2e8f0;font-weight:600;">' +
          '<span>💬 Chat <span id="online-chat-unread" style="display:none;color:#fbbf24;"></span></span>' +
          '<span id="online-chat-caret" style="font-size:12px;color:#94a3b8;">▼</span>' +
        '</div>' +
        '<div id="online-chat-body" style="display:none;">' +
          '<div id="online-chat-messages" style="height:180px;overflow-y:auto;padding:8px 12px;' +
                  'display:flex;flex-direction:column;gap:6px;font-size:13px;"></div>' +
          '<div style="display:flex;gap:6px;padding:8px;border-top:1px solid #334155;">' +
            '<input id="online-chat-input" type="text" maxlength="200" ' +
                   'placeholder="Type a message…" ' +
                   'style="flex:1;background:#0f172a;border:1px solid #334155;color:#e2e8f0;' +
                          'padding:6px 10px;border-radius:6px;font-size:13px;outline:none;">' +
            '<button id="online-chat-send" ' +
                   'style="background:#fbbf24;color:#1e293b;border:none;padding:6px 14px;' +
                          'border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">' +
              'Send</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="online-last-move" style="margin:8px 0;font-size:13px;color:#94a3b8;"></div>';
    var chatWrap = document.createElement('div');
    chatWrap.innerHTML = chatHtml;
    while (chatWrap.firstChild) container.appendChild(chatWrap.firstChild);
  }

  /**
   * Wire pointer-based drag-and-drop + click-to-select on every tile in
   * the freshly-rendered player rack. renderRack creates the tile DOM nodes
   * but doesn't attach our handlers; we do it here on every re-render.
   */
  function wireRackTileHandlers() {
    if (!_uiParts || !_uiParts.playerRack) return;
    var tileEls = _uiParts.playerRack.querySelectorAll('.amath-tile');
    tileEls.forEach(function (tileEl) {
      var tileId = tileEl.dataset.tileId;
      if (!tileId) return;

      // CRITICAL: prevent stale-listener accumulation. wireRackTileHandlers
      // gets called on every snapshot and every swap-selection change, but
      // the tile DOM nodes persist across calls (UI.renderRack only rebuilds
      // them when the rack itself changes). If we just .addEventListener
      // again, each tile ends up with N listeners after N taps, and the
      // swap toggle fires N times — producing the 'can only select one tile'
      // bug the user reported.
      //
      // Mark each tile once with a flag; only attach listeners if not yet
      // wired. The flag is cleared when UI.renderRack rebuilds the tile
      // (new DOM node = no flag).
      if (!tileEl._amathWired) {
        tileEl._amathWired = true;
        tileEl.addEventListener('click', function () {
          if (!localSession.isPlayerTurn) return;
          if (tileEl.dataset.didDrag === '1') { tileEl.dataset.didDrag = '0'; return; }
          if (swapMode) {
            if (swapSelected[tileId]) delete swapSelected[tileId];
            else swapSelected[tileId] = true;
            refreshRackVisuals();
            updateActionButtonStates();
            return;
          }
          selectedTileId = (selectedTileId === tileId) ? null : tileId;
          refreshRackVisuals();
        });
        // Drag handlers also attach only once per tile
        attachDragHandlers(tileEl, tileId);
      }
    });
    // Always refresh visual state (classes / outlines) since selection
    // changed even if listeners didn't.
    refreshRackVisuals();
  }

  /**
   * Update tile visual state (selection outline, swap-selected class) and
   * cursor / touchAction style on every rack tile. Does NOT attach event
   * listeners — those persist from the first wireRackTileHandlers call
   * after each UI.renderRack rebuild.
   */
  function refreshRackVisuals() {
    if (!_uiParts || !_uiParts.playerRack) return;
    var tileEls = _uiParts.playerRack.querySelectorAll('.amath-tile');
    tileEls.forEach(function (tileEl) {
      var tileId = tileEl.dataset.tileId;
      if (!tileId) return;
      tileEl.style.cursor = localSession.isPlayerTurn ? 'pointer' : 'default';
      tileEl.style.touchAction = 'none';
      if (swapMode && swapSelected[tileId]) {
        tileEl.classList.add('tile-swap-selected');
        tileEl.style.outline = '';
      } else {
        tileEl.classList.remove('tile-swap-selected');
        if (!swapMode && selectedTileId === tileId) {
          tileEl.style.outline = '3px solid #fbbf24';
          tileEl.style.outlineOffset = '-2px';
        } else {
          tileEl.style.outline = '';
        }
      }
    });
  }

  /**
   * Update enabled/disabled state of action buttons based on current turn
   * and whether tentative placements exist. Doesn't rebuild the buttons.
   */
  function updateActionButtonStates() {
    var gs = localSession._rawGameState;
    var myTurn = localSession.isPlayerTurn;
    var hasTentative = tentativePlacements.length > 0;
    var swapCount = 0;
    if (swapMode) {
      for (var sk in swapSelected) if (swapSelected[sk]) swapCount++;
    }
    var canChallenge = !!(myTurn && gs && gs.prevPlayState
                          && gs.prevPlayState.who && gs.prevPlayState.who !== myRole
                          && !hasTentative && !swapMode);

    var setEnabled = function (id, on) {
      var el = document.getElementById(id);
      if (el) el.disabled = !on;
    };
    var submitBtn = document.getElementById('btn-submit');
    if (submitBtn) {
      if (swapMode) {
        submitBtn.textContent = 'Confirm Swap (' + swapCount + ')';
        submitBtn.disabled = (swapCount === 0);
      } else {
        submitBtn.textContent = 'Submit';
        submitBtn.disabled = !(myTurn && hasTentative);
      }
    }
    setEnabled('btn-reset', myTurn && (hasTentative || swapMode));
    setEnabled('btn-pass', myTurn && !swapMode);
    // Swap button stays enabled in swap mode so it acts as a cancel toggle
    setEnabled('btn-swap', myTurn);
    setEnabled('btn-challenge', canChallenge);
    // Visual indicator that swap mode is active
    var swapBtn = document.getElementById('btn-swap');
    if (swapBtn) {
      if (swapMode) {
        swapBtn.classList.add('btn-active-mode');
        swapBtn.textContent = 'Cancel Swap';
      } else {
        swapBtn.classList.remove('btn-active-mode');
        swapBtn.textContent = 'Swap';
      }
    }
  }

  // -----------------------------------------------------------------------
  // INPUT (board click + tile drag — board renderer wipes handlers on each
  // render, so these get re-attached every refresh by renderGameUI)
  // -----------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // CHAT
  // ---------------------------------------------------------------------

  var _chatOpen = false;
  var _lastSeenChatCount = 0;

  function toggleChat() {
    _chatOpen = !_chatOpen;
    var body = document.getElementById('online-chat-body');
    var caret = document.getElementById('online-chat-caret');
    if (body) body.style.display = _chatOpen ? '' : 'none';
    if (caret) caret.textContent = _chatOpen ? '▲' : '▼';
    if (_chatOpen) {
      // Reset unread counter and scroll to bottom
      _lastSeenChatCount = currentChatCount();
      updateChatUnreadBadge();
      var msgs = document.getElementById('online-chat-messages');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      var input = document.getElementById('online-chat-input');
      if (input) setTimeout(function () { input.focus(); }, 50);
    }
  }

  function currentChatCount() {
    var gs = localSession && localSession._rawGameState;
    return (gs && gs.chat) ? gs.chat.length : 0;
  }

  function updateChatUnreadBadge() {
    var unread = currentChatCount() - _lastSeenChatCount;
    var badge = document.getElementById('online-chat-unread');
    if (!badge) return;
    if (unread > 0 && !_chatOpen) {
      badge.textContent = '(' + unread + ' new)';
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  function renderChatMessages() {
    var msgs = document.getElementById('online-chat-messages');
    if (!msgs) return;
    var chat = (localSession._rawGameState.chat) || [];
    if (chat.length === 0) {
      msgs.innerHTML =
        '<div style="color:#64748b;text-align:center;padding:14px 0;">' +
        'No messages yet. Say hi 👋</div>';
    } else {
      var html = '';
      for (var i = 0; i < chat.length; i++) {
        var m = chat[i];
        var mine = (m.from === myRole);
        var name = m.from === 'host'
          ? (roomData && roomData.hostName || 'Host')
          : (roomData && roomData.guestName || 'Guest');
        var when = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        var align = mine ? 'flex-end' : 'flex-start';
        var bg = mine ? '#fbbf24' : '#334155';
        var fg = mine ? '#1e293b' : '#e2e8f0';
        html +=
          '<div style="display:flex;flex-direction:column;align-items:' + align + ';">' +
            '<div style="font-size:10px;color:#64748b;margin-bottom:2px;">' +
              escapeHtml(mine ? 'You' : name) + (when ? ' · ' + when : '') +
            '</div>' +
            '<div style="background:' + bg + ';color:' + fg + ';padding:6px 10px;' +
                       'border-radius:10px;max-width:80%;word-wrap:break-word;' +
                       'white-space:pre-wrap;">' +
              escapeHtml(m.text || '') +
            '</div>' +
          '</div>';
      }
      msgs.innerHTML = html;
      // Auto-scroll to bottom when new messages arrive AND chat is open
      if (_chatOpen) msgs.scrollTop = msgs.scrollHeight;
    }
    // Update unread badge — if chat is closed, show count of new since last open
    updateChatUnreadBadge();
  }

  function wireChatInput(preservedValue) {
    var input = document.getElementById('online-chat-input');
    var sendBtn = document.getElementById('online-chat-send');
    if (input && preservedValue) input.value = preservedValue;
    if (sendBtn) sendBtn.onclick = sendChatMessage;
    if (input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          sendChatMessage();
        }
      });
    }
  }

  async function sendChatMessage() {
    var input = document.getElementById('online-chat-input');
    if (!input) return;
    var text = (input.value || '').trim();
    if (!text) return;
    if (text.length > 200) text = text.substring(0, 200);
    input.value = '';

    var gs = localSession._rawGameState;
    var newChat = ((gs && gs.chat) || []).slice();
    newChat.push({
      from: myRole,
      text: text,
      ts: Date.now(),
    });
    // Cap at last 50 messages to keep doc size bounded
    if (newChat.length > 50) newChat = newChat.slice(newChat.length - 50);

    try {
      await window.AMath.onlineRoom.updateRoom(roomCode, {
        gameState: Object.assign({}, gs, { chat: newChat }),
      });
    } catch (err) {
      console.error('[OnlineGame] chat send failed', err);
      alert('Failed to send: ' + err.message);
      input.value = text; // restore so user can retry
    }
  }

  /**
   * Click on a board cell:
   *   - Empty cell + a tile selected → place that tile (tentative)
   *   - Cell with one of MY tentative tiles → return it to rack
   *   - Cell with committed tile → ignore
   */
  function wireBoardClicks(boardEl) {
    if (!boardEl) return;
    var cells = boardEl.querySelectorAll('.amath-cell');
    cells.forEach(function (cellEl) {
      var r = parseInt(cellEl.dataset.row, 10);
      var c = parseInt(cellEl.dataset.col, 10);
      cellEl.addEventListener('click', function () { onCellClick(r, c); });
    });
  }

  function isTentativeAt(row, col) {
    for (var i = 0; i < tentativePlacements.length; i++) {
      if (tentativePlacements[i].row === row && tentativePlacements[i].col === col) return i;
    }
    return -1;
  }

  function highlightTentativeCells(boardEl) {
    if (!boardEl) return;
    var cells = boardEl.querySelectorAll('.amath-cell');
    cells.forEach(function (cellEl) {
      var r = parseInt(cellEl.dataset.row, 10);
      var c = parseInt(cellEl.dataset.col, 10);
      if (isTentativeAt(r, c) >= 0) {
        cellEl.style.outline = '2px solid #fbbf24';
        cellEl.style.outlineOffset = '-2px';
      }
    });
  }

  function onCellClick(row, col) {
    if (!localSession || !localSession.isPlayerTurn) return;
    var cell = localSession.board.cells[row][col];

    var tentativeIdx = isTentativeAt(row, col);
    if (tentativeIdx >= 0) {
      // Click your own tentative tile → return it to the rack
      returnTileToRack(tentativeIdx);
      return;
    }
    if (cell.tile) return; // committed tile — can't replace
    if (!selectedTileId) return; // nothing selected to place

    var rackTile = findRackTile(selectedTileId);
    if (!rackTile) { selectedTileId = null; return; }

    // BLANK or choice → pick face
    if (rackTile.type === 'blank' || rackTile.type === 'choice') {
      showFacePicker(rackTile, function (assignedFace) {
        if (!assignedFace) return; // cancelled
        placeTentative(rackTile, row, col, assignedFace);
      });
      return;
    }
    placeTentative(rackTile, row, col, null);
  }

  function findRackTile(tileId) {
    var tiles = localSession.playerRack.tiles;
    for (var i = 0; i < tiles.length; i++) if (tiles[i].id === tileId) return tiles[i];
    return null;
  }

  function placeTentative(rackTile, row, col, assignedFace) {
    // Visually move tile from rack to board (locally, until submit)
    // Use a copy with the assignment so the rack still has the original on
    // cancel/reset.
    var placed = Object.assign({}, rackTile);
    if (assignedFace) placed.assigned = assignedFace;
    // Remember the original rack slot so returning the tile preserves its
    // physical position (PvA's slot-stable rack expects this).
    var originalSlot = (localSession.playerRack.slotMap || {})[rackTile.id];
    tentativePlacements.push({
      row: row, col: col, tile: placed,
      originalSlot: originalSlot,
    });
    // Remove tile from rack view (locally only — write to Firestore on Submit)
    removeFromRackLocal(rackTile.id);
    selectedTileId = null;
    // Apply to board so re-render shows it
    localSession.board.cells[row][col].tile = placed;
    refreshUIWithoutSync();
  }

  function returnTileToRack(idx) {
    var p = tentativePlacements[idx];
    if (!p) return;
    localSession.board.cells[p.row][p.col].tile = null;
    // Put back into the rack (clear any picked face)
    var rackTile = Object.assign({}, p.tile, { assigned: null });
    localSession.playerRack.tiles.push(rackTile);
    // Restore the slot mapping so the rack tile appears in its original
    // physical position (matches PvA's slot-stable rack behavior).
    if (p.originalSlot !== undefined && p.originalSlot !== null) {
      if (!localSession.playerRack.slotMap) localSession.playerRack.slotMap = {};
      localSession.playerRack.slotMap[rackTile.id] = p.originalSlot;
    }
    tentativePlacements.splice(idx, 1);
    refreshUIWithoutSync();
  }

  function removeFromRackLocal(tileId) {
    var tiles = localSession.playerRack.tiles;
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].id === tileId) { tiles.splice(i, 1); break; }
    }
    // Also delete the slot mapping so tilesBySlot doesn't render an empty
    // slot containing a tile that no longer exists in rack.tiles
    if (localSession.playerRack.slotMap) {
      delete localSession.playerRack.slotMap[tileId];
    }
  }

  /**
   * Re-render after a purely local change (click-place, click-return).
   * Avoids round-trip to Firestore.
   *
   * Re-renders the board + my rack using the PvA-shaped sub-regions stored
   * in _uiParts, then re-wires drag/click handlers (renderBoard/renderRack
   * wipe DOM children & event listeners on each call).
   */
  function refreshUIWithoutSync() {
    var UI = window.AMath.ui;
    if (!_uiParts) return;
    if (UI && UI.renderBoard) UI.renderBoard(localSession.board, _uiParts.boardArea);
    if (UI && UI.renderRack) UI.renderRack(localSession.playerRack, _uiParts.playerRack, false);
    wireBoardClicks(_uiParts.boardArea);
    highlightTentativeCells(_uiParts.boardArea);
    wireRackTileHandlers();
    updateActionButtonStates();
  }

  /**
   * Pointer-based drag handlers. Works on touch + mouse. While dragging:
   *  - A floating clone of the tile follows the pointer
   *  - When pointerup lands over a board cell that is empty AND on the
   *    current player's turn, we trigger placeTentative (with picker for
   *    blank/choice).
   */
  function attachDragHandlers(tileEl, tileId) {
    var dragging = false;
    var ghost = null;
    var startX = 0, startY = 0;
    var moved = false;

    function onPointerDown(ev) {
      if (!localSession || !localSession.isPlayerTurn) return;
      // In swap mode, taps select for swap (handled by the click listener).
      // We must NOT start a drag here — the pointerup→onCellClick path
      // would try to place the tile, which is wrong in swap mode.
      if (swapMode) return;
      if (ev.button !== undefined && ev.button !== 0) return;
      dragging = true;
      moved = false;
      startX = ev.clientX;
      startY = ev.clientY;
      try { tileEl.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    }
    function onPointerMove(ev) {
      if (!dragging) return;
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      moved = true;
      if (!ghost) {
        ghost = tileEl.cloneNode(true);
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '99999';
        ghost.style.opacity = '0.85';
        ghost.style.transform = 'scale(1.15)';
        document.body.appendChild(ghost);
        tileEl.style.opacity = '0.3';
      }
      ghost.style.left = (ev.clientX - 20) + 'px';
      ghost.style.top = (ev.clientY - 20) + 'px';
    }
    function onPointerUp(ev) {
      if (!dragging) return;
      dragging = false;
      var didMove = moved;
      if (ghost) { document.body.removeChild(ghost); ghost = null; }
      tileEl.style.opacity = '';
      try { tileEl.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (!didMove) return;
      tileEl.dataset.didDrag = '1';
      var dropTarget = document.elementFromPoint(ev.clientX, ev.clientY);
      while (dropTarget && !dropTarget.classList.contains('amath-cell')) {
        dropTarget = dropTarget.parentElement;
      }
      if (!dropTarget) return;
      var r = parseInt(dropTarget.dataset.row, 10);
      var c = parseInt(dropTarget.dataset.col, 10);
      if (isNaN(r) || isNaN(c)) return;
      selectedTileId = tileId;
      onCellClick(r, c);
    }
    function onPointerCancel() {
      dragging = false;
      if (ghost) { document.body.removeChild(ghost); ghost = null; }
      tileEl.style.opacity = '';
    }
    tileEl.addEventListener('pointerdown', onPointerDown);
    tileEl.addEventListener('pointermove', onPointerMove);
    tileEl.addEventListener('pointerup', onPointerUp);
    tileEl.addEventListener('pointercancel', onPointerCancel);
  }

  function onResetClick() {
    if (swapMode) { exitSwapMode(); return; }
    // Move all tentative tiles back to the rack
    for (var i = tentativePlacements.length - 1; i >= 0; i--) {
      returnTileToRack(i);
    }
  }

  function onSwapClick() {
    if (!localSession || !localSession.isPlayerTurn) return;
    // If already in swap mode, this acts as a cancel toggle.
    if (swapMode) { exitSwapMode(); return; }
    var C = window.AMath.constants;
    var bagSize = (localSession._rawGameState.bag.tiles || []).length;
    if (bagSize < (C.SWAP_FORBIDDEN_BAG_THRESHOLD + 1)) {
      alert('Swap not allowed: bag has ' + bagSize + ' tile(s) remaining ' +
            '(minimum ' + (C.SWAP_FORBIDDEN_BAG_THRESHOLD + 1) + ' required).');
      return;
    }
    enterSwapMode();
  }

  /**
   * Inline swap mode — same UX as PvA. Tiles on the rack become tap-to-select
   * and the Submit button changes to 'Confirm Swap (N)'. Cancel via Reset or
   * by tapping Swap again.
   */
  function enterSwapMode() {
    swapMode = true;
    swapSelected = {};
    selectedTileId = null;
    // If the player had tentative placements down, send them back to the rack
    // first so we don't mix swap-select with placed-tiles state.
    for (var i = tentativePlacements.length - 1; i >= 0; i--) returnTileToRack(i);
    refreshUIWithoutSync();
  }

  function exitSwapMode() {
    swapMode = false;
    swapSelected = {};
    refreshUIWithoutSync();
  }

  /**
   * Called when Submit is clicked in swap mode — collects selected tiles
   * and calls submitSwap, then exits swap mode.
   */
  function confirmSwapFromMode() {
    var tilesToSwap = [];
    var tiles = localSession.playerRack.tiles;
    for (var i = 0; i < tiles.length; i++) {
      if (swapSelected[tiles[i].id]) tilesToSwap.push(tiles[i]);
    }
    if (tilesToSwap.length === 0) return;
    swapMode = false;
    swapSelected = {};
    submitSwap(tilesToSwap);
  }

  async function submitSwap(tilesToSwap) {
    if (submitInFlight) return;
    var gs = localSession._rawGameState;
    if (!gs) return;
    var C = window.AMath.constants;
    if ((gs.bag.tiles || []).length < (C.SWAP_FORBIDDEN_BAG_THRESHOLD + 1)) {
      alert('Swap not allowed: bag has ≤' + C.SWAP_FORBIDDEN_BAG_THRESHOLD + ' tiles remaining.');
      return;
    }
    submitInFlight = true;

    var myRackKey = (myRole === 'host') ? 'hostRack' : 'guestRack';
    var newRack = JSON.parse(JSON.stringify(gs[myRackKey]));
    var newBag = JSON.parse(JSON.stringify(gs.bag));

    // Remove the to-swap tiles from rack
    for (var i = 0; i < tilesToSwap.length; i++) {
      var idx = -1;
      for (var j = 0; j < newRack.tiles.length; j++) {
        if (newRack.tiles[j].id === tilesToSwap[i].id) { idx = j; break; }
      }
      if (idx >= 0) newRack.tiles.splice(idx, 1);
    }
    // Return swapped tiles to bag (fresh — clear assigned)
    for (var k = 0; k < tilesToSwap.length; k++) {
      var orig = tilesToSwap[k];
      newBag.tiles.push({
        id: orig.id, face: orig.face, type: orig.type,
        points: orig.points, assigned: null,
      });
      // Drop the swapped tile's slot mapping so the slot becomes available
      if (newRack.slotMap) delete newRack.slotMap[orig.id];
    }
    // Shuffle bag (simple Fisher-Yates)
    for (var s = newBag.tiles.length - 1; s > 0; s--) {
      var swapIdx = Math.floor(Math.random() * (s + 1));
      var tmp = newBag.tiles[s]; newBag.tiles[s] = newBag.tiles[swapIdx]; newBag.tiles[swapIdx] = tmp;
    }
    // Refill rack from bag, assigning fresh tiles to vacated slots so the
    // visual rack stays slot-stable.
    if (!newRack.slotMap) newRack.slotMap = {};
    while (newRack.tiles.length < 8 && newBag.tiles.length > 0) {
      var freshTile = newBag.tiles.pop();
      newRack.tiles.push(freshTile);
      var usedSlotsSwap = {};
      for (var sk2 in newRack.slotMap) usedSlotsSwap[newRack.slotMap[sk2]] = true;
      for (var si2 = 0; si2 < 8; si2++) {
        if (!usedSlotsSwap[si2]) { newRack.slotMap[freshTile.id] = si2; break; }
      }
    }

    var newConsec = (gs.consecutiveNonScoring || 0) + 1;
    var newTurn = (gs.turn === 'host') ? 'guest' : 'host';
    var gameOver = newConsec >= 6;
    var moveRec = buildMoveRecord(gs, { who: myRole, type: 'swap', count: tilesToSwap.length });
    var newMoves = (gs.moves || []).slice();
    newMoves.push(moveRec);
    var newGs = Object.assign({}, gs, {
      bag: newBag,
      turn: newTurn,
      consecutiveNonScoring: newConsec,
      lastMove: { who: myRole, type: 'swap', count: tilesToSwap.length, timestamp: Date.now() },
      moves: newMoves,
      moveCount: (gs.moveCount || 0) + 1,
      gameOver: gameOver,
      prevPlayState: null,  // swap clears the last challengeable play
    });
    newGs[myRackKey] = newRack;
    var update = { gameState: newGs, turn: newTurn };
    if (gameOver) {
      newGs.winner = newGs.hostScore > newGs.guestScore ? 'host'
                   : newGs.guestScore > newGs.hostScore ? 'guest' : 'tie';
      newGs.endReason = '6_consecutive_passes';
      update.status = 'finished';
      update.winner = newGs.winner;
    }
    tentativePlacements = [];
    selectedTileId = null;
    try {
      await window.AMath.onlineRoom.updateRoom(roomCode, update);
      if (gameOver) await saveReplayDoc(newGs, roomData);
      try {
        if (window.AMath.sounds && window.AMath.sounds.pass) window.AMath.sounds.pass();
        var myScore = (myRole === 'host') ? (newGs.hostScore || 0) : (newGs.guestScore || 0);
        if (window.AMath.scoreSheet) {
          window.AMath.scoreSheet.recordTurn('player', 'swap', 0, false, myScore,
            { swapCount: tilesToSwap.length });
        }
        if (window.AMath.gameLog) {
          window.AMath.gameLog.log('You swapped ' + tilesToSwap.length + ' tiles');
        }
      } catch (e) { /* non-fatal */ }
    } catch (err) {
      alert('Swap failed: ' + err.message);
    } finally {
      submitInFlight = false;
    }
  }

  /**
   * Submit the current tentative placements as a real move.
   * Validates with Placement.validatePlay, scores with Scoring.scorePlay,
   * then writes the new gameState to Firestore.
   */
  async function onSubmitClick() {
    if (submitInFlight) return;
    if (!localSession || !localSession.isPlayerTurn) return;
    // In swap mode, Submit confirms the swap selection
    if (swapMode) { confirmSwapFromMode(); return; }
    if (tentativePlacements.length === 0) return;
    var Placement = window.AMath.placement;
    var Scoring = window.AMath.scoring;
    if (!Placement || !Scoring) {
      alert('Game modules not loaded — please refresh.');
      return;
    }
    // Build placements payload (tiles must reference live board tiles which
    // we already inserted in placeTentative)
    var placementsToValidate = tentativePlacements.map(function (p) {
      return { row: p.row, col: p.col, tile: p.tile };
    });
    var validation = Placement.validatePlay(
      localSession.board, placementsToValidate, localSession.isFirstMove
    );
    if (!validation.ok) {
      alert('Invalid move: ' + (validation.reason || 'unknown'));
      return;
    }
    var scoreResult = Scoring.scorePlay(
      validation.equations, localSession.board, placementsToValidate.length
    );

    submitInFlight = true;

    // Build the new gameState reflecting the committed move
    var gs = localSession._rawGameState;
    var newBoard = serializeBoard(localSession.board);
    // Mark premium-used on the freshly-placed cells. newBoard.cells is a
    // FLAT 1D array (Firestore constraint — no nested arrays), so look up
    // each placed cell by scanning for matching r/c, NOT by [r][c] indexing.
    var placedKey = {};
    for (var pi = 0; pi < placementsToValidate.length; pi++) {
      placedKey[placementsToValidate[pi].row + ',' + placementsToValidate[pi].col] = true;
    }
    for (var ci = 0; ci < newBoard.cells.length; ci++) {
      var fc = newBoard.cells[ci];
      if (placedKey[fc.r + ',' + fc.c]) fc.premiumUsed = true;
    }

    var myRackKey = (myRole === 'host') ? 'hostRack' : 'guestRack';
    // Start from the snapshot rack (still has all 8 tiles) and REMOVE the
    // tiles that just got placed on the board. Otherwise the rack would
    // still have them after submit, and the refill would never trigger
    // since the rack count is already 8.
    var newRack = JSON.parse(JSON.stringify(gs[myRackKey]));
    var placedTileIds = {};
    for (var ti = 0; ti < placementsToValidate.length; ti++) {
      placedTileIds[placementsToValidate[ti].tile.id] = true;
    }
    newRack.tiles = newRack.tiles.filter(function (t) {
      return !placedTileIds[t.id];
    });
    if (!newRack.slotMap) newRack.slotMap = {};
    // Drop slot mappings for the placed tiles so their slots are reusable
    for (var pid in placedTileIds) delete newRack.slotMap[pid];

    var newBag = JSON.parse(JSON.stringify(gs.bag));
    // Refill rack from bag up to 8, assigning each new tile to an empty slot
    // so UI.renderRack (slot-stable) shows it in a stable position.
    while (newRack.tiles.length < 8 && newBag.tiles.length > 0) {
      var t = newBag.tiles.pop();
      newRack.tiles.push(t);
      // Find lowest empty slot 0..7
      var usedSlots = {};
      for (var sk in newRack.slotMap) usedSlots[newRack.slotMap[sk]] = true;
      for (var si = 0; si < 8; si++) {
        if (!usedSlots[si]) { newRack.slotMap[t.id] = si; break; }
      }
    }

    // Update scores
    var newHostScore = gs.hostScore || 0;
    var newGuestScore = gs.guestScore || 0;
    if (myRole === 'host') newHostScore += scoreResult.total;
    else newGuestScore += scoreResult.total;

    // Equations encoded as comma-separated face strings (e.g. '3,+,10,=,13').
    // CRITICAL: must NOT be an array-of-arrays — Firestore rejects nested
    // arrays. Comma preserves multi-character faces like '10' and '12'
    // (no face contains a comma). Decoded on read via .split(',').
    var equationFaces = (validation.equations || []).map(function (eq) {
      return eq.map(function (c) {
        return c.tile ? (c.tile.assigned || c.tile.face) : '?';
      }).join(',');
    });

    var isBingo = scoreResult.bingoBonus > 0;
    var playPlacements = placementsToValidate.map(function (p) {
      return {
        r: p.row, c: p.col,
        f: p.tile.face,
        p: p.tile.points,
        ty: p.tile.type,
        a: p.tile.assigned || null,
      };
    });

    // Append move record for replay
    var moveRec = buildMoveRecord(gs, {
      who: myRole,
      type: 'play',
      score: scoreResult.total,
      bingo: isBingo,
      placements: playPlacements,
      equations: equationFaces,
    });
    var newMoves = (gs.moves || []).slice();
    newMoves.push(moveRec);

    var newTurn = (gs.turn === 'host') ? 'guest' : 'host';
    var newHostBingos = gs.hostBingos || 0;
    var newGuestBingos = gs.guestBingos || 0;
    if (isBingo) {
      if (myRole === 'host') newHostBingos++;
      else newGuestBingos++;
    }

    // Pre-play snapshot — captured so the opposing player can challenge this
    // play and revert it on the next turn. Replaced on every play, so only
    // the MOST RECENT play is challengeable (matching PvA behavior).
    // Stored compactly: just what's needed to undo the play.
    var prevPlayState = {
      // Pre-play scores so we know how much to subtract
      hostScore: gs.hostScore || 0,
      guestScore: gs.guestScore || 0,
      hostBingos: gs.hostBingos || 0,
      guestBingos: gs.guestBingos || 0,
      // Pre-play rack of the player who made the play (so we can restore
      // the tiles they used + drop the refill tiles back to the bag).
      // The other rack is unchanged on a play, no need to snapshot it.
      playerRack: gs[myRackKey],
      // Bag state pre-play
      bag: gs.bag,
      // Pre-play board's premiumUsed flags for cells the play covered
      // (so the new tiles are removed AND the premium gets re-armed).
      // Read from the live 2D board we already reconstructed locally, since
      // the doc's gs.board.cells is a flat 1D array (Firestore constraint).
      premiumUsedRestore: playPlacements.map(function (p) {
        var liveCell = localSession.board
                       && localSession.board.cells[p.r]
                       && localSession.board.cells[p.r][p.c];
        return { r: p.r, c: p.c, premiumUsed: !!(liveCell && liveCell.premiumUsed) };
      }),
      isFirstMove: gs.isFirstMove,
      // Who made the play (for revert: their score goes down, their rack restored)
      who: myRole,
      // The tiles placed on the board (full tile objects so we can identify them)
      placedTiles: placementsToValidate.map(function (p) {
        return { row: p.row, col: p.col, tile: JSON.parse(JSON.stringify(p.tile)) };
      }),
    };

    var newGs = Object.assign({}, gs, {
      board: newBoard,
      bag: newBag,
      hostScore: newHostScore,
      guestScore: newGuestScore,
      hostBingos: newHostBingos,
      guestBingos: newGuestBingos,
      turn: newTurn,
      isFirstMove: false,
      consecutiveNonScoring: 0,
      lastMove: {
        who: myRole,
        type: 'play',
        score: scoreResult.total,
        bingo: isBingo,
        placements: playPlacements,
        equations: equationFaces,
        timestamp: Date.now(),
      },
      moves: newMoves,
      moveCount: (gs.moveCount || 0) + 1,
      prevPlayState: prevPlayState,
    });
    newGs[myRackKey] = newRack;

    // Endgame check: rack empty + bag empty
    var rackEmpty = newRack.tiles.length === 0;
    var bagEmpty = newBag.tiles.length === 0;
    var update = {
      gameState: newGs,
      turn: newTurn,
      hostScore: newHostScore,
      guestScore: newGuestScore,
    };
    if (rackEmpty && bagEmpty) {
      // Other side's remaining rack points go to the player who emptied
      var oppRackKey = (myRole === 'host') ? 'guestRack' : 'hostRack';
      var oppRackPoints = 0;
      var oppRack = newGs[oppRackKey];
      for (var op = 0; op < oppRack.tiles.length; op++) {
        oppRackPoints += oppRack.tiles[op].points || 0;
      }
      if (myRole === 'host') {
        newGs.hostScore = newHostScore + oppRackPoints * 2;
        update.hostScore = newGs.hostScore;
      } else {
        newGs.guestScore = newGuestScore + oppRackPoints * 2;
        update.guestScore = newGs.guestScore;
      }
      newGs.gameOver = true;
      newGs.winner = newGs.hostScore > newGs.guestScore ? 'host'
                   : newGs.guestScore > newGs.hostScore ? 'guest' : 'tie';
      newGs.endReason = 'rack_emptied';
      update.status = 'finished';
      update.winner = newGs.winner;
    }

    tentativePlacements = [];
    selectedTileId = null;
    try {
      await window.AMath.onlineRoom.updateRoom(roomCode, update);
      if (update.status === 'finished') await saveReplayDoc(newGs, roomData);
      // Side effects for MY play (sound + score sheet + game log). Opponent
      // moves fire similar effects via handleOpponentMoveArrived.
      try {
        if (window.AMath.sounds && window.AMath.sounds.submitSuccess) {
          window.AMath.sounds.submitSuccess();
        }
        var myScoreField = (myRole === 'host') ? newHostScore : newGuestScore;
        if (window.AMath.scoreSheet) {
          window.AMath.scoreSheet.recordTurn('player', 'play', scoreResult.total,
            isBingo, myScoreField);
        }
        if (window.AMath.gameLog) {
          window.AMath.gameLog.log('You played +' + scoreResult.total + 'pts ('
            + placementsToValidate.length + ' tiles)' + (isBingo ? ' 🎉 BINGO' : ''));
        }
      } catch (e) { /* non-fatal */ }
    } catch (err) {
      alert('Submit failed: ' + err.message);
    } finally {
      submitInFlight = false;
    }
  }

  /**
   * Challenge the opponent's last play. Walks the equations stashed in
   * lastMove and runs each through Evaluator.validateEquation.
   *   - Any invalid equation → opponent's play is reverted (tiles back to
   *     their rack, score subtracted, board cleaned, premium re-armed). They
   *     LOSE the play; turn stays on me.
   *   - All equations valid → I lose my turn as the penalty (challenge missed).
   *
   * Matches the PvA challenge semantics.
   */
  async function onChallengeClick() {
    if (submitInFlight) return;
    if (!localSession || !localSession.isPlayerTurn) return;
    var gs = localSession._rawGameState;
    if (!gs || !gs.prevPlayState || !gs.lastMove
        || gs.lastMove.type !== 'play'
        || gs.prevPlayState.who === myRole) return;

    if (!confirm('Challenge opponent\'s last play?\n\n' +
                 '• If invalid → their play is reverted and you keep your turn.\n' +
                 '• If valid → you lose your turn as the penalty.\n\n' +
                 'Proceed?')) return;

    var Evaluator = window.AMath.evaluator;
    if (!Evaluator || !Evaluator.validateEquation) {
      alert('Evaluator not loaded.');
      return;
    }

    submitInFlight = true;
    try {
      // Validate each equation. Replay schema stores each equation as a
      // comma-encoded face string (e.g. '3,+,4,=,7'). Split before
      // handing to Evaluator.validateEquation which wants an array of faces.
      var equations = gs.lastMove.equations || [];
      var badReason = null;
      for (var i = 0; i < equations.length; i++) {
        var encoded = equations[i];
        if (!encoded) continue;
        // Be defensive — old docs may still hold the broken nested-array
        // shape (Array<Array>). If we see an array, use it as-is.
        var faces = (typeof encoded === 'string') ? encoded.split(',') : encoded;
        if (!faces || !faces.length) continue;
        var res = Evaluator.validateEquation(faces);
        if (!res.valid) { badReason = res.reason || 'invalid'; break; }
      }

      if (badReason) {
        await revertOpponentPlay(gs, badReason);
      } else {
        await loseChallengePenalty(gs);
      }
    } catch (err) {
      console.error('[OnlineGame] challenge error', err);
      alert('Challenge failed: ' + err.message);
    } finally {
      submitInFlight = false;
    }
  }

  /**
   * Build a reverted gameState: opponent's last play is undone.
   * - Their score goes back to pre-play
   * - Their rack restored to pre-play (the tiles they USED come back; refill
   *   tiles go back to the bag — we just snapshot-restore both)
   * - Board's placed tiles removed, premiumUsed restored to pre-play
   * - Bingo counters rolled back if applicable
   * - lastMove updated to reflect the challenge result
   * - prevPlayState cleared (no challenge-after-challenge)
   * - Turn stays on me (challenger keeps the turn)
   */
  async function revertOpponentPlay(gs, reason) {
    var prev = gs.prevPlayState;
    var oppRole = prev.who;
    var oppRackKey = (oppRole === 'host') ? 'hostRack' : 'guestRack';

    // Deep-clone the board so we can mutate cells.
    var newBoard = JSON.parse(JSON.stringify(gs.board));

    for (var i = 0; i < prev.premiumUsedRestore.length; i++) {
      var rec = prev.premiumUsedRestore[i];
      newBoard.cells[rec.r][rec.c].tile = null;
      newBoard.cells[rec.r][rec.c].premiumUsed = rec.premiumUsed;
    }

    var newGs = Object.assign({}, gs, {
      board: newBoard,
      bag: JSON.parse(JSON.stringify(prev.bag)),
      hostScore: prev.hostScore,
      guestScore: prev.guestScore,
      hostBingos: prev.hostBingos,
      guestBingos: prev.guestBingos,
      isFirstMove: prev.isFirstMove,
      lastMove: {
        who: myRole,
        type: 'challenge_won',
        challengedReason: reason,
        timestamp: Date.now(),
      },
      moves: (gs.moves || []).concat([{
        t: gs.startedAt ? (Date.now() - gs.startedAt) : 0,
        who: myRole,
        type: 'challenge_won',
        reason: reason,
      }]),
      moveCount: (gs.moveCount || 0) + 1,
      prevPlayState: null,
    });
    newGs[oppRackKey] = JSON.parse(JSON.stringify(prev.playerRack));

    await window.AMath.onlineRoom.updateRoom(roomCode, {
      gameState: newGs,
      hostScore: newGs.hostScore,
      guestScore: newGs.guestScore,
      turn: gs.turn,
    });
  }

  /**
   * Challenge missed: opponent's play was valid. I lose my turn.
   * Turn flips back to opponent. Counts as a non-scoring turn.
   */
  async function loseChallengePenalty(gs) {
    var newTurn = (gs.turn === 'host') ? 'guest' : 'host';
    var newConsec = (gs.consecutiveNonScoring || 0) + 1;
    var gameOver = newConsec >= 6;
    var newGs = Object.assign({}, gs, {
      turn: newTurn,
      consecutiveNonScoring: newConsec,
      lastMove: {
        who: myRole,
        type: 'challenge_failed',
        timestamp: Date.now(),
      },
      moves: (gs.moves || []).concat([{
        t: gs.startedAt ? (Date.now() - gs.startedAt) : 0,
        who: myRole,
        type: 'challenge_failed',
      }]),
      moveCount: (gs.moveCount || 0) + 1,
      gameOver: gameOver,
      prevPlayState: null,
    });
    var update = { gameState: newGs, turn: newTurn };
    if (gameOver) {
      newGs.winner = newGs.hostScore > newGs.guestScore ? 'host'
                   : newGs.guestScore > newGs.hostScore ? 'guest' : 'tie';
      newGs.endReason = '6_consecutive_passes';
      update.status = 'finished';
      update.winner = newGs.winner;
    }
    await window.AMath.onlineRoom.updateRoom(roomCode, update);
    if (gameOver) await saveReplayDoc(newGs, roomData);
  }

  /**
   * Picker popup for BLANK / +/- / ×÷ tiles.
   * Calls callback(face) with the chosen face, or callback(null) on cancel.
   */
  function showFacePicker(tile, callback) {
    var C = window.AMath.constants;
    var choices;
    if (tile.type === 'choice') {
      choices = tile.face === '+/-' ? ['+', '-'] : ['×', '÷'];
    } else {
      // BLANK — full inventory faces
      choices = (C && C.getBlankChoices) ? C.getBlankChoices() : C.BLANK_CHOICES;
    }

    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;' +
      'display:flex;align-items:center;justify-content:center;';
    var card = document.createElement('div');
    card.style.cssText =
      'background:#1e293b;padding:18px;border-radius:12px;max-width:340px;width:90%;';
    card.innerHTML = '<div style="font-weight:700;margin-bottom:10px;">Choose face for ' +
      escapeHtml(tile.face) + ':</div>';
    var grid = document.createElement('div');
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:6px;';
    for (var i = 0; i < choices.length; i++) {
      (function (face) {
        var btn = document.createElement('button');
        btn.textContent = face;
        btn.style.cssText =
          'background:#fef3c7;color:#1e293b;border:1px solid #fbbf24;border-radius:6px;' +
          'padding:10px;font-size:16px;font-weight:700;cursor:pointer;';
        btn.onclick = function () {
          document.body.removeChild(overlay);
          callback(face);
        };
        grid.appendChild(btn);
      })(choices[i]);
    }
    card.appendChild(grid);
    var cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText =
      'margin-top:12px;width:100%;background:#334155;color:#e2e8f0;border:none;' +
      'padding:8px;border-radius:6px;cursor:pointer;';
    cancel.onclick = function () {
      document.body.removeChild(overlay);
      callback(null);
    };
    card.appendChild(cancel);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function renderLastMove() {
    var el = document.getElementById('online-last-move');
    if (!el) return;
    var lm = localSession.lastMove;
    if (!lm) { el.textContent = ''; return; }
    var who = (lm.who === myRole) ? 'You' : 'Opponent';
    if (lm.type === 'pass') el.textContent = who + ' passed.';
    else if (lm.type === 'swap') el.textContent = who + ' swapped ' + (lm.count || 0) + ' tiles.';
    else if (lm.type === 'play') el.textContent = who + ' played for ' + (lm.score || 0) + ' pts.';
    else if (lm.type === 'challenge_won') {
      el.innerHTML = '⚖️ <b>' + who + ' challenged successfully</b> — opponent\u2019s play was reverted' +
                     (lm.challengedReason ? ' (' + escapeHtml(lm.challengedReason) + ')' : '') + '.';
    } else if (lm.type === 'challenge_failed') {
      el.innerHTML = '⚖️ <b>' + who + ' challenged and lost</b> — opponent\u2019s play stood; turn forfeited.';
    }
  }

  function renderGameEnd(data) {
    var el = document.getElementById('online-last-move');
    if (!el) return;
    var gs = data.gameState;
    el.innerHTML =
      '<div style="background:#1e293b;padding:14px;border-radius:8px;text-align:center;margin-top:10px;">' +
      '<div style="font-size:18px;font-weight:700;color:#fbbf24;">Game over</div>' +
      '<div>Winner: ' + escapeHtml(gs.winner === 'host' ? data.hostName : gs.winner === 'guest' ? data.guestName : 'Tie') + '</div>' +
      '<div style="margin-top:6px;font-size:13px;color:#94a3b8;">' +
      'Final: ' + gs.hostScore + ' (host) – ' + gs.guestScore + ' (guest)</div>' +
      '<button id="online-show-sheet" style="margin-top:10px;background:#fbbf24;color:#1e293b;' +
        'border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:700;' +
        'margin-right:8px;">📊 Score Sheet</button>' +
      '<button id="online-show-log" style="margin-top:10px;background:#334155;color:#e2e8f0;' +
        'border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;' +
        'margin-right:8px;">📜 Game Log</button>' +
      '<a href="lobby.html" style="color:#fbbf24;display:inline-block;margin-top:10px;">Back to lobby</a>' +
      '</div>';
    var sheetBtn = document.getElementById('online-show-sheet');
    if (sheetBtn) {
      sheetBtn.onclick = function () {
        if (window.AMath.scoreSheet && window.AMath.scoreSheet.showPopup) {
          var myScoreEnd = (myRole === 'host') ? gs.hostScore : gs.guestScore;
          var oppScoreEnd = (myRole === 'host') ? gs.guestScore : gs.hostScore;
          window.AMath.scoreSheet.showPopup(myScoreEnd, oppScoreEnd);
        }
      };
    }
    var logBtn = document.getElementById('online-show-log');
    if (logBtn) {
      logBtn.onclick = function () {
        if (window.AMath.gameLog && window.AMath.gameLog.show) {
          window.AMath.gameLog.show();
        } else if (window.AMath.gameLog && window.AMath.gameLog.exportLog) {
          // Fallback: open as text
          var txt = window.AMath.gameLog.exportLog();
          var w = window.open('', '_blank');
          if (w) {
            w.document.body.innerHTML = '<pre style="white-space:pre-wrap;font-family:monospace;">'
              + escapeHtml(txt) + '</pre>';
          }
        }
      };
    }
  }

  // -----------------------------------------------------------------------
  // MOVES
  // -----------------------------------------------------------------------

  async function onPassClick() {
    if (!localSession || !localSession.isPlayerTurn) return;
    var gs = localSession._rawGameState;
    var newConsec = (gs.consecutiveNonScoring || 0) + 1;
    var newTurn = (gs.turn === 'host') ? 'guest' : 'host';
    var gameOver = newConsec >= 6;

    var moveRec = buildMoveRecord(gs, { who: myRole, type: 'pass' });
    var newMoves = (gs.moves || []).slice();
    newMoves.push(moveRec);

    var update = {
      gameState: Object.assign({}, gs, {
        turn: newTurn,
        consecutiveNonScoring: newConsec,
        lastMove: {
          who: myRole,
          type: 'pass',
          timestamp: Date.now(),
        },
        moves: newMoves,
        moveCount: (gs.moveCount || 0) + 1,
        gameOver: gameOver,
        prevPlayState: null,  // pass clears the last challengeable play
      }),
      turn: newTurn,
    };
    if (gameOver) {
      // 6-pass end: nobody wins (or use rack-point tiebreak — keep simple)
      var winner = gs.hostScore > gs.guestScore ? 'host'
                 : gs.guestScore > gs.hostScore ? 'guest' : 'tie';
      update.gameState.winner = winner;
      update.gameState.endReason = '6_consecutive_passes';
      update.status = 'finished';
      update.winner = winner;
    }
    try {
      await window.AMath.onlineRoom.updateRoom(roomCode, update);
      if (gameOver) await saveReplayDoc(update.gameState, roomData);
      try {
        if (window.AMath.sounds && window.AMath.sounds.pass) window.AMath.sounds.pass();
        var myScoreP = (myRole === 'host') ? (gs.hostScore || 0) : (gs.guestScore || 0);
        if (window.AMath.scoreSheet) {
          window.AMath.scoreSheet.recordTurn('player', 'pass', 0, false, myScoreP);
        }
        if (window.AMath.gameLog) {
          window.AMath.gameLog.log('You passed');
        }
      } catch (e) { /* non-fatal */ }
    } catch (err) {
      alert('Failed to send pass: ' + err.message);
    }
  }

  // -----------------------------------------------------------------------
  // UTILS
  // -----------------------------------------------------------------------

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Build a compact move record in the same shape used by replay-recorder.js,
   * so the saved replay docs are compatible with replay-player.js.
   * @param gs current gameState (pre-move) — used to compute t-offset from start
   */
  function buildMoveRecord(gs, info) {
    var t = gs.startedAt ? (Date.now() - gs.startedAt) : 0;
    var move = { t: t, who: info.who, type: info.type };
    if (info.type === 'play') {
      move.score = info.score || 0;
      move.bingo = !!info.bingo;
      move.placements = info.placements || [];
      if (info.equations) move.equations = info.equations;
    } else if (info.type === 'swap') {
      move.count = info.count || 0;
    }
    return move;
  }

  /**
   * After a game finishes, save it as a `games/{id}` doc so it appears in
   * Recent Games and is playable in replay.html. Called by both players;
   * idempotent-ish (we tag the doc with roomCode so dedup is possible later).
   */
  async function saveReplayDoc(gs, data) {
    if (!window.AMathBridge || !window.AMathBridge.saveReplay) return;
    // The bridge attaches userId/displayName/photoURL of the CALLER, so each
    // side saves its own replay. That's deliberate — each player's Recent
    // Games tab shows the game from their perspective.
    var isHost = (myRole === 'host');
    var doc = {
      // Replay schema fields used by replay-player.js
      startedAt: gs.startedAt || Date.now(),
      tileSet: roomData && roomData.tileSet || 'prathom',
      botLevel: 'online',
      isPvP: false,
      moves: gs.moves || [],
      playerScore: isHost ? gs.hostScore : gs.guestScore,
      aiScore: isHost ? gs.guestScore : gs.hostScore,
      won: (gs.winner === myRole),
      bingos: isHost ? (gs.hostBingos || 0) : (gs.guestBingos || 0),
      // Extra metadata so users can tell this was an online game
      online: true,
      opponentName: isHost ? data.guestName : data.hostName,
      roomCode: roomCode,
    };
    try {
      var id = await window.AMathBridge.saveReplay(doc);
      console.log('[OnlineGame] Replay saved as ' + id);
    } catch (err) {
      console.error('[OnlineGame] saveReplay failed', err);
    }
  }

  // -----------------------------------------------------------------------
  // ACHIEVEMENTS + STATS
  // -----------------------------------------------------------------------

  /**
   * Detect a ×9 play. Same rule as PvA (isX9Play in main.js):
   * a single play that places 2+ NEW tiles on 3E (triple-equation) squares
   * creates a 9× multiplier.
   *
   * @param {Array} placements - compact [{r,c,...}] from a play move
   * @returns {boolean}
   */
  function isX9Move(placements) {
    if (!placements || placements.length < 2) return false;
    var C = window.AMath.constants;
    var squares = C && C.PREMIUM_SQUARES;
    if (!squares) return false;
    var count = 0;
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      var row = squares[p.r];
      if (row && row[p.c] === '3E') {
        count++;
        if (count >= 2) return true;
      }
    }
    return false;
  }

  /**
   * After game end, compute per-player stats from gameState.moves[] and
   * write them via the existing AMathBridge.saveGameResult — same code path
   * as PvA, so achievements unlock and lifetime stats update identically.
   *
   * Only fires when the local user is authenticated (signed-in players).
   * Online games for guests are not tracked, consistent with PvA behavior.
   */
  async function finalizeOnlineStats(gs, data) {
    if (!window.AMathBridge || !window.AMathBridge.saveGameResult) return;
    if (window.AMathBridge.isGuest && window.AMathBridge.isGuest()) return;

    var isHost = (myRole === 'host');
    var myScore = isHost ? gs.hostScore : gs.guestScore;
    var oppScore = isHost ? gs.guestScore : gs.hostScore;
    var myBingos = isHost ? (gs.hostBingos || 0) : (gs.guestBingos || 0);
    var won = (gs.winner === myRole);

    // Walk moves[] and count my actions / x9 plays
    var myPlays = 0, mySwaps = 0, myX9 = 0;
    var moves = gs.moves || [];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      if (m.who !== myRole) continue;
      if (m.type === 'play') {
        myPlays++;
        if (isX9Move(m.placements)) myX9++;
      } else if (m.type === 'swap') {
        mySwaps++;
      }
    }

    var payload = {
      playerScore: myScore,
      aiScore: oppScore,
      won: won,
      bingos: myBingos,
      x9plays: myX9,
      maxDeficit: myMaxDeficit,
      swapCount: mySwaps,
      playsMade: myPlays,
      gameDurationMs: gs.startedAt ? (Date.now() - gs.startedAt) : 0,
    };

    try {
      await window.AMathBridge.saveGameResult(payload);
      console.log('[OnlineGame] Stats saved:', payload);
    } catch (err) {
      console.error('[OnlineGame] saveGameResult failed', err);
    }
  }

  // -----------------------------------------------------------------------
  // EXPORTS / BOOT
  // -----------------------------------------------------------------------

  window.AMath = window.AMath || {};
  window.AMath.onlineGame = {
    boot: boot,
    getRoomCode: function () { return roomCode; },
    getRole: function () { return myRole; },
    getRoomData: function () { return roomData; },
    toggleChat: toggleChat,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.addEventListener('beforeunload', function () {
    if (unsubscribe) unsubscribe();
  });
})();
