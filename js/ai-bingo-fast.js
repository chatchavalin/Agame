/**
 * A-Math AI — Fast Bingo Search via Pattern Matching
 *
 * Uses ai-patterns-data + ai-patterns-engine to find an 8-tile Bingo
 * MUCH faster than brute-force search, especially when the rack has
 * multiple BLANKs.
 *
 * High-level algorithm:
 *   1. For each adjacent board tile (potential anchor):
 *        a. Form combined candidate rack = AI's 8 tiles + 1 board tile
 *        b. Find viable patterns matching the rack composition
 *        c. For each pattern:
 *             - Try each template
 *             - If engine finds a valid assignment, build board placements
 *             - Check placements actually fit on the board
 *             - Return the first valid Bingo
 *   2. If no Bingo found via patterns → return null (caller falls back to brute force)
 *
 * NOTE: This module ONLY handles 8-tile Bingo plays (size-9 candidate rack).
 *       Smaller plays (YoYo, partial) still use the existing brute force.
 */

(function () {
  const C = window.AMath.constants;
  const Board = window.AMath.board;
  const Eval = window.AMath.evaluator;
  const PatternsData = window.AMath.patternsData;
  const PatternsEngine = window.AMath.patternsEngine;
  const Scoring = window.AMath.scoring;

  /**
   * Attempt to find an 8-tile Bingo using pattern matching.
   * @param state: { board, aiRack, isFirstMove, ... }
   * @param timeLimitMs: max time to spend on this search
   * @returns { type: 'play', placements, score, equations } or null
   */
  function findFastBingo(state, timeLimitMs) {
    if (!PatternsData || !PatternsEngine) {
      console.log('[FastBingo] Pattern modules not available — skipping');
      return null;
    }
    timeLimitMs = timeLimitMs || 5000;
    const startTime = Date.now();
    const aiTiles = state.aiRack.tiles;
    if (aiTiles.length < 8) return null;     // not a full rack — no Bingo possible

    // ── First move case: no adjacent tiles, just play through center (7,7) ──
    if (state.isFirstMove) {
      return tryFirstMoveBingo(state, startTime, timeLimitMs);
    }

    // ── Normal case: find anchor tiles on the board ──
    const anchors = findAnchorTiles(state.board);
    if (anchors.length === 0) return null;

    const aiX9 = window.AMath.aiX9;
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    let attemptsCount = 0;
    let skippedDead = 0;

    // Cross-anchor optimization: after the first Bingo is found, keep
    // exploring OTHER anchors for a short bonus window. Different anchors can
    // place the same equation pattern in different positions, hitting
    // different premium squares for a higher score.
    let bestResult = null;
    let bestScore = -1;
    let bonusDeadline = null;
    const ANCHOR_BONUS_MS = 1200;

    for (const anchor of anchors) {
      const now = Date.now();
      if (now - startTime > timeLimitMs) {
        console.log('[FastBingo] Time limit reached after ' + attemptsCount + ' anchor attempts');
        break;
      }
      if (bonusDeadline && now > bonusDeadline) break;

      // Syntactic pre-filter: skip anchors whose every adjacent empty cell is
      // syntactically dead (no tile of any type can legally fit).
      if (aiX9 && aiX9.isCellDead) {
        let hasLive = false;
        for (const [dr, dc] of dirs) {
          const nr = anchor.row + dr, nc = anchor.col + dc;
          if (nr < 0 || nr >= C.BOARD_SIZE || nc < 0 || nc >= C.BOARD_SIZE) continue;
          const ncell = Board.getCell(state.board, nr, nc);
          if (!ncell || ncell.tile) continue;
          if (!aiX9.isCellDead(state.board, nr, nc, null)) { hasLive = true; break; }
        }
        if (!hasLive) { skippedDead++; continue; }
      }

      const result = tryBingoAtAnchor(state, anchor, startTime, timeLimitMs);
      attemptsCount++;
      if (result && (result.score || 0) > bestScore) {
        bestScore = result.score || 0;
        bestResult = result;
        if (!bonusDeadline) {
          bonusDeadline = Date.now() + ANCHOR_BONUS_MS;
        }
      }
    }

    if (bestResult) {
      console.log('[FastBingo] Found Bingo (score=' + bestScore + ') in ' +
                  (Date.now() - startTime) + 'ms after checking ' +
                  attemptsCount + ' anchors' +
                  (skippedDead > 0 ? ', ' + skippedDead + ' skipped as dead' : ''));
      return bestResult;
    }

    console.log('[FastBingo] No pattern Bingo found after checking ' + attemptsCount + ' anchors (' + (Date.now() - startTime) + 'ms)' +
                (skippedDead > 0 ? ', ' + skippedDead + ' skipped as syntactically dead' : ''));
    return null;
  }

  /**
   * For an anchor tile already placed on the board:
   *   - If it's a BLANK with an .assigned face, return a synthetic tile of the
   *     equivalent concrete type (so the engine treats it as a fixed digit/op/=).
   *   - If it's a choice tile (+/-, ×/÷) with .assigned, similar treatment.
   *   - Otherwise, return as-is.
   * The returned tile keeps the original id so we can recognize it later.
   */
  function concretizeAnchorTile(tile) {
    if (!tile.assigned) return tile;

    const face = tile.assigned;
    // What's the type of the assigned face?
    if (face === '=') {
      return { ...tile, type: 'equals', face: '=', _originalType: tile.type };
    }
    if (face === '+' || face === '-' || face === '×' || face === '÷') {
      return { ...tile, type: 'op', face: face, _originalType: tile.type };
    }
    // Otherwise it's a number
    if (face.length === 1) {
      return { ...tile, type: 'digit', face: face, _originalType: tile.type };
    } else {
      // Multi-digit like '10', '20'
      return { ...tile, type: 'twodigit', face: face, _originalType: tile.type };
    }
  }

  /**
   * Find all board tiles that are adjacent to at least one empty cell.
   * These are potential "anchor" tiles a Bingo can hook onto.
   */
  function findAnchorTiles(board) {
    const anchors = [];
    const effectiveFace = (window.AMath.placement && window.AMath.placement.effectiveFace)
      ? window.AMath.placement.effectiveFace
      : function(t) { return t.assigned || t.face; };
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = Board.getCell(board, r, c);
        if (!cell || !cell.tile) continue;
        // Check 4 neighbors
        const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          const nc2 = Board.getCell(board, nr, nc);
          if (nc2 && !nc2.tile) {
            anchors.push({ row: r, col: c, tile: cell.tile, face: effectiveFace(cell.tile) });
            break;
          }
        }
      }
    }
    return anchors;
  }

  /**
   * Try to find an 8-tile Bingo hooking onto a specific anchor tile.
   *
   * Strategy:
   *   - Combine AI rack (8 tiles) with this 1 anchor tile → 9-tile candidate
   *   - Compute candidate composition (#ops of each type, #numbers, #equals, #blanks)
   *   - Find viable patterns
   *   - For each pattern, try each template
   *   - If template assigns successfully, convert to placements & verify on board
   */
  function tryBingoAtAnchor(state, anchor, startTime, timeLimitMs) {
    const aiTiles = state.aiRack.tiles;
    const candidateTiles = aiTiles.slice();    // 8 tiles

    // Convert anchor to a "concrete" tile representation for the engine.
    // If the anchor is a BLANK already placed (and thus assigned to a value),
    // treat it as a fixed tile of that effective type so the engine can't
    // re-assign it. Same for choice tiles.
    const anchorConcrete = concretizeAnchorTile(anchor.tile);
    candidateTiles.push(anchorConcrete);       // 9 tiles

    // Categorize for pattern matching
    const composition = composeRack(candidateTiles);

    // Filter quick: need exactly 1 equals (or BLANK to become equals)
    if (composition.equals + composition.blanks < 1) return null;

    // Find viable patterns
    const viable = PatternsData.findViablePatterns(composition);
    if (viable.length === 0) return null;

    // Try each viable pattern
    for (const pattern of viable) {
      if (Date.now() - startTime > timeLimitMs) return null;

      for (const tmplStr of pattern.templates) {
        if (Date.now() - startTime > timeLimitMs) return null;

        // Skip unary-minus templates for now — they require extra tile accounting
        // that the current engine doesn't handle precisely.
        if (tmplStr.indexOf('-x') === 0 || tmplStr.indexOf('= -x') !== -1) continue;

        const tmpl = PatternsEngine.parseTemplate(tmplStr);
        if (!tmpl) continue;

        // Try to assign — must include the anchor tile somewhere
        const result = PatternsEngine.tryAssign(tmpl, categorizeRackForEngine(candidateTiles), 10000);
        if (!result) continue;

        // Check: does the assignment USE the anchor tile?
        // Use the concretized tile (matches what the engine sees in its pools)
        const usesAnchor = assignmentUsesTile(result, anchorConcrete);
        if (!usesAnchor) {
          if (window._FAST_DEBUG) console.log('[Debug] pattern', tmplStr, '→', result.faces.join(' '), 'but anchor not used');
          continue;
        }

        // Now figure out HOW to place the AI tiles on the board.
        const placements = buildPlacements(state.board, result, anchor, aiTiles, candidateTiles);
        if (!placements) {
          if (window._FAST_DEBUG) console.log('[Debug] pattern', tmplStr, '→', result.faces.join(' '), 'buildPlacements failed');
          continue;
        }

        // Final validation
        const validation = validatePlacements(state.board, placements);
        if (!validation.ok) {
          if (window._FAST_DEBUG) console.log('[Debug] pattern', tmplStr, '→', result.faces.join(' '), 'validation failed:', validation.reason);
          continue;
        }

        // Compute score using game's scoring module
        let score = 0;
        let equations = validation.equations || [];
        if (Scoring && Scoring.scorePlay && equations.length > 0) {
          // Apply tiles temporarily so scorePlay can read the board correctly
          const applied = [];
          try {
            for (const p of placements) {
              if (p.assigned) p.tile.assigned = p.assigned;
              Board.placeTile(state.board, p.row, p.col, p.tile);
              applied.push(p);
            }
            const s = Scoring.scorePlay(equations, state.board, placements.length);
            score = s.total;
          } finally {
            for (const p of applied) {
              Board.removeTile(state.board, p.row, p.col);
            }
          }
        }

        return {
          type: 'play',
          placements: placements,
          score: score,
          equations: equations,
        };
      }
    }
    return null;
  }

  /**
   * Try Bingo on first move (place through center cell).
   * NOT YET IMPLEMENTED — would require 8-cell patterns (separate from size-9).
   * On first move, AI falls back to brute force.
   *
   * Future: add SIZE_8_PATTERNS to ai-patterns-data with patterns like:
   *   xx = xxx o x      (1 eq, 1 op, 5 nums)
   *   x o x = xx o x    (1 eq, 2 ops, 5 nums)
   *   x = x = xx o x    (2 eq, 1 op, 5 nums)
   *   etc.
   */
  function tryFirstMoveBingo(state, startTime, timeLimitMs) {
    return null;
  }

  /**
   * Categorize candidate rack for the pattern data module (used by findViablePatterns).
   * Returns: { digits, twodigits, ops:{+:N,-:N,×:N,÷:N}, equals, blanks, choices:{+/-:N,×/÷:N} }
   */
  function composeRack(tiles) {
    const result = {
      digits: 0, twodigits: 0,
      ops: { '+': 0, '-': 0, '×': 0, '÷': 0 },
      equals: 0, blanks: 0,
      choices: { '+/-': 0, '×/÷': 0 },
    };
    for (const t of tiles) {
      if (t.type === 'digit') result.digits++;
      else if (t.type === 'twodigit') result.twodigits++;
      else if (t.type === 'op') {
        if (result.ops[t.face] !== undefined) result.ops[t.face]++;
      }
      else if (t.type === 'choice') {
        if (t.face === '+/-') result.choices['+/-']++;
        else if (t.face === '×/÷') result.choices['×/÷']++;
      }
      else if (t.type === 'equals') result.equals++;
      else if (t.type === 'blank') result.blanks++;
    }
    return result;
  }

  /**
   * Categorize for the engine (returns the structured form it expects).
   */
  function categorizeRackForEngine(tiles) {
    return PatternsEngine.categorizeRack(tiles);
  }

  /**
   * Check whether an assignment result actually uses a specific tile.
   * (We need the Bingo to include the anchor tile.)
   */
  /**
   * Check whether an assignment result actually uses a specific tile.
   * (We need the Bingo to include the anchor tile.)
   *
   * The anchor can be:
   *   - A number tile (digit/twodigit) → appears in slot.assignedTiles
   *   - An operator tile (+, -, ×, ÷) → consumed as one of the equation's ops
   *   - An equals tile (=) → consumed as the equation's =
   *   - A choice tile (+/-, ×/÷) → consumed as one of the equation's ops
   *
   * For non-number anchors: if the assignment is valid AND the rack contains
   * exactly one tile matching what the anchor provides, we assume it's used
   * (since we built the rack INCLUDING the anchor).
   */
  function assignmentUsesTile(result, tile) {
    // Number tile check
    for (const slot of result.slots) {
      if (!slot.assignedTiles) continue;
      for (const t of slot.assignedTiles) {
        if (t.id === tile.id) return true;
      }
    }
    // For ops/equals/choice tiles, we accept that they're used IF the template
    // needs the matching operator. We do a sanity check that result.faces
    // includes a face the anchor could provide.
    if (!result.faces) return false;
    if (tile.type === 'equals') {
      return result.faces.indexOf('=') !== -1;
    }
    if (tile.type === 'op') {
      return result.faces.indexOf(tile.face) !== -1;
    }
    if (tile.type === 'choice') {
      if (tile.face === '+/-') {
        return result.faces.indexOf('+') !== -1 || result.faces.indexOf('-') !== -1;
      }
      if (tile.face === '×/÷') {
        return result.faces.indexOf('×') !== -1 || result.faces.indexOf('÷') !== -1;
      }
    }
    return false;
  }

  /**
   * Build board placements from the assignment result.
   * The anchor tile stays at its existing position; figure out positions for
   * the other 8 tiles such that they form a contiguous equation with the anchor.
   *
   * Returns array of {row, col, tile, assigned?} or null if can't place.
   */
  function buildPlacements(board, result, anchor, aiTiles, candidateTiles) {
    // The result has `faces` = the equation tokens in order, left-to-right
    // (e.g., ['1', '2', '5', '+', '3', '=', '1', '2', '8'])
    // We need to map each token to a tile (from result.slots) and put them on the board
    // in a contiguous row or column, with the anchor at its existing position.

    if (!result.faces) return null;

    // Build a list of "place items": each is (face, tile, isAnchor, blankFace?)
    // Use candidateTiles (all 9) for op/equals matching, since anchor might be the only '='
    const tokens = buildTokensList(result, candidateTiles || aiTiles);
    if (!tokens) return null;

    // Find anchor's position in the tokens list
    let anchorIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].tile && tokens[i].tile.id === anchor.tile.id) {
        anchorIdx = i;
        break;
      }
    }
    if (anchorIdx === -1) return null;

    // Try placing horizontally
    const hPlacements = tryPlaceLine(board, tokens, anchorIdx, anchor.row, anchor.col, 'h');
    if (hPlacements) return hPlacements;

    // Try placing vertically
    const vPlacements = tryPlaceLine(board, tokens, anchorIdx, anchor.row, anchor.col, 'v');
    if (vPlacements) return vPlacements;

    return null;
  }

  /**
   * Build a list of tokens from the assignment result, one per equation cell.
   * Each token: { face, tile, isOperator, isEquals, isBlank, blankFace }
   *
   * The equation faces are in result.faces. The tile assignments are in result.slots.
   * We need to walk the slots and align tiles to face positions.
   *
   * Also need to identify which tiles are "BLANKs for ops" (allocated to fill missing ops/equals).
   */
  function buildTokensList(result, aiTiles) {
    // result.slots has number slots assigned. Now we need to also account for ops and equals
    // and BLANKs that were used as ops.
    //
    // Approach: walk through result.faces, building a token per face character.
    // For each face character, determine which TILE produced it.

    const tokens = [];
    const slotsByCellIdx = {};
    // Build a mapping from face-index to slot info
    // Number slots emit `size` face characters; ops emit 1 char each.

    // We need to reconstruct: walk through result.faces, and at each position determine
    // whether it's a number cell (from a slot) or an op/equals cell.

    // result.slots is ordered: lhs slots first, then rhs slots
    // result.faces has unary '-' inserted for slots with unary='-'

    // Let me reconstruct by simulating buildAndValidate's output ordering.
    // Easier: just walk slots and ops together.

    const lhsSlots = result.slots.filter(s => s.side === 'lhs');
    const rhsSlots = result.slots.filter(s => s.side === 'rhs');

    // We don't know exactly which op tiles were used yet — that info isn't
    // tracked precisely. We'll match later using the rack tiles.
    //
    // For now, just emit tokens in equation order:
    //   - For each lhs slot: if unary '-', emit a '-' token (op); then emit each digit
    //   - Between slots: emit the operator from template
    //   - Then '='
    //   - Then rhs slots similarly

    let blanksForOpsRemaining = (result.blanksForOps || []).slice();

    function emitSlot(slot) {
      if (slot.unary === '-') {
        tokens.push({ face: '-', isOperator: true });
      }
      for (let i = 0; i < slot.assignedTiles.length; i++) {
        const tile = slot.assignedTiles[i];
        let face;
        if (tile.type === 'blank') {
          face = slot.assignedBlankFaces[i];
        } else {
          face = tile.face;
        }
        tokens.push({
          face: face,
          tile: tile,
          isOperator: false,
          isBlank: tile.type === 'blank',
          blankFace: tile.type === 'blank' ? face : null,
        });
      }
    }

    function emitOp(opChar, opLookupAiTiles) {
      // Find an AI tile (op tile, or BLANK allocated as op) that matches this op
      // Simplification: pop a tile from blanksForOpsRemaining if available, else from aiTiles
      // (we won't be super-strict about which tile becomes which op — we just need to know
      //  what tile to physically place on the board)
      tokens.push({
        face: opChar,
        isOperator: true,
        // tile reference will be filled in later by matchTokensToRackTiles
      });
    }

    // Now: we need template ops too. They're not stored in result directly.
    // For this we need to know which template was used. Currently result doesn't track this.
    // FIX: I'll modify the engine to also return the template/op info.

    // TEMP: derive ops from result.faces by skipping number characters
    // result.faces has tokens like ['1','2','5','+','3','=','1','2','8']
    // We can iterate result.faces and emit a token per face,
    // matching number faces to slot tiles in order.

    const faces = result.faces;
    let slotIdx = 0;
    let withinSlotIdx = 0;
    let unaryEmitted = false;

    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];

      if (face === '=') {
        tokens.push({ face: '=', isEquals: true });
        unaryEmitted = false;
        continue;
      }

      if (face === '+' || face === '×' || face === '÷') {
        tokens.push({ face: face, isOperator: true });
        unaryEmitted = false;
        continue;
      }

      if (face === '-') {
        // Could be unary or binary. Check: is the next character a number AND the previous was an op or start?
        // For now, just emit as operator (binary or unary doesn't matter for placement)
        tokens.push({ face: '-', isOperator: true });
        continue;
      }

      // Otherwise: digit face. Map to current slot's tile.
      const slot = result.slots[slotIdx];
      if (!slot) return null;

      const tile = slot.assignedTiles[withinSlotIdx];
      const isBlank = tile && tile.type === 'blank';

      tokens.push({
        face: face,
        tile: tile,
        isOperator: false,
        isBlank: isBlank,
        blankFace: isBlank ? face : null,
      });

      withinSlotIdx++;
      if (withinSlotIdx >= slot.assignedTiles.length) {
        slotIdx++;
        withinSlotIdx = 0;
      }
    }

    // Now match operator tokens to AI tile op/equals/blank tiles
    matchOpTokensToTiles(tokens, aiTiles, result);

    return tokens;
  }

  /**
   * Match operator/equals tokens to actual tiles from AI's rack.
   * Modifies tokens in place to add .tile to each operator/equals token.
   */
  function matchOpTokensToTiles(tokens, aiTiles, result) {
    // Build pools
    const opPool = {};      // op char → list of tile objects (excluding number tiles)
    const blanksAvailableForOps = (result.blanksForOps || []).slice();

    for (const t of aiTiles) {
      if (t.type === 'op') {
        opPool[t.face] = opPool[t.face] || [];
        opPool[t.face].push(t);
      } else if (t.type === 'equals') {
        opPool['='] = opPool['='] || [];
        opPool['='].push(t);
      } else if (t.type === 'choice') {
        // Choice tiles can fill either op
        if (t.face === '+/-') {
          opPool['+'] = opPool['+'] || []; opPool['+'].push({ ...t, _choiceForce: '+' });
          opPool['-'] = opPool['-'] || []; opPool['-'].push({ ...t, _choiceForce: '-' });
        } else if (t.face === '×/÷') {
          opPool['×'] = opPool['×'] || []; opPool['×'].push({ ...t, _choiceForce: '×' });
          opPool['÷'] = opPool['÷'] || []; opPool['÷'].push({ ...t, _choiceForce: '÷' });
        }
      }
    }

    for (const tok of tokens) {
      if (tok.tile) continue;  // already has tile (number token)
      if (tok.isEquals) {
        if (opPool['='] && opPool['='].length > 0) {
          tok.tile = opPool['='].shift();
        } else if (blanksAvailableForOps.length > 0) {
          const blank = blanksAvailableForOps.shift();
          tok.tile = blank;
          tok.assigned = '=';
        }
      } else if (tok.isOperator) {
        const op = tok.face;
        if (opPool[op] && opPool[op].length > 0) {
          const tile = opPool[op].shift();
          tok.tile = tile;
          if (tile._choiceForce) tok.assigned = tile._choiceForce;
        } else if (blanksAvailableForOps.length > 0) {
          const blank = blanksAvailableForOps.shift();
          tok.tile = blank;
          tok.assigned = op;
        }
      }
    }
  }

  /**
   * Place tokens on the board horizontally or vertically, with the anchor at (r0, c0)
   * and anchorIdx being the index of the anchor in the tokens list.
   * Returns array of {row, col, tile, assigned?} for the NEW placements (excluding anchor),
   * or null if the line doesn't fit.
   */
  function tryPlaceLine(board, tokens, anchorIdx, r0, c0, orientation) {
    // Tokens are emitted left-to-right. Anchor is at position anchorIdx.
    // The cells they occupy are continuous: anchor at (r0, c0), tokens left of anchor go left/up,
    // tokens right of anchor go right/down.
    const placements = [];

    // Direction vectors
    const dr = orientation === 'v' ? 1 : 0;
    const dc = orientation === 'h' ? 1 : 0;

    // Walk tokens in order
    for (let i = 0; i < tokens.length; i++) {
      const offset = i - anchorIdx;
      const r = r0 + offset * dr;
      const c = c0 + offset * dc;

      // Bounds check
      if (r < 0 || r >= C.BOARD_SIZE || c < 0 || c >= C.BOARD_SIZE) return null;

      const cell = Board.getCell(board, r, c);
      if (!cell) return null;

      if (i === anchorIdx) {
        // This cell must have the anchor tile already
        if (!cell.tile || cell.tile.id !== tokens[i].tile.id) return null;
        // OK, skip (don't add to placements)
        continue;
      }

      // Cell must be empty for new placement
      if (cell.tile) return null;

      // For BLANK tiles, set the assigned face (either from operator allocation
      // or from number assignment via blankFace)
      let assigned = tokens[i].assigned;
      if (!assigned && tokens[i].isBlank && tokens[i].blankFace) {
        assigned = tokens[i].blankFace;
      }

      placements.push({
        row: r,
        col: c,
        tile: tokens[i].tile,
        assigned: assigned,
      });
    }

    if (placements.length !== 8) return null;     // must be exactly 8 (Bingo)
    return placements;
  }

  /**
   * Validate placements don't create invalid cross-equations and ALL cross-equations are valid.
   */
  function validatePlacements(board, placements) {
    if (!window.AMath.placement || !window.AMath.placement.validatePlay) {
      return { valid: true };  // skip if placement module missing
    }
    // Fast pre-filter: skip obviously illegal placements (digit next to
    // twodigit, op next to op, etc.) without running full validation.
    if (window.AMath.aiX9 && window.AMath.aiX9.isPlaySyntacticallyLegal) {
      if (!window.AMath.aiX9.isPlaySyntacticallyLegal(board, placements)) {
        return { valid: false, reason: 'syntactic pre-check failed' };
      }
    }
    // Simulate placing tiles temporarily
    const applied = [];
    try {
      for (const p of placements) {
        const tile = p.tile;
        if (p.assigned) tile.assigned = p.assigned;
        Board.placeTile(board, p.row, p.col, tile);
        applied.push(p);
      }
      const result = window.AMath.placement.validatePlay(board, placements);
      // validatePlay returns { ok, reason, equations, ... } — normalize to { valid, reason, equations }
      return {
        valid: result.ok !== false,
        reason: result.reason,
        equations: result.equations,
      };
    } catch (err) {
      return { valid: false, reason: 'validation error: ' + err.message };
    } finally {
      for (const p of applied) {
        Board.removeTile(board, p.row, p.col);
      }
    }
  }

  window.AMath = window.AMath || {};
  window.AMath.aiBingoFast = {
    findFastBingo: findFastBingo,
  };
})();
