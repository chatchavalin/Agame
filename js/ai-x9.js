/**
 * A-Math AI — ×9 Threat Detection, Defense, and Offense
 *
 * ×9 occurs when an equation passes through TWO empty 3E squares in the same
 * row/col, giving a 3×3 = 9 multiplier on the equation.
 *
 * Detection happens on 6 lines: row 0, 7, 14 and col 0, 7, 14.
 *
 * Per line, 3 patterns:
 *   - Between positions 0 and 7 (corner-to-middle)
 *   - Between positions 7 and 14 (middle-to-corner)
 *   - Between positions 0 and 14 (entire line)
 *
 * Per PDF (full implementation):
 *   Threat exists when:
 *     1. Both 3E squares empty
 *     2. ≤5 empty cells between (or ≤6 for entire-line)
 *     3. Adjacent tile usable by opponent (Case 3.1: on line between 3Es,
 *        OR Case 3.2: on subrim, one row/col away, forming T-shape)
 *   Exceptions: certain two-digit tiles at corner-adjacent positions block ×9.
 *
 * Defense priority (when threat detected):
 *   1. Play ×9 yourself (best — block + score)
 *   2. Place equation on one of the 3E squares
 *   3. Subrim equation (longer = better)
 */

(function () {
  const C = window.AMath.constants;
  const Board = window.AMath.board;

  /**
   * Detect ALL ×9 threats currently on the board.
   * @returns array of threat objects, each: { line, threeE_a, threeE_b, adjacentInfo, severity }
   */
  function detectAllThreats(board) {
    const threats = [];

    for (const line of C.X9_LINES) {
      const lineThreats = detectThreatsOnLine(board, line);
      for (const t of lineThreats) threats.push(t);
    }

    return threats;
  }

  /**
   * Detect ×9 threats on a specific line.
   */
  function detectThreatsOnLine(board, line) {
    const threats = [];
    const cells = getLineCells(board, line);

    // 3 patterns: (0,7), (7,14), (0,14)
    const patterns = [
      { a: 0, b: 7, maxEmpty: 5 },
      { a: 7, b: 14, maxEmpty: 5 },
      { a: 0, b: 14, maxEmpty: 6 }, // entire line allows ≤6
    ];

    for (const p of patterns) {
      // Both endpoints must be empty
      if (cells[p.a].tile || cells[p.b].tile) continue;

      // Count empty cells between
      let emptyBetween = 0;
      for (let i = p.a + 1; i < p.b; i++) {
        if (!cells[i].tile) emptyBetween++;
      }
      const totalBetween = p.b - p.a - 1;
      const nonEmptyBetween = totalBetween - emptyBetween;

      // Skip if too few empty cells between (whole span filled = no threat)
      // Or all empty (no adjacent tile to hook onto)
      if (nonEmptyBetween < 1 && p.a !== 0 && p.b !== 14) {
        // Need subrim check (Case 3.2)
        if (!hasSubrimAdjacent(board, line, p.a, p.b)) continue;
      }

      // Apply max empty constraint
      if (emptyBetween > p.maxEmpty) continue;

      // Exception checks (PDF):
      // (0,13) two-digit blocks (0,14); (14,13) blocks (14,14); etc.
      if (isBlockedByTwoDigit(board, line, p.a, p.b)) continue;

      threats.push({
        line: line,
        positionA: cellPositionOnLine(line, p.a),
        positionB: cellPositionOnLine(line, p.b),
        emptyBetween: emptyBetween,
        nonEmptyBetween: nonEmptyBetween,
        severity: estimateThreatSeverity(emptyBetween, nonEmptyBetween),
      });
    }

    return threats;
  }

  /**
   * Get cells on a line.
   */
  function getLineCells(board, line) {
    const cells = [];
    if (line.type === 'row') {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = Board.getCell(board, line.index, c);
        cells.push({ row: line.index, col: c, tile: cell ? cell.tile : null });
      }
    } else {
      for (let r = 0; r < C.BOARD_SIZE; r++) {
        const cell = Board.getCell(board, r, line.index);
        cells.push({ row: r, col: line.index, tile: cell ? cell.tile : null });
      }
    }
    return cells;
  }

  /**
   * Get the (row, col) of cell at index i on a line.
   */
  function cellPositionOnLine(line, idx) {
    return line.type === 'row'
      ? { row: line.index, col: idx }
      : { row: idx, col: line.index };
  }

  /**
   * Check if there's an adjacent tile on subrim that opponent can hook for T-form.
   */
  function hasSubrimAdjacent(board, line, idxA, idxB) {
    // Subrim is one row/col away from the line
    const subrimIndex = line.type === 'row'
      ? (line.index === 0 ? 1 : (line.index === 14 ? 13 : line.index === 7 ? 8 : -1))
      : (line.index === 0 ? 1 : (line.index === 14 ? 13 : line.index === 7 ? 8 : -1));

    if (subrimIndex < 0 || subrimIndex >= C.BOARD_SIZE) return false;

    for (let i = idxA + 1; i < idxB; i++) {
      const r = line.type === 'row' ? subrimIndex : i;
      const c = line.type === 'row' ? i : subrimIndex;
      const cell = Board.getCell(board, r, c);
      if (cell && cell.tile) return true;
    }
    return false;
  }

  /**
   * Check if a corner 3E is blocked by an adjacent two-digit tile.
   * Per PDF exceptions:
   *   - Two-digit at (0,13) blocks (0,14)
   *   - Two-digit at (13,0) blocks (14,0)
   *   - etc.
   */
  function isBlockedByTwoDigit(board, line, idxA, idxB) {
    const checkCorners = [];

    if (line.type === 'row') {
      if (idxA === 0) checkCorners.push({ checkAt: [line.index, 1], blocks: [line.index, 0] });
      if (idxB === 14) checkCorners.push({ checkAt: [line.index, 13], blocks: [line.index, 14] });
    } else {
      if (idxA === 0) checkCorners.push({ checkAt: [1, line.index], blocks: [0, line.index] });
      if (idxB === 14) checkCorners.push({ checkAt: [13, line.index], blocks: [14, line.index] });
    }

    for (const cc of checkCorners) {
      const cell = Board.getCell(board, cc.checkAt[0], cc.checkAt[1]);
      if (cell && cell.tile && cell.tile.type === 'twodigit') {
        return true; // This corner 3E is blocked
      }
    }
    return false;
  }

  /**
   * Estimate threat severity (higher = more urgent).
   */
  function estimateThreatSeverity(emptyBetween, nonEmptyBetween) {
    // Fewer empty between = easier for opponent to fill = higher severity
    return 100 - emptyBetween * 10 + nonEmptyBetween * 5;
  }

  /**
   * Pick the highest-severity threat to defend against.
   */
  function pickWorstThreat(threats) {
    if (threats.length === 0) return null;
    return threats.slice().sort((a, b) => b.severity - a.severity)[0];
  }

  /**
   * Find a defensive play that blocks a threat.
   *
   * Strategy (per PDF):
   *   1. Play ×9 yourself (best — both block + high score)
   *   2. Place equation that uses one of the 3E squares (STRONG block)
   *   3. Place equation that crosses BETWEEN the two 3Es (MEDIUM block)
   *   4. Subrim equation (WEAK block — only counts if no better option)
   *
   * Selection algorithm:
   *   - Filter to plays that block at minimum quality.
   *   - Compute defensive_value = score + (block_quality_bonus)
   *     where bonus reflects "how much threat remains"
   *   - Pick highest defensive_value
   *
   * @param candidates    array of candidate plays { placements, score, ... }
   * @param threat        threat object from detectAllThreats
   * @param opts          { minQuality, threatScore, board }
   *                      minQuality:  minimum block quality to consider (default WEAK)
   *                      threatScore: estimated opponent score if unblocked
   *                      board:       (optional) board state for syntactic checks
   * @returns the best blocking play with .blockQuality attached, or null
   */
  function findDefensivePlay(candidates, threat, opts) {
    opts = opts || {};
    const minQuality = (typeof opts.minQuality === 'number') ? opts.minQuality : BLOCK_QUALITY.WEAK;
    const threatScore = (typeof opts.threatScore === 'number') ? opts.threatScore
                      : estimateThreatScore(threat);
    const board = opts.board || null;

    const blockers = [];
    for (const c of candidates) {
      if (!c || !c.placements) continue;
      const quality = classifyBlockQuality(c.placements, threat);
      if (quality < minQuality) continue;

      // Use the same residual function as everywhere else — accounts for
      // multi-tile MEDIUM blocks being stronger than single-tile ones, AND
      // for syntactic infeasibility (when board is available).
      const residual = residualThreatMultiplier(c.placements, threat, board);
      const threatPrevented = threatScore * (1 - residual);
      const defensiveValue = (c.score || 0) + threatPrevented;

      blockers.push({
        play: c,
        quality: quality,
        residual: residual,
        defensiveValue: defensiveValue,
      });
    }
    if (blockers.length === 0) return null;

    // Sort by defensiveValue desc — combines score AND block quality
    blockers.sort((a, b) => b.defensiveValue - a.defensiveValue);

    const winner = blockers[0];
    // Attach diagnostic info to the returned play
    const result = winner.play;
    result.blockQuality = winner.quality;
    result.residualThreat = winner.residual;
    result.defensiveValue = winner.defensiveValue;
    return result;
  }

  /**
   * Multi-threat aware defensive play finder.
   *
   * When the board has SEVERAL ×9 threats simultaneously (e.g., row 14 ×9 AND
   * col 14 developing ×9), picking a play that blocks only ONE is suboptimal.
   * A play that blocks MULTIPLE threats — even at lower individual quality —
   * can be the best choice.
   *
   * Algorithm:
   *   For each candidate, compute total defensive_value = score +
   *     sum over all threats of: threatScore[t] × (1 - residual[t])
   *
   * Returns the play with the highest total defensive value, plus diagnostic
   * info on which threats it blocks and how well.
   *
   * @param candidates  array of plays
   * @param threats     array of threat objects (NOT just the worst one)
   * @param opts        { minQuality, board } applied to the WORST threat — at
   *                    least that threat must be blocked at minQuality.
   *                    board (optional): enables syntactic-feasibility checks.
   * @returns the best play, or null if none blocks the worst threat
   */
  function findDefensivePlayMulti(candidates, threats, opts) {
    if (!threats || threats.length === 0) return null;
    opts = opts || {};
    const minQuality = (typeof opts.minQuality === 'number') ? opts.minQuality : BLOCK_QUALITY.WEAK;
    const board = opts.board || null;

    // Sort threats by severity desc so threats[0] is "worst"
    const sortedThreats = threats.slice().sort((a, b) => b.severity - a.severity);
    const worst = sortedThreats[0];

    // Precompute estimated scores
    const threatScores = sortedThreats.map(t => estimateThreatScore(t));

    const blockers = [];
    for (const c of candidates) {
      if (!c || !c.placements) continue;

      // Worst threat must be blocked at minQuality
      const worstQuality = classifyBlockQuality(c.placements, worst);
      if (worstQuality < minQuality) continue;

      // Compute total defensive value across ALL threats
      let totalPrevented = 0;
      const blockSummary = [];
      for (let i = 0; i < sortedThreats.length; i++) {
        const t = sortedThreats[i];
        const q = classifyBlockQuality(c.placements, t);
        const residual = residualThreatMultiplier(c.placements, t, board);
        totalPrevented += threatScores[i] * (1 - residual);
        blockSummary.push({ threat: t, quality: q, residual: residual });
      }

      const defensiveValue = (c.score || 0) + totalPrevented;
      blockers.push({
        play: c,
        defensiveValue: defensiveValue,
        worstQuality: worstQuality,
        blockSummary: blockSummary,
      });
    }
    if (blockers.length === 0) return null;

    blockers.sort((a, b) => b.defensiveValue - a.defensiveValue);

    const winner = blockers[0];
    const result = winner.play;
    result.blockQuality = winner.worstQuality;
    result.defensiveValue = winner.defensiveValue;
    result._multiBlockSummary = winner.blockSummary;
    return result;
  }

  /**
   * Block-quality constants — higher = stronger defense
   *
   * STRONG (100): Placement ON one of the two 3E squares.
   *   This physically occupies the 3E with AI's tile, completely preventing
   *   opponent from using that 3E for a ×9 multiplier on that line.
   *   Residual threat: 0% (fully neutralized)
   *
   * MEDIUM (50): Placement BETWEEN the two 3Es on the SAME line.
   *   Fills a cell opponent would need. Importantly, this is NOT a strong
   *   block on its own — opponent can usually form an equation that reads
   *   through the AI's tile. The block effectiveness depends on:
   *     - How many tiles AI placed in the gap (more = better)
   *     - Whether AI's tile forces a constraint opponent can't satisfy
   *   We conservatively estimate residual = 40% for single-tile MEDIUM,
   *   reflecting that opponent often can route around one tile.
   *
   * WEAK (10): Subrim placement (one row/col away from the threat line,
   *   between the two 3Es).
   *   This only disrupts the T-shape hook scenario. If opponent has other
   *   hook tiles already on the threat line, the threat persists.
   *   Residual: 60%
   *
   * NONE (0): Doesn't block. Residual: 100%
   */
  const BLOCK_QUALITY = {
    STRONG: 100,
    MEDIUM: 50,
    WEAK: 10,
    NONE: 0,
  };

  /**
   * Classify how well a play blocks a ×9 threat.
   * Returns the HIGHEST-quality block among all placements (the play takes
   * the strongest interpretation of what it blocks).
   *
   * @param placements  array of {row, col, tile}
   * @param threat      threat object from detectAllThreats
   * @returns one of BLOCK_QUALITY values
   */
  function classifyBlockQuality(placements, threat) {
    const A = threat.positionA;
    const B = threat.positionB;
    const line = threat.line;
    let best = BLOCK_QUALITY.NONE;

    // Compute subrim once
    const subrim = (line.index === 0 ? 1
                  : line.index === 14 ? 13
                  : line.index === 7 ? 8 : -1);

    for (const p of placements) {
      // STRONG block: tile on a 3E square involved in the threat
      if ((p.row === A.row && p.col === A.col) ||
          (p.row === B.row && p.col === B.col)) {
        return BLOCK_QUALITY.STRONG; // can't do better than this
      }

      // MEDIUM block: tile on the same line, strictly between A and B
      if (line.type === 'row' && p.row === line.index) {
        const lo = Math.min(A.col, B.col);
        const hi = Math.max(A.col, B.col);
        if (p.col > lo && p.col < hi) {
          if (best < BLOCK_QUALITY.MEDIUM) best = BLOCK_QUALITY.MEDIUM;
        }
      } else if (line.type === 'col' && p.col === line.index) {
        const lo = Math.min(A.row, B.row);
        const hi = Math.max(A.row, B.row);
        if (p.row > lo && p.row < hi) {
          if (best < BLOCK_QUALITY.MEDIUM) best = BLOCK_QUALITY.MEDIUM;
        }
      }

      // WEAK block: subrim placement between the two 3Es
      if (subrim >= 0) {
        if (line.type === 'row' && p.row === subrim) {
          const lo = Math.min(A.col, B.col);
          const hi = Math.max(A.col, B.col);
          if (p.col > lo && p.col < hi) {
            if (best < BLOCK_QUALITY.WEAK) best = BLOCK_QUALITY.WEAK;
          }
        } else if (line.type === 'col' && p.col === subrim) {
          const lo = Math.min(A.row, B.row);
          const hi = Math.max(A.row, B.row);
          if (p.row > lo && p.row < hi) {
            if (best < BLOCK_QUALITY.WEAK) best = BLOCK_QUALITY.WEAK;
          }
        }
      }
    }

    return best;
  }

  /**
   * Classify the syntactic TYPE of a tile face — used for grammar checks.
   *   'digit'    : 0-9 (single-digit number tile)
   *   'twodigit' : 10-20 (multi-digit number tile)
   *   'op'       : binary operator (+, -, ×, ÷, or choice tile)
   *   'eq'       : =
   *   null       : unknown / blank / empty
   */
  function tokenTypeOf(face) {
    if (!face) return null;
    if (face === '?') return null; // blank, wildcard — don't constrain
    if (face === '=') return 'eq';
    if (face === '+' || face === '-') return 'op';
    if (face === '×' || face === '÷') return 'op';
    if (face === '+/-') return 'op';
    if (face === '×/÷') return 'op';
    if (/^[0-9]$/.test(face)) return 'digit';
    if (/^([1][0-9]|20)$/.test(face)) return 'twodigit';
    return null;
  }

  /**
   * Get the tile face at (r, c) considering BOTH the existing board AND
   * the play's planned placements. Returns null if cell is empty.
   */
  function effectiveFace(board, placements, r, c) {
    if (placements) {
      for (const p of placements) {
        if (p.row === r && p.col === c && p.tile) {
          return p.tile.face;
        }
      }
    }
    const Board = window.AMath.board;
    const cell = Board.getCell(board, r, c);
    if (cell && cell.tile) return cell.tile.face;
    return null;
  }

  /**
   * Check if two adjacent token types are syntactically legal in A-Math.
   * Either side may be null (= empty / boundary).
   *
   * Grammar (Master Spec §1.5, simplified):
   *   - No two operators adjacent (e.g., `+-` invalid)
   *   - No two `=` adjacent
   *   - `=` next to operator invalid (unary + forbidden; `= -` is the borderline case)
   *   - Two-digit tile next to a digit → forms 3+ digit chain (forbidden)
   *   - Two two-digit tiles adjacent → forbidden
   */
  function isLegalAdjacency(left, right) {
    if (left === null || right === null) return true; // boundary OK
    if (left === 'op' && right === 'op') return false;
    if (left === 'eq' && right === 'eq') return false;
    if (left === 'eq' && right === 'op') return false; // = + or = × forbidden
    if (left === 'op' && right === 'eq') return false; // + = or × = forbidden
    if (left === 'twodigit' && right === 'digit') return false;
    if (left === 'digit' && right === 'twodigit') return false;
    if (left === 'twodigit' && right === 'twodigit') return false;
    return true;
  }

  /**
   * Given two known token types (or null for empty), determine the set of
   * token types syntactically legal at a cell BETWEEN them.
   */
  function legalTypesBetween(leftType, rightType) {
    const legal = new Set();
    for (const cand of ['digit', 'twodigit', 'op', 'eq']) {
      if (isLegalAdjacency(leftType, cand) && isLegalAdjacency(cand, rightType)) {
        legal.add(cand);
      }
    }
    return legal;
  }

  /**
   * Check whether opponent could syntactically form a valid equation along
   * the threat line from one 3E to the other, given existing tiles + AI's
   * planned placements.
   *
   * Returns:
   *   { feasible: bool,
   *     unfillableCells: number,    // cells with zero legal token types (block guaranteed)
   *     veryConstrainedCells: number // cells with only 1 legal token type
   *   }
   *
   * When feasible=false, opponent literally cannot form any valid equation
   * along this line → effectively STRONG syntactic block, residual ≈ 0%.
   *
   * Example: row 0 has `12` at col 1. AI plans to place `-` at col 3.
   * For opponent's row-0 equation to span cols 0 to 7, col 2 must contain
   * a legal token between `12` (twodigit) and `-` (op). The only legal
   * intermediate types between twodigit and op are: ... let's see:
   *   - 'digit': twodigit→digit forbidden (chain). NOT LEGAL.
   *   - 'twodigit': twodigit→twodigit forbidden. NOT LEGAL.
   *   - 'op': op→op forbidden. NOT LEGAL.
   *   - 'eq': twodigit→eq legal; eq→op forbidden. NOT LEGAL.
   * Zero legal options → unfillable → opponent cannot use this line for ×9.
   */
  function syntacticFeasibilityCheck(board, placements, threat) {
    const A = threat.positionA;
    const B = threat.positionB;
    const line = threat.line;

    // Walk the threat line from A to B, building [cell, face, type] for each
    const cells = [];
    if (line.type === 'row') {
      const r = line.index;
      const lo = Math.min(A.col, B.col);
      const hi = Math.max(A.col, B.col);
      for (let c = lo; c <= hi; c++) {
        cells.push({ row: r, col: c, face: effectiveFace(board, placements, r, c) });
      }
    } else {
      const c = line.index;
      const lo = Math.min(A.row, B.row);
      const hi = Math.max(A.row, B.row);
      for (let r = lo; r <= hi; r++) {
        cells.push({ row: r, col: c, face: effectiveFace(board, placements, r, c) });
      }
    }
    const types = cells.map(c => tokenTypeOf(c.face));

    // For each empty cell, check legal tokens given IMMEDIATE neighbors only.
    // (Longer-range constraints would require full grammar parsing; immediate
    // neighbors catch the most common impossible configurations.)
    let unfillableCells = 0;
    let veryConstrainedCells = 0;

    for (let i = 0; i < cells.length; i++) {
      if (types[i] !== null) continue; // already filled — not opponent's choice

      // Immediate neighbors only — these create hard local constraints.
      // Distant neighbors are mediated by tiles in between, so they don't
      // force any single cell to be unfillable.
      const leftImm = (i > 0 && types[i - 1] !== null) ? types[i - 1] : null;
      const rightImm = (i < types.length - 1 && types[i + 1] !== null) ? types[i + 1] : null;

      // If both immediate neighbors are empty, no hard constraint from this cell
      if (leftImm === null && rightImm === null) continue;

      const legal = legalTypesBetween(leftImm, rightImm);
      if (legal.size === 0) {
        unfillableCells++;
      } else if (legal.size === 1) {
        veryConstrainedCells++;
      }
    }

    return {
      feasible: unfillableCells === 0,
      unfillableCells: unfillableCells,
      veryConstrainedCells: veryConstrainedCells,
    };
  }

  /**
   * Boolean wrapper for backward compatibility.
   * Returns true if ANY block (STRONG, MEDIUM, or WEAK) exists.
   * Use classifyBlockQuality for quality-aware decisions.
   *
   * @param placements  placements array
   * @param threat      threat object
   * @param opts        { includeSubrim: bool (default true), minQuality: number (default WEAK) }
   */
  function playBlocksThreat(placements, threat, opts) {
    opts = opts || {};
    const minQuality = (typeof opts.minQuality === 'number') ? opts.minQuality
                     : (opts.includeSubrim === false ? BLOCK_QUALITY.MEDIUM
                                                     : BLOCK_QUALITY.WEAK);
    return classifyBlockQuality(placements, threat) >= minQuality;
  }

  /**
   * Estimate the RESIDUAL threat after a play is made.
   *
   * Two complementary signals:
   *   1. SYNTACTIC feasibility (NEW): can opponent legally form ANY valid
   *      equation along the threat line given the existing+planned tiles?
   *      Uses grammar rules (no `op op`, no `twodigit digit`, etc.).
   *      If unfillable cells exist → effectively STRONG block (residual ≈ 0).
   *
   *   2. POSITIONAL classification: tile placement relative to 3Es.
   *      STRONG (on 3E) / MEDIUM (between) / WEAK (subrim).
   *
   * The board parameter is optional — if provided, syntactic check runs first.
   * If it confirms the threat is dead, return very low residual regardless of
   * position-based classification. Otherwise, fall back to positional residuals.
   *
   * @param placements  AI's planned placements
   * @param threat      threat object
   * @param board       (optional) board state for syntactic feasibility check
   */
  function residualThreatMultiplier(placements, threat, board) {
    const q = classifyBlockQuality(placements, threat);
    if (q >= BLOCK_QUALITY.STRONG) return 0.0;

    // === SYNTACTIC CHECK (new) ===
    // If we have board context, check whether opponent can syntactically form
    // any valid equation along the threat line. If even one cell is unfillable,
    // the threat is effectively neutralized regardless of where AI placed tiles.
    if (board) {
      try {
        const syn = syntacticFeasibilityCheck(board, placements, threat);
        if (syn.unfillableCells > 0) {
          // Threat line cannot legally host any equation → near-perfect block
          return 0.05;
        }
        // Multiple very-constrained cells → still very strong block
        if (syn.veryConstrainedCells >= 2) return 0.15;
      } catch (e) {
        // Syntactic check failed; fall through to positional classification
      }
    }

    const A = threat.positionA;
    const B = threat.positionB;
    const line = threat.line;

    // Count tiles placed on each "track" between the two 3Es:
    //   betweenCount = tiles ON the threat line itself, between A and B
    //   subrimCount  = tiles one row/col away from the threat line, between A and B
    const subrim = (line.index === 0 ? 1
                  : line.index === 14 ? 13
                  : line.index === 7 ? 8 : -1);
    let betweenCount = 0;
    let subrimCount = 0;

    for (const p of placements) {
      if (line.type === 'row') {
        const lo = Math.min(A.col, B.col);
        const hi = Math.max(A.col, B.col);
        if (p.row === line.index) {
          if (p.col > lo && p.col < hi) betweenCount++;
        } else if (subrim >= 0 && p.row === subrim) {
          if (p.col >= lo && p.col <= hi) subrimCount++;
        }
      } else if (line.type === 'col') {
        const lo = Math.min(A.row, B.row);
        const hi = Math.max(A.row, B.row);
        if (p.col === line.index) {
          if (p.row > lo && p.row < hi) betweenCount++;
        } else if (subrim >= 0 && p.col === subrim) {
          if (p.row >= lo && p.row <= hi) subrimCount++;
        }
      }
    }

    if (q >= BLOCK_QUALITY.MEDIUM) {
      if (betweenCount >= 3) return 0.20;
      if (betweenCount === 2) return 0.45;
      return 0.70;
    }

    if (q >= BLOCK_QUALITY.WEAK) {
      if (subrimCount >= 5) return 0.10;
      if (subrimCount >= 3) return 0.25;
      if (subrimCount === 2) return 0.40;
      return 0.55;
    }
    return 1.0;
  }

  /**
   * Conservatively estimate the SCORE opponent could get by exploiting this
   * ×9 threat. Used to weigh defense vs offense tradeoff.
   *
   * Heuristic (deliberately conservative — slightly UNDER-estimates so AI
   * only defends when clearly worthwhile):
   *
   *   Equation length L = span + 1 (e.g., (0,7) threat → 8 cells)
   *   Base face-value sum: ~3 pts/cell average (mix of digits/ops/equals)
   *   Multiplier: ×9
   *   Bingo bonus: +40 if opponent must place ≥8 tiles
   *
   * Empirically, real opponent ×9 plays range 80–280 pts. We aim to estimate
   * a lower bound near 100 for partial threats, and 150+ for clean Bingo-×9s.
   *
   * @param threat  threat object from detectAllThreats
   * @returns estimated opponent score (a conservative lower bound)
   */
  function estimateThreatScore(threat) {
    const A = threat.positionA;
    const B = threat.positionB;
    // Manhattan distance between the two 3E squares = 7 or 14
    const span = Math.abs(A.row - B.row) + Math.abs(A.col - B.col);
    const equationLength = span + 1; // 8 or 15

    // Conservative base: 3 pts per cell average
    const baseSum = 3 * equationLength;

    // ×9 multiplier (3×3 from the two 3E squares)
    let estimatedScore = baseSum * 9;

    // Bingo bonus if opponent will need to place ≥8 tiles.
    // Tiles placed by opponent = emptyBetween + 2 endpoints minus any pre-existing
    // tiles they can hook onto for free. Worst case for AI is they place full Bingo.
    const tilesOpponentPlaces = (threat.emptyBetween || 0) + 2;
    if (tilesOpponentPlaces >= 8) {
      estimatedScore += 40;
    }

    return estimatedScore;
  }

  /**
   * Try to find an offensive ×9 play (AI plays ×9 itself).
   * Returns the best ×9 play found, or null.
   *
   * NOTE: This searches via YoYo only (7-tile + hook). 8-tile Bingo ×9 plays
   * are handled by findBestPlay's natural score-based ranking, since ×9 gives
   * a 9x multiplier and naturally bubbles to the top.
   */
  function findOffensiveX9(state) {
    // This requires forming an equation that hits BOTH 3Es in a line.
    // For practical purposes, this is similar to YoYo but with stricter constraint.
    // We rely on the YoYo search + filter for plays that hit 2× 3Es.

    if (!window.AMath.aiYoyo) return null;

    const yoyos = window.AMath.aiYoyo.findAllYoYos(state);
    const x9Plays = yoyos.filter(y => {
      // Count how many placements land on 3E
      let threeECount = 0;
      for (const p of y.placements) {
        if (isThreeE(p.row, p.col)) threeECount++;
      }
      return threeECount >= 2;
    });

    if (x9Plays.length === 0) return null;

    // Pick highest scoring
    x9Plays.sort((a, b) => b.score - a.score);
    return x9Plays[0];
  }

  function isThreeE(row, col) {
    for (const sq of C.THREE_E_SQUARES) {
      if (sq[0] === row && sq[1] === col) return true;
    }
    return false;
  }

  /**
   * Detects "easy hook" threats: empty 3E squares that the opponent can reach
   * with a small number of tiles by using an existing nearby tile as a hook.
   *
   * This is a lighter-weight threat than ×9 — it covers the case where the
   * opponent can hit a SINGLE 3E (×3 multiplier) cheaply, not just the double-3E ×9 case.
   *
   * @param board   The board to analyze
   * @param maxGap  How few empty cells between the nearest tile and the 3E to flag (default 4)
   * @returns array of threats: { row, col, hookRow, hookCol, gap }
   */
  function detectEasy3EHookThreats(board, maxGap) {
    if (typeof maxGap !== 'number') maxGap = 4;
    const threats = [];

    for (const [tr, tc] of C.THREE_E_SQUARES) {
      // Skip if the 3E square is already occupied
      const cell = Board.getCell(board, tr, tc);
      if (!cell || cell.tile) continue;

      // Skip the center (7,7) — it's not really a "corner hook" risk in the same way
      if (tr === 7 && tc === 7) continue;

      // Check along the row: any tile within maxGap cells to left or right?
      for (let dc = 1; dc <= maxGap; dc++) {
        for (const sign of [-1, 1]) {
          const r = tr;
          const c = tc + sign * dc;
          if (c < 0 || c >= C.BOARD_SIZE) continue;
          const adj = Board.getCell(board, r, c);
          if (adj && adj.tile) {
            // Found a hook tile. Check that ALL cells between (tr,tc) and (r,c) are empty
            // (so opponent can place a contiguous line of tiles to extend the equation)
            let allEmpty = true;
            const lo = Math.min(tc, c) + 1;
            const hi = Math.max(tc, c) - 1;
            for (let i = lo; i <= hi; i++) {
              const m = Board.getCell(board, r, i);
              if (m && m.tile) { allEmpty = false; break; }
            }
            if (allEmpty) {
              threats.push({ row: tr, col: tc, hookRow: r, hookCol: c, gap: dc, direction: 'row' });
            }
          }
        }
      }

      // Check along the column: any tile within maxGap cells up or down?
      for (let dr = 1; dr <= maxGap; dr++) {
        for (const sign of [-1, 1]) {
          const r = tr + sign * dr;
          const c = tc;
          if (r < 0 || r >= C.BOARD_SIZE) continue;
          const adj = Board.getCell(board, r, c);
          if (adj && adj.tile) {
            let allEmpty = true;
            const lo = Math.min(tr, r) + 1;
            const hi = Math.max(tr, r) - 1;
            for (let i = lo; i <= hi; i++) {
              const m = Board.getCell(board, i, c);
              if (m && m.tile) { allEmpty = false; break; }
            }
            if (allEmpty) {
              threats.push({ row: tr, col: tc, hookRow: r, hookCol: c, gap: dr, direction: 'col' });
            }
          }
        }
      }
    }

    return threats;
  }

  /**
   * Public helper: compute the set of legal token types at cell (r, c)
   * given the existing board and any planned placements.
   *
   * Considers ONLY immediate horizontal AND vertical neighbors (4-neighbor).
   * If neighbors are inconsistent (e.g., the cell's row-neighbors say it must
   * be a digit but col-neighbors say it must be an op), returns an empty set
   * meaning NO LEGAL PLACEMENT exists at this cell.
   *
   * Search engines can use this to skip cells/anchors that cannot accept ANY
   * tile, saving the cost of generating doomed placements.
   *
   * Returns: Set<string> from {'digit', 'twodigit', 'op', 'eq'}.
   * Empty set = cell is "syntactically dead".
   */
  function legalTypesAt(board, r, c, placements) {
    // Get neighbor types in each direction
    const leftFace  = effectiveFace(board, placements, r, c - 1);
    const rightFace = effectiveFace(board, placements, r, c + 1);
    const upFace    = effectiveFace(board, placements, r - 1, c);
    const downFace  = effectiveFace(board, placements, r + 1, c);

    const leftT  = tokenTypeOf(leftFace);
    const rightT = tokenTypeOf(rightFace);
    const upT    = tokenTypeOf(upFace);
    const downT  = tokenTypeOf(downFace);

    // Start with the four possible token types, then filter.
    let legal = new Set(['digit', 'twodigit', 'op', 'eq']);

    // Horizontal constraints
    if (leftT !== null || rightT !== null) {
      const hLegal = legalTypesBetween(leftT, rightT);
      legal = intersect(legal, hLegal);
    }
    // Vertical constraints
    if (upT !== null || downT !== null) {
      const vLegal = legalTypesBetween(upT, downT);
      legal = intersect(legal, vLegal);
    }
    return legal;
  }

  function intersect(a, b) {
    const out = new Set();
    for (const x of a) if (b.has(x)) out.add(x);
    return out;
  }

  /**
   * Public helper: is cell (r,c) "dead" — meaning no tile of any type can
   * legally be placed there given immediate neighbors?
   *
   * Use this to prune doomed anchors before running expensive shape-fitting.
   * A dead cell can never be part of a valid equation.
   */
  function isCellDead(board, r, c, placements) {
    return legalTypesAt(board, r, c, placements).size === 0;
  }

  /**
   * Public helper: quick pre-validation of a play's placements.
   * Returns true if every placed tile has a legal token type at its position
   * (considering local 4-neighbor constraints).
   *
   * This is a CHEAP pre-filter — it catches obviously illegal placements
   * (like a digit next to a twodigit) without running full equation parsing.
   * A play that passes this check might still be invalid for other reasons
   * (math doesn't balance, no = sign, etc.) — but a play that FAILS this
   * check is guaranteed invalid.
   */
  function isPlaySyntacticallyLegal(board, placements) {
    if (!placements || placements.length === 0) return false;

    // For each placement, check that its tile's type is in the legal set
    // at that position (considering OTHER placements as already on the board)
    for (const p of placements) {
      if (!p.tile || !p.tile.face) continue;

      const ptype = tokenTypeOf(p.tile.face);
      if (ptype === null) continue; // BLANK assignment may not be resolved yet

      // Build placements minus this one — so we check this tile against the
      // CONTEXT created by the other placements + board
      const others = placements.filter(q => q !== p);
      const legal = legalTypesAt(board, p.row, p.col, others);

      if (!legal.has(ptype)) return false;
    }
    return true;
  }

  window.AMath = window.AMath || {};
  window.AMath.aiX9 = {
    detectAllThreats: detectAllThreats,
    pickWorstThreat: pickWorstThreat,
    playBlocksThreat: playBlocksThreat,
    classifyBlockQuality: classifyBlockQuality,
    residualThreatMultiplier: residualThreatMultiplier,
    BLOCK_QUALITY: BLOCK_QUALITY,
    findOffensiveX9: findOffensiveX9,
    findDefensivePlay: findDefensivePlay,
    findDefensivePlayMulti: findDefensivePlayMulti,
    estimateThreatScore: estimateThreatScore,
    detectEasy3EHookThreats: detectEasy3EHookThreats,
    // Syntax-aware helpers for search-time pruning:
    legalTypesAt: legalTypesAt,
    isCellDead: isCellDead,
    isPlaySyntacticallyLegal: isPlaySyntacticallyLegal,
    tokenTypeOf: tokenTypeOf,
  };
})();
