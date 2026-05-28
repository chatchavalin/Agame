/**
 * board-import.js — shared core for the Scan / Import Board feature.
 *
 * Pure data layer (no DOM, no network) so it can be unit-tested in node and
 * reused by BOTH import paths:
 *   A) in-app camera → Gemini → grid JSON
 *   B) "paste board code" → grid JSON
 *
 * Both paths produce the same intermediate "import object" and then call
 * buildGameState() to get a state in the SAME shape the save/resume system
 * uses, which the game loader already understands.
 *
 * Tiles in this game are: { id, type, face, points, assigned }
 *   - face   : inventory face string ('2', '13', '+', '-', '+/-', '×/÷', '=', 'BLANK')
 *   - assigned: chosen value for choice ('+/-','×/÷') and 'BLANK' tiles
 *               (e.g. a '+/-' tile placed as minus has assigned '-')
 *
 * The inventory is injected (param) so this file is testable without `window`.
 * In the browser, callers pass window.TILE_INVENTORY.
 */
(function () {
  'use strict';

  var RACK_SIZE = 8;
  var BOARD_SIZE = 15;
  var CURRENT_CODE_VERSION = 2;

  // Faces a BLANK / choice tile is allowed to be "assigned" to, for validation.
  var ASSIGNABLE = (function () {
    var arr = ['=', '+', '-', '×', '÷'];
    for (var n = 0; n <= 20; n++) arr.push(String(n));
    return arr;
  })();

  /** Build a quick lookup: face -> inventory definition. */
  function indexInventory(inventory) {
    var map = {};
    (inventory || []).forEach(function (def) { map[def.face] = def; });
    return map;
  }

  var _idCounter = 0;
  function genId() {
    _idCounter++;
    return 'imp_' + Date.now().toString(36) + '_' + _idCounter;
  }

  // Map values a vision model naturally emits onto our exact face vocabulary.
  // Key insight: there is NO standalone × or ÷ tile — those come from the
  // "×/÷" choice tile, so a bare × becomes face "×/÷" assigned "×", etc.
  var FACE_ALIAS = {
    '×': { f: '×/÷', a: '×' }, '÷': { f: '×/÷', a: '÷' },
    'x': { f: '×/÷', a: '×' }, 'X': { f: '×/÷', a: '×' }, '*': { f: '×/÷', a: '×' },
    '/': { f: '×/÷', a: '÷' }, '÷/×': { f: '×/÷' }, 'x/÷': { f: '×/÷' },
    '±': { f: '+/-' }, '+-': { f: '+/-' }, '-/+': { f: '+/-' },
    '−': { f: '-' }, '–': { f: '-' }, '—': { f: '-' },
    '': { f: 'BLANK' }, 'blank': { f: 'BLANK' }, 'Blank': { f: 'BLANK' },
    '▢': { f: 'BLANK' }, '?': { f: 'BLANK' }, '_': { f: 'BLANK' },
  };
  var ASSIGN_ALIAS = { 'x': '×', 'X': '×', '*': '×', '/': '÷', '−': '-' };

  // Returns normalized { f, a } from a raw face + raw assigned value.
  function normalizeFace(rawF, rawA) {
    var f = (rawF == null ? '' : String(rawF)).trim();
    var a = (rawA == null || rawA === '') ? null : String(rawA).trim();
    if (a && ASSIGN_ALIAS[a]) a = ASSIGN_ALIAS[a];
    if (FACE_ALIAS[f]) {
      var m = FACE_ALIAS[f];
      return { f: m.f, a: a || m.a || null };
    }
    return { f: f, a: a };
  }

  /**
   * Make a full tile object from a face (+ optional assigned value), looking up
   * type/points from the inventory. Returns null for an unknown face.
   */
  function makeTile(face, assigned, inventory) {
    var def = indexInventory(inventory)[face];
    if (!def) return null;
    var tile = {
      id: genId(),
      type: def.type,
      face: def.face,
      points: def.points,
      assigned: null,
    };
    if (assigned != null && assigned !== '') {
      tile.assigned = String(assigned);
    }
    return tile;
  }

  /** Empty 15x15 board in the canonical { cells } shape. */
  function emptyBoard() {
    var cells = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      var row = [];
      for (var c = 0; c < BOARD_SIZE; c++) row.push({ tile: null });
      cells.push(row);
    }
    return { cells: cells };
  }

  /**
   * Validate + normalize a raw import object (from parsed JSON / Gemini).
   * Shape: { v, board:[{r,c,f,a?}], rack:[face|{f,a}], turn?, scores? }
   * Returns { ok, errors:[], warnings:[], board:[...], rack:[...], turn, scores }.
   * Does NOT throw — collects problems so the review UI can surface them.
   */
  function normalizeImport(obj, inventory) {
    var errors = [];
    var warnings = [];
    var inv = indexInventory(inventory);

    if (!obj || typeof obj !== 'object') {
      return { ok: false, errors: ['Import is empty or not an object.'], warnings: warnings };
    }
    if (obj.v != null && obj.v > CURRENT_CODE_VERSION) {
      warnings.push('Code version ' + obj.v + ' is newer than supported (' + CURRENT_CODE_VERSION + ').');
    }

    // Accept a fixed 15x15 "grid" form (rows of 15 strings, "" = empty) and
    // flatten it to board entries. This structural form prevents the model
    // from emitting phantom tiles (e.g. reading a subscript as an extra tile),
    // since every output slot maps to a real board square.
    if (Array.isArray(obj.grid)) {
      var gb = [];
      obj.grid.forEach(function (row, r) {
        if (!Array.isArray(row)) return;
        row.forEach(function (cell, c) {
          if (cell == null) return;
          var s = String(cell).trim();
          if (s === '' || s === '.' || s === '-.' ) return;  // empty markers
          gb.push({ r: r, c: c, f: s });
        });
      });
      obj = { v: obj.v, board: gb, rack: obj.rack, turn: obj.turn, scores: obj.scores };
    }

    // --- board cells ---
    var board = [];
    var seen = {};
    (obj.board || []).forEach(function (cell, i) {
      var r = parseInt(cell.r, 10);
      var c = parseInt(cell.c, 10);
      if (isNaN(r) || isNaN(c) || r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) {
        warnings.push('Skipped a tile with an out-of-range position.');
        return;
      }
      var key = r + ',' + c;
      if (seen[key]) { warnings.push('Two tiles on cell ' + key + ' — kept the first.'); return; }
      var norm = normalizeFace(cell.f, cell.a);
      var f = norm.f;
      if (!inv[f]) { warnings.push('Couldn\u2019t read a tile at (' + (r + 1) + ',' + (c + 1) + ') — left empty.'); return; }
      var entry = { r: r, c: c, f: f };
      var def = inv[f];
      if (def.type === 'choice' || def.type === 'blank') {
        if (norm.a == null || norm.a === '') {
          warnings.push('Cell (' + (r + 1) + ',' + (c + 1) + ') (' + f + ') needs a chosen value.');
        } else if (ASSIGNABLE.indexOf(String(norm.a)) === -1) {
          warnings.push('Cell (' + (r + 1) + ',' + (c + 1) + '): unclear chosen value.');
        } else {
          entry.a = String(norm.a);
        }
      }
      seen[key] = true;
      board.push(entry);
    });

    // --- rack (optional; user usually fills this manually) ---
    var rack = [];
    (obj.rack || []).forEach(function (item, i) {
      var rawF = (typeof item === 'string') ? item : (item && item.f);
      var rawA = (typeof item === 'object' && item) ? item.a : undefined;
      if (rawF == null || rawF === '') return; // empty slot
      var nr = normalizeFace(rawF, rawA);
      if (!inv[nr.f]) { warnings.push('Couldn\u2019t read a rack tile — left empty.'); return; }
      var ri = { f: nr.f };
      if (nr.a != null && nr.a !== '') ri.a = String(nr.a);
      rack.push(ri);
    });
    if (rack.length > RACK_SIZE) {
      warnings.push('Rack had ' + rack.length + ' tiles — kept the first ' + RACK_SIZE + '.');
      rack = rack.slice(0, RACK_SIZE);
    }

    // --- inventory overflow: don't block. Flag only the SURPLUS tiles (the
    //     extras beyond what exists), not every copy — keeps the highlight
    //     surgical so the user sees the few genuine problems. ---
    var used = {}, flaggedFaces = [], flaggedCells = [];
    board.forEach(function (e) {
      used[e.f] = (used[e.f] || 0) + 1;
      var def = inv[e.f];
      if (def && used[e.f] > def.count) flaggedCells.push([e.r, e.c]); // this copy is a surplus
    });
    var rackUsed = {};
    rack.forEach(function (e) { rackUsed[e.f] = (rackUsed[e.f] || 0) + 1; });
    Object.keys(used).forEach(function (face) {
      var def = inv[face];
      var total = used[face] + (rackUsed[face] || 0);
      if (def && total > def.count) {
        warnings.push('Read ' + total + ' \u00d7 "' + face + '" but only ' + def.count + ' exist \u2014 extra one(s) flagged red.');
        flaggedFaces.push(face);
      }
    });

    var turn = (obj.turn === 'ai') ? 'ai' : 'you';
    var scores = {
      you: (obj.scores && Number(obj.scores.you)) || 0,
      ai: (obj.scores && Number(obj.scores.ai)) || 0,
    };

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
      board: board,
      rack: rack,
      turn: turn,
      scores: scores,
      flaggedFaces: flaggedFaces,
      flaggedCells: flaggedCells,
    };
  }

  /** Parse a pasted board-code string (JSON) into a normalized import. */
  function parseBoardCode(text, inventory) {
    var obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return { ok: false, errors: ['Could not read code — not valid JSON.'], warnings: [] };
    }
    return normalizeImport(obj, inventory);
  }

  /**
   * Compute the remaining bag (array of tiles) = inventory − board − racks.
   * Subtraction is by inventory face (choice/blank counted by their face).
   */
  function computeBag(usedFaces, inventory) {
    var remaining = {};
    (inventory || []).forEach(function (def) { remaining[def.face] = def.count; });
    Object.keys(usedFaces || {}).forEach(function (face) {
      if (remaining[face] != null) remaining[face] -= usedFaces[face];
    });
    var bag = { tiles: [] };
    Object.keys(remaining).forEach(function (face) {
      var n = remaining[face];
      for (var i = 0; i < n; i++) {
        var t = makeTile(face, null, inventory);
        if (t) bag.tiles.push(t);
      }
    });
    return bag;
  }

  /**
   * Build a full game state (save/resume shape) from a normalized import.
   * Draws the AI/opponent rack from the computed bag to fill empty slots so a
   * PvA game can continue from this position. `rng` is injectable for tests.
   */
  function buildGameState(norm, inventory, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;

    var board = opts.boardFactory ? opts.boardFactory() : emptyBoard();
    var usedFaces = {};

    norm.board.forEach(function (e) {
      var t = makeTile(e.f, e.a, inventory);
      if (t) {
        board.cells[e.r][e.c].tile = t;
        usedFaces[e.f] = (usedFaces[e.f] || 0) + 1;
      }
    });

    var playerTiles = [];
    var playerSlotMap = {};
    norm.rack.forEach(function (e, idx) {
      var t = makeTile(e.f, e.a, inventory);
      if (t) {
        playerTiles.push(t);
        playerSlotMap[t.id] = idx;
        usedFaces[e.f] = (usedFaces[e.f] || 0) + 1;
      }
    });

    var bag = computeBag(usedFaces, inventory);

    // Fill an opponent rack from the bag (random draw) up to RACK_SIZE.
    // Skipped for solo/analysis (no opponent → tiles stay in the bag).
    var aiTiles = [];
    var aiSlotMap = {};
    var need = (opts.fillOpponent === false) ? 0 : Math.min(RACK_SIZE, bag.tiles.length);
    for (var i = 0; i < need; i++) {
      var pick = Math.floor(rng() * bag.tiles.length);
      var drawn = bag.tiles.splice(pick, 1)[0];
      aiTiles.push(drawn);
      aiSlotMap[drawn.id] = i;
    }

    return {
      board: board,
      playerRack: { owner: 'player', tiles: playerTiles, slotMap: playerSlotMap },
      aiRack: { owner: 'ai', tiles: aiTiles, slotMap: aiSlotMap },
      bag: bag,
      playerScore: norm.scores.you,
      aiScore: norm.scores.ai,
      isPlayerTurn: norm.turn === 'you',
      isFirstMove: norm.board.length === 0,
      tentativePlacements: [],
      selectedTileId: null,
      gameOver: false,
      consecutiveNonScoringTurns: 0,
      _imported: true,
    };
  }

  // ===========================================================================
  // AUTO-CORRECT — use A-Math's rule that every line of tiles is a valid
  // equation to detect & fix misread tiles. Conservative: only auto-applies a
  // change when there is exactly ONE single-tile substitution that makes the
  // line valid AND doesn't break the crossing line. Anything ambiguous or
  // unfixable is returned as a "problem" for the user to review.
  // ===========================================================================
  var _DIGITS = ['0','1','2','3','4','5','6','7','8','9'];
  var _TWO = ['10','11','12','13','14','15','16','20'];
  var _OPS = ['+','-','×','÷'];

  function _classOf(face) {
    if (/^[0-9]$/.test(face)) return 'digit';
    if (/^(1[0-6]|20)$/.test(face)) return 'two';
    if (face === '+' || face === '-' || face === '×' || face === '÷') return 'op';
    if (face === '=') return 'eq';
    return null;
  }
  function _candidatesFor(face) {
    switch (_classOf(face)) {
      case 'digit': return _DIGITS.filter(function (x) { return x !== face; });
      case 'two':   return _TWO.filter(function (x) { return x !== face; });
      case 'op':    return _OPS.filter(function (x) { return x !== face; });
      default:      return [];   // '=' / unknown: never auto-change
    }
  }
  // Resolved tokenizer-face for a cell model (assigned wins); unresolved → null.
  function _resolved(m) {
    if (!m) return null;
    var f = m.assigned || m.face;
    if (f === '×/÷' || f === '+/-' || f === 'BLANK') return null; // needs a value first
    return f;
  }
  function _modelFromFace(face) {
    if (face === '×' || face === '÷') return { face: '×/÷', assigned: face };
    return { face: face, assigned: null };
  }
  // Maximal run of non-null cells through (r,c) along 'h' or 'v'.
  function _runThrough(grid, r, c, dir) {
    var cells = [];
    var dr = dir === 'v' ? 1 : 0, dc = dir === 'h' ? 1 : 0;
    var sr = r, sc = c;
    while (sr - dr >= 0 && sc - dc >= 0 && grid[sr - dr][sc - dc] != null) { sr -= dr; sc -= dc; }
    var er = r, ec = c;
    while (er + dr < BOARD_SIZE && ec + dc < BOARD_SIZE && grid[er + dr][ec + dc] != null) { er += dr; ec += dc; }
    var rr = sr, cc = sc;
    while (rr <= er && cc <= ec) {
      cells.push({ r: rr, c: cc });
      rr += dr; cc += dc;
      if (dr === 0 && dc === 0) break;
    }
    return cells;
  }
  function _allRuns(grid) {
    var runs = [], r, c, i, j;
    for (r = 0; r < BOARD_SIZE; r++) {
      c = 0;
      while (c < BOARD_SIZE) {
        if (grid[r][c] == null) { c++; continue; }
        var s = c; while (c < BOARD_SIZE && grid[r][c] != null) c++;
        if (c - s >= 2) { var hc = []; for (i = s; i < c; i++) hc.push({ r: r, c: i }); runs.push({ dir: 'h', cells: hc }); }
      }
    }
    for (c = 0; c < BOARD_SIZE; c++) {
      r = 0;
      while (r < BOARD_SIZE) {
        if (grid[r][c] == null) { r++; continue; }
        var s2 = r; while (r < BOARD_SIZE && grid[r][c] != null) r++;
        if (r - s2 >= 2) { var vc = []; for (j = s2; j < r; j++) vc.push({ r: j, c: c }); runs.push({ dir: 'v', cells: vc }); }
      }
    }
    return runs;
  }

  /**
   * @param board2d  15x15 of {face,assigned}|null (mutated in place with fixes)
   * @param validate fn(facesArray) -> bool  (wraps evaluator.validateEquation)
   * @returns { fixes:[{r,c,from,to}], problems:[[r,c],...] }
   */
  function autoCorrect(board2d, validate) {
    var grid = [];
    for (var r = 0; r < BOARD_SIZE; r++) { var row = []; for (var c = 0; c < BOARD_SIZE; c++) row.push(_resolved(board2d[r][c])); grid.push(row); }

    var fixes = [], problems = {};
    var facesOf = function (cells) { return cells.map(function (p) { return grid[p.r][p.c]; }); };

    var runs = _allRuns(grid).filter(function (run) {
      var f = facesOf(run.cells);
      return f.indexOf('=') >= 0 && f.every(function (x) { return x != null; }); // resolvable equations only
    });

    runs.forEach(function (run) {
      var faces = facesOf(run.cells);
      if (validate(faces)) return;                       // line already fine

      var cands = [];
      run.cells.forEach(function (p, k) {
        var orig = grid[p.r][p.c];
        _candidatesFor(orig).forEach(function (nf) {
          var trial = facesOf(run.cells); trial[k] = nf;
          if (!validate(trial)) return;
          // crossing safety: the perpendicular line through this cell must not
          // turn into a broken equation because of the change.
          var cross = _runThrough(grid, p.r, p.c, run.dir === 'h' ? 'v' : 'h');
          if (cross.length >= 2) {
            var cf = cross.map(function (q) { return (q.r === p.r && q.c === p.c) ? nf : grid[q.r][q.c]; });
            if (cf.every(function (x) { return x != null; }) && cf.indexOf('=') >= 0 && !validate(cf)) return;
          }
          cands.push({ r: p.r, c: p.c, from: orig, to: nf });
        });
      });

      // unique single fix? (dedupe by r,c,to)
      var seen = {}, uniq = [];
      cands.forEach(function (x) { var k = x.r + ',' + x.c + ',' + x.to; if (!seen[k]) { seen[k] = 1; uniq.push(x); } });

      if (uniq.length === 1) {
        var fx = uniq[0];
        board2d[fx.r][fx.c] = _modelFromFace(fx.to);
        grid[fx.r][fx.c] = fx.to;                        // keep resolved grid in sync
        fixes.push(fx);
      } else {
        run.cells.forEach(function (p) { problems[p.r + ',' + p.c] = true; });
      }
    });

    return {
      fixes: fixes,
      problems: Object.keys(problems).map(function (k) { return k.split(',').map(Number); }),
    };
  }

  /**
   * Resolve unassigned choice (±, ×/÷) and BLANK tiles from equation context:
   * pick the value that makes the crossing equation(s) valid. Only assigns when
   * the value is uniquely forced by a fully-resolved equation line.
   * @returns [{r,c,a}]
   */
  function autoAssign(board2d, validate) {
    function gridNow() {
      var g = [];
      for (var r = 0; r < BOARD_SIZE; r++) { var row = []; for (var c = 0; c < BOARD_SIZE; c++) row.push(_resolved(board2d[r][c])); g.push(row); }
      return g;
    }
    var assigns = [], changed = true, guard = 0;
    while (changed && guard++ < 6) {
      changed = false;
      var grid = gridNow();
      for (var r = 0; r < BOARD_SIZE; r++) for (var c = 0; c < BOARD_SIZE; c++) {
        var m = board2d[r][c];
        if (!m || m.assigned) continue;
        var f = m.face, cands;
        if (f === '+/-') cands = ['+', '-'];
        else if (f === '×/÷') cands = ['×', '÷'];
        else if (f === 'BLANK') cands = ['0','1','2','3','4','5','6','7','8','9','+','-'];
        else continue;
        var cr = r, cc = c;
        var H = _runThrough(grid, r, c, 'h');
        var V = _runThrough(grid, r, c, 'v');
        function lineOK(cells, cand) {
          if (cells.length < 2) return true;
          var faces = cells.map(function (p) { return (p.r === cr && p.c === cc) ? cand : grid[p.r][p.c]; });
          if (faces.indexOf('=') === -1) return true;                       // not an equation
          if (faces.some(function (x) { return x == null; })) return true;  // other unresolved → can't judge
          return validate(faces);
        }
        function constrains(cand) {
          return [H, V].some(function (cells) {
            if (cells.length < 2) return false;
            var faces = cells.map(function (p) { return (p.r === cr && p.c === cc) ? cand : grid[p.r][p.c]; });
            return faces.indexOf('=') >= 0 && !faces.some(function (x) { return x == null; });
          });
        }
        var ok = cands.filter(function (cand) { return lineOK(H, cand) && lineOK(V, cand); });
        if (ok.length === 1 && constrains(ok[0])) {
          m.assigned = ok[0];
          assigns.push({ r: r, c: c, a: ok[0] });
          changed = true;
        }
      }
    }
    return assigns;
  }

  var api = {
    RACK_SIZE: RACK_SIZE,
    BOARD_SIZE: BOARD_SIZE,
    CODE_VERSION: CURRENT_CODE_VERSION,
    ASSIGNABLE: ASSIGNABLE,
    makeTile: makeTile,
    emptyBoard: emptyBoard,
    normalizeImport: normalizeImport,
    parseBoardCode: parseBoardCode,
    computeBag: computeBag,
    buildGameState: buildGameState,
    autoCorrect: autoCorrect,
    autoAssign: autoAssign,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node / tests
  }
  if (typeof window !== 'undefined') {
    window.AMath = window.AMath || {};
    window.AMath.boardImport = api;  // browser
  }
})();
