/**
 * analysis-export.js
 * Converts an in-game replay recording (from replay-recorder.js) into a Game
 * Analysis project, and hands it off to analysis.html via localStorage.
 *
 * Project shape consumed by analysis.html (v2):
 *   { v:2, p1, p2, grid:[15][15 faces], plays:[{player,equation,score,type,
 *     cells:[[r,c]],notes,timeMs}], cellMeta:[[r,c,player,turnIdx]] }
 *
 * The handoff key is read by analysis.html on load.
 */
(function () {
  'use strict';

  var SAVE_KEY = 'amath_analysis_games';
  var PENDING_KEY = 'amath_analysis_pending'; // a single project waiting to open

  // yymmdd_hhmm  e.g. 260530_2147
  function stamp(d) {
    d = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var yy = String(d.getFullYear()).slice(2);
    return yy + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
           p(d.getHours()) + p(d.getMinutes());
  }

  /**
   * Convert a replay recording doc → analysis project.
   * @param {object} rec  recording from replayRecorder.finish()
   * @param {object} opts { p1, p2 }  display names
   */
  function recordingToProject(rec, opts) {
    opts = opts || {};
    var p1 = opts.p1 || 'Player 1';
    var p2 = opts.p2 || (rec && rec.isPvP ? 'Player 2' : 'Computer');

    var grid = [];
    for (var r = 0; r < 15; r++) { grid[r] = []; for (var c = 0; c < 15; c++) grid[r][c] = ''; }

    var plays = [];
    var cellMeta = [];
    var moves = (rec && rec.moves) || [];
    var prevT = 0;

    moves.forEach(function (mv, idx) {
      // 'who' is 'player' or 'ai'/'opponent'. Map to p1/p2.
      var who = mv.who === 'player' ? 'p1' : 'p2';
      // time used on this move = offset delta from previous move
      var timeMs = Math.max(0, (mv.t || 0) - prevT);
      prevT = mv.t || prevT;

      var type = mv.type === 'swap' ? 'swap' : (mv.type === 'pass' ? 'swap'
                 : (mv.bingo ? 'bingo' : 'yoyo'));

      var cells = [];
      if (mv.type === 'play' && mv.placements) {
        mv.placements.forEach(function (pl) {
          if (pl && pl.r >= 0 && pl.r < 15 && pl.c >= 0 && pl.c < 15) {
            // place the face onto the grid
            grid[pl.r][pl.c] = pl.a || pl.f || '';
            cells.push([pl.r, pl.c]);
            cellMeta.push([pl.r, pl.c, who, idx]);
          }
        });
      }

      // equations: recorder stored each as comma-joined faces; join with spaces
      var eq = '';
      if (mv.equations && mv.equations.length) {
        eq = mv.equations.map(function (e) {
          return (typeof e === 'string') ? e.split(',').join(' ') : '';
        }).filter(Boolean).join('  /  ');
      }

      plays.push({
        player: who,
        equation: eq,
        score: mv.score || 0,
        type: type,
        cells: cells,
        notes: mv.type === 'pass' ? 'pass' : '',
        timeMs: timeMs
      });
    });

    return { v: 2, p1: p1, p2: p2, grid: grid, plays: plays, cellMeta: cellMeta };
  }

  /**
   * Save a project into the analysis library and mark it pending so
   * analysis.html opens it automatically.
   * @returns {string} the saved game id
   */
  function sendProjectToAnalysis(project, name) {
    var lib = {};
    try { lib = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch (e) { lib = {}; }
    var id = 'g' + Date.now();
    name = name || ('Game ' + stamp());
    lib[id] = { id: id, name: name, savedAt: Date.now(), data: project };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(lib));
      localStorage.setItem(PENDING_KEY, id);
    } catch (e) {
      alert('Could not hand off to Analysis (storage full?): ' + e.message);
      return null;
    }
    return id;
  }

  /**
   * Build a project from a scoreSheet (the full per-turn history that survives
   * save/resume) plus the final board grid. The scoreSheet lacks per-tile
   * placements, so cells are left empty for Auto-build, but every TURN is present.
   * @param {Array} scoreSheet entries {turn,who,action,score,isBingo,total}
   * @param {object} board the game board (cells[r][c].tile.face) — optional
   * @param {object} opts { p1, p2 }
   */
  function scoreSheetToProject(scoreSheet, board, opts) {
    opts = opts || {};
    var p1 = opts.p1 || 'Player 1';
    var p2 = opts.p2 || 'Computer';

    var grid = [];
    for (var r = 0; r < 15; r++) { grid[r] = []; for (var c = 0; c < 15; c++) grid[r][c] = ''; }
    // Fill grid from the final board if provided
    if (board && board.cells) {
      for (var rr = 0; rr < 15; rr++) {
        for (var cc = 0; cc < 15; cc++) {
          var cell = board.cells[rr] && board.cells[rr][cc];
          if (cell && cell.tile) grid[rr][cc] = cell.tile.assigned || cell.tile.face || '';
        }
      }
    }

    var plays = (scoreSheet || []).map(function (e) {
      var who = e.who === 'player' ? 'p1' : 'p2';
      var type = e.action === 'play' ? (e.isBingo ? 'bingo' : 'yoyo')
               : (e.action === 'swap' ? 'swap' : 'swap'); // pass/swap both 'swap'
      return {
        player: who,
        equation: '',
        score: e.score || 0,
        type: type,
        cells: [],
        notes: e.action === 'pass' ? 'pass' : (e.action === 'swap' ? 'swap' : ''),
        timeMs: 0
      };
    });

    return { v: 2, p1: p1, p2: p2, grid: grid, plays: plays, cellMeta: [] };
  }

  /**
   * One-call helper for game pages: convert the recording and send it.
   * @param {object} rec recording doc
   * @param {object} opts { p1, p2 }
   * @returns {string|null} saved id
   */
  function sendRecordingToAnalysis(rec, opts) {
    if (!rec || !rec.moves || !rec.moves.length) return null;
    var project = recordingToProject(rec, opts);
    var name = stamp(new Date(rec.startedAt || Date.now())) +
               '  ' + project.p1 + ' vs ' + project.p2;
    return sendProjectToAnalysis(project, name);
  }

  /**
   * Smart sender: picks the most COMPLETE source.
   * Prefers the recording IF it has as many (or more) turns than the scoreSheet
   * (recording has per-tile placements). Otherwise falls back to the scoreSheet,
   * which always holds the full turn history (survives save/resume).
   * @param {object} args { rec, scoreSheet, board, p1, p2 }
   */
  function sendBestToAnalysis(args) {
    args = args || {};
    var rec = args.rec;
    var sheet = args.scoreSheet || [];
    var recTurns = (rec && rec.moves) ? rec.moves.length : 0;
    var opts = { p1: args.p1, p2: args.p2 };

    var project, name;
    if (recTurns > 0 && recTurns >= sheet.length) {
      // recording is complete — use it (has placements)
      project = recordingToProject(rec, opts);
    } else if (sheet.length > 0) {
      // scoreSheet is the fuller history (e.g. loaded from a saved game)
      project = scoreSheetToProject(sheet, args.board, opts);
    } else if (recTurns > 0) {
      project = recordingToProject(rec, opts);
    } else {
      return null;
    }
    name = stamp(new Date()) + '  ' + project.p1 + ' vs ' + project.p2;
    return sendProjectToAnalysis(project, name);
  }

  window.AMath = window.AMath || {};
  window.AMath.analysisExport = {
    stamp: stamp,
    recordingToProject: recordingToProject,
    scoreSheetToProject: scoreSheetToProject,
    sendProjectToAnalysis: sendProjectToAnalysis,
    sendRecordingToAnalysis: sendRecordingToAnalysis,
    sendBestToAnalysis: sendBestToAnalysis,
    PENDING_KEY: PENDING_KEY,
    SAVE_KEY: SAVE_KEY
  };
})();
