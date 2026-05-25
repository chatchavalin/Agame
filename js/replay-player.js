/**
 * A-Math Replay Player
 *
 * Loads a game replay doc from Firestore and renders it move-by-move.
 *
 * URL: replay.html?gameId=xxx
 *
 * Renders a board element that we mutate by stepping forward/backward through
 * `moves[]`. Each play move's compact placements are reconstructed into
 * board-tile objects with synthetic ids (the real tile ids aren't preserved
 * in the replay; ids only matter for rack tracking which we don't display).
 */

(function () {
  'use strict';

  var state = {
    doc: null,
    moveIdx: -1,      // -1 = pre-game state; 0..N-1 = after move i applied
    board: null,
    cumPlayerScore: 0,
    cumAiScore: 0,
    autoTimer: null,
  };

  var _tileIdCounter = 1;
  function makeTile(pl) {
    return {
      id: 'rep_' + (_tileIdCounter++),
      face: pl.f,
      type: pl.ty || 'digit',
      points: pl.p || 0,
      assigned: pl.a || null,
    };
  }

  /**
   * Reset to a fresh board (move -1).
   */
  function resetState() {
    var Board = window.AMath.board;
    state.board = Board.createBoard();
    state.moveIdx = -1;
    state.cumPlayerScore = 0;
    state.cumAiScore = 0;
  }

  /**
   * Step forward by one move. Returns true if a move was applied.
   */
  function stepForward() {
    if (!state.doc || !state.doc.moves) return false;
    if (state.moveIdx >= state.doc.moves.length - 1) return false;
    var next = state.doc.moves[state.moveIdx + 1];
    applyMove(next);
    state.moveIdx++;
    return true;
  }

  /**
   * Apply a move to the board + score tally.
   */
  function applyMove(move) {
    var Board = window.AMath.board;
    if (move.type === 'play' && move.placements) {
      for (var i = 0; i < move.placements.length; i++) {
        var pl = move.placements[i];
        // Defensive: a corrupt replay might place on an occupied cell.
        var cell = Board.getCell(state.board, pl.r, pl.c);
        if (!cell || cell.tile) continue;
        Board.placeTile(state.board, pl.r, pl.c, makeTile(pl));
        Board.markPremiumUsed(state.board, pl.r, pl.c);
      }
      if (move.who === 'player') state.cumPlayerScore += (move.score || 0);
      else state.cumAiScore += (move.score || 0);
    }
    // swap and pass have no board effect
  }

  /**
   * Rebuild the board from scratch up to moveIdx = target.
   * Used when stepping backward (cheaper than implementing per-move undo).
   */
  function rebuildTo(targetIdx) {
    resetState();
    if (!state.doc || !state.doc.moves) return;
    for (var i = 0; i <= targetIdx && i < state.doc.moves.length; i++) {
      applyMove(state.doc.moves[i]);
    }
    state.moveIdx = Math.min(targetIdx, state.doc.moves.length - 1);
  }

  function stepBackward() {
    if (state.moveIdx < 0) return false;
    var target = state.moveIdx - 1;
    rebuildTo(target);
    return true;
  }

  function jumpStart() { rebuildTo(-1); }
  function jumpEnd() {
    if (state.doc && state.doc.moves) rebuildTo(state.doc.moves.length - 1);
  }

  // ------------ Rendering ------------

  function renderAll() {
    var content = document.getElementById('replay-content');
    if (!content) return;
    if (!state.doc) {
      content.innerHTML = '<div class="replay-loading">Replay not found.</div>';
      return;
    }
    var d = state.doc;
    var movesTotal = (d.moves || []).length;
    var dateStr = d.endedAt
      ? new Date(d.endedAt).toLocaleString()
      : (d.startedAt ? new Date(d.startedAt).toLocaleString() : '');
    var durMin = d.durationMs ? Math.round(d.durationMs / 60000) : '?';
    var wonText = d.won ? '✅ Win' : '❌ Loss';
    var playerName = d.displayName || 'You';
    var playerPhoto = d.photoURL || '';

    var html =
      '<div class="replay-header">' +
        (playerPhoto ? '<img src="' + escapeAttr(playerPhoto) + '" alt="">' : '') +
        '<div>' +
          '<div style="font-weight:700;">' + escapeHtml(playerName) + '</div>' +
          '<div class="replay-meta">' + escapeHtml(dateStr) +
            ' · ' + durMin + ' min · ' + movesTotal + ' moves · ' + wonText +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="replay-scores">' +
        '<div class="replay-score-box" id="rep-player-box">' +
          '<div class="replay-score-value" id="rep-player-score">0</div>' +
          '<div class="replay-score-label">' + escapeHtml(playerName) + '</div>' +
        '</div>' +
        '<div class="replay-score-box" id="rep-ai-box">' +
          '<div class="replay-score-value" id="rep-ai-score">0</div>' +
          '<div class="replay-score-label">AI</div>' +
        '</div>' +
      '</div>' +
      '<div id="rep-step-info" class="replay-step-info"></div>' +
      '<div id="rep-board"></div>' +
      '<div class="replay-controls">' +
        '<button class="replay-btn" id="rep-start">⏮</button>' +
        '<button class="replay-btn" id="rep-prev">◀</button>' +
        '<button class="replay-btn replay-btn-primary" id="rep-next">Next ▶</button>' +
        '<button class="replay-btn" id="rep-play">Auto ▶</button>' +
        '<button class="replay-btn" id="rep-end">⏭</button>' +
      '</div>';
    content.innerHTML = html;

    document.getElementById('rep-start').onclick = function () { stopAuto(); jumpStart(); refreshUI(); };
    document.getElementById('rep-prev').onclick = function () { stopAuto(); stepBackward(); refreshUI(); };
    document.getElementById('rep-next').onclick = function () { stopAuto(); stepForward(); refreshUI(); };
    document.getElementById('rep-end').onclick = function () { stopAuto(); jumpEnd(); refreshUI(); };
    document.getElementById('rep-play').onclick = toggleAuto;

    refreshUI();
  }

  function refreshUI() {
    var UI = window.AMath.ui;
    var boardEl = document.getElementById('rep-board');
    if (boardEl && UI && UI.renderBoard) UI.renderBoard(state.board, boardEl);

    document.getElementById('rep-player-score').textContent = state.cumPlayerScore;
    document.getElementById('rep-ai-score').textContent = state.cumAiScore;

    var info = document.getElementById('rep-step-info');
    if (info) {
      if (state.moveIdx < 0) {
        info.textContent = 'Game start (move 0 of ' + state.doc.moves.length + ')';
      } else {
        var m = state.doc.moves[state.moveIdx];
        var who = m.who === 'player' ? (state.doc.displayName || 'You') : 'AI';
        var text = 'Move ' + (state.moveIdx + 1) + '/' + state.doc.moves.length + ' — ' + who + ' ';
        if (m.type === 'play') {
          text += 'played ' + (m.placements ? m.placements.length : 0) + ' tiles for ' + (m.score || 0) + ' pts';
          if (m.bingo) text += ' BINGO! 🎉';
          if (m.equations && m.equations.length) {
            var eqStr = m.equations.map(function (e) { return e.join(''); }).join(' | ');
            text += ' (' + eqStr + ')';
          }
        } else if (m.type === 'swap') {
          text += 'swapped ' + (m.count || 0) + ' tiles';
        } else {
          text += 'passed';
        }
        info.innerHTML = m.bingo ? '<span class="replay-step-bingo">' + escapeHtml(text) + '</span>' : escapeHtml(text);
      }
    }

    // Player/AI box highlight based on whose move was last
    var pbox = document.getElementById('rep-player-box');
    var abox = document.getElementById('rep-ai-box');
    if (pbox && abox) {
      pbox.classList.remove('active');
      abox.classList.remove('active');
      if (state.moveIdx >= 0) {
        var last = state.doc.moves[state.moveIdx];
        if (last.who === 'player') pbox.classList.add('active');
        else abox.classList.add('active');
      }
    }

    // Button disable states
    var atStart = state.moveIdx < 0;
    var atEnd = !state.doc || state.moveIdx >= (state.doc.moves || []).length - 1;
    document.getElementById('rep-start').disabled = atStart;
    document.getElementById('rep-prev').disabled = atStart;
    document.getElementById('rep-next').disabled = atEnd;
    document.getElementById('rep-end').disabled = atEnd;
    document.getElementById('rep-play').disabled = atEnd;
  }

  function toggleAuto() {
    if (state.autoTimer) { stopAuto(); return; }
    var btn = document.getElementById('rep-play');
    if (btn) btn.textContent = 'Pause ⏸';
    state.autoTimer = setInterval(function () {
      if (!stepForward()) { stopAuto(); }
      refreshUI();
    }, 1200);
  }
  function stopAuto() {
    if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
    var btn = document.getElementById('rep-play');
    if (btn) btn.textContent = 'Auto ▶';
  }

  // ------------ Boot ------------

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  async function boot() {
    var params = new URLSearchParams(window.location.search);
    var gameId = params.get('gameId');
    if (!gameId) {
      document.getElementById('replay-content').innerHTML =
        '<div class="replay-loading">No gameId in URL.</div>';
      return;
    }

    // Wait until Firebase has initialized
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
      // Try again shortly
      return setTimeout(boot, 200);
    }
    var auth = firebase.auth();
    if (!auth.currentUser) {
      // Wait briefly for auth state
      await new Promise(function (resolve) {
        var unsub = auth.onAuthStateChanged(function (u) { unsub(); resolve(u); });
        setTimeout(resolve, 1500);
      });
    }
    if (!auth.currentUser) {
      document.getElementById('replay-content').innerHTML =
        '<div class="replay-loading">Please sign in via the lobby first.</div>';
      return;
    }

    var db = firebase.firestore();
    try {
      var doc = await db.collection('games').doc(gameId).get();
      if (!doc.exists) {
        document.getElementById('replay-content').innerHTML =
          '<div class="replay-loading">Replay not found.</div>';
        return;
      }
      state.doc = Object.assign({ id: doc.id }, doc.data());
      resetState();
      renderAll();
    } catch (err) {
      console.error('[Replay] load error:', err);
      document.getElementById('replay-content').innerHTML =
        '<div class="replay-loading">Could not load replay.</div>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
