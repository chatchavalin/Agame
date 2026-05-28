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
  var CURRENT_CODE_VERSION = 1;

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

    // --- board cells ---
    var board = [];
    var seen = {};
    (obj.board || []).forEach(function (cell, i) {
      var r = parseInt(cell.r, 10);
      var c = parseInt(cell.c, 10);
      var f = cell.f;
      if (isNaN(r) || isNaN(c) || r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) {
        errors.push('Board entry ' + i + ': bad cell (' + cell.r + ',' + cell.c + ').');
        return;
      }
      var key = r + ',' + c;
      if (seen[key]) { errors.push('Two tiles on the same cell ' + key + '.'); return; }
      var norm = normalizeFace(cell.f, cell.a);
      var f = norm.f;
      if (!inv[f]) { errors.push('Cell ' + key + ': unknown face "' + cell.f + '".'); return; }
      var entry = { r: r, c: c, f: f };
      var def = inv[f];
      if (def.type === 'choice' || def.type === 'blank') {
        if (norm.a == null || norm.a === '') {
          warnings.push('Cell ' + key + ' (' + f + ') needs a chosen value (+,−,×,÷ or a number).');
        } else if (ASSIGNABLE.indexOf(String(norm.a)) === -1) {
          errors.push('Cell ' + key + ': invalid chosen value "' + norm.a + '".');
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
      if (!inv[nr.f]) { errors.push('Rack slot ' + i + ': unknown face "' + rawF + '".'); return; }
      var ri = { f: nr.f };
      if (nr.a != null && nr.a !== '') ri.a = String(nr.a);
      rack.push(ri);
    });
    if (rack.length > RACK_SIZE) {
      errors.push('Rack has ' + rack.length + ' tiles (max ' + RACK_SIZE + ').');
    }

    // --- inventory overflow check (board + rack can't exceed real tile counts) ---
    var used = {};
    board.forEach(function (e) { used[e.f] = (used[e.f] || 0) + 1; });
    rack.forEach(function (e) { used[e.f] = (used[e.f] || 0) + 1; });
    Object.keys(used).forEach(function (face) {
      var def = inv[face];
      if (def && used[face] > def.count) {
        errors.push('Used ' + used[face] + ' × "' + face + '" but only ' + def.count + ' exist.');
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
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node / tests
  }
  if (typeof window !== 'undefined') {
    window.AMath = window.AMath || {};
    window.AMath.boardImport = api;  // browser
  }
})();
