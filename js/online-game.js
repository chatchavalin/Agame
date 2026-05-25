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
      moves: [],           // compact replay log; append on every action
      startedAt: Date.now(),
      hostBingos: 0,
      guestBingos: 0,
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
  }

  function renderGameUI() {
    var UI = window.AMath.ui;
    var container = document.getElementById('room-content');
    if (!container) return;

    container.innerHTML =
      '<div id="online-board-container" style="margin:10px 0;"></div>' +
      '<div id="online-rack-container" style="margin:10px 0;"></div>' +
      '<div id="online-action-buttons" style="display:flex;gap:6px;justify-content:center;margin:8px 0;flex-wrap:wrap;"></div>' +
      '<div id="online-last-move" style="margin:8px 0;font-size:13px;color:#94a3b8;"></div>';

    var boardEl = document.getElementById('online-board-container');
    if (UI && UI.renderBoard) UI.renderBoard(localSession.board, boardEl);

    // Wire board click handling for placement
    wireBoardClicks(boardEl);
    // Mark tentative tiles so the user can see what they've placed but not submitted
    highlightTentativeCells(boardEl);

    renderMyRack();
    renderActionButtons();
    renderLastMove();
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
    tentativePlacements.push({ row: row, col: col, tile: placed });
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
    tentativePlacements.splice(idx, 1);
    refreshUIWithoutSync();
  }

  function removeFromRackLocal(tileId) {
    var tiles = localSession.playerRack.tiles;
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].id === tileId) { tiles.splice(i, 1); return; }
    }
  }

  /**
   * Re-render after a purely local change (click-place, click-return).
   * Avoids round-trip to Firestore.
   */
  function refreshUIWithoutSync() {
    var UI = window.AMath.ui;
    var boardEl = document.getElementById('online-board-container');
    if (boardEl && UI && UI.renderBoard) {
      UI.renderBoard(localSession.board, boardEl);
      wireBoardClicks(boardEl);
      highlightTentativeCells(boardEl);
    }
    renderMyRack();
    renderActionButtons();
  }

  function renderMyRack() {
    var UI = window.AMath.ui;
    var rackEl = document.getElementById('online-rack-container');
    if (!rackEl) return;

    rackEl.innerHTML = '';

    var label = document.createElement('div');
    label.style.cssText = 'font-size:12px;color:#94a3b8;margin-bottom:4px;';
    label.textContent = localSession.isPlayerTurn
      ? 'Your tiles — click or drag a tile onto the board'
      : 'Your tiles — waiting on opponent';
    rackEl.appendChild(label);

    var rackWrap = document.createElement('div');
    rackWrap.id = 'online-rack-tiles';
    rackWrap.style.cssText =
      'display:flex;gap:4px;flex-wrap:wrap;background:#1e293b;padding:8px;border-radius:8px;' +
      'min-height:60px;touch-action:none;';

    var tiles = (localSession.playerRack && localSession.playerRack.tiles) || [];
    if (tiles.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:#64748b;font-size:12px;padding:4px;';
      empty.textContent = '(rack empty)';
      rackWrap.appendChild(empty);
    }
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var tileEl = UI && UI.renderTile ? UI.renderTile(t, false, false)
                                       : makeFallbackTile(t);
      tileEl.dataset.tileId = t.id;
      tileEl.style.cursor = localSession.isPlayerTurn ? 'pointer' : 'default';
      tileEl.style.touchAction = 'none';
      if (selectedTileId === t.id) {
        tileEl.style.outline = '3px solid #fbbf24';
      }
      (function (tid, tileNode) {
        // Click → toggle selection (existing behavior, still useful as a
        // fallback for users who prefer tap-to-place over drag).
        tileNode.addEventListener('click', function (ev) {
          if (!localSession.isPlayerTurn) return;
          // Don't fire click if we just finished a drag (handled by pointer code)
          if (tileNode.dataset.didDrag === '1') {
            tileNode.dataset.didDrag = '0';
            return;
          }
          selectedTileId = (selectedTileId === tid) ? null : tid;
          renderMyRack();
        });
        // Pointer-based drag from rack tile to board cell
        attachDragHandlers(tileNode, tid);
      })(t.id, tileEl);
      rackWrap.appendChild(tileEl);
    }
    rackEl.appendChild(rackWrap);
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
      // Allow primary button only (mouse) or any touch
      if (ev.button !== undefined && ev.button !== 0) return;
      dragging = true;
      moved = false;
      startX = ev.clientX;
      startY = ev.clientY;
      // Capture pointer so we keep receiving events even if it leaves the element
      try { tileEl.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
    }

    function onPointerMove(ev) {
      if (!dragging) return;
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return; // dead zone
      moved = true;
      if (!ghost) {
        // Create a floating clone the first time we move past the dead zone
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
      if (!didMove) return; // treat as click — let onClick handle
      // Mark so click handler doesn't double-fire
      tileEl.dataset.didDrag = '1';
      // Find the board cell under the pointer
      var dropTarget = document.elementFromPoint(ev.clientX, ev.clientY);
      while (dropTarget && !dropTarget.classList.contains('amath-cell')) {
        dropTarget = dropTarget.parentElement;
      }
      if (!dropTarget) return;
      var r = parseInt(dropTarget.dataset.row, 10);
      var c = parseInt(dropTarget.dataset.col, 10);
      if (isNaN(r) || isNaN(c)) return;
      // Reuse the click placement path
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

  function makeFallbackTile(t) {
    var d = document.createElement('div');
    d.className = 'amath-tile';
    d.style.cssText =
      'width:40px;height:40px;background:#fef3c7;color:#1e293b;border-radius:6px;' +
      'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;';
    d.textContent = t.assigned || t.face;
    return d;
  }

  function renderActionButtons() {
    var btns = document.getElementById('online-action-buttons');
    if (!btns) return;
    var myTurn = localSession.isPlayerTurn;
    var hasTentative = tentativePlacements.length > 0;
    btns.innerHTML =
      '<button class="replay-btn" id="online-btn-reset" ' + ((myTurn && hasTentative) ? '' : 'disabled') + '>Reset</button>' +
      '<button class="replay-btn" id="online-btn-pass" ' + (myTurn ? '' : 'disabled') + '>Pass</button>' +
      '<button class="replay-btn" id="online-btn-swap" ' + (myTurn ? '' : 'disabled') + '>Swap…</button>' +
      '<button class="replay-btn replay-btn-primary" id="online-btn-submit" ' + ((myTurn && hasTentative) ? '' : 'disabled') + '>Submit move</button>';

    var resetBtn = document.getElementById('online-btn-reset');
    var passBtn = document.getElementById('online-btn-pass');
    var swapBtn = document.getElementById('online-btn-swap');
    var submitBtn = document.getElementById('online-btn-submit');
    if (resetBtn) resetBtn.onclick = onResetClick;
    if (passBtn) passBtn.onclick = onPassClick;
    if (swapBtn) swapBtn.onclick = onSwapClick;
    if (submitBtn) submitBtn.onclick = onSubmitClick;
  }

  function onResetClick() {
    // Move all tentative tiles back to the rack
    for (var i = tentativePlacements.length - 1; i >= 0; i--) {
      returnTileToRack(i);
    }
  }

  function onSwapClick() {
    if (!localSession || !localSession.isPlayerTurn) return;
    var C = window.AMath.constants;
    var bagSize = (localSession._rawGameState.bag.tiles || []).length;
    if (bagSize < (C.SWAP_FORBIDDEN_BAG_THRESHOLD + 1)) {
      alert('Swap not allowed: bag has ' + bagSize + ' tile(s) remaining ' +
            '(minimum ' + (C.SWAP_FORBIDDEN_BAG_THRESHOLD + 1) + ' required).');
      return;
    }
    showSwapModal();
  }

  /**
   * Modal that lets the player tap tiles to add/remove them from a swap set,
   * then confirm. Replaces the previous prompt()-based picker.
   */
  function showSwapModal() {
    var UI = window.AMath.ui;
    var selected = {}; // tileId -> true
    var tiles = localSession.playerRack.tiles.slice();

    var overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;' +
      'display:flex;align-items:center;justify-content:center;padding:14px;';

    var card = document.createElement('div');
    card.style.cssText =
      'background:#1e293b;padding:18px;border-radius:12px;max-width:420px;' +
      'width:100%;color:#e2e8f0;';
    card.innerHTML =
      '<div style="font-weight:700;font-size:16px;margin-bottom:6px;">Swap tiles</div>' +
      '<div style="font-size:12px;color:#94a3b8;margin-bottom:12px;">' +
      'Tap the tiles you want to return to the bag. You\'ll draw the same ' +
      'number of fresh tiles. Tap a selected tile again to unselect it.' +
      '</div>';

    var rackWrap = document.createElement('div');
    rackWrap.style.cssText =
      'display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:#0f172a;' +
      'border-radius:8px;margin-bottom:12px;justify-content:center;';
    card.appendChild(rackWrap);

    function rerender() {
      rackWrap.innerHTML = '';
      for (var i = 0; i < tiles.length; i++) {
        (function (t) {
          var tileEl = UI && UI.renderTile
            ? UI.renderTile(t, false, false)
            : makeFallbackTile(t);
          tileEl.style.cursor = 'pointer';
          tileEl.style.transition = 'transform .15s';
          if (selected[t.id]) {
            tileEl.style.outline = '3px solid #ef4444';
            tileEl.style.transform = 'scale(0.92)';
            tileEl.style.opacity = '0.7';
          }
          tileEl.addEventListener('click', function () {
            if (selected[t.id]) delete selected[t.id];
            else selected[t.id] = true;
            rerender();
            updateConfirmLabel();
          });
          rackWrap.appendChild(tileEl);
        })(tiles[i]);
      }
    }

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText =
      'flex:1;background:#334155;color:#e2e8f0;border:none;padding:10px;' +
      'border-radius:6px;cursor:pointer;';
    cancelBtn.onclick = function () { document.body.removeChild(overlay); };

    var confirmBtn = document.createElement('button');
    confirmBtn.style.cssText =
      'flex:2;background:#fbbf24;color:#1e293b;border:none;padding:10px;' +
      'border-radius:6px;font-weight:700;cursor:pointer;';

    function updateConfirmLabel() {
      var n = Object.keys(selected).length;
      confirmBtn.textContent = n === 0 ? 'Select tiles…' : 'Swap ' + n + ' tile' + (n === 1 ? '' : 's');
      confirmBtn.disabled = (n === 0);
      confirmBtn.style.opacity = (n === 0) ? '0.5' : '1';
      confirmBtn.style.cursor = (n === 0) ? 'not-allowed' : 'pointer';
    }

    confirmBtn.onclick = function () {
      var toSwap = tiles.filter(function (t) { return !!selected[t.id]; });
      if (toSwap.length === 0) return;
      document.body.removeChild(overlay);
      submitSwap(toSwap);
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    rerender();
    updateConfirmLabel();
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
    }
    // Shuffle bag (simple Fisher-Yates)
    for (var s = newBag.tiles.length - 1; s > 0; s--) {
      var swapIdx = Math.floor(Math.random() * (s + 1));
      var tmp = newBag.tiles[s]; newBag.tiles[s] = newBag.tiles[swapIdx]; newBag.tiles[swapIdx] = tmp;
    }
    // Refill rack from bag
    while (newRack.tiles.length < 8 && newBag.tiles.length > 0) {
      newRack.tiles.push(newBag.tiles.pop());
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
    // Mark premium-used on the freshly-placed cells (scoring already accounted
    // for them; future plays must not double-count)
    for (var i = 0; i < placementsToValidate.length; i++) {
      var p = placementsToValidate[i];
      newBoard.cells[p.row][p.col].premiumUsed = true;
    }

    var myRackKey = (myRole === 'host') ? 'hostRack' : 'guestRack';
    var newRack = JSON.parse(JSON.stringify(gs[myRackKey]));
    var newBag = JSON.parse(JSON.stringify(gs.bag));
    // Refill rack from bag up to 8
    while (newRack.tiles.length < 8 && newBag.tiles.length > 0) {
      newRack.tiles.push(newBag.tiles.pop());
    }

    // Update scores
    var newHostScore = gs.hostScore || 0;
    var newGuestScore = gs.guestScore || 0;
    if (myRole === 'host') newHostScore += scoreResult.total;
    else newGuestScore += scoreResult.total;

    // Equation faces for replay
    var equationFaces = (validation.equations || []).map(function (eq) {
      return eq.map(function (c) { return c.tile ? (c.tile.assigned || c.tile.face) : '?'; });
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
    } catch (err) {
      alert('Submit failed: ' + err.message);
    } finally {
      submitInFlight = false;
    }
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
