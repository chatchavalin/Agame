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
      rebuildLocalSession(data.gameState);
      renderGameUI();
    }

    if (data.status === 'finished' && data.gameState) {
      rebuildLocalSession(data.gameState);
      renderGameUI();
      renderGameEnd(data);
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
    };

    await window.AMath.onlineRoom.updateRoom(roomCode, {
      status: 'playing',
      gameState: initialState,
      turn: 'host',
      hostScore: 0,
      guestScore: 0,
    });
  }

  function serializeBoard(board) {
    // Strip non-serializable bits; cells are plain objects already
    var out = { cells: [] };
    for (var r = 0; r < board.cells.length; r++) {
      var row = [];
      for (var c = 0; c < board.cells[r].length; c++) {
        var cell = board.cells[r][c];
        row.push({
          row: cell.row, col: cell.col,
          premium: cell.premium || null,
          premiumUsed: !!cell.premiumUsed,
          tile: cell.tile || null,
        });
      }
      out.cells.push(row);
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // STATE → LOCAL SESSION
  // -----------------------------------------------------------------------

  function rebuildLocalSession(gs) {
    var C = window.AMath.constants;
    var Board = window.AMath.board;

    // Reconstruct board from serialized form (need a fresh board object that
    // matches what Board.createBoard returns — cell objects with full keys)
    var board = Board.createBoard();
    for (var r = 0; r < C.BOARD_SIZE; r++) {
      for (var c = 0; c < C.BOARD_SIZE; c++) {
        var saved = gs.board.cells[r][c];
        var live = board.cells[r][c];
        live.tile = saved.tile || null;
        live.premiumUsed = !!saved.premiumUsed;
      }
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

    localSession = {
      board: board,
      bag: gs.bag,
      playerRack: myRack,    // interactions.js expects this name
      aiRack: oppRack,       // opponent rack — visible face-down to player
      isOnline: true,        // marker for our specialized code paths
      onlineRole: myRole,
      tentativePlacements: [],
      selectedTileId: null,
      playerScore: myScore,
      aiScore: oppScore,
      isFirstMove: gs.isFirstMove,
      gameOver: gs.gameOver,
      consecutiveNonScoringTurns: gs.consecutiveNonScoring || 0,
      isPlayerTurn: myTurn,
      lastMove: gs.lastMove || null,
      _rawGameState: gs, // raw doc for write-back later
    };
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
  }

  function renderGameUI() {
    var UI = window.AMath.ui;
    var container = document.getElementById('room-content');
    if (!container) return;

    if (!container.dataset.online === 'true') {
      container.dataset.online = 'true';
    }

    container.innerHTML =
      '<div id="online-board-container" style="margin:10px 0;"></div>' +
      '<div id="online-rack-container" style="margin:10px 0;"></div>' +
      '<div id="online-action-buttons" style="display:flex;gap:6px;justify-content:center;margin:8px 0;flex-wrap:wrap;"></div>' +
      '<div id="online-last-move" style="margin:8px 0;font-size:13px;color:#94a3b8;"></div>';

    var boardEl = document.getElementById('online-board-container');
    if (UI && UI.renderBoard) UI.renderBoard(localSession.board, boardEl);

    renderMyRack();
    renderActionButtons();
    renderLastMove();
  }

  function renderMyRack() {
    var UI = window.AMath.ui;
    var rackEl = document.getElementById('online-rack-container');
    if (!rackEl) return;

    var label = document.createElement('div');
    label.style.cssText = 'font-size:12px;color:#94a3b8;margin-bottom:4px;';
    label.textContent = localSession.isPlayerTurn ? 'Your tiles — your turn' : 'Your tiles — waiting on opponent';
    rackEl.innerHTML = '';
    rackEl.appendChild(label);

    var rackWrap = document.createElement('div');
    rackWrap.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;background:#1e293b;padding:8px;border-radius:8px;';
    var tiles = (localSession.playerRack && localSession.playerRack.tiles) || [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var tileEl = document.createElement('div');
      tileEl.className = 'amath-tile';
      tileEl.dataset.tileId = t.id;
      // Reuse the UI's renderTile if available
      if (UI && UI.renderBoard) {
        // simpler: just create a basic tile DOM here
        tileEl.style.cssText =
          'width:40px;height:40px;background:#fef3c7;color:#1e293b;border-radius:6px;' +
          'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;';
        tileEl.textContent = t.assigned || t.face;
      }
      rackWrap.appendChild(tileEl);
    }
    rackEl.appendChild(rackWrap);
  }

  function renderActionButtons() {
    var btns = document.getElementById('online-action-buttons');
    if (!btns) return;
    var myTurn = localSession.isPlayerTurn;
    btns.innerHTML =
      '<button class="replay-btn" id="online-btn-pass" ' + (myTurn ? '' : 'disabled') + '>Pass</button>' +
      '<button class="replay-btn" id="online-btn-swap" ' + (myTurn ? '' : 'disabled') + '>Swap…</button>' +
      '<button class="replay-btn replay-btn-primary" id="online-btn-submit" ' + (myTurn ? '' : 'disabled') + '>Submit move</button>';

    var passBtn = document.getElementById('online-btn-pass');
    var swapBtn = document.getElementById('online-btn-swap');
    var submitBtn = document.getElementById('online-btn-submit');
    if (passBtn) passBtn.onclick = onPassClick;
    if (swapBtn) swapBtn.onclick = function () { alert('Swap UI is not yet wired in the online MVP. Pass for now.'); };
    if (submitBtn) submitBtn.onclick = function () {
      alert('Move submission needs the placement UI — coming next. Use Pass to test the turn-flip flow.');
    };
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
      '<a href="lobby.html" style="color:#fbbf24;display:inline-block;margin-top:10px;">Back to lobby</a>' +
      '</div>';
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

    var update = {
      gameState: Object.assign({}, gs, {
        turn: newTurn,
        consecutiveNonScoring: newConsec,
        lastMove: {
          who: myRole,
          type: 'pass',
          timestamp: Date.now(),
        },
        moveCount: (gs.moveCount || 0) + 1,
        gameOver: gameOver,
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

  // -----------------------------------------------------------------------
  // EXPORTS / BOOT
  // -----------------------------------------------------------------------

  window.AMath = window.AMath || {};
  window.AMath.onlineGame = {
    boot: boot,
    getRoomCode: function () { return roomCode; },
    getRole: function () { return myRole; },
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
