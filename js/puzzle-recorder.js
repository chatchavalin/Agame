/**
 * A-Math — Puzzle Recorder
 *
 * Listens at handleSubmit time during PvA. When all of these are true:
 *   1. Bag has fewer than 25 tiles remaining (late mid-game / endgame)
 *   2. Player has search results available (from education module)
 *   3. Player's chosen play scores meaningfully less than Best 1
 *
 * the recorder snapshots the position + rack + top-3 plays and saves it
 * to localStorage under the key 'amath_puzzle_bank'.
 *
 * Capped at 200 puzzles — when full, the OLDEST entry is dropped (FIFO).
 *
 * Stored shape per entry (matches puzzle.html PUZZLE_BANK format):
 * {
 *   id: timestamp,
 *   capturedAt: ISO date string,
 *   scoreYou: number, scoreOpp: number, bagCount: number,
 *   board: [[r, c, face, assigned?], ...],   // ALL tiles BEFORE player's submitted move
 *   rack: ['2','+','3', ...],                // player's rack tile faces (incl. assigned for BLANK)
 *   bagComp: { face: count, ... },           // unseen tiles for tracker
 *   playerPlay: { score, placements:[{r,c,face}] },  // what player actually did
 *   bestPlays: [                             // top-3 from background solver
 *     { score, tilesUsed, placements:[{r,c,face}], createsX9 },
 *     ...
 *   ],
 *   hint: "Captured from your game"
 * }
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'amath_puzzle_bank';
  var MAX_PUZZLES = 200;
  var BAG_THRESHOLD = 25;
  var MIN_SCORE_DIFF = 5;   // only record if you missed by 5+ points
  var MIN_BEST_SCORE = 8;   // skip if even the best play is trivial

  function loadBank() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveBank(bank) {
    try {
      // Cap at MAX_PUZZLES — drop oldest (front of array)
      while (bank.length > MAX_PUZZLES) bank.shift();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bank));
      return true;
    } catch (e) {
      // localStorage quota exceeded → drop more aggressively
      try {
        while (bank.length > MAX_PUZZLES / 2) bank.shift();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bank));
        return true;
      } catch (e2) { return false; }
    }
  }

  /**
   * Snapshot the board state BEFORE the player's submitted move.
   * session.board ALREADY HAS the tentative placements removed at this point —
   * but if called from handleSubmit BEFORE commitPlayerPlay, the tentativePlacements
   * are still in session.tentativePlacements (separate). Either way, we want the
   * board state WITHOUT the player's just-submitted tiles.
   */
  /**
   * True iff this play completes a full row or column (15 cells) — YoYo.
   * Tests by adding the play's placements to a virtual board copy.
   */
  function isYoyo(session, play, beforeBoardTiles) {
    if (!play || !play.placements || play.placements.length === 0) return false;
    // Build a tile-occupied set from beforeBoardTiles plus play's placements
    var occ = {};
    for (var i = 0; i < beforeBoardTiles.length; i++) {
      var t = beforeBoardTiles[i];
      occ[t[0] + ',' + t[1]] = true;
    }
    play.placements.forEach(function (p) {
      occ[p.row + ',' + p.col] = true;
    });
    // Collect rows/cols touched by the play
    var rows = {}, cols = {};
    play.placements.forEach(function (p) { rows[p.row] = true; cols[p.col] = true; });
    // Check each touched row for full 15
    for (var rk in rows) {
      var ok = true;
      for (var cc = 0; cc < 15; cc++) {
        if (!occ[rk + ',' + cc]) { ok = false; break; }
      }
      if (ok) return true;
    }
    for (var ck in cols) {
      var ok2 = true;
      for (var rr = 0; rr < 15; rr++) {
        if (!occ[rr + ',' + ck]) { ok2 = false; break; }
      }
      if (ok2) return true;
    }
    return false;
  }

  function isBingo(play) {
    return play && play.placements && play.placements.length >= 8;
  }

  function snapshotBoardBeforeMove(session, submittedPlacements) {
    var tiles = [];
    var submittedSet = new Set();
    if (submittedPlacements) {
      submittedPlacements.forEach(function (p) { submittedSet.add(p.row + ',' + p.col); });
    }
    for (var r = 0; r < 15; r++) {
      for (var c = 0; c < 15; c++) {
        var cell = session.board.cells[r][c];
        if (!cell.tile) continue;
        // Skip tiles that are part of the player's just-submitted move
        if (submittedSet.has(r + ',' + c)) continue;
        var face = cell.tile.face;
        var assigned = cell.tile.assigned || null;
        if (assigned) tiles.push([r, c, face, assigned]);
        else tiles.push([r, c, face]);
      }
    }
    return tiles;
  }

  /**
   * Snapshot the rack — the EXACT 8 tiles the player had on their rack at decision time.
   * The placements take some tiles off, but we want all 8 because puzzle replay
   * needs to recreate the original rack.
   */
  function snapshotRack(session, submittedPlacements) {
    var Rack = window.AMath.rack;
    var rack = session.playerRack;
    var faces = [];
    // Get all tiles currently in rack
    if (rack && rack.tiles) {
      rack.tiles.forEach(function (t) {
        if (t) faces.push(t.assigned || t.face);
      });
    }
    // Add back the submitted placements (those tiles came FROM the rack)
    if (submittedPlacements) {
      submittedPlacements.forEach(function (p) {
        // p.tile.face is the original rack face. For BLANK with assigned, store face='BLANK' so puzzle
        // replay shows it as a BLANK that needs assignment.
        faces.push(p.tile.face);
      });
    }
    return faces;
  }

  /**
   * Compute remaining unseen tiles given current board + rack.
   * Used as the bagComp data for the tile tracker.
   */
  function computeBagComp(session, submittedPlacements) {
    var C = window.AMath.constants;
    var inv = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    var counts = {};
    inv.forEach(function (d) { counts[d.face] = d.count; });
    // Subtract tiles on board (before player's submitted move)
    var submittedSet = new Set();
    if (submittedPlacements) {
      submittedPlacements.forEach(function (p) { submittedSet.add(p.row + ',' + p.col); });
    }
    for (var r = 0; r < 15; r++) {
      for (var c = 0; c < 15; c++) {
        var cell = session.board.cells[r][c];
        if (cell.tile && !submittedSet.has(r + ',' + c)) {
          counts[cell.tile.face] = (counts[cell.tile.face] || 0) - 1;
        }
      }
    }
    // Subtract rack
    if (session.playerRack && session.playerRack.tiles) {
      session.playerRack.tiles.forEach(function (t) {
        if (t) counts[t.face] = (counts[t.face] || 0) - 1;
      });
    }
    // Also subtract placements (since they came from rack)
    if (submittedPlacements) {
      submittedPlacements.forEach(function (p) {
        counts[p.tile.face] = (counts[p.tile.face] || 0) - 1;
      });
    }
    // Subtract any tiles in opponent rack
    if (session.aiRack && session.aiRack.tiles) {
      session.aiRack.tiles.forEach(function (t) {
        if (t) counts[t.face] = (counts[t.face] || 0) - 1;
      });
    }
    // Clean up to non-negative counts only
    var result = {};
    for (var f in counts) {
      if (counts.hasOwnProperty(f) && counts[f] > 0) result[f] = counts[f];
    }
    return result;
  }

  /**
   * Convert education.js play placements to puzzle bank format.
   * play.placements has objects with .row, .col, .tile (tile object).
   */
  function convertPlay(play) {
    if (!play || !play.placements) return null;
    return {
      score: play.score,
      tilesUsed: play.tilesUsed || play.placements.length,
      placements: play.placements.map(function (p) {
        var face = (p.tile && (p.tile.assigned || p.tile.face)) || p.face || '?';
        return { row: p.row, col: p.col, face: face };
      }),
      createsX9: !!play.createsX9,
    };
  }

  /**
   * Main entry — called from main.js's handleSubmit AFTER validation
   * but BEFORE commitPlayerPlay applies the play.
   *
   * Args:
   *   session: full PvA session
   *   scoreResult: { total, equations, ... } from Scoring.scorePlay()
   *   educationResult: searchResult from education.js (may be null if not searched)
   */
  function maybeRecord(session, scoreResult, educationResult) {
    try {
      // Early exits
      if (!session || !session.bag) return;
      var bagCount = session.bag.tiles ? session.bag.tiles.length : 0;
      if (bagCount >= BAG_THRESHOLD) return;

      if (!educationResult || !educationResult.plays || educationResult.plays.length === 0) return;
      var bestPlay = educationResult.plays[0];
      if (!bestPlay || !bestPlay.score || bestPlay.score < MIN_BEST_SCORE) return;

      var playerScore = scoreResult ? scoreResult.total : 0;
      var diff = bestPlay.score - playerScore;
      if (diff < MIN_SCORE_DIFF) return;  // player did good enough — not a teaching moment

      // Snapshot the pre-move board ONCE (we need it for the yoyo check too)
      var placements = session.tentativePlacements || [];
      var beforeBoardTiles = snapshotBoardBeforeMove(session, placements);

      // ── KEY REQUIREMENT (added v19) ──
      // At least one of the top-3 best plays must be a BINGO (8+ tiles) or YOYO
      // (completes a 15-cell row/col). Otherwise this isn't a teaching moment
      // worth saving — it's just an ordinary points-leak.
      var hasBigPlay = false;
      for (var bi = 0; bi < educationResult.plays.length && bi < 3; bi++) {
        var pl = educationResult.plays[bi];
        if (isBingo(pl) || isYoyo(session, pl, beforeBoardTiles)) {
          hasBigPlay = true;
          break;
        }
      }
      if (!hasBigPlay) return;

      var bank = loadBank();

      // Convert top-3 plays (annotated with bingo/yoyo flags so puzzle UI can tag them)
      var bestPlays = [];
      for (var i = 0; i < educationResult.plays.length && i < 3; i++) {
        var converted = convertPlay(educationResult.plays[i]);
        if (!converted) continue;
        converted.isBingo = isBingo(educationResult.plays[i]);
        converted.isYoyo = isYoyo(session, educationResult.plays[i], beforeBoardTiles);
        bestPlays.push(converted);
      }
      if (bestPlays.length === 0) return;

      var puzzle = {
        id: Date.now(),
        capturedAt: new Date().toISOString(),
        scoreYou: session.playerScore || 0,
        scoreOpp: session.aiScore || 0,
        bagCount: bagCount,
        board: beforeBoardTiles,
        rack: snapshotRack(session, placements),
        bagComp: computeBagComp(session, placements),
        playerPlay: {
          score: playerScore,
          placements: placements.map(function (p) {
            return {
              row: p.row, col: p.col,
              face: (p.tile.assigned || p.tile.face),
            };
          }),
        },
        bestPlays: bestPlays,
        hint: 'Captured from your PvA game on ' + new Date().toLocaleDateString() +
              ' — you scored ' + playerScore + ', best was ' + bestPlay.score + '.',
      };

      bank.push(puzzle);
      saveBank(bank);
      console.log('[PuzzleRecorder] Saved puzzle #' + bank.length +
                  ' (you ' + playerScore + ' vs best ' + bestPlay.score + ', bag ' + bagCount + ')');
    } catch (e) {
      console.warn('[PuzzleRecorder] Failed:', e);
    }
  }

  function getBank() { return loadBank(); }

  function clearBank() {
    try { localStorage.removeItem(STORAGE_KEY); return true; } catch (e) { return false; }
  }

  window.AMath = window.AMath || {};
  window.AMath.puzzleRecorder = {
    maybeRecord: maybeRecord,
    getBank: getBank,
    clearBank: clearBank,
    MAX: MAX_PUZZLES,
    BAG_THRESHOLD: BAG_THRESHOLD,
  };
})();
