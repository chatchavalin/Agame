/**
 * A-Math Replay Recorder
 *
 * Records a game's full move list in a schema designed for replay playback.
 * Independent of game-log.js (which is a free-form debug log) — this module
 * captures the minimum info needed to replay the game move-by-move.
 *
 * Lifecycle:
 *   start({tileSet, botLevel, isPvP}) → fresh recording begins
 *   recordPlay({who, score, placements, equations})
 *   recordSwap({who, count})
 *   recordPass({who})
 *   finish({playerScore, aiScore, won, ...stats}) → returns final game doc
 *
 * Output schema (kept compact for Firestore — placements stored as light
 * {r, c, f, a} not the full tile object; equations as faces only):
 *   {
 *     startedAt, endedAt, durationMs,
 *     tileSet, botLevel, isPvP,
 *     playerScore, aiScore, won,
 *     bingos, x9plays, maxDeficit, swapCount, playsMade,
 *     moves: [
 *       { t: <ms-from-start>, who: 'player'|'ai',
 *         type: 'play', score: N, bingo: bool,
 *         placements: [{r, c, f, a?}],
 *         equations: [["3","+","4","=","7"], ...] }
 *       { t, who, type: 'swap', count: N }
 *       { t, who, type: 'pass' }
 *     ]
 *   }
 */

(function () {
  'use strict';

  var _recording = null;

  function start(meta) {
    _recording = {
      startedAt: Date.now(),
      tileSet: meta && meta.tileSet || 'prathom',
      botLevel: meta && meta.botLevel || 'hard',
      isPvP: !!(meta && meta.isPvP),
      moves: [],
    };
  }

  function active() {
    return !!_recording;
  }

  function nowOffsetMs() {
    if (!_recording) return 0;
    return Date.now() - _recording.startedAt;
  }

  /**
   * Convert a placement (with full tile object) to compact replay form.
   * Strip the tile id, keep face + assigned. The replay can re-create a
   * pseudo-tile with `points` derived from inventory if needed.
   */
  function compactPlacement(p) {
    if (!p) return null;
    var face = p.tile ? p.tile.face : (p.face || null);
    var assigned = p.assigned || (p.tile && p.tile.assigned) || null;
    var type = p.tile ? p.tile.type : (p.type || null);
    var points = p.tile ? (p.tile.points || 0) : (p.points || 0);
    var out = { r: p.row, c: p.col, f: face, p: points, ty: type };
    if (assigned) out.a = assigned;
    return out;
  }

  /**
   * Convert an equation (array of {row,col,tile,isNew?}) to faces only.
   */
  function compactEquation(eq) {
    if (!eq || !eq.length) return [];
    var out = [];
    for (var i = 0; i < eq.length; i++) {
      var cell = eq[i];
      if (!cell || !cell.tile) { out.push('?'); continue; }
      out.push(cell.tile.assigned || cell.tile.face);
    }
    return out;
  }

  function recordPlay(info) {
    if (!_recording) return;
    var move = {
      t: nowOffsetMs(),
      who: info.who,
      type: 'play',
      score: info.score || 0,
      bingo: !!info.bingo,
      placements: (info.placements || []).map(compactPlacement),
    };
    if (info.equations && info.equations.length) {
      move.equations = info.equations.map(compactEquation);
    }
    _recording.moves.push(move);
  }

  function recordSwap(info) {
    if (!_recording) return;
    _recording.moves.push({
      t: nowOffsetMs(),
      who: info.who,
      type: 'swap',
      count: info.count || 0,
    });
  }

  function recordPass(info) {
    if (!_recording) return;
    _recording.moves.push({
      t: nowOffsetMs(),
      who: info.who,
      type: 'pass',
    });
  }

  /**
   * Stop recording and return the final game document.
   * @param {object} summary — final fields: { playerScore, aiScore, won,
   *   bingos, x9plays, maxDeficit, swapCount, playsMade }
   * @returns {object|null} the game doc, or null if not recording
   */
  function finish(summary) {
    if (!_recording) return null;
    var doc = Object.assign({}, _recording, summary || {}, {
      endedAt: Date.now(),
      durationMs: Date.now() - _recording.startedAt,
    });
    _recording = null;
    return doc;
  }

  function cancel() {
    _recording = null;
  }

  function getCurrentMoveCount() {
    return _recording ? _recording.moves.length : 0;
  }

  window.AMath = window.AMath || {};
  window.AMath.replayRecorder = {
    start: start,
    active: active,
    recordPlay: recordPlay,
    recordSwap: recordSwap,
    recordPass: recordPass,
    finish: finish,
    cancel: cancel,
    getCurrentMoveCount: getCurrentMoveCount,
  };
})();
