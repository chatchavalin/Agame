/**
 * A-Math Game — AI Player (Phase 6c+ with YoYo + ×9 Strategy)
 *
 * Decision tree:
 *   1. Detect ×9 threats from opponent (every turn, regardless of score)
 *   2. Behind 140+ → try ×9 offense (also serves as defense)
 *   3. Search Bingo + YoYo + regular plays
 *   4. ×9 DEFENSE: if threat exists and bestPlay doesn't block it,
 *      switch to a defensive alternative when swing favors defense
 *      (threat magnitude > score lost by switching)
 *   5. Bingo/YoYo-only mode (first 4 turns OR behind 100+) → enforce
 *   6. Lead 150+ → don't CREATE new ×9/×4 threats
 *   7. Normal → play best
 */

(function () {
  const C = window.AMath.constants;
  const Bag = window.AMath.bag;
  const Board = window.AMath.board;
  const Placement = window.AMath.placement;
  const Scoring = window.AMath.scoring;

  // AI thinking time per turn. Read from settings (default 180s = 3 min).
  // Settings allows: 30, 60, 120, 180, 300 seconds.
  // Worker-compatible: prefers _settings passed in state, falls back to window.
  // (In Worker context, window is aliased to self by the worker bootstrap.)
  let _stateSettings = null;
  let _isEducationMode = false;
  let _desperationRetryActive = false;  // set by decideMove during fallback retry
  let _lastTopPlays = [];  // Top plays from last search — survives any return path
  function getTimeBudgetMs() {
    try {
      // Bot level overrides think time
      var level = getBotLevel();
      if (level === 'easy') return 30000;   // 30s
      if (level === 'normal') return 90000; // 90s

      if (_stateSettings && typeof _stateSettings.aiThinkSeconds === 'number') {
        const s = _stateSettings.aiThinkSeconds;
        if (s >= 10 && s <= 600) return s * 1000;
      }
      if (window.AMath && window.AMath.settings && window.AMath.settings.get) {
        const seconds = window.AMath.settings.get('aiThinkSeconds');
        if (typeof seconds === 'number' && seconds >= 10 && seconds <= 600) {
          return seconds * 1000;
        }
      }
    } catch (e) { /* fallback below */ }
    return 180000; // 3 min default
  }

  function getStateSetting(key, fallback) {
    if (_stateSettings && _stateSettings[key] !== undefined) return _stateSettings[key];
    try {
      if (window.AMath && window.AMath.settings && window.AMath.settings.get) {
        return window.AMath.settings.get(key);
      }
    } catch (e) { /* */ }
    return fallback;
  }

  /**
   * Get bot difficulty level. Affects search depth, strategy, and time budget.
   *   'easy'   → shorter search, simpler strategy
   *   'normal' → balanced
   *   'hard'   → full power (default)
   */
  function getBotLevel() {
    return getStateSetting('botLevel', 'hard');
  }

  const MAX_CANDIDATES_PER_STAGE = 1000000;  // Per-stage cap; multiplied by complexity

  // Track how many actual plays each AI rack has made (per-rack counters)
  // Key = rack.owner (e.g., 'ai', 'ai1', 'ai2', 'player' for takeover)
  const playCounters = {};

  function resetPlayCount(owner) {
    if (owner) {
      playCounters[owner] = 0;
    } else {
      // Reset all
      for (const k of Object.keys(playCounters)) playCounters[k] = 0;
    }
  }

  function getPlayCount(owner) {
    return playCounters[owner] || 0;
  }

  function recordPlay(owner) {
    if (!owner) return;
    playCounters[owner] = (playCounters[owner] || 0) + 1;
  }

  /** Return a 'swap' decision using the selected brain (1 = seed-keeping, 2 = probability). */
  function smartSwap(state) {
    // Read brain selection from settings (default: brain1 — the stable, tested one)
    const brain = getStateSetting('aiSwapBrain', 'brain1') || 'brain1';

    let result = null;
    if (brain === 'brain2' && window.AMath.aiSwapBrain2 && window.AMath.aiSwapBrain2.computeSwapTiles_brain2) {
      try {
        result = window.AMath.aiSwapBrain2.computeSwapTiles_brain2(state);
        if (result && result.reasoning) console.log('[AI Brain2]', result.reasoning);
      } catch (e) {
        console.warn('[AI Brain2] Error, falling back to Brain1:', e);
        result = null;
      }
    }

    // Default / fallback path: Brain 1
    if (!result && window.AMath.aiSwap && window.AMath.aiSwap.computeSwapTiles) {
      result = window.AMath.aiSwap.computeSwapTiles(state);
      if (result && result.reasoning) console.log('[AI Brain1]', result.reasoning);
    }

    if (result && result.tileIds && result.tileIds.length > 0) {
      return { type: 'swap', tileIds: result.tileIds };
    }
    // Fallback: swap all tiles
    return { type: 'swap', tileIds: state.aiRack.tiles.map(function (t) { return t.id; }) };
  }

  /** Calculate total tile points in a rack (BLANK = 0). */
  function rackPointsSum(rack) {
    if (!rack || !rack.tiles) return 0;
    let sum = 0;
    for (const t of rack.tiles) sum += (t.points || 0);
    return sum;
  }

  /**
   * Determine if passing this turn would cause AI to lose or tie.
   * Per pass-rule, 6 consecutive non-scoring turns end the game.
   * Endgame scoring: each player's remaining tile points are subtracted from score.
   *
   * If the user has disabled the 6-pass auto-end rule
   * (settings.disableSixPassEnd === true), this check is moot — passing
   * cannot end the game via this path, so we always return false. This
   * prevents the AI from making panicky last-resort plays when there is
   * no actual impending game end.
   *
   * @returns true if AI would lose or tie by passing
   */
  function wouldPassLoseGame(state) {
    if (getStateSetting('disableSixPassEnd', false) === true) return false;
    if (state.isFirstMove) return false;   // no tiles on board → 6-pass rule doesn't apply

    const consecutiveNonScoring = state.consecutiveNonScoringTurns || 0;
    // Pass causes 6th non-scoring turn → game ends
    if (consecutiveNonScoring < 5) return false;

    const aiRackPoints = rackPointsSum(state.aiRack);
    const opponentRackPoints = rackPointsSum(state.opponentRack);
    const aiFinal = (state.aiScore || 0) - aiRackPoints;
    const playerFinal = (state.playerScore || 0) - opponentRackPoints;

    // Lose if AI's final < player's final; tie if equal
    return aiFinal <= playerFinal;
  }

  // =========================================================================
  // BEGINNING STRATEGY HELPERS
  // =========================================================================

  /**
   * Check if opponent appears ready for bingo based on swap history.
   * Ready if: never swapped, or swapped ≥2 turns with each ≤4 tiles.
   */
  function isOpponentReadyForBingo(oppHistory) {
    if (!oppHistory || oppHistory.length === 0) return false; // no data yet

    const swapTurns = oppHistory.filter(h => h.type === 'swap');

    // If opponent ever played a tile → definitely ready
    if (oppHistory.some(h => h.type === 'play')) return true;

    // If opponent never swapped (all passes) → very ready
    if (swapTurns.length === 0) return true;

    // If opponent swapped ≥2 turns, check last 2 swap amounts
    if (swapTurns.length >= 2) {
      const last2 = swapTurns.slice(-2);
      return last2.every(s => (s.count || 0) <= 4);
    }

    return false;
  }

  /**
   * Check if hand is too bad for a short play (Scenario B).
   * Bad hand: ≥2 two-digit tiles OR ≥3 operators.
   */
  function isHandBadForShortPlay(tiles) {
    let twoDigit = 0, ops = 0;
    for (const t of tiles) {
      if (t.type === 'twodigit') twoDigit++;
      if (t.type === 'op' || t.type === 'choice') ops++;
    }
    return twoDigit >= 2 || ops >= 3;
  }

  /**
   * Find a blocking play for Scenario A (board empty, first move).
   * Rules:
   * - Must pass through center ★ (7,7) — required by game rules
   * - = must be placed at (7,7) — blocks ×9 lines
   * - Entire equation within safe zone (4,4)-(10,10)
   * - Length ≤6 tiles
   * - Don't use blank tiles
   * - Dump bad tiles (0, two-digit, duplicates)
   * - If using last =, play longer to increase chance of drawing new =
   */
  function findBlockingPlay(state) {
    const Board = window.AMath.board;
    const Placement = window.AMath.placement;
    const Scoring = window.AMath.scoring;
    const tiles = state.aiRack.tiles;

    // Count = tiles and blanks
    let eqCount = 0, blankCount = 0;
    for (const t of tiles) {
      if (t.type === 'equals') eqCount++;
      if (t.type === 'blank') blankCount++;
    }

    // Need at least one = (don't use blank for =)
    if (eqCount === 0) return null;

    // Determine desired play length
    // If only 1 =, play longer (5-6 tiles) to draw more tiles
    // If 2+ =, can play short (3-4 tiles)
    const minLen = eqCount <= 1 ? 5 : 3;
    const maxLen = 6;

    // Classify tiles by desirability (lower = dump first)
    function tileDesirability(t) {
      if (t.type === 'blank') return 100;       // never use
      if (t.type === 'equals') return 90;        // keep if possible
      if (t.face === '0') return 5;              // bad — dump
      if (t.type === 'twodigit') return 10;      // bad — dump
      if (t.type === 'choice') return 70;        // flexible — keep
      if (t.type === 'op') return 60;            // decent — keep
      // Digits: check for duplicates
      return 40;
    }

    // Sort: least desirable first (those we want to dump)
    const sortedTiles = tiles.slice().sort((a, b) => tileDesirability(a) - tileDesirability(b));

    // Find = tile for center
    const eqTile = tiles.find(t => t.type === 'equals');
    if (!eqTile) return null;

    // Available tiles (excluding the = going to center, excluding blanks)
    const available = tiles.filter(t => t.id !== eqTile.id && t.type !== 'blank');

    // Try equations of various lengths, centered at (7,7)
    // Format: tiles placed horizontally through (7,7) with = at center
    const bestPlays = [];

    // Try all lengths from maxLen down to minLen
    for (let len = maxLen; len >= minLen; len--) {
      const numOtherTiles = len - 1; // minus the = tile
      if (numOtherTiles > available.length) continue;

      // Generate combinations of numOtherTiles from available
      const combos = getCombinations(available, numOtherTiles);

      for (const combo of combos) {
        if (Date.now() - state._blockSearchStart > 3000) break; // time limit
        
        // Try all permutations
        const perms = getPermutations(combo);
        for (const perm of perms) {
          // Build equation: place tiles centered at (7,7)
          // = goes at col 7, other tiles spread left and right
          // Try different = positions within the equation
          for (let eqPos = 1; eqPos < len; eqPos++) {
            const placements = [];
            const startCol = 7 - eqPos;
            let valid = true;

            // Check safe zone bounds
            for (let i = 0; i < len; i++) {
              const col = startCol + i;
              if (col < 4 || col > 10) { valid = false; break; }
            }
            if (!valid) continue;

            let permIdx = 0;
            for (let i = 0; i < len; i++) {
              const col = startCol + i;
              const tile = (i === eqPos) ? eqTile : perm[permIdx++];
              placements.push({ row: 7, col: col, tile: tile });
            }

            // Place on board and validate
            // Handle choice tiles — try both assignments
            const choiceIndices = [];
            for (let ci = 0; ci < placements.length; ci++) {
              if (placements[ci].tile.type === 'choice') choiceIndices.push(ci);
            }

            function tryChoiceAssignments(cIdx) {
              if (cIdx >= choiceIndices.length) {
                // All choices assigned — validate
                const tempBoard = Board.createBoard();
                for (const p of placements) {
                  Board.placeTile(tempBoard, p.row, p.col, p.tile);
                }
                const result = Placement.validatePlay(tempBoard, placements, true);
                if (result.ok) {
                  const score = Scoring.scorePlay(result.equations, tempBoard, placements.length);
                  let dumpScore = 0;
                  for (const p of placements) {
                    if (p.tile.type !== 'equals') dumpScore += (100 - tileDesirability(p.tile));
                  }
                  bestPlays.push({
                    // IMPORTANT: surface `assigned` at the placement top-level.
                    // main.js commits via `p.assigned` (not p.tile.assigned),
                    // so a played +/- or ×/÷ choice tile must carry its
                    // assigned face up here, or the board cell will render
                    // the raw stacked "+/-" / "×/÷" face after commit.
                    placements: placements.map(p => ({
                      row: p.row,
                      col: p.col,
                      tile: Object.assign({}, p.tile),
                      assigned: p.tile.assigned || null,
                    })),
                    score: score.total,
                    equations: result.equations,
                    dumpScore: dumpScore,
                    len: len,
                  });
                }
                for (const p of placements) Board.removeTile(tempBoard, p.row, p.col);
                return;
              }
              const pi = choiceIndices[cIdx];
              const tile = placements[pi].tile;
              const opts = tile.face === '+/-' ? ['+','-'] : ['×','÷'];
              for (const opt of opts) {
                tile.assigned = opt;
                tryChoiceAssignments(cIdx + 1);
              }
              tile.assigned = null;
            }

            if (choiceIndices.length > 0) {
              tryChoiceAssignments(0);
            } else {
              const tempBoard = Board.createBoard();
              for (const p of placements) {
                Board.placeTile(tempBoard, p.row, p.col, p.tile);
              }
              const result = Placement.validatePlay(tempBoard, placements, true);
              if (result.ok) {
                const score = Scoring.scorePlay(result.equations, tempBoard, placements.length);
                let dumpScore = 0;
                for (const p of placements) {
                  if (p.tile.type !== 'equals') dumpScore += (100 - tileDesirability(p.tile));
                }
                bestPlays.push({
                  // (See sibling bestPlays.push above for why `assigned` is
                  // surfaced at the placement top-level. Same reason here —
                  // this branch handles plays with no choice tiles, but the
                  // shape must match for main.js to commit consistently.)
                  placements: placements.map(p => ({
                    row: p.row,
                    col: p.col,
                    tile: Object.assign({}, p.tile),
                    assigned: p.tile.assigned || null,
                  })),
                  score: score.total,
                  equations: result.equations,
                  dumpScore: dumpScore,
                  len: len,
                });
              }
              for (const p of placements) Board.removeTile(tempBoard, p.row, p.col);
            }
          }
        }
      }
    }

    if (bestPlays.length === 0) return null;

    // Pick best: prefer longer (dumps more bad tiles), then higher dump score, then higher points
    bestPlays.sort((a, b) => {
      // Prefer longer equations (dump more tiles, get more fresh tiles)
      if (a.len !== b.len) return b.len - a.len;
      // Prefer higher dump score (got rid of worse tiles)
      if (a.dumpScore !== b.dumpScore) return b.dumpScore - a.dumpScore;
      // Tiebreak by score
      return b.score - a.score;
    });

    console.log('[AI] Blocking play candidates: ' + bestPlays.length +
                ', best: len=' + bestPlays[0].len + ' score=' + bestPlays[0].score +
                ' dump=' + bestPlays[0].dumpScore);
    return bestPlays[0];
  }

  /** Get all k-combinations from an array */
  function getCombinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const results = [];
    // Limit combinations to avoid explosion
    const maxCombos = 200;
    function helper(start, chosen) {
      if (results.length >= maxCombos) return;
      if (chosen.length === k) { results.push(chosen.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        // Skip duplicate tiles (same face+type) to reduce permutations
        if (i > start && arr[i].face === arr[i-1].face && arr[i].type === arr[i-1].type) continue;
        chosen.push(arr[i]);
        helper(i + 1, chosen);
        chosen.pop();
      }
    }
    helper(0, []);
    return results;
  }

  /** Get all permutations of an array (limited to avoid explosion) */
  function getPermutations(arr) {
    if (arr.length <= 1) return [arr];
    const results = [];
    const maxPerms = 120;
    function helper(remaining, chosen) {
      if (results.length >= maxPerms) return;
      if (remaining.length === 0) { results.push(chosen.slice()); return; }
      for (let i = 0; i < remaining.length; i++) {
        // Skip duplicate tiles at same position
        if (i > 0 && remaining[i].face === remaining[i-1].face && remaining[i].type === remaining[i-1].type) continue;
        chosen.push(remaining[i]);
        const next = remaining.slice(0, i).concat(remaining.slice(i + 1));
        helper(next, chosen);
        chosen.pop();
      }
    }
    helper(arr, []);
    return results;
  }

  async function decideMove(state) {
    const startTime = Date.now();

    // Worker-compatibility: pick up settings from state if passed
    _stateSettings = state._settings || null;
    _isEducationMode = !!(state && state._isEducation);

    // =====================================================================
    // CRITICAL: deep-clone the AI rack so the search can mutate tile.assigned
    // freely without ever touching the live player-visible rack.
    //
    // The AI's search paths (findBestPlay, ai-yoyo, ai-bingo-fast,
    // ai-bingo-grammar, pattern engines) all temporarily assign faces to
    // BLANK and CHOICE tiles during permutation, then restore. If ANY
    // early-return path leaves a tile mid-mutation — even briefly — the
    // user's UI can render a blank as a permanent number, or a +/- tile
    // can flip face mid-game.
    //
    // Education mode already clones (js/education.js). The real-game path
    // must do the same. See PROJECT-BIBLE §6, §15 and the regression
    // history (Blank changes face — Education used .slice()).
    //
    // We rebind `state.aiRack` locally; the caller's session.aiRack is
    // untouched. Tile identity is preserved via `id`, so downstream
    // main.js commit (Rack.removeTile by id) still works.
    // =====================================================================
    if (state && state.aiRack && state.aiRack.tiles) {
      state = Object.assign({}, state, {
        aiRack: {
          owner: state.aiRack.owner,
          tiles: state.aiRack.tiles.map(function (t) {
            return { id: t.id, face: t.face, type: t.type, points: t.points, assigned: t.assigned };
          }),
        },
      });
    }

    // Top plays tracked during search — attached to the final decision for education mode
    var _searchTopPlays = null;

    // Helper: wrap play returns to include top plays for education
    function makePlayResult(play) {
      var r = {
        type: 'play',
        placements: play.placements,
        score: play.score,
        equations: play.equations,
        _topPlays: _searchTopPlays || [],
      };
      return r;
    }

    // Identify which rack is playing (for play-count tracking)
    const rackOwner = (state.aiRack && state.aiRack.owner) || 'ai';

    // Determine AI vs opponent score difference
    const myScore = state.aiScore !== undefined ? state.aiScore : 0;
    const oppScore = state.playerScore !== undefined ? state.playerScore : 0;
    const deficit = oppScore - myScore;        // positive = AI behind
    const lead = -deficit;                     // positive = AI ahead

    // Use the authoritative play count from the game session if provided.
    // This is ALWAYS correct (session resets on new game, saved/restored properly).
    // Fall back to internal counter only as a legacy safety net.
    const aiPlayCount = (state.aiActualPlayCount !== undefined)
      ? state.aiActualPlayCount
      : getPlayCount(rackOwner);
    const botLevel = getBotLevel();
    const tileSet = getStateSetting('tileSet', 'prathom') || 'prathom';
    const isMathayom = tileSet === 'mathayom';

    // Bot level affects bingo enforcement:
    //   easy: no bingo enforcement (play any equation)
    //   normal: first 2 turns only
    //   hard: first 4 turns (prathom) / 3 turns (mathayom — two-digit tiles make bingo harder)
    const bingoTurns = botLevel === 'easy' ? 0 : botLevel === 'normal' ? 2 : (isMathayom ? 3 : C.AI_BINGO_MODE_TURNS);
    const isFirstFewPlays = aiPlayCount < bingoTurns;
    const isBehind100 = deficit > C.AI_BEHIND_FOR_BINGO_MODE;
    const isBehind140 = deficit >= C.AI_LEAD_FOR_OFFENSE;
    const isLead150 = lead >= C.AI_LEAD_FOR_CLOSE;
    const bingoYoyoOnlyMode = botLevel !== 'easy' && (isFirstFewPlays || isBehind100) && lead <= C.AI_LEAD_FOR_CLOSE;
    const bagSize = Bag.bagSize(state.bag);
    // Late-game threshold: Mathayom (100 tiles) needs higher threshold to match ~20% of game
    const lateGameBagThreshold = isMathayom ? 20 : 15;

    // === 1. Detect ×9 threat from opponent ===
    let threats = [];
    if (window.AMath.aiX9) {
      threats = window.AMath.aiX9.detectAllThreats(state.board);
    }
    const worstThreat = window.AMath.aiX9 ? window.AMath.aiX9.pickWorstThreat(threats) : null;

    // === 2. Behind 140+? Try ×9 offense first ===
    if (isBehind140 && window.AMath.aiX9) {
      const x9Play = window.AMath.aiX9.findOffensiveX9(state);
      if (x9Play) {
        return {
          type: 'play',
          placements: x9Play.placements,
          score: x9Play.score,
          equations: x9Play.equations,
        };
      }
    }

    // === 2a. Bingo Feasibility Check ===
    // A valid 8-tile equation needs AT MINIMUM:
    //   - 2 numbers (one per side of =), or blanks substituting
    //   - 1 operator (to form an expression), or blank/choice substituting
    //   - 1 equals sign, or blank substituting
    // If the rack can't possibly meet these requirements, skip ALL bingo
    // searches (fast, grammar, and brute-force bingo stage). This saves
    // 3-12 seconds of wasted computation.
    let bingoFeasible = false;
    let bingoIsHard = false;
    if (state.aiRack.tiles.length === 8) {
      const tiles = state.aiRack.tiles;
      let numCount = 0, opCount = 0, eqCount = 0, blankCount = 0;
      for (const t of tiles) {
        if (t.type === 'digit' || t.type === 'twodigit') numCount++;
        else if (t.type === 'op' || t.type === 'choice') opCount++;
        else if (t.type === 'equals') eqCount++;
        else if (t.type === 'blank') blankCount++;
      }
      // Blanks can fill any role. Check if blanks cover the deficits.
      const needNums = Math.max(0, 2 - numCount);
      const needOps = Math.max(0, 1 - opCount);
      const needEq = Math.max(0, 1 - eqCount);
      bingoFeasible = blankCount >= (needNums + needOps + needEq);

      // Extra infeasibility checks:
      // - 3+ two-digit tiles → too few slots left for operators/equals
      // - 4+ operators with < 3 numbers → not enough numbers
      // Note: 3+ equals is HARD but not impossible (chained: A=B=C=D)
      //   → still feasible but gets reduced time budget
      if (bingoFeasible) {
        const twoDigitCount = tiles.filter(t => t.type === 'twodigit').length;
        if (twoDigitCount >= 3) {
          bingoFeasible = false;
          console.log('[AI] Bingo INFEASIBLE: ' + twoDigitCount + ' two-digit tiles — too many');
        } else if (opCount >= 4 && numCount < 3) {
          bingoFeasible = false;
          console.log('[AI] Bingo INFEASIBLE: ' + opCount + ' ops but only ' + numCount + ' nums');
        }
      }

      // Flag hard racks (combinatorially expensive bingo searches) for
      // reduced budget. We trigger on any of:
      //   - 3+ equals (chained equation search, was the only original trigger)
      //   - 3+ blanks combined with 2+ equals or 2+ twodigit (multi-blank +
      //     multi-special-tile racks blow up the brute-force search; the
      //     bingo's almost never findable in the available time, so spending
      //     full budget here just delays yoyo and adds 30-60s of wasted time)
      const twoDigitCountForHard = tiles.filter(t => t.type === 'twodigit').length;
      const isMultiBlankComplex = blankCount >= 3 && (eqCount >= 2 || twoDigitCountForHard >= 2);
      bingoIsHard = bingoFeasible && (eqCount >= 3 || isMultiBlankComplex);
      if (bingoIsHard) {
        const reason = eqCount >= 3 ? (eqCount + ' equals') : (blankCount + ' blanks + complex');
        console.log('[AI] Bingo HARD: ' + reason + ' — reduced budget');
      }

      if (!bingoFeasible) {
        console.log('[AI] Bingo INFEASIBLE: rack has ' + numCount + ' nums, ' +
                    opCount + ' ops, ' + eqCount + ' eq, ' + blankCount +
                    ' blanks (need ' + needNums + 'N + ' + needOps + 'O + ' + needEq + '= from blanks)');
      }
    }

    // === 2b. Fast Bingo Pattern Search ===
    // Try pattern-based Bingo BEFORE expensive brute force.
    // This handles 3-BLANK racks that brute force can't solve in time.
    let fastBingoPlay = null;
    if (bingoFeasible && window.AMath.aiBingoFast && state.aiRack.tiles.length === 8 && !state.isFirstMove) {
      const fastStart = Date.now();
      const fastBingoBudget = (bingoIsHard && !_isEducationMode) ? 3000 : (getTimeBudgetMs() >= 200000 ? 15000 : 5000);
      fastBingoPlay = window.AMath.aiBingoFast.findFastBingo(state, fastBingoBudget);
      if (fastBingoPlay) {
        console.log('[AI] Fast Bingo found in ' + (Date.now() - fastStart) + 'ms, score=' + fastBingoPlay.score);
      }
    }

    // === 2c. Grammar Bingo Search (handles cases template engine misses) ===
    // Grammar-based search catches edge cases like:
    //   - First-move Bingos
    //   - Unary minus equations
    //   - Choice tile flexing
    //   - Multi-equals chained equations
    //   - Exotic patterns not in the hand-curated template list
    //
    // We always run this (not just as fallback) because it may find HIGHER-SCORING
    // Bingos than the template engine, especially for first moves.
    let grammarBingoPlay = null;
    if (bingoFeasible && window.AMath.aiBingoGrammar && state.aiRack.tiles.length === 8) {
      const grammarStart = Date.now();
      // Adaptive budget based on rack difficulty:
      //   - First move (no anchor): 8s base, +2s per BLANK over 2
      //   - With anchor:            4s base, +1.5s per BLANK over 2
      // Hard racks (3-4 BLANKs) need more time but we cap at 12s to keep AI responsive.
      const blankCount = state.aiRack.tiles.filter(t => t.type === 'blank').length;
      const extraBlanks = Math.max(0, blankCount - 2);
      let grammarBudget;
      if (botLevel === 'easy') {
        grammarBudget = 2000; // 2s cap for easy
      } else if (botLevel === 'normal') {
        grammarBudget = state.isFirstMove ? 5000 : 3000;
      } else if (state.isFirstMove) {
        grammarBudget = Math.min(12000, 8000 + extraBlanks * 2000);
      } else {
        grammarBudget = Math.min(10000, 4000 + extraBlanks * 1500);
      }
      // Two-digit tiles increase equation complexity — boost grammar budget
      const grammarTwoDigits = state.aiRack.tiles.filter(t => t.type === 'twodigit').length;
      if (grammarTwoDigits >= 2) grammarBudget = Math.min(15000, grammarBudget * 1.5);
      else if (grammarTwoDigits >= 1) grammarBudget = Math.min(12000, grammarBudget * 1.2);
      // Education mode (300s budget) — allow much longer grammar search
      const totalBudgetMs = getTimeBudgetMs();
      if (totalBudgetMs >= 200000) {
        grammarBudget = Math.max(grammarBudget, 30000); // at least 30s for education
      }
      grammarBingoPlay = window.AMath.aiBingoGrammar.findGrammarBingo(state, grammarBudget);
      if (grammarBingoPlay) {
        console.log('[AI] Grammar Bingo found in ' + (Date.now() - grammarStart) + 'ms, score=' + grammarBingoPlay.score);
      }
    }

    // === 3. Search Bingo + YoYo + Regular plays ===
    //
    // BLANK STRATEGY: When holding 2+ blanks, yoyo becomes the highest-value
    // play type because blanks fill any gap in cross-equations. We give yoyo
    // more time and later prefer plays that use FEWER blanks (preserving
    // option value for future turns).
    const rackBlanks = state.aiRack.tiles.filter(t => t.type === 'blank').length;
    const hasMultiBlanks = rackBlanks >= 2;

    const timeBudget = getTimeBudgetMs();

    // Reserve time for yoyo — it's high-value and must always run. The
    // reserve scales with blank count because heavy-blank racks need
    // much more time for the yoyo's target-aware permutation search to
    // converge. Without this, yoyo searches return null on hard racks
    // even when valid 80+ pt yoyos exist (observed bug: rack
    //   = = ×÷ ? ? +- ? 13   missed an 81pt yoyo on col 7).
    //   0-1 blanks: 15% of total, min 10s
    //   2 blanks:   20%, min 12s
    //   3 blanks:   30%, min 35s
    //   4+ blanks:  40%, min 45s
    const rackBlanksForReserve = state.aiRack.tiles.filter(t => t.type === 'blank').length;
    let yoyoReserveMs = 0;
    if (window.AMath.aiYoyo) {
      if (rackBlanksForReserve >= 4) {
        yoyoReserveMs = Math.max(45000, Math.floor(timeBudget * 0.40));
      } else if (rackBlanksForReserve === 3) {
        yoyoReserveMs = Math.max(35000, Math.floor(timeBudget * 0.30));
      } else if (rackBlanksForReserve === 2) {
        yoyoReserveMs = Math.max(12000, Math.floor(timeBudget * 0.20));
      } else {
        yoyoReserveMs = Math.max(10000, Math.floor(timeBudget * 0.15));
      }
      // Cap: yoyo reserve must not exceed 60% of total budget, or
      // findBestPlay starves. Especially important for easy/normal bots
      // with smaller total budgets (30s/90s).
      const capMs = Math.floor(timeBudget * 0.60);
      if (yoyoReserveMs > capMs) yoyoReserveMs = capMs;
    }
    const findBestBudgetMs = Math.max(5000, timeBudget - yoyoReserveMs);

    // Temporarily reduce time budget so findBestPlay leaves room for yoyo
    const origThinkSeconds = _stateSettings ? _stateSettings.aiThinkSeconds : null;
    if (_stateSettings && yoyoReserveMs > 0) {
      _stateSettings.aiThinkSeconds = Math.floor(findBestBudgetMs / 1000);
    }

    const bingoPlay = await findBestPlay(state.board, state.aiRack, state.isFirstMove, startTime, threats, bingoFeasible, bingoIsHard);

    // Restore original time budget
    if (_stateSettings && origThinkSeconds !== null) {
      _stateSettings.aiThinkSeconds = origThinkSeconds;
    }

    _searchTopPlays = bingoPlay && bingoPlay._topPlays ? bingoPlay._topPlays.slice() : [];
    _lastTopPlays = _searchTopPlays;

    // Yoyo search — ALWAYS runs with reserved budget
    let yoyoPlay = null;
    if (window.AMath.aiYoyo) {
      // Budget for yoyo: the reserved amount, but CAPPED at the remaining
      // total budget. Previously used Math.max which let yoyo overrun the
      // total budget by 30+ seconds when findBestPlay ran long — causing
      // the AI to think for 4+ minutes on hard racks and appear hung.
      //
      // Floor at 3s so yoyo at least tries; if zero time left, skip.
      const remainingMs = timeBudget - (Date.now() - startTime);
      let yoyoBudget = Math.min(yoyoReserveMs, Math.max(3000, remainingMs));
      if (remainingMs <= 0) yoyoBudget = 0;
      console.log('[AI] Yoyo search: budget=' + Math.round(yoyoBudget / 1000) + 's' +
                  ' (reserve=' + Math.round(yoyoReserveMs / 1000) + 's, remaining=' +
                  Math.round(remainingMs / 1000) + 's)');
      if (yoyoBudget > 0) {
        yoyoPlay = window.AMath.aiYoyo.findBestYoYo({
          board: state.board,
          aiRack: state.aiRack,
          isFirstMove: state.isFirstMove,
          _maxTimeMs: yoyoBudget,
        });
        if (yoyoPlay) {
          console.log('[AI] YoYo found: score=' + yoyoPlay.score + ' tiles=' + yoyoPlay.placements.length);
        } else {
          console.log('[AI] YoYo: no valid extension found');
        }
      } else {
        console.log('[AI] YoYo: skipped (no time left)');
      }
    }

    // Count blanks used by each play
    function countBlanksInPlay(play) {
      if (!play || !play.placements) return 0;
      return play.placements.filter(p => p.tile && p.tile.type === 'blank').length;
    }

    // BLANK-MINIMIZED SELECTION: When 2+ blanks in rack, prefer plays
    // that achieve similar scores while using FEWER blanks.
    // "Similar" = within 15% of best score or within 10 pts.
    function blankAwarePick(a, b) {
      if (!a) return b;
      if (!b) return a;
      if (!hasMultiBlanks) return a.score >= b.score ? a : b; // normal: highest score wins

      const blanksA = countBlanksInPlay(a);
      const blanksB = countBlanksInPlay(b);

      // If same blank count, pick higher score
      if (blanksA === blanksB) return a.score >= b.score ? a : b;

      // If one uses fewer blanks, it wins IF its score is "close enough"
      const threshold = Math.max(10, Math.max(a.score, b.score) * 0.15);
      if (blanksA < blanksB && a.score >= b.score - threshold) return a; // a uses fewer blanks, close score
      if (blanksB < blanksA && b.score >= a.score - threshold) return b; // b uses fewer blanks, close score

      // Scores too far apart — pick higher score regardless of blanks
      return a.score >= b.score ? a : b;
    }

    // Identify the "best non-defense play" — compare all search results
    let bestPlay = blankAwarePick(bingoPlay, yoyoPlay);
    if (fastBingoPlay) {
      bestPlay = blankAwarePick(bestPlay, fastBingoPlay);
    }
    if (grammarBingoPlay) {
      bestPlay = blankAwarePick(bestPlay, grammarBingoPlay);
    }

    // Log comparison for debugging
    console.log('[AI] Play comparison:',
      'bingo=' + (bingoPlay ? bingoPlay.score + '/' + bingoPlay.placements.length + 't' : 'none'),
      'yoyo=' + (yoyoPlay ? yoyoPlay.score + '/' + yoyoPlay.placements.length + 't' : 'none'),
      'fast=' + (fastBingoPlay ? fastBingoPlay.score : 'none'),
      'grammar=' + (grammarBingoPlay ? grammarBingoPlay.score : 'none'),
      '→ best=' + (bestPlay ? bestPlay.score + '/' + bestPlay.placements.length + 't' : 'none')
    );

    // Snapshot the search outcome so the game log can record exactly what the AI
    // saw and decided this turn (for diagnosing 'missed bingo' reports).
    window.AMath.aiPlayer._lastDecisionDiag = {
      rack: state.aiRack.tiles.map(function(t){ return t.assigned || t.face; }).join(','),
      rackTypes: state.aiRack.tiles.map(function(t){ return t.type + ':' + t.face + (t.assigned ? '=' + t.assigned : ''); }).join(' '),
      bingoFeasible: bingoFeasible,
      bingoIsHard: bingoIsHard,
      budgetMs: timeBudget,
      level: getBotLevel(),
      bingo: bingoPlay ? (bingoPlay.score + '/' + bingoPlay.placements.length + 't') : 'none',
      yoyo: yoyoPlay ? (yoyoPlay.score + '/' + yoyoPlay.placements.length + 't') : 'none',
      fast: fastBingoPlay ? String(fastBingoPlay.score) : 'none',
      grammar: grammarBingoPlay ? String(grammarBingoPlay.score) : 'none',
      best: bestPlay ? (bestPlay.score + '/' + bestPlay.placements.length + 't') : 'none'
    };

    if (hasMultiBlanks && bestPlay) {
      console.log('[AI] Multi-blank rack (' + rackBlanks + ' blanks): best=' +
                  bestPlay.score + 'pts using ' + countBlanksInPlay(bestPlay) + ' blanks');
    }

    // === Apply Rim Rule (Feature F) ===
    // Don't play on rim (row 0/14, col 0/14) unless:
    //   - Bingo with at least 1 tile on 3E
    //   - YoYo (always exempt; YoYo hits 3E by definition)
    // YoYo is always non-rim-violating per spec. Regular and non-3E Bingo follow rule.
    // If behind 100+, drop the rim rule (desperation mode).
    if (bestPlay && !isBehind100) {
      const isYoYo = bestPlay.type === 'yoyo';
      const isBingo = bestPlay.placements.length === 8;
      const hitsThreeE = playHits3E(bestPlay.placements);
      const exempt = isYoYo || (isBingo && hitsThreeE);

      if (!exempt && isRimPlacement(bestPlay.placements)) {
        // Best play violates rim rule — try non-rim alternative
        const nonRimAlt = bingoPlay ? bingoPlay._bestNonRim : null;
        const nonRimPlay = pickBetterPlay(nonRimAlt, yoyoPlay);

        if (nonRimPlay) {
          // Use the non-rim alternative
          bestPlay = nonRimPlay;
        } else {
          // No non-rim play exists — check if we'd lose by passing
          if (wouldPassLoseGame(state)) {
            // Drop rim rule — play any valid equation to survive
            console.log('[AI] Rim rule blocking, but pass would lose. Playing on rim.');
            // bestPlay already on rim, just use it
          } else {
            // Swap or pass instead
            if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
              return smartSwap(state);
            }
            return { type: 'pass' };
          }
        }
      }
    }

    // === 4. ×9 defense check (Quality-aware implementation) ===
    //
    // Track whether this section picks the play for defensive reasons.
    // If so, blank usage is justified even for short equations — blocking
    // a ×9 threat is worth spending a BLANK.
    let x9DefenseActive = false;
    //
    // The ×9 multiplier is catastrophic: an opponent ×9 play can score 100-300+ pts.
    //
    // Block quality matters: a tile placed ON a 3E square fully prevents the
    // threat (STRONG), a tile BETWEEN the two 3Es on the same line is also very
    // good (MEDIUM, ~90% prevention), but a SUBRIM block (one row/col away) is
    // WEAK and may leave 60% of the threat intact — opponent can still hook
    // using other tiles on the threat line. We must NOT pick a weak subrim
    // block over a strong direct block just because the scores are close.
    //
    // Decision math:
    //   defensive_value(play) = play.score + threat_prevented
    //                         = play.score + threatScore × (1 - residual_threat)
    //
    //   Where residual_threat is:
    //     STRONG block on 3E → 0%      (threat fully neutralized)
    //     MEDIUM between 3Es → 10%     (opponent needs miracle)
    //     WEAK subrim block  → 60%     (opponent still has hooks)
    //     No block           → 100%    (full threat remains)
    //
    // The best play is the one with the highest defensive_value:
    //   - A STRONG-block defensive play prevents 100% of threat → big bonus
    //   - A WEAK-block "defensive" play only prevents 40% → small bonus
    //   - A high-scoring NON-blocking play has no bonus but also loses
    //     full threatScore on opponent's next turn
    //
    // Bug fix history:
    //   v1: defense was a no-op TODO stub; ignored threats entirely
    //   v2: implemented but treated all blocks as equal → picked weak subrim
    //       blocks over strong direct blocks
    //   v3 (current): quality-aware — strongly prefers STRONG/MEDIUM blocks
    if (worstThreat && bestPlay && window.AMath.aiX9) {
      const aiX9 = window.AMath.aiX9;
      const threatScore = aiX9.estimateThreatScore(worstThreat);

      // Helper: compute defensive_value for a single play, including the
      // amplification penalty when the play makes the threat WORSE for opponent.
      //
      //   defensive_value = play.score
      //                    + threatScore × (1 - residual)   // prevention bonus
      //                    - threatScore × amplification    // amplification penalty
      //
      // where amplification > 0 if the threat severity goes UP after the play
      // (e.g., AI's tile adds a hook on the threat line, reducing emptyBetween).
      function evaluateCandidate(play) {
        const residual = aiX9.residualThreatMultiplier(play.placements, worstThreat, state.board);
        let amplification = 0;
        try {
          const threatsAfter = computeThreatsAfterPlay(state.board, play.placements);
          for (const ta of threatsAfter) {
            if (ta.line.type === worstThreat.line.type &&
                ta.line.index === worstThreat.line.index &&
                ta.positionA.row === worstThreat.positionA.row &&
                ta.positionA.col === worstThreat.positionA.col &&
                ta.positionB.row === worstThreat.positionB.row &&
                ta.positionB.col === worstThreat.positionB.col) {
              if (ta.severity > worstThreat.severity) {
                amplification = (ta.severity - worstThreat.severity) / 100;
              }
            }
          }
        } catch (err) { /* ignore */ }
        const defValue = (play.score || 0)
                       + threatScore * (1 - residual)
                       - threatScore * amplification;
        const quality = aiX9.classifyBlockQuality(play.placements, worstThreat);
        return { play: play, defValue: defValue, residual: residual,
                 amplification: amplification, quality: quality };
      }

      // Try offensive ×9 (already tried in section 2 if behind 140)
      let offensiveX9 = null;
      if (!isBehind140) {
        try {
          offensiveX9 = aiX9.findOffensiveX9(state);
        } catch (err) {
          console.error('[AI] findOffensiveX9 failed:', err);
        }
      }

      // Gather ALL candidate plays — blockers AND non-blockers. We compare them
      // on the same metric (defensive_value) so a high-scoring non-blocker can
      // win when no blocker scores well, and a blocker can win when it prevents
      // a large threat.
      const candidates = [bestPlay, bingoPlay, yoyoPlay, fastBingoPlay,
                          grammarBingoPlay,
                          bingoPlay && bingoPlay._bestNonRim,
                          bingoPlay && bingoPlay._bestBlocking,
                          offensiveX9].filter(Boolean);

      // Dedupe — multiple candidates may point to the same play object.
      const seen = new Set();
      const uniqueCandidates = [];
      for (const c of candidates) {
        if (seen.has(c)) continue;
        seen.add(c);
        uniqueCandidates.push(c);
      }

      // Evaluate each and pick the best.
      let bestEval = null;
      for (const c of uniqueCandidates) {
        const ev = evaluateCandidate(c);
        if (!bestEval || ev.defValue > bestEval.defValue) {
          bestEval = ev;
        }
      }

      if (bestEval && bestEval.play !== bestPlay) {
        const isOffX9 = (bestEval.play === offensiveX9);
        const qName = (bestEval.quality >= aiX9.BLOCK_QUALITY.STRONG ? 'STRONG'
                    : bestEval.quality >= aiX9.BLOCK_QUALITY.MEDIUM ? 'MEDIUM'
                    : bestEval.quality >= aiX9.BLOCK_QUALITY.WEAK   ? 'WEAK'
                    : 'NONE');
        const ampNote = bestEval.amplification > 0
          ? ' (amplifies threat by ' + (bestEval.amplification * 100).toFixed(0) + '%)'
          : '';
        console.log('[AI] ×9 defense: switched to ' + bestEval.play.score +
                    '-pt' + (isOffX9 ? ' OFFENSIVE ×9' : '') +
                    ' (' + qName + ' block, defValue ' + bestEval.defValue.toFixed(0) +
                    ', residual ' + (bestEval.residual * 100).toFixed(0) + '%' +
                    ampNote + ')');
        bestPlay = bestEval.play;
        x9DefenseActive = true;   // play was chosen for defensive reasons — blanks OK
      } else if (bestEval) {
        // bestPlay is already the best — log diagnostics for verification
        const qName = (bestEval.quality >= aiX9.BLOCK_QUALITY.STRONG ? 'STRONG'
                    : bestEval.quality >= aiX9.BLOCK_QUALITY.MEDIUM ? 'MEDIUM'
                    : bestEval.quality >= aiX9.BLOCK_QUALITY.WEAK   ? 'WEAK'
                    : 'NONE');
        const ampNote = bestEval.amplification > 0
          ? ' (amplifies threat ' + (bestEval.amplification * 100).toFixed(0) + '%)'
          : '';
        console.log('[AI] ×9 threat handled: ' + bestEval.play.score + '-pt ' + qName +
                    ' block, defValue ' + bestEval.defValue.toFixed(0) + ampNote);
      }
    }

    // === 4b. ×4 threat avoidance ===
    // Don't create plays that LEAVE two 2E squares reachable by a short opponent equation
    // (opponent needs ≤7 tiles to hit both 2Es → ×4 multiplier on their equation).
    //
    // Risk/reward: AI scores N pts but gives opponent a chance for 30-80+ pts via ×4.
    // We avoid creating such threats unless the AI's play scores VERY high (≥80 pts).
    if (window.AMath.aiX4 && bestPlay && bestPlay.score < 80) {
      const createsX4 = window.AMath.aiX4.wouldCreateX4Threat(state.board, bestPlay.placements);
      if (createsX4) {
        // Look for an alternative play that doesn't create a ×4 threat.
        // Search through bingoPlay alternatives and yoyoPlay.
        const altCandidates = [];
        if (bingoPlay && bingoPlay !== bestPlay) altCandidates.push(bingoPlay);
        if (bingoPlay && bingoPlay._bestNonRim) altCandidates.push(bingoPlay._bestNonRim);
        if (yoyoPlay && yoyoPlay !== bestPlay) altCandidates.push(yoyoPlay);

        let safeAlt = null;
        for (const alt of altCandidates) {
          if (!alt || !alt.placements) continue;
          // Require alternative to score reasonably (at least half of bestPlay, or 8+ pts)
          if (alt.score < Math.max(8, bestPlay.score * 0.5)) continue;
          const altCreatesX4 = window.AMath.aiX4.wouldCreateX4Threat(state.board, alt.placements);
          if (!altCreatesX4) {
            safeAlt = alt;
            break;
          }
        }

        if (safeAlt) {
          console.log('[AI] ×4 avoidance: switching from ' + bestPlay.score + '-pt play (creates ×4 threat) to ' +
                      safeAlt.score + '-pt safe play');
          bestPlay = safeAlt;
        } else {
          // No safe alternative. Decision based on score:
          //   - Score < 40 AND can swap: swap instead (giving opponent ×4 isn't worth a small play)
          //   - Score 40-79: play it (the points are worth the risk)
          //   - Score ≥80: handled by outer condition (skip this block entirely)
          if (bestPlay.score < 40 && bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
            console.log('[AI] ×4 avoidance: best play scores only ' + bestPlay.score +
                        ' pts AND creates ×4 threat — swapping instead (opponent could score 30+ with ×4)');
            return smartSwap(state);
          }
          console.log('[AI] ×4 avoidance: best play creates ×4 threat (' + bestPlay.score +
                      ' pts) but no safe alternative — playing anyway since score is decent');
        }
      }
    }

    // === 5. Bingo/YoYo-only mode ===
    // Both bingo (8 tiles, +40 bonus) and yoyo (×9 line, huge multiplier) yield
    // high scores. Treat them with EQUAL priority.
    if (bingoYoyoOnlyMode) {
      // Check bestPlay (might be bingo or yoyo from blankAwarePick)
      if (bestPlay && (bestPlay.placements.length === 8 || bestPlay.type === 'yoyo')) {
        // Bingo trap check: if bag is low, playing all 8 tiles might leave us stuck
        if (bestPlay.placements.length === 8 && bagSize > 0 && bagSize <= 5) {
          const trapDrawn = predictBagContents(state);
          if (trapDrawn && !isLikelyPlayable(trapDrawn, state.board)) {
            console.log('[AI] Bingo-only: bingo trap! After bingo, drawn tiles unplayable');
            // Fall through to yoyo or shorter play below
          } else {
            recordPlay(rackOwner);
            return makePlayResult(bestPlay);
          }
        } else {
          recordPlay(rackOwner);
          return makePlayResult(bestPlay);
        }
      }

      // bestPlay might be a short equation — check yoyoPlay separately
      if (yoyoPlay && yoyoPlay.score >= 10) {
        console.log('[AI] Bingo/YoYo-only: yoyo found (' + yoyoPlay.score + ' pts)');
        recordPlay(rackOwner);
        return makePlayResult(yoyoPlay);
      }

      // Check fastBingo and grammarBingo directly
      if (fastBingoPlay && fastBingoPlay.placements.length === 8) {
        console.log('[AI] Bingo/YoYo-only: fast bingo (' + fastBingoPlay.score + ' pts)');
        recordPlay(rackOwner);
        return makePlayResult(fastBingoPlay);
      }
      if (grammarBingoPlay && grammarBingoPlay.placements.length === 8) {
        console.log('[AI] Bingo/YoYo-only: grammar bingo (' + grammarBingoPlay.score + ' pts)');
        recordPlay(rackOwner);
        return makePlayResult(grammarBingoPlay);
      }

      // EXCEPTIONS to bingo-only rule — when bingo is unlikely or impossible.
      //
      // CRITICAL: Never waste BLANKs on low-value plays.
      // BLANKs are the most valuable tiles (any value, worth 0 points).
      // Playing a 12-pt equation that uses 3 BLANKs is a strategic disaster.
      //
      // Rules:
      // - If the best play USES BLANK(s), score must be MUCH higher to justify it:
      //     1 BLANK used: requires 40+ pts
      //     2 BLANKs used: requires 60+ pts
      //     3+ BLANKs used: requires 80+ pts (essentially must be a Bingo)
      // - If best play uses NO BLANKs, the original 10-pt threshold applies.
      // - If rack has BLANKs but the best play doesn't use them, that's fine (BLANKs preserved).
      const rackTiles = state.aiRack.tiles;
      const blanksInRack = rackTiles.filter(t => t.type === 'blank').length;
      const opsInRack = rackTiles.filter(t => t.type === 'op' || t.type === 'choice').length;
      const equalsInRack = rackTiles.filter(t => t.type === 'equals').length;
      const numbersInRack = rackTiles.filter(t => t.type === 'digit' || t.type === 'twodigit').length;

      // Count BLANKs USED in best play
      const blanksUsedInPlay = bestPlay
        ? bestPlay.placements.filter(p => p.tile && p.tile.type === 'blank').length
        : 0;

      // Score threshold required for a non-Bingo play, scaled by BLANKs used
      let scoreThreshold = 10;
      if (blanksUsedInPlay === 1) scoreThreshold = 40;
      else if (blanksUsedInPlay === 2) scoreThreshold = 60;
      else if (blanksUsedInPlay >= 3) scoreThreshold = 80;

      // A Bingo needs roughly: 4 numbers + 3 ops + 1 equals (or 5 numbers + 2 ops + 1 equals).
      const flexNumbers = numbersInRack + blanksInRack;
      const tooManyOps = opsInRack > 3;
      const notEnoughNumbers = flexNumbers < 4;
      const noEqualsAvailable = equalsInRack === 0 && blanksInRack === 0;
      const bingoInfeasible = tooManyOps || notEnoughNumbers || noEqualsAvailable;

      // Trigger override when:
      //   (a) 2+ BLANKs in rack (search budget likely incomplete), OR
      //   (b) Bingo composition infeasible
      // AND the best play is worth its BLANK cost.
      //
      // IMPORTANT: This override is DISABLED during the first few actual turns.
      // The strategy spec is strict: first turns → bingo/yoyo or SWAP.
      // The override only applies when bingoYoyoOnly mode was triggered by
      // being behind 100+ points (after the initial turns).
      const allowOverride = !isFirstFewPlays;
      const shouldOverride = allowOverride && bestPlay && bestPlay.score >= scoreThreshold &&
                             (blanksInRack >= 2 || bingoInfeasible);

      if (shouldOverride) {
        const reason = blanksInRack >= 2
          ? blanksInRack + ' BLANKs in rack'
          : 'Bingo infeasible (ops=' + opsInRack + ' nums+blanks=' + flexNumbers + ' eq=' + equalsInRack + ')';
        console.log('[AI] Bingo-only override: ' + reason +
                    ', playing ' + bestPlay.score + '-pt fallback' +
                    ' (used ' + blanksUsedInPlay + ' BLANKs, threshold was ' + scoreThreshold + ')');
        recordPlay(rackOwner);
        return {
          type: 'play',
          placements: bestPlay.placements,
          score: bestPlay.score,
          equations: bestPlay.equations,
        };
      }

      // Did not meet threshold — before swapping, check for yoyo using fewer blanks
      if (bestPlay && blanksInRack >= 2) {
        console.log('[AI] Bingo-only mode: best play scored ' + bestPlay.score +
                    ' pts using ' + blanksUsedInPlay + ' BLANKs — below threshold ' + scoreThreshold);

        // With 2+ blanks, a yoyo using 0-1 blanks is gold — play it even if score is modest
        if (yoyoPlay && yoyoPlay.score >= 15) {
          const yoyoBlanks = countBlanksInPlay(yoyoPlay);
          if (yoyoBlanks < blanksInRack) {
            console.log('[AI] Bingo-only: yoyo found using ' + yoyoBlanks +
                        ' blanks for ' + yoyoPlay.score + ' pts — preserving ' +
                        (blanksInRack - yoyoBlanks) + ' blank(s) for next turn');
            recordPlay(rackOwner);
            return {
              type: 'play',
              placements: yoyoPlay.placements,
              score: yoyoPlay.score,
              equations: yoyoPlay.equations,
            };
          }
        }

        // Also check if there's a min-blank play from the search
        const minBlankAlt = bingoPlay && bingoPlay._bestMinBlank;
        if (minBlankAlt && minBlankAlt.score >= 20) {
          const altBlanks = minBlankAlt._blankCount || 0;
          if (altBlanks < blanksUsedInPlay && altBlanks < blanksInRack) {
            console.log('[AI] Bingo-only: min-blank play found using ' + altBlanks +
                        ' blanks for ' + minBlankAlt.score + ' pts');
            recordPlay(rackOwner);
            return {
              type: 'play',
              placements: minBlankAlt.placements,
              score: minBlankAlt.score,
              equations: minBlankAlt.equations,
            };
          }
        }

        console.log('[AI] Swapping non-BLANKs to preserve BLANKs for yoyo.');
      }

      // === BEGINNING STRATEGY ===
      // After 2+ swaps without bingo/yoyo, consider strategic short plays
      const aiSwaps = state.aiConsecutiveSwaps || 0;
      const oppHistory = state.opponentSwapHistory || [];
      const boardIsEmpty = state.isFirstMove;

      if (aiSwaps >= 2) {
        console.log('[AI] Beginning strategy: aiSwaps=' + aiSwaps + ', boardEmpty=' + boardIsEmpty);

        if (boardIsEmpty) {
          // Scenario A: Board empty — check if opponent is ready for bingo
          const oppReady = isOpponentReadyForBingo(oppHistory);
          if (oppReady) {
            state._blockSearchStart = Date.now();
            const blockPlay = findBlockingPlay(state);
            if (blockPlay) {
              console.log('[AI] Beginning: blocking play in safe zone, score=' + blockPlay.score);
              recordPlay(rackOwner);
              return makePlayResult(blockPlay);
            }
          } else {
            console.log('[AI] Beginning: opponent not ready, swap continues');
          }
        } else {
          // Scenario B: Board not empty — play ≥40 if hand is decent
          const handBad = isHandBadForShortPlay(state.aiRack.tiles);
          if (!handBad && bestPlay && bestPlay.score >= 40) {
            const blanksUsed = countBlanksInPlay(bestPlay);
            if (blanksUsed === 0) {
              console.log('[AI] Beginning: board not empty, playing ≥40 (' + bestPlay.score + ')');
              recordPlay(rackOwner);
              return makePlayResult(bestPlay);
            }
          } else if (handBad) {
            console.log('[AI] Beginning: hand too bad for short play, swap');
          }
        }
      }

      // No Bingo or YoYo found — swap to fish for better tiles
      if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
        return smartSwap(state);
      }
      // Bag too small to swap — must pass (unless pass would lose)
      if (wouldPassLoseGame(state) && bestPlay) {
        console.log('[AI] Bingo-only mode but pass would lose. Playing whatever:', bestPlay.score);
        recordPlay(rackOwner);
        return {
          type: 'play',
          placements: bestPlay.placements,
          score: bestPlay.score,
          equations: bestPlay.equations,
        };
      }
      return { type: 'pass' };
    }

    // === 5b. ALWAYS check: don't create ×9/×4 threats for opponent ===
    // Creating a ×9 threat for the opponent is catastrophic at ANY lead.
    // Check all plays, not just when leading 150+.
    if (bestPlay && !state.isFirstMove && botLevel !== 'easy' && window.AMath.aiX9) {
      const createsX9 = wouldCreateX9Threat(state.board, bestPlay.placements);
      const createsX4 = wouldCreateX4Threat(state.board, bestPlay.placements);

      if (createsX9 || createsX4) {
        const threatType = createsX9 ? '×9' : '×4';
        console.log('[AI] Safety: best play (' + bestPlay.score + ' pts) creates ' + threatType + ' threat. Seeking safer alt.');

        // Gather alternatives
        const safeAlts = [
          bingoPlay && bingoPlay._bestNonRim,
          bingoPlay && bingoPlay._bestNoBlank,
          bingoPlay && bingoPlay._bestMinBlank,
          yoyoPlay,
        ].filter(Boolean);

        let safeBest = null;
        for (const alt of safeAlts) {
          if (alt === bestPlay) continue;
          if (wouldCreateX9Threat(state.board, alt.placements)) continue;
          if (wouldCreateX4Threat(state.board, alt.placements)) continue;
          if (!safeBest || alt.score > safeBest.score) safeBest = alt;
        }

        if (safeBest) {
          const lossIfSwap = bestPlay.score - safeBest.score;
          const threatCost = createsX9 ? 100 : 30;
          if (lossIfSwap < threatCost) {
            console.log('[AI] Safety: switched to safer play (' + safeBest.score +
                        ' pts, -' + lossIfSwap + ') to avoid ' + threatType + ' threat (~' + threatCost + ' pts)');
            bestPlay = safeBest;
          } else {
            console.log('[AI] Safety: kept ' + bestPlay.score + '-pt play despite ' +
                        threatType + ' (gain ' + lossIfSwap + ' > threat cost ' + threatCost + ')');
          }
        } else {
          console.log('[AI] Safety: no safe alternative found — playing ' +
                      bestPlay.score + ' pts despite ' + threatType + ' risk');
        }
      }
    }

    // === 6. Lead 150+ closing mode (Feature G) ===
    // Goal: maintain the lead by playing safe + offload hard tiles.
    // Priority: Defend existing ×9 > Score > Safety (no new ×9 or ×4) > Rack mgmt
    //
    // Note: ×9 DEFENSE for existing threats already happened in section 4 above.
    // This section handles: don't CREATE new ×9/×4 threats with our play.
    if (isLead150 && bestPlay) {
      // Lead 150+: actively block ×9 opportunities on the board.
      // Identify unblocked ×9 lines where opponent could set up ×9.
      // A ×9 line has two 3E squares; if both are open, opponent can score ×9.
      const x9Lines = [
        // Horizontal ×9 segments
        { r1: 0, c1: 0, r2: 0, c2: 7 },   { r1: 0, c1: 7, r2: 0, c2: 14 },
        { r1: 7, c1: 0, r2: 7, c2: 7 },   { r1: 7, c1: 7, r2: 7, c2: 14 },
        { r1: 14, c1: 0, r2: 14, c2: 7 }, { r1: 14, c1: 7, r2: 14, c2: 14 },
        // Vertical ×9 segments
        { r1: 0, c1: 0, r2: 7, c2: 0 },   { r1: 7, c1: 0, r2: 14, c2: 0 },
        { r1: 0, c1: 7, r2: 7, c2: 7 },   { r1: 7, c1: 7, r2: 14, c2: 7 },
        { r1: 0, c1: 14, r2: 7, c2: 14 }, { r1: 7, c1: 14, r2: 14, c2: 14 },
      ];

      // Find unblocked ×9 lines (both 3E squares still open/unused)
      const unblockedLines = [];
      for (const line of x9Lines) {
        const cell1 = state.board.cells[line.r1][line.c1];
        const cell2 = state.board.cells[line.r2][line.c2];
        const open1 = !cell1.tile || !cell1.premiumUsed;
        const open2 = !cell2.tile || !cell2.premiumUsed;
        if (open1 && open2) {
          // Collect all cells on this line segment
          const cells = [];
          if (line.r1 === line.r2) {
            // Horizontal
            const minC = Math.min(line.c1, line.c2), maxC = Math.max(line.c1, line.c2);
            for (let c = minC; c <= maxC; c++) cells.push({ r: line.r1, c: c });
          } else {
            // Vertical
            const minR = Math.min(line.r1, line.r2), maxR = Math.max(line.r1, line.r2);
            for (let r = minR; r <= maxR; r++) cells.push({ r: r, c: line.c1 });
          }
          unblockedLines.push(cells);
        }
      }

      if (unblockedLines.length > 0) {
        console.log('[AI] Lead-150: ' + unblockedLines.length + ' unblocked ×9 lines detected');
      }

      // Close-board preference + ×9 blocking bonus
      if (bestPlay.score < 80) {
        const candidates = [bestPlay, bingoPlay && bingoPlay._bestNonRim,
                            bingoPlay && bingoPlay._bestNoBlank, yoyoPlay].filter(Boolean);
        let bestClosing = null;
        let bestCloseScore = -Infinity;

        for (const play of candidates) {
          if (play.score < 5) continue;
          let newAnchors = 0;
          for (const p of play.placements) {
            const adj = [[0,1],[0,-1],[1,0],[-1,0]];
            for (const [dr,dc] of adj) {
              const nr = p.row + dr, nc = p.col + dc;
              if (Board.inBounds(nr, nc) && Board.isCellEmpty(state.board, nr, nc)) {
                const existingAdj = Board.getAdjacentTiles(state.board, nr, nc);
                if (existingAdj.length === 0) newAnchors++;
              }
            }
          }

          // ×9 blocking bonus: how many unblocked ×9 lines does this play disrupt?
          let x9BlockBonus = 0;
          for (const lineCells of unblockedLines) {
            for (const p of play.placements) {
              const blocksLine = lineCells.some(function (lc) { return lc.r === p.row && lc.c === p.col; });
              if (blocksLine) { x9BlockBonus += 15; break; } // 15 pts bonus per blocked line
            }
          }

          const closeScore = play.score * 0.3 + play.placements.length * 3 - newAnchors * 5 + x9BlockBonus;
          if (closeScore > bestCloseScore) {
            bestCloseScore = closeScore;
            bestClosing = play;
          }
        }
        if (bestClosing && bestClosing !== bestPlay) {
          console.log('[AI] Lead-150 close-board: switched to ' + bestClosing.score +
                      '-pt play (' + bestClosing.placements.length + ' tiles, closing)');
          bestPlay = bestClosing;
        }
      }

      // Check rack management: count hard tiles AFTER this play
      const tileSet = getStateSetting('tileSet', 'prathom') || 'prathom';
      const maxHardInRack = (tileSet === 'mathayom') ? 2 : 1;
      const usedTileIds = new Set(bestPlay.placements.map(p => p.tile && p.tile.id).filter(x => x));
      const remainingRack = state.aiRack.tiles.filter(t => !usedTileIds.has(t.id));
      const hardCountAfter = countHardTiles(remainingRack);

      // Bag prediction: count unseen hard tiles
      if (hardCountAfter > maxHardInRack && bestPlay.score < 30) {
        const bagInfo = predictBag(state);
        if (bagInfo.hardRatio < 0.15) {
          // Bag is mostly easy tiles — safe to swap hard tiles
          // Swap the hard tiles in current rack
          const hardTileIds = state.aiRack.tiles
            .filter(t => isHardTile(t))
            .map(t => t.id);
          if (hardTileIds.length > 0 && bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
            return { type: 'swap', tileIds: hardTileIds };
          }
        }
      }
    }

    // === 6.5 LATE-GAME STRATEGY (bag ≤ 15, bag > 0) ===
    //
    // When the bag is running low but not empty, the strategic priorities shift:
    //   - Rack balance matters (keep tiles that enable future bingo)
    //   - Swap quality depends on what's actually left in the bag
    //   - If opponent just swapped few tiles (<4), they're likely near bingo — BLOCK
    //
    // Decision tree:
    //   OVERRIDE: Opponent swapped <4 tiles & bot leads → block their bingo spot
    //   1. bestPlay > 60 pts → play it (any position)
    //   2. Leading 60+, good swap odds → play if >40 pts, or smart swap (rack balance)
    //   3. Leading 60+, bad swap odds → play short eq, dump worst tiles
    //   4. Leading <60 / tied → play with rack balance focus
    //   5. Behind → swap for bingo chance
    if (bagSize > 0 && bagSize <= lateGameBagThreshold && !state.isFirstMove && !bingoYoyoOnlyMode && botLevel !== 'easy') {
      const lateGameResult = lateGameStrategy(state, bestPlay, bingoPlay, yoyoPlay, bagSize);
      if (lateGameResult) {
        if (lateGameResult.type === 'play') recordPlay(rackOwner);
        return lateGameResult;
      }
      // null → fall through to normal mode
    }

    // === 7. Normal mode ===

    // === 7a. ENDGAME PLANNER (bag empty) ===
    // When the bag is empty, the AI has perfect information and should plan
    // multiple turns ahead to empty its rack (earning the ×2 bonus on
    // opponent's remaining tiles). This overrides normal play selection
    // because the strategic priorities change completely:
    //   - BLANK preservation is irrelevant (no future bingo possible)
    //   - Rack management is irrelevant (no tiles to draw)
    //   - Goal: empty rack first, block opponent from doing the same
    if (bagSize === 0 && !state.isFirstMove && bestPlay && botLevel !== 'easy') {
      const endgamePlan = planEndgame(state, bestPlay);
      if (endgamePlan) {
        recordPlay(rackOwner);
        return {
          type: 'play',
          placements: endgamePlan.placements,
          score: endgamePlan.score,
          equations: endgamePlan.equations,
        };
      }
    }

    if (bestPlay) {
      // ×4 threat avoidance: check if this play opens up a 2E+2E line for opponent
      // Try alternatives if so.
      if (!state.isFirstMove && wouldCreateX4Threat(state.board, bestPlay.placements)) {
        console.log('[AI] ×4 threat detected: best play opens 2E+2E line for opponent');
        const alternatives = [
          bingoPlay && bingoPlay._bestNonRim,
          yoyoPlay,
        ].filter(Boolean);
        const safePlay = pickSafePlay(bestPlay, alternatives, state.board);
        if (safePlay !== bestPlay) {
          console.log('[AI] Switched to safer alternative: ' + safePlay.score + ' pts (vs ' + bestPlay.score + ' pts)');
          bestPlay = safePlay;
        } else {
          console.log('[AI] No safe alternative found — accepting ×4 risk');
        }
      }

      // BLANK preservation — strict rule.
      //
      // BLANKs are the most valuable tiles in A-Math (any value, 0 points cost).
      // They should be saved for Bingo attempts. Using a BLANK in a short equation
      // (e.g. 2=2 using a BLANK as the '=') is almost always a strategic disaster.
      //
      // Rule: If the best play uses ANY blanks and is NOT a Bingo (8 tiles),
      //   REJECT it and find a blank-free alternative or swap.
      //
      // Exceptions (blanks may be used in short equations):
      //   1. x9 defense — section 4 chose this play to block a ×9 threat.
      //      Losing 100-300 pts to a ×9 is worse than spending a BLANK.
      //   2. Endgame — bag ≤ 15 tiles. No future Bingo opportunity anyway;
      //      the BLANK should be played for whatever it can get.
      //   3. Bag too small to swap (≤ SWAP_FORBIDDEN_BAG_THRESHOLD) — forced.
      const blanksUsed = bestPlay.placements.filter(p => p.tile && p.tile.type === 'blank').length;
      const isBingo = bestPlay.placements.length === 8;
      const isEndgame = bagSize <= lateGameBagThreshold && !state.isFirstMove;

      if (blanksUsed > 0 && !isBingo && !x9DefenseActive && !isEndgame && botLevel === 'hard') {
        console.log('[AI] BLANK protection: best play uses ' + blanksUsed +
                    ' BLANK(s) for ' + bestPlay.score + ' pts (not Bingo, not x9 defense, not endgame). Rejecting.');

        // Try the tracked blank-free alternative from the search
        const noBlankAlt = bingoPlay && bingoPlay._bestNoBlank;
        if (noBlankAlt && noBlankAlt.score >= 5) {
          console.log('[AI] Using blank-free alternative: ' + noBlankAlt.score + ' pts');
          recordPlay(rackOwner);
          return {
            type: 'play',
            placements: noBlankAlt.placements,
            score: noBlankAlt.score,
            equations: noBlankAlt.equations,
          };
        }

        // With 2+ blanks: try a play using FEWER blanks (save blanks for yoyo)
        if (hasMultiBlanks && bingoPlay && bingoPlay._bestMinBlank) {
          const minBlankAlt = bingoPlay._bestMinBlank;
          const minBlankCount = minBlankAlt._blankCount || 0;
          if (minBlankCount < blanksUsed && minBlankAlt.score >= 5) {
            console.log('[AI] Using min-blank alternative: ' + minBlankAlt.score +
                        ' pts, ' + minBlankCount + ' blanks (saved ' + (blanksUsed - minBlankCount) + ')');
            recordPlay(rackOwner);
            return {
              type: 'play',
              placements: minBlankAlt.placements,
              score: minBlankAlt.score,
              equations: minBlankAlt.equations,
            };
          }
        }

        // Also try yoyo if it doesn't use blanks (or uses fewer)
        if (yoyoPlay) {
          const yoyoBlanks = countBlanksInPlay(yoyoPlay);
          if (yoyoBlanks < blanksUsed && yoyoPlay.score >= 5) {
            console.log('[AI] Using yoyo with fewer blanks: ' + yoyoPlay.score +
                        ' pts, ' + yoyoBlanks + ' blanks');
            recordPlay(rackOwner);
            return {
              type: 'play',
              placements: yoyoPlay.placements,
              score: yoyoPlay.score,
              equations: yoyoPlay.equations,
            };
          }
        }

        // No blank-free alternative — swap to preserve BLANKs for future Bingo/YoYo
        if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
          console.log('[AI] Swapping to preserve BLANKs for future Bingo/YoYo');
          return smartSwap(state);
        }
        // Bag too small to swap — must play the blank-using play anyway
        console.log('[AI] Bag too small to swap, playing blank-heavy play as last resort');
      }

      recordPlay(rackOwner);
      return makePlayResult(bestPlay);
    }

    // === 7c. Endgame Bingo Trap Check ===
    // When bag has few tiles (1-5) and bot plays bingo (all 8 tiles),
    // bot draws those few tiles. If they're unplayable → bot is stuck → loses.
    // Better: play shorter equation, keep some good tiles, plan bingo next turn.
    if (bestPlay && bestPlay.placements.length === 8 && bagSize > 0 && bagSize <= 5 && !state.isFirstMove) {
      const afterBingoDrawn = predictBagContents(state);
      if (afterBingoDrawn && !isLikelyPlayable(afterBingoDrawn, state.board)) {
        console.log('[AI] Bingo trap detected! After bingo, would draw ' + afterBingoDrawn.length +
                    ' tiles that are likely unplayable: ' + afterBingoDrawn.map(t => t.face).join(','));

        // Find best non-bingo play (shorter equation that keeps strategic tiles)
        const shortAlts = [
          bingoPlay && bingoPlay._bestNonRim,
          bingoPlay && bingoPlay._bestNoBlank,
          bingoPlay && bingoPlay._bestMinBlank,
        ].filter(p => p && p.placements.length < 8 && p.placements.length >= 3 && p.score >= 10);

        if (shortAlts.length > 0) {
          shortAlts.sort((a, b) => b.score - a.score);
          const saferPlay = shortAlts[0];
          console.log('[AI] Playing shorter equation (' + saferPlay.score + 'pts, ' +
                      saferPlay.placements.length + ' tiles) instead of bingo to avoid trap');
          recordPlay(rackOwner);
          return makePlayResult(saferPlay);
        }
        // No good alternative — play the bingo anyway (it's still better than nothing)
        console.log('[AI] No good short alternative — playing bingo despite trap risk');
      }
    }

    // Strategic swap
    if (bagSize > 15) {
      const STRATEGIC_SWAP_THRESHOLD = 5;
      if (bingoPlay && bingoPlay.score < STRATEGIC_SWAP_THRESHOLD) {
        return smartSwap(state);
      }
    }

    if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
      // DESPERATION RETRY: before giving up and swapping, try findBestPlay
      // once more with a hugely inflated candidate budget. This catches the
      // case where the rack is "hard" (3+ blanks, multi-digit tile, multiple
      // same operators) and the normal search ran out of candidates before
      // finding ANY valid play. Without this, the AI swaps even when valid
      // plays exist — a real bug observed with rack:
      //   = = ×÷ ? ? +- ? 13   on a board with an 8-tile column equation.
      if (!state.isFirstMove) {
        console.log('[AI] No play found in normal search — running DESPERATION retry');
        _desperationRetryActive = true;
        try {
          const retryPlay = await findBestPlay(state.board, state.aiRack, state.isFirstMove, startTime, threats, false, false);
          if (retryPlay) {
            console.log('[AI] Desperation retry FOUND play: ' + retryPlay.score + ' pts, ' +
                        retryPlay.placements.length + ' tiles');
            _desperationRetryActive = false;
            recordPlay(rackOwner);
            return makePlayResult(retryPlay);
          }
          console.log('[AI] Desperation retry also found nothing — swap is justified');
        } catch (err) {
          console.warn('[AI] Desperation retry threw:', err);
        } finally {
          _desperationRetryActive = false;
        }
      }
      return smartSwap(state);
    }

    // === Pass-Loss Prevention ===
    // If passing would end the game and AI would lose or tie,
    // try to play ANY valid equation (drop all restrictions).
    if (wouldPassLoseGame(state)) {
      console.log('[AI] Pass would lose game! Trying emergency play...');
      // Try ALL available plays: bestPlay (the chosen one) or its non-rim alternative
      // or fallback to bingoPlay/yoyoPlay
      let emergencyPlay = bestPlay ||
                          (bingoPlay && bingoPlay._bestNonRim) ||
                          bingoPlay ||
                          yoyoPlay;
      if (emergencyPlay) {
        console.log('[AI] Emergency play found, score:', emergencyPlay.score);
        recordPlay(rackOwner);
        return {
          type: 'play',
          placements: emergencyPlay.placements,
          score: emergencyPlay.score,
          equations: emergencyPlay.equations,
        };
      }
      console.log('[AI] No emergency play available, must pass');
    }

    // === LAST RESORT: ×0 chain ===
    if (bagSize <= lateGameBagThreshold && !state.isFirstMove) {
      const zeroChains = findZeroChainPlays(state.board, state.aiRack.tiles, false);
      if (zeroChains.length > 0) {
        const best = zeroChains[0];
        console.log('[AI] ×0 chain last resort: ' + best.score + ' pts, ' +
                    best.placements.length + ' tiles (' + (best._chainType || '') + ')');
        recordPlay(rackOwner);
        return makePlayResult(best);
      }
    }

    // === ENDGAME DUMP: bag=0, any play beats passing ===
    // When bag is empty, tiles in hand = penalty at game end.
    // Even a 1-point play that dumps 1 tile is worth it.
    // Re-search with extended time if the main search missed something.
    if (bagSize === 0 && !state.isFirstMove) {
      console.log('[AI] Bag=0 emergency: searching for ANY valid dump play...');
      const dumpStart = Date.now();
      const dumpPlay = await findBestPlay(state.board, state.aiRack, state.isFirstMove,
        dumpStart, null, false);
      if (dumpPlay) {
        console.log('[AI] Bag=0 dump found: ' + dumpPlay.score + ' pts, ' +
                    dumpPlay.placements.length + ' tiles');
        recordPlay(rackOwner);
        return makePlayResult(dumpPlay);
      }
      console.log('[AI] Bag=0: truly no valid play — must pass');
    }

    return { type: 'pass' };
  }

  /**
   * Pick the better of two plays (higher score wins).
   * Returns the play with higher score, or null if both are null.
   */
  function pickBetterPlay(a, b) {
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    return a.score >= b.score ? a : b;
  }

  // Yield to the browser so it can repaint and run timer setInterval callback.
  // Called periodically inside AI's search loops. Resolves immediately on next tick.
  function yieldToBrowser() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  async function findBestPlay(board, aiRack, isFirstMove, startTime, threats, bingoFeasible, bingoIsHard) {
    let bestPlay = null;
    let bestNonRimPlay = null;
    let bestSafePlay = null;
    let bestBlockingPlay = null;
    let bestBlockingDefValue = -1;
    let bestNoBlankPlay = null;
    let bestMinBlankPlay = null;
    let topPlays = [];
    const rack = aiRack.tiles;
    if (rack.length === 0) return null;

    const anchors = findAnchorCells(board, isFirstMove);
    const counter = { count: 0, abort: false };
    const maxTiles = Math.min(rack.length, 8);

    // Count BLANKs — boost candidate budget when many BLANKs present
    const blankCount = rack.filter(t => t.type === 'blank').length;
    const choiceCount = rack.filter(t => t.type === 'choice').length;

    // Candidate budget multiplier scales with combinatorial complexity:
    //   - Each BLANK: 4-15× search space (depending on pruning)
    //   - Each choice (+/-, ×/÷): 2× search space
    //   - First move (only 1 anchor): needs more thorough search
    let candidateMultiplier = 1;
    if (blankCount >= 3) candidateMultiplier = 5;
    else if (blankCount >= 2) candidateMultiplier = 3;
    else if (blankCount >= 1) candidateMultiplier = 2;
    if (choiceCount >= 2) candidateMultiplier *= 1.5;
    if (isFirstMove) candidateMultiplier *= 1.5;
    // Two-digit tiles increase search space — boost budget
    const twoDigitCount = rack.filter(t => t.type === 'twodigit').length;
    if (twoDigitCount >= 2) candidateMultiplier *= 1.5;
    else if (twoDigitCount >= 1) candidateMultiplier *= 1.2;
    // Education mode (300s budget) — search deeper
    if (getTimeBudgetMs() >= 200000) candidateMultiplier *= 2;
    // Desperation retry from decideMove — inflate budget 4× more so we
    // actually exhaust the harder search spaces (3+ blanks + 2 twodigit etc.)
    if (_desperationRetryActive) {
      candidateMultiplier *= 4;
      console.log('[AI] findBestPlay in DESPERATION mode — multiplier boosted 4×');
    }

    const maxCandidatesThisRack = Math.floor(MAX_CANDIDATES_PER_STAGE * candidateMultiplier);
    if (candidateMultiplier > 1) {
      console.log('[AI] Rack: ' + blankCount + ' BLANKs, ' + choiceCount + ' choices, isFirstMove=' + isFirstMove +
                  ' — budget multiplier ' + candidateMultiplier + ' → ' + maxCandidatesThisRack);
    }

    const onValidPlay = (play) => {
      if (!bestPlay || play.score > bestPlay.score) bestPlay = play;

      // Track best non-rim play (Bingo on 3E is also exempt)
      const isBingoOn3E = play.placements.length === 8 && playHits3E(play.placements);
      const isRim = isRimPlacement(play.placements);
      if (!isRim || isBingoOn3E) {
        if (!bestNonRimPlay || play.score > bestNonRimPlay.score) {
          bestNonRimPlay = play;
        }
      }

      // Track best play that uses ZERO blank tiles — for blank preservation in section 7
      const playBlankCount = play.placements.filter(p => p.tile && p.tile.type === 'blank').length;
      if (playBlankCount === 0) {
        if (!bestNoBlankPlay || play.score > bestNoBlankPlay.score) {
          bestNoBlankPlay = play;
        }
      }

      // Track best play using MINIMUM blanks — for multi-blank optimization
      // When holding 2+ blanks, a play using 1 blank for 45 pts is often
      // better than a play using 2 blanks for 50 pts (saves a blank for next turn)
      if (!bestMinBlankPlay ||
          playBlankCount < bestMinBlankPlay._blankCount ||
          (playBlankCount === bestMinBlankPlay._blankCount && play.score > bestMinBlankPlay.score)) {
        bestMinBlankPlay = play;
        bestMinBlankPlay._blankCount = playBlankCount;
      }

      // Track top 3 plays at different board positions (for education mode)
      // Use position key = sorted list of (row,col) to detect same-position plays
      var posKey = play.placements.map(function (p) {
        return p.row + ',' + p.col;
      }).sort().join(';');
      var dominated = false;
      for (var ti = 0; ti < topPlays.length; ti++) {
        if (topPlays[ti]._posKey === posKey) {
          // Same position — keep higher score
          if (play.score > topPlays[ti].score) {
            topPlays[ti] = play;
            topPlays[ti]._posKey = posKey;
          }
          dominated = true;
          break;
        }
      }
      if (!dominated) {
        if (topPlays.length < 3) {
          play._posKey = posKey;
          topPlays.push(play);
        } else {
          // Replace lowest-scoring entry if this play is better
          var minIdx = 0;
          for (var mi = 1; mi < topPlays.length; mi++) {
            if (topPlays[mi].score < topPlays[minIdx].score) minIdx = mi;
          }
          if (play.score > topPlays[minIdx].score) {
            play._posKey = posKey;
            topPlays[minIdx] = play;
          }
        }
      }

      // Track best "safe" play that doesn't create rim hooks for opponent.
      // A "rim hook" = a tile placed on row 0/14 or col 0/14 (the rim itself).
      // Each rim tile gives opponent an easy hook to corner 3X / 2X premium squares
      // on the perpendicular row/col. We score plays by adjusted score:
      //   adjustedScore = score - (rimTileCount × RIM_HOOK_PENALTY)
      // and pick the highest. Penalty is set so a 30-pt safety gain typically
      // outweighs a single rim hook.
      const rimTilesPlaced = countRimTilesInPlay(play.placements);
      const RIM_HOOK_PENALTY = 25;  // pts forfeited per rim tile
      const adjustedScore = play.score - (rimTilesPlaced * RIM_HOOK_PENALTY);
      play._adjustedScore = adjustedScore;
      play._rimTilesPlaced = rimTilesPlaced;
      if (!bestSafePlay || adjustedScore > bestSafePlay._adjustedScore) {
        bestSafePlay = play;
      }

      // Track best threat-blocking play if threats were provided.
      // This widens the candidate pool for section 4's defensive logic, so we
      // can find a blocking play even when bingoPlay/yoyoPlay/etc. don't happen
      // to block.
      //
      // Scoring: defensive_value = play.score + Σ threatScore × (1 - residual)
      // Higher = better play to defend AND score.
      if (threats && threats.length > 0 && window.AMath.aiX9) {
        const aiX9 = window.AMath.aiX9;
        let totalPrevented = 0;
        let blocksAtLeastOne = false;
        for (const t of threats) {
          const q = aiX9.classifyBlockQuality(play.placements, t);
          if (q >= aiX9.BLOCK_QUALITY.MEDIUM) blocksAtLeastOne = true;
          // Pass board so syntactic-feasibility check kicks in: an "between"
          // play that creates an unfillable cell scores like a STRONG block.
          const residual = aiX9.residualThreatMultiplier(play.placements, t, board);
          totalPrevented += aiX9.estimateThreatScore(t) * (1 - residual);
          // Also surface syntactic blocks even if positional quality is below MEDIUM —
          // a syntactic block IS a real block even from a non-MEDIUM placement.
          if (!blocksAtLeastOne && residual <= 0.15) blocksAtLeastOne = true;
        }
        if (blocksAtLeastOne) {
          const defValue = play.score + totalPrevented;
          if (defValue > bestBlockingDefValue) {
            bestBlockingDefValue = defValue;
            bestBlockingPlay = play;
          }
        }
      }

      // ── HARD ×9 EARLY-EXIT ──────────────────────────────────────────────
      // A play that lands new tiles on BOTH 3E squares of a line gets a ×9
      // (3×3) equation multiplier — the maximum premium possible. It is the
      // top-scoring option AND occupies the most dangerous squares (so it also
      // blocks the opponent from using them). There is nothing better to find,
      // so stop the brute-force search immediately. This never skips a needed
      // block, because taking both 3E IS the strongest block of that line.
      if (playHitsBoth3E(play.placements)) {
        if (!bestPlay || play.score >= bestPlay.score) bestPlay = play;
        counter.abort = true;
        counter.stopAll = true;   // global: halt every stage/anchor, not just this loop
        play._x9EarlyExit = true;
        console.log('[AI] ×9 play found (both 3E, ' + play.score + 'pts) — early exit');
      }
    };

    // Search plan: each stage gets an ABSOLUTE time budget in ms (not fractions),
    // so that smaller sizes always get a guaranteed window even if Bingo took long.
    //
    // Bingo: 1500ms (1.5s) — give it a real chance but don't starve smaller sizes
    // Each smaller size: 500ms guaranteed
    // Single tile: 200ms (rare)
    // Time budget per stage scales with rack complexity AND user-configured total budget.
    // The total budget is divided among stages, weighted toward Bingo (size 8).
    //
    // Default split for 180s total:
    //   Size 8 (Bingo): 60s
    //   Size 7-2: 15s each (90s total)
    //   Size 1: 10s
    //   Total: ~160s, leaving slack for YoYo + scoring
    const totalBudgetMs = getTimeBudgetMs();
    // Hard racks: reduce all stage budgets so total findBestPlay time stays
    // bounded. On 3-blank + 2-equals racks the bingo brute-force almost
    // never finds anything, AND the smaller-size stages also have huge
    // permutation spaces. Spending full budget here starves yoyo of time.
    const bingoBudgetPct = (bingoIsHard && !_isEducationMode) ? 0.15 : 0.33;
    const otherBudgetPct = (bingoIsHard && !_isEducationMode) ? 0.04 : 0.08;
    const bingoStageMs = Math.floor(totalBudgetMs * bingoBudgetPct * Math.min(candidateMultiplier, 1.5));
    const otherStageMs = Math.floor(totalBudgetMs * otherBudgetPct * Math.min(candidateMultiplier, 1.5));
    const singleTileMs = Math.floor(totalBudgetMs * 0.05);

    const searchPlan = [];

    if (maxTiles === 8 && bingoFeasible !== false) {
      searchPlan.push({ size: 8, budgetMs: bingoStageMs });
    }
    for (let n = 7; n >= 2; n--) {
      if (n <= maxTiles) searchPlan.push({ size: n, budgetMs: otherStageMs });
    }
    if (!isFirstMove && maxTiles >= 1) {
      searchPlan.push({ size: 1, budgetMs: singleTileMs });
    }

    // Execute search plan
    const stageLogs = [];
    let totalCandidates = 0;
    let anyStageTimedOut = false;
    let lastYieldTime = Date.now();
    const YIELD_INTERVAL_MS = 30;  // yield to browser every ~30ms for responsive UI

    for (const stage of searchPlan) {
      if (counter.stopAll) break;   // ×9 already found — stop all remaining stages
      const stageStart = Date.now();
      const stageDeadline = stageStart + stage.budgetMs;
      const startBest = bestPlay ? bestPlay.score : -1;

      // Reset abort flag AND counter at each stage (per-stage budget, not global)
      counter.abort = false;
      counter.count = 0;

      // Yield at start of each stage so browser can repaint
      if (Date.now() - lastYieldTime > YIELD_INTERVAL_MS) {
        await yieldToBrowser();
        lastYieldTime = Date.now();
      }

      for (const anchor of anchors) {
        if (counter.abort || counter.stopAll) break;
        if (Date.now() > stageDeadline) {
          counter.abort = true;
          break;
        }

        // Yield periodically so timer can tick. Cheap check; ~150ms granularity.
        if (Date.now() - lastYieldTime > YIELD_INTERVAL_MS) {
          await yieldToBrowser();
          lastYieldTime = Date.now();
        }

        // Per-anchor time cap for bingo (size 8): ensures search SPREADS
        // across the board instead of exhausting one area.
        // Budget = stage_time / anchors × 3 (some anchors finish fast, redistribute)
        var anchorStart = Date.now();
        var perAnchorMs = (stage.size >= 7) ? Math.max(500, Math.floor(stage.budgetMs / anchors.length * 3)) : Infinity;

        // For bingo stages, reset abort flag per anchor so one expensive
        // anchor doesn't kill all subsequent ones (unless ×9 found globally)
        if (stage.size >= 7 && !counter.stopAll) {
          counter.abort = false;
        }

        for (const direction of ['horizontal', 'vertical']) {
          if (counter.abort || counter.stopAll) break;
          if (Date.now() > stageDeadline) {
            counter.abort = true;
            break;
          }
          // Per-anchor cap: move on to next anchor after time limit
          if (Date.now() - anchorStart > perAnchorMs) break;

          searchAtAnchor(
            board, aiRack, anchor, direction, stage.size, isFirstMove,
            onValidPlay, counter, stageStart, stage.budgetMs, maxCandidatesThisRack
          );
        }
      }

      const stageElapsed = Date.now() - stageStart;
      if (stageElapsed >= stage.budgetMs * 0.95) anyStageTimedOut = true;
      const stageCandidates = counter.count;
      totalCandidates += stageCandidates;
      const stageImproved = (bestPlay ? bestPlay.score : -1) > startBest;
      stageLogs.push(
        'size=' + stage.size +
        ' candidates=' + stageCandidates +
        ' ms=' + stageElapsed +
        (stageImproved ? ' *NEW BEST*' : '')
      );

      // Hard total time cap — safety net
      if (Date.now() - startTime > getTimeBudgetMs() + 1000) {
        console.log('[AI] Hard total time cap reached');
        break;
      }
    }

    console.log(
      '[AI] Total candidates:', totalCandidates,
      '| Best:', bestPlay ? bestPlay.score + ' pts (' + bestPlay.placements.length + ' tiles)' : 'none',
      '| Best non-rim:', bestNonRimPlay ? bestNonRimPlay.score + ' pts' : 'none',
      '| Best blocking:', bestBlockingPlay ? bestBlockingPlay.score + ' pts (defValue ' + bestBlockingDefValue.toFixed(0) + ')' : 'none',
      '| Stages:', stageLogs.join(' | ')
    );

    // Attach non-rim and blocking alternatives for caller's use
    if (bestPlay) {
      bestPlay._bestNonRim = bestNonRimPlay;
      bestPlay._bestBlocking = bestBlockingPlay;
      bestPlay._bestNoBlank = bestNoBlankPlay;
      bestPlay._bestMinBlank = bestMinBlankPlay;
      bestPlay._timedOut = anyStageTimedOut;
      // Sort top plays by score descending
      topPlays.sort(function (a, b) { return b.score - a.score; });
      bestPlay._topPlays = topPlays;
    }
    return bestPlay;
  }

  // ============================================================================
  // RIM RULE HELPERS
  // ============================================================================

  /** Returns true if any placement is on the rim (row 0/14 or col 0/14). */
  function isRimPlacement(placements) {
    for (const p of placements) {
      if (p.row === 0 || p.row === 14 || p.col === 0 || p.col === 14) {
        return true;
      }
    }
    return false;
  }

  /** Counts how many NEW tiles in the play land on row 0/14 or col 0/14. */
  function countRimTilesInPlay(placements) {
    let count = 0;
    for (const p of placements) {
      if (p.row === 0 || p.row === 14 || p.col === 0 || p.col === 14) {
        count++;
      }
    }
    return count;
  }

  /** Returns true if any placement is on a 3E square. */
  function playHits3E(placements) {
    for (const p of placements) {
      for (const sq of C.THREE_E_SQUARES) {
        if (sq[0] === p.row && sq[1] === p.col) return true;
      }
    }
    return false;
  }

  // True if this play lands NEW tiles on 2+ distinct 3E squares — a ×9 (3×3)
  // equation multiplier. Such a play is both the top-scoring option AND occupies
  // the most valuable/ dangerous squares (so it inherently blocks the opponent
  // from using them). Finding one lets the search stop early with no downside.
  function playHitsBoth3E(placements) {
    let hits = 0;
    for (const sq of C.THREE_E_SQUARES) {
      for (const p of placements) {
        if (sq[0] === p.row && sq[1] === p.col) { hits++; break; }
      }
      if (hits >= 2) return true;
    }
    return false;
  }

  // ============================================================================
  // CLOSING STRATEGY HELPERS (Feature G)
  // ============================================================================

  /**
   * Hard tile faces (NOT considered "easy" rank 10-11).
   * Rank 10-11 = even/odd single-digit (1, 2, 3, 4, 6, 7, 8, 9)
   * Anything else = hard.
   */
  const HARD_TILE_FACES = new Set([
    '0', '5',
    '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  ]);

  /** Returns true if the tile is a "hard" tile by user ranking. */
  function isHardTile(tile) {
    if (!tile) return false;
    if (tile.type === 'op' || tile.type === 'choice' || tile.type === 'equals' || tile.type === 'blank') {
      return false; // operators, choices, equals, blank are always "easy"
    }
    return HARD_TILE_FACES.has(tile.face);
  }

  /** Count hard tiles in a rack array. */
  function countHardTiles(tiles) {
    let count = 0;
    for (const t of tiles) {
      if (isHardTile(t)) count++;
    }
    return count;
  }

  /**
   * Predict bag composition: returns { hardRatio, unseenTotal, unseenHard }.
   * Uses tile tracker logic — total inventory minus what we've seen.
   */
  function predictBag(state) {
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    const seen = {};

    // Count tiles on board
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = state.board.cells[r][c];
        if (cell && cell.tile) {
          seen[cell.tile.face] = (seen[cell.tile.face] || 0) + 1;
        }
      }
    }

    // Count tiles in own rack (AI knows these are NOT in bag)
    for (const t of state.aiRack.tiles) {
      seen[t.face] = (seen[t.face] || 0) + 1;
    }

    // Unseen = inventory - seen
    let unseenTotal = 0;
    let unseenHard = 0;
    for (const def of inventory) {
      const remaining = def.count - (seen[def.face] || 0);
      if (remaining > 0) {
        unseenTotal += remaining;
        if (HARD_TILE_FACES.has(def.face)) {
          unseenHard += remaining;
        }
      }
    }

    return {
      unseenTotal: unseenTotal,
      unseenHard: unseenHard,
      hardRatio: unseenTotal > 0 ? unseenHard / unseenTotal : 0,
    };
  }

  // ============================================================================
  // LATE-GAME STRATEGY (bag ≤ 15)
  // ============================================================================

  /**
   * Detailed bag composition analysis.
   * Returns counts of operators, numbers, equals, blanks, choices in unseen tiles.
   */
  function analyzeBagDetailed(state) {
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    const seen = {};
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = state.board.cells[r][c];
        if (cell && cell.tile) seen[cell.tile.face] = (seen[cell.tile.face] || 0) + 1;
      }
    }
    for (const t of state.aiRack.tiles) seen[t.face] = (seen[t.face] || 0) + 1;

    let ops = 0, nums = 0, equals = 0, blanks = 0, choices = 0, total = 0, hard = 0;
    for (const def of inventory) {
      const rem = Math.max(0, def.count - (seen[def.face] || 0));
      if (rem === 0) continue;
      total += rem;
      if (def.type === 'op') ops += rem;
      else if (def.type === 'equals') equals += rem;
      else if (def.type === 'blank') blanks += rem;
      else if (def.type === 'choice') choices += rem;
      else { nums += rem; if (HARD_TILE_FACES.has(def.face)) hard += rem; }
    }
    return { ops, nums, equals, blanks, choices, total, hard,
             hardRatio: total > 0 ? hard / total : 0 };
  }

  /**
   * Count tile types in an array of tiles.
   */
  function countTileTypes(tiles) {
    let ops = 0, nums = 0, eq = 0, blanks = 0, choices = 0;
    for (const t of tiles) {
      if (t.type === 'op') ops++;
      else if (t.type === 'equals') eq++;
      else if (t.type === 'blank') blanks++;
      else if (t.type === 'choice') choices++;
      else nums++;
    }
    return { ops, nums, eq, blanks, choices };
  }

  /**
   * Assess swap quality: how likely is swapping bad tiles to improve rack?
   * Returns 'good' | 'bad' with reasoning.
   */
  function assessSwapQuality(state, bagInfo, rackInfo) {
    const reasons = [];
    let score = 0;
    const bagSize = Bag.bagSize(state.bag);

    // Small ACTUAL bag = high variance (fewer tiles to draw = riskier)
    if (bagSize <= 5) { score -= 3; reasons.push('bag tiny (' + bagSize + ')'); }
    else if (bagSize <= 8) { score -= 1; reasons.push('bag small (' + bagSize + ')'); }

    // Need operators?
    if (rackInfo.ops === 0 && bagInfo.ops + bagInfo.choices > 0) {
      score += 1; reasons.push('unseen has operators');
    }

    // Need equals?
    if (rackInfo.eq === 0 && rackInfo.blanks === 0) {
      if (bagInfo.equals > 0 || bagInfo.blanks > 0 || bagInfo.choices > 0) {
        score += 1; reasons.push('unseen has = or blanks');
      } else {
        score -= 2; reasons.push('no = or blanks unseen');
      }
    }

    // Too many equals unseen → risk drawing more
    if (bagInfo.equals >= 2 && rackInfo.eq >= 1) {
      score -= 1; reasons.push('many = unseen, risk drawing more');
    }

    // Good number ratio in unseen pool?
    const goodNums = bagInfo.nums - bagInfo.hard;
    const goodRatio = bagInfo.total > 0 ? goodNums / bagInfo.total : 0;
    if (goodRatio > 0.4) {
      score += 1; reasons.push('good num ratio ' + (goodRatio * 100).toFixed(0) + '%');
    }

    // Mostly hard tiles unseen?
    if (bagInfo.hardRatio > 0.5) {
      score -= 1; reasons.push('mostly hard tiles unseen');
    }

    // Need numbers but few unseen?
    if (rackInfo.nums <= 2 && bagInfo.nums < 3) {
      score -= 1; reasons.push('few numbers unseen');
    }

    return {
      quality: score >= 0 ? 'good' : 'bad',
      score: score,
      reasons: reasons,
    };
  }

  /**
   * Find plays that use specific "bad" tiles (dump them).
   * Returns the best play that uses at least one hard/excess tile.
   */
  function findDumpPlay(bestPlay, bingoPlay, yoyoPlay, state) {
    const rack = state.aiRack.tiles;
    const rackInfo = countTileTypes(rack);
    const candidates = [bestPlay, bingoPlay && bingoPlay._bestNonRim,
                        bingoPlay && bingoPlay._bestNoBlank, yoyoPlay].filter(Boolean);

    // Add ×0 chain plays as dump candidates
    const bagSize = Bag.bagSize(state.bag);
    const dumpIsMathayom = (getStateSetting('tileSet', 'prathom') || 'prathom') === 'mathayom';
    const dumpLateThreshold = dumpIsMathayom ? 20 : 15;
    if (bagSize <= dumpLateThreshold) {
      const zeroChains = findZeroChainPlays(state.board, rack, state.isFirstMove);
      for (const zp of zeroChains) candidates.push(zp);
    }

    // Score each candidate by how many "bad" tiles it dumps
    let best = null;
    let bestDumpScore = -1;

    for (const play of candidates) {
      if (play.score < 3) continue; // too weak
      let dumpScore = 0;
      for (const p of play.placements) {
        if (!p.tile) continue;
        if (isHardTile(p.tile)) dumpScore += 3;
        // Mathayom: extra bonus for dumping hard two-digit tiles (prime/÷5)
        if (dumpIsMathayom && p.tile.type === 'twodigit') {
          var face = p.tile.face;
          if (face === '19' || face === '17' || face === '13' || face === '11') dumpScore += 4; // prime
          else if (face === '15' || face === '20') dumpScore += 3; // ÷5
        }
        // Excess operators (>2 in rack)
        if ((p.tile.type === 'op' || p.tile.type === 'choice') && rackInfo.ops + rackInfo.choices > 2) dumpScore += 2;
        // Excess equals (>2 in rack) — 1-2 = is useful for chained equations (e.g. 2+3=5=4+1)
        // Only 3+ equals is truly excess
        if (p.tile.type === 'equals' && rackInfo.eq > 2) dumpScore += 3;
        // Bag=0: every tile dumped avoids penalty — bonus for tile points
        if (Bag.bagSize(state.bag) === 0) dumpScore += (p.tile.points || 0);
      }
      // Bonus for using more tiles (closer to empty)
      dumpScore += play.placements.length;
      // Bonus for score
      dumpScore += play.score * 0.1;

      if (dumpScore > bestDumpScore) {
        bestDumpScore = dumpScore;
        best = play;
      }
    }
    return best;
  }

  /**
   * Find plays that use the most tiles to achieve best rack balance.
   */
  function findRackBalancePlay(bestPlay, bingoPlay, yoyoPlay, state, bagInfo) {
    const rack = state.aiRack.tiles;
    const candidates = [bestPlay, bingoPlay && bingoPlay._bestNonRim,
                        bingoPlay && bingoPlay._bestNoBlank, yoyoPlay].filter(Boolean);

    let best = null;
    let bestBalanceScore = -Infinity;

    for (const play of candidates) {
      if (play.score < 3) continue;
      const usedIds = new Set(play.placements.map(p => p.tile && p.tile.id));
      const remaining = rack.filter(t => !usedIds.has(t.id));
      const remInfo = countTileTypes(remaining);

      // Score remaining rack quality for future bingo
      let balanceScore = play.score * 0.3; // base: play score matters
      balanceScore += play.placements.length * 5; // more tiles played = better

      // Remaining rack balance: ideal is 4-5 nums, 1-2 ops, 1 eq, 0-1 blank
      // Penalize imbalance
      if (remInfo.eq >= 2) balanceScore -= 15;  // 2+ equals is bingo-killer
      if (remInfo.ops + remInfo.choices >= 4) balanceScore -= 10;
      if (remInfo.nums <= 1 && remaining.length > 3) balanceScore -= 10;

      // Reward keeping operators if bag has few
      if (bagInfo.ops + bagInfo.choices <= 2 && remInfo.ops >= 1) balanceScore += 5;
      // Reward keeping numbers if bag has few
      if (bagInfo.nums <= 3 && remInfo.nums >= 2) balanceScore += 5;

      // Penalize keeping hard tiles
      const remHard = remaining.filter(t => isHardTile(t)).length;
      balanceScore -= remHard * 3;

      if (balanceScore > bestBalanceScore) {
        bestBalanceScore = balanceScore;
        best = play;
      }
    }
    return best;
  }

  /**
   * Late-game strategy entry point. Called when 0 < bag ≤ 15.
   * Returns a decision { type, ... } or null to fall through.
   */
  function lateGameStrategy(state, bestPlay, bingoPlay, yoyoPlay, bagSize) {
    const lead = (state.aiScore || 0) - (state.playerScore || 0);
    const lastOpp = state.lastOpponentAction;
    const bagInfo = analyzeBagDetailed(state);
    const rackInfo = countTileTypes(state.aiRack.tiles);

    console.log('[AI] Late-game (bag=' + bagSize + ', lead=' + lead +
                ', rack: ' + rackInfo.nums + 'N ' + rackInfo.ops + 'O ' +
                rackInfo.eq + '= ' + rackInfo.blanks + 'B)');

    // ── 1. Can score >60? Play it regardless (highest priority) ──
    if (bestPlay && bestPlay.score > 60) {
      console.log('[AI] Late-game: best play scores ' + bestPlay.score + ' (>60), playing it');
      return null; // fall through to normal mode — already the best play
    }

    // ── OVERRIDE: Opponent swapped <4 tiles & bot leads → BLOCK ──
    // A small swap (1-3 tiles) strongly suggests the opponent is near bingo/yoyo.
    // If we're leading, it's worth sacrificing a few points to block them.
    // (Checked AFTER >60 — a huge play shouldn't be sacrificed for blocking.)
    if (lead > 0 && lastOpp && lastOpp.type === 'swap' && lastOpp.count < 4) {
      console.log('[AI] Late-game BLOCK: opponent swapped only ' + lastOpp.count +
                  ' tiles → likely near bingo. Attempting to block.');

      if (bestPlay) {
        const allCandidates = [bestPlay, bingoPlay && bingoPlay._bestNonRim,
                               bingoPlay && bingoPlay._bestBlocking, yoyoPlay].filter(Boolean);

        // Score each candidate by how many bingo-viable runs it disrupts.
        // A "bingo-viable run" is a consecutive sequence of 8+ cells
        // (including existing tiles) in a row or column that an opponent
        // could use for a bingo. Placing tiles in the middle of such runs
        // splits them into shorter segments, blocking bingo.
        let blockPlay = null;
        let bestBlockScore = -Infinity;

        for (const play of allCandidates) {
          if (play.score < 5) continue;
          let blockScore = 0;

          for (const p of play.placements) {
            // Check how many long open runs this placement interrupts
            // (a run = consecutive cells in a line that aren't all occupied)
            for (const [dr, dc] of [[0,1],[1,0]]) {
              // Count empty cells in this run direction
              let runLength = 1; // the placed cell itself
              for (let d = 1; d <= 7; d++) {
                const nr = p.row + dr*d, nc = p.col + dc*d;
                if (!Board.inBounds(nr, nc)) break;
                runLength++;
              }
              for (let d = 1; d <= 7; d++) {
                const nr = p.row - dr*d, nc = p.col - dc*d;
                if (!Board.inBounds(nr, nc)) break;
                runLength++;
              }
              // Placing in a run of 8+ cells blocks bingo potential
              if (runLength >= 8) blockScore += 3;
            }

            // Bonus for placing near premium squares (opponent wants these)
            const cell = state.board.cells[p.row][p.col];
            if (cell.premium === '3E') blockScore += 5;
            else if (cell.premium === '2E') blockScore += 3;
            else if (cell.premium === '3T') blockScore += 2;
          }

          // Factor in tiles used and score
          blockScore += play.placements.length * 2;
          blockScore += play.score * 0.2;

          if (blockScore > bestBlockScore) {
            bestBlockScore = blockScore;
            blockPlay = play;
          }
        }

        if (blockPlay) {
          console.log('[AI] Late-game BLOCK: playing ' + blockPlay.score + ' pts, ' +
                      blockPlay.placements.length + ' tiles (block score ' +
                      bestBlockScore.toFixed(0) + ')');
          return {
            type: 'play',
            placements: blockPlay.placements,
            score: blockPlay.score,
            equations: blockPlay.equations,
          };
        }
      }
    }

    // ── 2 & 3. Leading by 60+ ──
    if (lead >= 60) {
      const swapQuality = assessSwapQuality(state, bagInfo, rackInfo);
      console.log('[AI] Late-game leading ' + lead + '+, swap quality: ' +
                  swapQuality.quality + ' (' + swapQuality.reasons.join(', ') + ')');

      if (swapQuality.quality === 'good') {
        // 2a. Good swap odds: play if >40 pts, or smart swap with rack balance
        if (bestPlay && bestPlay.score > 40) {
          console.log('[AI] Late-game: playing ' + bestPlay.score + ' pts (>40, good swap available)');
          return null; // fall through
        }
        // Smart swap considering rack balance
        if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
          console.log('[AI] Late-game: smart swap for rack balance (lead=' + lead + ')');
          return smartSwap(state);
        }
        // Can't swap (bag too small) — fall through to dump play below
      }

      // 3. Bad swap odds (or good swap but can't swap): dump worst tiles
      const dumpPlay = findDumpPlay(bestPlay, bingoPlay, yoyoPlay, state);
      if (dumpPlay) {
        console.log('[AI] Late-game: dump play ' + dumpPlay.score + ' pts, ' +
                    dumpPlay.placements.length + ' tiles (dumping bad tiles)');
        return {
          type: 'play',
          placements: dumpPlay.placements,
          score: dumpPlay.score,
          equations: dumpPlay.equations,
        };
      }
      return null; // no dump play found — fall through to normal
    }

    // ── 4. Leading <60 / tied → rack balance focus ──
    if (lead >= 0) {
      const balancePlay = findRackBalancePlay(bestPlay, bingoPlay, yoyoPlay, state, bagInfo);
      if (balancePlay) {
        console.log('[AI] Late-game: rack-balance play ' + balancePlay.score + ' pts, ' +
                    balancePlay.placements.length + ' tiles');
        return {
          type: 'play',
          placements: balancePlay.placements,
          score: balancePlay.score,
          equations: balancePlay.equations,
        };
      }
      return null;
    }

    // ── 5. Behind → swap for bingo chance ──
    if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
      console.log('[AI] Late-game BEHIND ' + (-lead) + ', swapping to chase bingo');
      return smartSwap(state);
    }

    // Can't swap (bag too small) — play best available
    return null;
  }

  // ============================================================================
  // END OF LATE-GAME STRATEGY
  // ============================================================================

  /**
   * Compute all ×9 threats that would exist after the given placements.
   * Used to detect threat amplification (e.g., adding a hook to a threat line
   * that strengthens an existing threat by lowering emptyBetween).
   */
  function computeThreatsAfterPlay(board, placements) {
    if (!window.AMath.aiX9) return [];
    const placedAt = [];
    try {
      for (const p of placements) {
        if (p.tile && !board.cells[p.row][p.col].tile) {
          window.AMath.board.placeTile(board, p.row, p.col, p.tile);
          placedAt.push({ row: p.row, col: p.col });
        }
      }
      return window.AMath.aiX9.detectAllThreats(board) || [];
    } catch (err) {
      console.error('[AI] computeThreatsAfterPlay error:', err);
      return [];
    } finally {
      for (const pa of placedAt) {
        window.AMath.board.removeTile(board, pa.row, pa.col);
      }
    }
  }

  /**
   * Check if a play would create a new ×9 threat by leaving 2 empty 3E squares
   * exposed on a line with an adjacent tile.
   *
   * Simplified version: check if play results in a board state where any
   * ×9-line has both endpoints empty + adjacent tile + ≤5 cells between.
   */
  function wouldCreateX9Threat(board, placements) {
    if (!window.AMath.aiX9) return false;

    // Helper: create unique key for a threat (line identity + pattern endpoints)
    function threatKey(t) {
      var line = t.line || {};
      var lineId = (line.type || '') + (line.index !== undefined ? line.index : '');
      var a = t.positionA || {};
      var b = t.positionB || {};
      return lineId + ':' + a.row + ',' + a.col + '-' + b.row + ',' + b.col;
    }

    // Detect threats BEFORE placement
    const threatsBefore = window.AMath.aiX9.detectAllThreats(board);
    const beforeKeys = new Set();
    if (threatsBefore) {
      for (var i = 0; i < threatsBefore.length; i++) beforeKeys.add(threatKey(threatsBefore[i]));
    }

    // Simulate: place tiles, check threats, undo
    const placedAt = [];
    try {
      for (const p of placements) {
        if (p.tile && !board.cells[p.row][p.col].tile) {
          window.AMath.board.placeTile(board, p.row, p.col, p.tile);
          placedAt.push({ row: p.row, col: p.col });
        }
      }

      // Detect threats AFTER simulated placement
      const threatsAfter = window.AMath.aiX9.detectAllThreats(board);
      if (!threatsAfter || threatsAfter.length === 0) return false;

      // Check for NEW threats — keys that didn't exist before
      for (var j = 0; j < threatsAfter.length; j++) {
        if (!beforeKeys.has(threatKey(threatsAfter[j]))) {
          return true; // genuinely new threat
        }
      }
      return false;
    } catch (err) {
      console.error('[AI] wouldCreateX9Threat error:', err);
      return false;
    } finally {
      for (const pa of placedAt) {
        window.AMath.board.removeTile(board, pa.row, pa.col);
      }
    }
  }

  /**
   * Detects ×4 (2E + 2E) threats — when a line has two unused 2E squares
   * close enough that the opponent could place a single equation crossing both.
   *
   * Returns true if AFTER placing `placements`, a NEW ×4 threat exists that
   * did not exist BEFORE. (Pre-existing threats aren't AI's fault.)
   *
   * Heuristic:
   *   - Both 2E cells empty + not premium-used
   *   - Distance ≤ 9 cells (so 1 play, 8 rack tiles + 1 hook, can span them)
   *   - At least one occupied cell exists in the row/col within reach
   *     to serve as a hook/anchor
   */
  function wouldCreateX4Threat(board, placements) {
    const SIZE = C.BOARD_SIZE;

    function isUnused2E(cell) {
      return cell && cell.premium === '2E' && !cell.premiumUsed && cell.tile === null;
    }

    // Enumerate all ×4 threats currently on the board (lines with 2E+2E reachable)
    function findThreats() {
      const threats = [];

      // Rows
      for (let r = 0; r < SIZE; r++) {
        const twoE = [], tiles = [];
        for (let c = 0; c < SIZE; c++) {
          const cell = board.cells[r][c];
          if (isUnused2E(cell)) twoE.push(c);
          if (cell.tile !== null) tiles.push(c);
        }
        if (twoE.length < 2) continue;
        for (let i = 0; i < twoE.length; i++) {
          for (let j = i + 1; j < twoE.length; j++) {
            const ca = twoE[i], cb = twoE[j];
            if (cb - ca + 1 > 9) continue;
            let hasHook = false;
            for (const tc of tiles) {
              if (tc >= ca && tc <= cb) { hasHook = true; break; }
              if (tc === ca - 1 || tc === cb + 1) { hasHook = true; break; }
            }
            if (hasHook) threats.push('r' + r + ':' + ca + '-' + cb);
          }
        }
      }

      // Columns
      for (let c = 0; c < SIZE; c++) {
        const twoE = [], tiles = [];
        for (let r = 0; r < SIZE; r++) {
          const cell = board.cells[r][c];
          if (isUnused2E(cell)) twoE.push(r);
          if (cell.tile !== null) tiles.push(r);
        }
        if (twoE.length < 2) continue;
        for (let i = 0; i < twoE.length; i++) {
          for (let j = i + 1; j < twoE.length; j++) {
            const ra = twoE[i], rb = twoE[j];
            if (rb - ra + 1 > 9) continue;
            let hasHook = false;
            for (const tr of tiles) {
              if (tr >= ra && tr <= rb) { hasHook = true; break; }
              if (tr === ra - 1 || tr === rb + 1) { hasHook = true; break; }
            }
            if (hasHook) threats.push('c' + c + ':' + ra + '-' + rb);
          }
        }
      }
      return threats;
    }

    // Count threats BEFORE placement
    const threatsBefore = new Set(findThreats());

    // Simulate placement, count threats AFTER, undo
    const placedAt = [];
    try {
      for (const p of placements) {
        if (p.tile && !board.cells[p.row][p.col].tile) {
          window.AMath.board.placeTile(board, p.row, p.col, p.tile);
          placedAt.push({ row: p.row, col: p.col });
        }
      }
      const threatsAfter = findThreats();
      // Find threats that are NEW (didn't exist before)
      for (const t of threatsAfter) {
        if (!threatsBefore.has(t)) return true;
      }
      return false;
    } catch (err) {
      console.error('[AI] wouldCreateX4Threat error:', err);
      return false;
    } finally {
      for (const pa of placedAt) {
        window.AMath.board.removeTile(board, pa.row, pa.col);
      }
    }
  }

  /**
   * Compares two plays and returns the one that's safer + still high-scoring.
   * Prefers plays that don't create ×4 threats.
   */
  function pickSafePlay(primary, alternatives, board) {
    if (!primary) return null;
    // If primary is safe, use it
    if (!wouldCreateX4Threat(board, primary.placements)) return primary;
    // Primary creates threat — try alternatives
    for (const alt of alternatives) {
      if (!alt) continue;
      if (!wouldCreateX4Threat(board, alt.placements)) {
        // Only swap if alternative score is reasonable (within 60% of primary)
        if (alt.score >= primary.score * 0.6) return alt;
      }
    }
    return primary;  // No safe alternative — accept the threat
  }

  function findAnchorCells(board, isFirstMove) {
    if (isFirstMove) return [{ row: C.CENTER_CELL.row, col: C.CENTER_CELL.col }];

    const anchors = [];
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        if (board.cells[r][c].tile !== null) continue;
        const adj = Board.getAdjacentTiles(board, r, c);
        if (adj.length > 0) anchors.push({ row: r, col: c });
      }
    }

    // OPTIMIZATION: order anchors by "promise" — premium lines first.
    // Priority: ×9 lines > ×4 lines > single 3E > single 2E > 3T > 2T > plain
    anchors.forEach(function (a) {
      let promise = 0;

      // Check each direction for premium cells on the same line
      var directions = [
        { dr: 0, dc: 1, name: 'horiz' },   // horizontal
        { dr: 1, dc: 0, name: 'vert' },     // vertical
      ];

      for (var di = 0; di < directions.length; di++) {
        var dir = directions[di];
        var premiums3E = 0, premiums2E = 0, premiums3T = 0, premiums2T = 0;

        // Scan both directions along this line (up to 14 cells = full board)
        for (var sign = -1; sign <= 1; sign += 2) {
          for (var d = 1; d <= 14; d++) {
            var nr = a.row + dir.dr * d * sign;
            var nc = a.col + dir.dc * d * sign;
            if (!Board.inBounds(nr, nc)) break;
            var cell = board.cells[nr][nc];
            if (!cell) break;
            // Only count UNUSED premiums (tile not placed or premium not consumed)
            var prem = cell.premium;
            if (prem && !cell.premiumUsed) {
              if (prem === '3E') premiums3E++;
              else if (prem === '2E') premiums2E++;
              else if (prem === '3T') premiums3T++;
              else if (prem === '2T') premiums2T++;
            }
          }
        }

        // ×9 line: two 3E squares on same line → highest priority
        if (premiums3E >= 2) promise += 100;
        else if (premiums3E === 1 && premiums2E >= 1) promise += 50;  // 3E×2E = ×6
        else if (premiums3E === 1) promise += 30;  // single 3E
        if (premiums2E >= 2) promise += 40;  // ×4 line
        else if (premiums2E === 1) promise += 15;
        if (premiums3T >= 1) promise += 5;
        if (premiums2T >= 1) promise += 2;
      }

      // Small bonus for nearby existing tiles (more equation context)
      var adjTiles = Board.getAdjacentTiles(board, a.row, a.col);
      promise += adjTiles.length * 0.5;

      a._promise = promise;
    });

    anchors.sort(function (x, y) { return (y._promise || 0) - (x._promise || 0); });
    return anchors;
  }

  function searchAtAnchor(
    board, aiRack, anchor, direction, numTiles, isFirstMove,
    onValidPlay, counter, stageStart, stageBudgetMs, maxCandidates
  ) {
    const cellPositions = collectPlacementCells(board, anchor, direction, numTiles);
    if (!cellPositions) return;

    const rack = aiRack.tiles;
    const used = new Array(rack.length).fill(false);
    const sequence = [];

    permuteAndTry(
      rack, used, sequence, cellPositions, numTiles, board,
      isFirstMove, onValidPlay, counter, stageStart, stageBudgetMs, maxCandidates
    );
  }

  function collectPlacementCells(board, anchor, direction, numTiles) {
    const positions = [];
    let r = anchor.row;
    let c = anchor.col;

    if (!Board.isCellEmpty(board, r, c)) return null;

    // Direction step: supports old names (horizontal/vertical) and new (right/left/down/up)
    let dr = 0, dc = 0;
    if (direction === 'horizontal' || direction === 'right') dc = 1;
    else if (direction === 'left') dc = -1;
    else if (direction === 'vertical' || direction === 'down') dr = 1;
    else if (direction === 'up') dr = -1;

    while (positions.length < numTiles) {
      if (!Board.inBounds(r, c)) return null;
      if (Board.isCellEmpty(board, r, c)) {
        positions.push({ row: r, col: c });
      }
      r += dr;
      c += dc;
    }
    return positions;
  }

  function permuteAndTry(
    rack, used, sequence, cellPositions, numTiles, board,
    isFirstMove, onValidPlay, counter, stageStart, stageBudgetMs, maxCandidates
  ) {
    if (counter.abort) return;
    const limit = maxCandidates || MAX_CANDIDATES_PER_STAGE;
    if (counter.count >= limit) {
      counter.abort = true;
      return;
    }
    // Stage time check every 200 candidates (cheap)
    if (counter.count % 200 === 0 && Date.now() - stageStart > stageBudgetMs) {
      counter.abort = true;
      return;
    }

    if (sequence.length === numTiles) {
      counter.count++;
      const placements = sequence.map((tileIdx, i) => ({
        row: cellPositions[i].row,
        col: cellPositions[i].col,
        tile: rack[tileIdx],
      }));
      const result = tryPlay(board, placements, isFirstMove);
      if (result) onValidPlay(result);
      return;
    }

    // Early pruning for 6+ tile placements: check partial sequence validity
    // to avoid exploring billions of dead-end permutations
    if (numTiles >= 6 && sequence.length >= 2) {
      var seqLen = sequence.length;
      var curPos = cellPositions[seqLen - 1];
      var prevPos = cellPositions[seqLen - 2];
      // Only prune if cells are actually adjacent (no board tile between)
      var areAdjacent = (Math.abs(curPos.row - prevPos.row) + Math.abs(curPos.col - prevPos.col)) === 1;
      if (areAdjacent) {
        var lastTile = rack[sequence[seqLen - 1]];
        var prevTile = rack[sequence[seqLen - 2]];
        var lastFace = lastTile.assigned || lastTile.face;
        var prevFace = prevTile.assigned || prevTile.face;
        var isOp = function (f) { return f === '+' || f === '-' || f === '×' || f === '÷' || f === '+/-' || f === '×/÷'; };
        var lastIsOp = isOp(lastFace);
        var prevIsOp = isOp(prevFace);
        // Two operators adjacent → invalid
        if (lastIsOp && prevIsOp) return;
        // Two equals adjacent → invalid
        var lastIsEq = lastFace === '=';
        var prevIsEq = prevFace === '=';
        if (lastIsEq && prevIsEq) return;
      }
    }

    for (let i = 0; i < rack.length; i++) {
      if (counter.abort) return;
      if (used[i]) continue;
      const tile = rack[i];

      // Skip duplicate tiles: if a previous tile at same depth had the same
      // face+type and wasn't used, swapping them gives identical results.
      // This can cut 2-4× from the search space (e.g., two +/- tiles).
      let isDuplicate = false;
      for (let j = 0; j < i; j++) {
        if (!used[j] && rack[j].face === tile.face && rack[j].type === tile.type) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) continue;
      const cellPos = cellPositions[sequence.length]; // the cell this tile will go into
      const assignedValues = getCandidateAssignments(tile, rack, isFirstMove, board, cellPos);

      for (const assigned of assignedValues) {
        if (counter.abort) return;
        const originalAssigned = tile.assigned;
        tile.assigned = assigned;
        used[i] = true;
        sequence.push(i);

        permuteAndTry(
          rack, used, sequence, cellPositions, numTiles, board,
          isFirstMove, onValidPlay, counter, stageStart, stageBudgetMs, maxCandidates
        );

        sequence.pop();
        used[i] = false;
        tile.assigned = originalAssigned;
      }
    }
  }

  function getCandidateAssignments(tile, rack, isFirstMove, board, cellPos) {
    if (tile.type === 'choice') return tile.face.split('/');
    if (tile.type === 'blank') {
      const fullChoices = (C.getBlankChoices ? C.getBlankChoices() : C.BLANK_CHOICES);

      if (!rack) return fullChoices;

      const rackBlankCount = rack.filter(t => t && t.type === 'blank').length;
      const rackHasEquals = rack.some(t => t && (t.face === '=' || t.assigned === '='));

      // FORCED-EQUALS OPTIMIZATION:
      // If this is the FIRST MOVE (board has no '='), the rack has 0 '=' tiles,
      // and there is exactly 1 BLANK, then the BLANK MUST be '=' — no valid
      // equation can be formed otherwise. Skip enumerating the other ~15 choices.
      // (For non-first moves we can't safely force this — the placement might
      // connect to an existing '=' on the board.)
      if (isFirstMove && rackBlankCount === 1 && !rackHasEquals) {
        return ['='];
      }

      // Smart BLANK assignment: prune choices to reduce combinatorial explosion.
      // 1 BLANK: try all ~15 choices
      // 2 BLANKs: try ~10 (skip duplicates of rack faces)
      // 3+ BLANKs: try ~6 most useful (skip dups, prioritize structural symbols)
      if (rackBlankCount <= 1) return applyCrossConstraint(fullChoices, board, cellPos);

      const rackFaces = new Set();
      for (const t of rack) {
        if (!t || t.type === 'blank') continue;
        rackFaces.add(t.assigned || t.face);
      }

      // Has = already?
      const hasEquals = rackFaces.has('=');
      // Has operator?
      const hasOp = ['+', '-', '×', '÷'].some(o => rackFaces.has(o));

      // Build pruned set based on what the rack needs.
      // IMPORTANT: a BLANK may legitimately DUPLICATE a face already in the
      // rack — e.g. a rack with two '5's can still want a third '5' from a
      // blank (the 94-pt bingo 5..=..5..5 needs exactly this). So for the
      // common structural faces we add them REGARDLESS of whether the rack
      // already has them; only the bulkier digit/two-digit padding is
      // dedup-gated to keep the set small.
      const needed = [];
      // Top priority: = if missing (always include = below for 2-blank anyway)
      if (!hasEquals) needed.push('=');
      // Operators if missing
      if (!hasOp) needed.push('+', '-');
      // Always-useful small numbers — include even if the rack already has them,
      // because blanks can duplicate (common in equations like a+a=2a).
      needed.push('0', '1', '5');

      // For 2 BLANKs: add more variety including two-digit values
      if (rackBlankCount === 2) {
        // Add all operators if not present
        for (const op of ['+', '-', '×', '÷']) {
          if (!needed.includes(op) && !rackFaces.has(op)) needed.push(op);
        }
        // Add small digits not in rack
        for (const d of ['2', '3', '4', '6', '7', '8', '9']) {
          if (!needed.includes(d) && !rackFaces.has(d) && needed.length < 16) needed.push(d);
        }
        // Add two-digit values from inventory (critical for Mathayom + Prathom)
        for (const td of ['10', '12', '14', '16', '18', '20', '11', '13', '15']) {
          if (fullChoices.indexOf(td) >= 0 && !needed.includes(td) && !rackFaces.has(td) && needed.length < 19) needed.push(td);
        }
        // Always include = for safety
        if (!needed.includes('=')) needed.push('=');
      }

      // For 3+ BLANKs: keep lean but include two-digit options
      if (rackBlankCount >= 3) {
        const top6 = [];
        if (!hasEquals) top6.push('=');
        if (!hasOp) top6.push('+');
        if (!rackFaces.has('0')) top6.push('0');
        if (!rackFaces.has('1')) top6.push('1');
        // Add a two-digit if available
        for (const td of ['10', '12', '14']) {
          if (fullChoices.indexOf(td) >= 0 && !rackFaces.has(td) && top6.length < 6) top6.push(td);
        }
        while (top6.length < 6) {
          for (const c of ['=', '+', '-', '0', '1', '2', '5']) {
            if (!top6.includes(c)) { top6.push(c); break; }
          }
        }
        return applyCrossConstraint(top6.slice(0, 6), board, cellPos);
      }

      // Filter to valid faces in active inventory, dedup (needed may repeat)
      const valid = new Set(fullChoices);
      const result = [];
      const seenFace = new Set();
      for (const c of needed) {
        if (valid.has(c) && !seenFace.has(c)) { seenFace.add(c); result.push(c); }
      }
      return applyCrossConstraint(result.length > 0 ? result : fullChoices.slice(0, 5), board, cellPos);
    }
    return [null];
  }

  /**
   * Filter BLANK choices based on cross-direction neighbors on the board.
   * This is SAFE — only eliminates provably impossible assignments.
   *
   * Rules:
   *   - If BOTH cross-neighbors are numbers → BLANK must be operator or =
   *   - If BOTH cross-neighbors are operators → BLANK must be a number
   *   - If one cross-neighbor is operator → BLANK must be a number (op needs number next to it)
   *   - Otherwise: no constraint
   *
   * Falls back to full choices if constraint eliminates everything (safety).
   */
  function applyCrossConstraint(choices, board, cellPos) {
    if (!board || !cellPos) return choices;

    var r = cellPos.row, c = cellPos.col;
    var isNum = function (face) { return /^[0-9]/.test(face); };
    var isOp = function (face) { return face === '+' || face === '-' || face === '×' || face === '÷' || face === '+/-' || face === '×/÷'; };

    // Check all 4 neighbors
    var dirs = [[0,1],[0,-1],[1,0],[-1,0]];
    var neighborTypes = []; // 'num', 'op', 'eq'
    for (var d = 0; d < dirs.length; d++) {
      var nr = r + dirs[d][0], nc = c + dirs[d][1];
      if (!Board.inBounds(nr, nc)) continue;
      var cell = board.cells[nr][nc];
      if (!cell.tile) continue;
      var face = cell.tile.assigned || cell.tile.face;
      if (isNum(face)) neighborTypes.push('num');
      else if (isOp(face)) neighborTypes.push('op');
      else if (face === '=') neighborTypes.push('eq');
    }

    if (neighborTypes.length === 0) return choices; // no neighbors, no constraint

    // If ANY neighbor is an operator, this cell likely needs to be a number
    // (operators need numbers on both sides)
    var hasOpNeighbor = neighborTypes.indexOf('op') >= 0;
    var hasNumNeighbor = neighborTypes.indexOf('num') >= 0;
    var allNum = neighborTypes.every(function (t) { return t === 'num'; }) && neighborTypes.length >= 2;
    var allOp = neighborTypes.every(function (t) { return t === 'op'; }) && neighborTypes.length >= 2;

    var filtered;
    if (allOp) {
      // All operator neighbors → must be number
      filtered = choices.filter(function (ch) { return isNum(ch); });
    } else if (allNum) {
      // All number neighbors → must be operator or =
      filtered = choices.filter(function (ch) { return isOp(ch) || ch === '='; });
    } else if (hasOpNeighbor && !hasNumNeighbor) {
      // Only operator neighbors → prefer numbers (but allow = too)
      filtered = choices.filter(function (ch) { return isNum(ch) || ch === '='; });
    } else {
      return choices; // mixed neighbors or only =, no safe constraint
    }

    // Safety: never return empty — fall back to full choices
    return filtered.length > 0 ? filtered : choices;
  }

  // ============================================================================
  // ENDGAME PLANNER — Multi-turn lookahead when bag is empty
  //
  // When the bag is empty, the AI has PERFECT information:
  //   opponent_rack = total_inventory − board_tiles − ai_rack
  //
  // The planner finds the best sequence of plays to empty the AI's rack
  // (earning the ×2 bonus on opponent's remaining tiles) while blocking
  // the opponent from doing the same.
  //
  // Uses a depth-limited minimax: AI plays → opponent responds → AI plays...
  // up to 3 ply deep. With ≤8 tiles per side and limited board positions,
  // the search tree is manageable.
  // ============================================================================

  /**
   * Deduce opponent's exact rack tiles when bag is empty.
   * Returns array of virtual tile objects.
   */
  function deduceOpponentRack(state) {
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    // Count remaining by face
    const counts = {};
    const typeLookup = {};
    for (const def of inventory) {
      counts[def.face] = (counts[def.face] || 0) + def.count;
      typeLookup[def.face] = { type: def.type, points: def.points };
    }
    // Subtract board
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = state.board.cells[r][c];
        if (cell.tile) counts[cell.tile.face] = (counts[cell.tile.face] || 0) - 1;
      }
    }
    // Subtract AI rack
    for (const t of state.aiRack.tiles) {
      counts[t.face] = (counts[t.face] || 0) - 1;
    }
    // Build virtual tiles
    const tiles = [];
    for (const face in counts) {
      const n = counts[face] || 0;
      const info = typeLookup[face] || { type: 'num', points: 1 };
      for (let i = 0; i < n; i++) {
        tiles.push({
          id: '_opp_' + face + '_' + i,
          face: face, type: info.type, points: info.points, assigned: null,
        });
      }
    }
    return tiles;
  }

  /**
   * Lightweight deep-copy of a board for endgame simulation.
   */
  function cloneBoardForSim(board) {
    const clone = { cells: [] };
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      clone.cells[r] = [];
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = board.cells[r][c];
        clone.cells[r][c] = {
          premium: cell.premium,
          premiumUsed: cell.premiumUsed,
          tile: cell.tile ? { face: cell.tile.face, type: cell.tile.type,
                             points: cell.tile.points, assigned: cell.tile.assigned,
                             id: cell.tile.id } : null,
        };
      }
    }
    return clone;
  }

  /**
   * Synchronous search: find up to `budget` valid plays for given tiles on board.
   * Reuses the same anchor + permutation logic as the main AI search.
   * @param deadline  - Date.now() absolute deadline (shared across entire endgame tree)
   */
  function findPlaysForTiles(board, tiles, budget, deadline) {
    if (!tiles || tiles.length === 0) return [];
    if (deadline && Date.now() > deadline) return [];  // already over time
    budget = budget || 200;
    const results = [];
    const anchors = findAnchorCells(board, false);
    const maxT = Math.min(tiles.length, 8);

    const counter = { count: 0, abort: false };

    for (let numTiles = maxT; numTiles >= 1; numTiles--) {
      for (const anchor of anchors) {
        for (const dir of ['right', 'left', 'down', 'up']) {
          if (counter.abort) break;
          const cellPos = collectPlacementCells(board, anchor, dir, numTiles);
          if (!cellPos) continue;

          const used = new Array(tiles.length).fill(false);
          const seq = [];
          endgamePermute(tiles, used, seq, cellPos, numTiles, board,
                         results, counter, deadline, budget);
        }
        if (counter.abort) break;
      }
      if (counter.abort) break;
    }
    return results;
  }

  /**
   * Recursive permutation for endgame search.
   * Like permuteAndTry but collects ALL valid plays into results array.
   * Uses the shared global deadline for time-checking.
   */
  function endgamePermute(tiles, used, seq, cellPos, numTiles, board,
                          results, counter, deadline, budget) {
    if (counter.abort) return;
    if (results.length >= budget) { counter.abort = true; return; }
    // Check deadline every 300 candidates (cheap)
    if (counter.count % 300 === 0 && deadline && Date.now() > deadline) {
      counter.abort = true; return;
    }

    if (seq.length === numTiles) {
      counter.count++;
      const placements = seq.map((idx, i) => ({
        row: cellPos[i].row, col: cellPos[i].col, tile: tiles[idx],
      }));
      const result = tryPlay(board, placements, false);
      if (result) {
        result.tilesUsed = seq.map(idx => tiles[idx]);
        // Deduplicate: skip if identical score + same tile faces in same positions
        const dominated = results.some(r =>
          r.score >= result.score &&
          r.placements.length === result.placements.length &&
          r.placements.every((p, i) =>
            p.row === result.placements[i].row && p.col === result.placements[i].col
          )
        );
        if (!dominated) results.push(result);
      }
      return;
    }

    for (let i = 0; i < tiles.length; i++) {
      if (counter.abort) return;
      if (used[i]) continue;
      const tile = tiles[i];
      const assignedVals = getCandidateAssignments(tile, tiles, false);

      for (const assigned of assignedVals) {
        if (counter.abort) return;
        const origAssigned = tile.assigned;
        tile.assigned = assigned;
        used[i] = true;
        seq.push(i);

        endgamePermute(tiles, used, seq, cellPos, numTiles, board,
                       results, counter, deadline, budget);

        seq.pop();
        used[i] = false;
        tile.assigned = origAssigned;
      }
    }
  }

  /**
   * Apply a play to a board clone (permanently place tiles).
   */
  function applyPlayToBoard(board, play) {
    for (const p of play.placements) {
      const tile = { face: p.tile.face, type: p.tile.type, points: p.tile.points,
                     assigned: p.assigned || p.tile.assigned, id: p.tile.id };
      Board.placeTile(board, p.row, p.col, tile);
      board.cells[p.row][p.col].premiumUsed = true;
    }
  }

  /**
   * Remove tiles used in a play from a tile array (by id).
   * Returns new array of remaining tiles.
   */
  function removeTilesUsed(tiles, play) {
    const usedIds = new Set(play.placements.map(p => p.tile.id));
    return tiles.filter(t => !usedIds.has(t.id));
  }

  /**
   * Sum of tile points in an array of tiles (for end-game scoring).
   */
  function tilesPointSum(tiles) {
    let s = 0;
    for (const t of tiles) {
      if (t.type !== 'blank') s += (t.points || 0);
    }
    return s;
  }

  /**
   * Endgame evaluation: recursively score a position with minimax.
   *
   * @param simBoard  - cloned board state
   * @param myTiles   - current player's tiles (AI when isMyTurn)
   * @param oppTiles  - opponent's tiles
   * @param myScore   - AI's accumulated endgame score this sequence
   * @param oppScore  - Opponent's accumulated endgame score
   * @param isMyTurn  - true if it's AI's turn
   * @param depth     - remaining search depth
   * @param deadline  - Date.now() deadline for entire search
   * @returns {number} evaluation score (positive = good for AI)
   */
  function endgameEval(simBoard, myTiles, oppTiles, myScore, oppScore, isMyTurn, depth, deadline, alpha, beta) {
    // Time check
    if (Date.now() > deadline) {
      return myScore - oppScore - tilesPointSum(myTiles) + tilesPointSum(oppTiles) * 0.5;
    }

    // Terminal: someone emptied rack → big bonus
    if (myTiles.length === 0) {
      return myScore + tilesPointSum(oppTiles) * 2 + 500;
    }
    if (oppTiles.length === 0) {
      return myScore - oppScore - tilesPointSum(myTiles) * 2 - 500;
    }
    // Depth exhausted
    if (depth <= 0) {
      return myScore - oppScore - tilesPointSum(myTiles) + tilesPointSum(oppTiles) * 0.5;
    }

    // Reduce search budget and branching at deeper levels
    const playBudget = depth >= 2 ? 80 : 40;
    const branchLimit = depth >= 2 ? 8 : 5;

    if (isMyTurn) {
      const plays = findPlaysForTiles(simBoard, myTiles, playBudget, deadline);
      if (plays.length === 0) {
        return endgameEval(simBoard, myTiles, oppTiles, myScore, oppScore, false, depth - 1, deadline, alpha, beta);
      }
      let bestVal = -Infinity;
      plays.sort((a, b) => b.placements.length - a.placements.length || b.score - a.score);
      const topPlays = plays.slice(0, branchLimit);

      for (const play of topPlays) {
        if (Date.now() > deadline) break;
        const nextBoard = cloneBoardForSim(simBoard);
        applyPlayToBoard(nextBoard, play);
        const remaining = removeTilesUsed(myTiles, play);
        const val = endgameEval(nextBoard, remaining, oppTiles,
                                myScore + play.score, oppScore, false, depth - 1, deadline, alpha, beta);
        if (val > bestVal) bestVal = val;
        if (bestVal > alpha) alpha = bestVal;
        if (alpha >= beta) break;  // beta cutoff — opponent won't allow this
      }
      return bestVal === -Infinity ? myScore - oppScore : bestVal;
    } else {
      const plays = findPlaysForTiles(simBoard, oppTiles, playBudget, deadline);
      if (plays.length === 0) {
        return endgameEval(simBoard, myTiles, oppTiles, myScore, oppScore, true, depth - 1, deadline, alpha, beta);
      }
      let worstVal = Infinity;
      plays.sort((a, b) => b.placements.length - a.placements.length || b.score - a.score);
      const topPlays = plays.slice(0, branchLimit);

      for (const play of topPlays) {
        if (Date.now() > deadline) break;
        const nextBoard = cloneBoardForSim(simBoard);
        applyPlayToBoard(nextBoard, play);
        const remaining = removeTilesUsed(oppTiles, play);
        const val = endgameEval(nextBoard, myTiles, remaining,
                                myScore, oppScore + play.score, true, depth - 1, deadline, alpha, beta);
        if (val < worstVal) worstVal = val;
        if (worstVal < beta) beta = worstVal;
        if (alpha >= beta) break;  // alpha cutoff — AI already has a better option
      }
      return worstVal === Infinity ? myScore - oppScore : worstVal;
    }
  }

  /**
   * Main endgame planner. Called from decideMove when bag is empty.
   *
   * Returns the best play for the AI considering multi-turn consequences,
   * or null if endgame planning didn't improve on the normal search.
   */
  function planEndgame(state, normalBestPlay) {
    const startTime = Date.now();
    const deadline = startTime + 15000;   // 15-second budget for entire endgame search
    console.log('[AI] Endgame planner: bag empty, planning ahead...');

    const oppTiles = deduceOpponentRack(state);
    console.log('[AI] Opponent rack deduced: ' +
                oppTiles.map(t => t.face).join(', ') +
                ' (' + oppTiles.length + ' tiles, ' + tilesPointSum(oppTiles) + ' pts)');

    const aiTiles = state.aiRack.tiles;
    if (aiTiles.length === 0) return null;

    // Find all plays for AI on current board
    const allPlays = findPlaysForTiles(state.board, aiTiles, 200, deadline);

    // Add ×0 chain plays — these dump tiles fast even if they score low
    const zeroChainPlays = findZeroChainPlays(state.board, aiTiles, state.isFirstMove);
    for (const zp of zeroChainPlays) {
      // Avoid duplicates: zp is dominated if some existing play p is at least as
      // long and high-scoring AND covers every one of zp's placements. Iterate
      // zp.placements (the subset we're testing) and look each up in p — never
      // index p.placements by zp's length (that caused an out-of-range crash).
      const dominated = allPlays.some(p => {
        if (p.placements.length < zp.placements.length) return false;
        if (p.score < zp.score) return false;
        return zp.placements.every(zpp =>
          p.placements.some(pp => pp.row === zpp.row && pp.col === zpp.col)
        );
      });
      if (!dominated) allPlays.push(zp);
    }

    console.log('[AI] Endgame: found ' + allPlays.length + ' candidates (' +
                zeroChainPlays.length + ' ×0 chain)');

    if (allPlays.length === 0) return null;

    // Evaluate each candidate with minimax lookahead
    let bestPlay = null;
    let bestValue = -Infinity;
    const depth = aiTiles.length <= 4 ? 3 : 2;

    // Include normal best play as a candidate if it exists
    if (normalBestPlay) {
      allPlays.push(normalBestPlay);
    }

    // Sort: prioritize plays using more tiles (closer to emptying rack)
    allPlays.sort((a, b) => b.placements.length - a.placements.length || b.score - a.score);

    for (const play of allPlays) {
      if (Date.now() > deadline) break;

      const simBoard = cloneBoardForSim(state.board);
      applyPlayToBoard(simBoard, play);
      const remaining = removeTilesUsed(aiTiles, play);

      const value = endgameEval(
        simBoard, remaining, oppTiles,
        play.score, 0, false, depth, deadline, -Infinity, Infinity
      );

      if (value > bestValue) {
        bestValue = value;
        bestPlay = play;
      }
    }

    const elapsed = Date.now() - startTime;
    if (bestPlay) {
      console.log('[AI] Endgame plan: ' + bestPlay.score + '-pt play using ' +
                  bestPlay.placements.length + ' tiles (eval ' + bestValue.toFixed(0) +
                  ', depth ' + depth + ', ' + elapsed + 'ms)');

      const rem = removeTilesUsed(aiTiles, bestPlay);
      if (rem.length > 0) {
        console.log('[AI] After play: ' + rem.length + ' tiles remain: ' +
                    rem.map(t => t.face).join(', '));
      } else {
        console.log('[AI] This play empties the rack! Bonus: +' +
                    (tilesPointSum(oppTiles) * 2) + ' pts');
      }
    }

    return bestPlay;
  }

  // ============================================================================
  // END OF ENDGAME PLANNER
  // ============================================================================

  // ============================================================================
  // ×0 CHAIN STRATEGY — Empty rack by appending +0, -0, ×digit chains
  //
  // When the bot has 0 + × and digits, it can dump tiles by chaining:
  //   Turn 1: append +0 to existing equation  (e.g. 5+3=8  →  5+3=8+0)
  //   Turn 2: append ×1 after the 0           (e.g. 5+3=8+0  →  5+3=8+0×1)
  //   Turn 3: append more digits              (e.g. 5+3=8+0×1  →  5+3=8+0×12)
  //
  // Math: +0×(anything) = +0, so the equation stays valid.
  //
  // Activation:
  //   - Bag = 0 (endgame): always check — race to empty rack
  //   - Bag ≤ 4, can't swap, stuck: escape from pass loop
  //   - Leading 60+, bag ≤ 15: close game fast
  //   - Never when behind or bag > 15
  // ============================================================================

  /**
   * Find ×0 chain plays on the board.
   * Returns array of valid plays sorted by tiles used (most first).
   */
  function findZeroChainPlays(board, tiles, isFirstMove) {
    if (isFirstMove) return [];  // Can't chain off empty board
    const results = [];

    // Categorize rack tiles
    const zeros = tiles.filter(t => t.face === '0' || (t.type === 'blank'));
    const plusMinus = tiles.filter(t => t.face === '+' || t.face === '-' ||
      (t.type === 'choice' && (t.face === '+/-')));
    const mulDiv = tiles.filter(t => t.face === '×' || t.face === '÷' ||
      (t.type === 'choice' && (t.face === '×/÷')) || (t.type === 'blank'));
    const digits = tiles.filter(t => t.type === 'digit' || t.type === 'twodigit');

    // Find all line-end positions on the board
    const lineEnds = findLineEnds(board);

    // Phase 1: Try appending +0 or -0
    if (zeros.length > 0 && plusMinus.length > 0) {
      for (const le of lineEnds) {
        for (const opTile of plusMinus) {
          for (const zeroTile of zeros) {
            if (opTile.id === zeroTile.id) continue;

            // Set assignment for choice/blank tiles
            const origOpAssign = opTile.assigned;
            const origZeroAssign = zeroTile.assigned;
            if (opTile.type === 'choice') opTile.assigned = le.preferMinus ? '-' : '+';
            else if (opTile.type === 'blank') opTile.assigned = '+';
            if (zeroTile.type === 'blank') zeroTile.assigned = '0';

            const placements = [
              { row: le.cells[0].row, col: le.cells[0].col, tile: opTile },
              { row: le.cells[1].row, col: le.cells[1].col, tile: zeroTile },
            ];
            const result = tryPlay(board, placements, false);
            if (result) {
              result._chainType = 'phase1_plus_zero';
              result._tilesUsed = 2;
              results.push(result);
            }
            opTile.assigned = origOpAssign;
            zeroTile.assigned = origZeroAssign;
          }
        }
      }
    }

    // Phase 2: Try appending ×digit (after existing +0 on board)
    // Look for board positions ending in ...0 with empty cells after
    if (mulDiv.length > 0 && digits.length > 0) {
      const zeroEnds = findZeroEnds(board);
      for (const ze of zeroEnds) {
        for (const mulTile of mulDiv) {
          // Try ×digit, ×digit-digit, etc.
          const origMulAssign = mulTile.assigned;
          if (mulTile.type === 'choice') mulTile.assigned = '×';
          else if (mulTile.type === 'blank') mulTile.assigned = '×';

          // Single digit: ×N
          for (const dTile of digits) {
            if (dTile.id === mulTile.id) continue;
            if (ze.cells.length < 2) continue;
            const placements = [
              { row: ze.cells[0].row, col: ze.cells[0].col, tile: mulTile },
              { row: ze.cells[1].row, col: ze.cells[1].col, tile: dTile },
            ];
            const result = tryPlay(board, placements, false);
            if (result) {
              result._chainType = 'phase2_mul_digit';
              result._tilesUsed = 2;
              results.push(result);
            }
          }

          // Two digits: ×NN (dump 3 tiles)
          if (ze.cells.length >= 3) {
            for (let i = 0; i < digits.length; i++) {
              for (let j = 0; j < digits.length; j++) {
                if (i === j) continue;
                if (digits[i].id === mulTile.id || digits[j].id === mulTile.id) continue;
                const placements = [
                  { row: ze.cells[0].row, col: ze.cells[0].col, tile: mulTile },
                  { row: ze.cells[1].row, col: ze.cells[1].col, tile: digits[i] },
                  { row: ze.cells[2].row, col: ze.cells[2].col, tile: digits[j] },
                ];
                const result = tryPlay(board, placements, false);
                if (result) {
                  result._chainType = 'phase2_mul_digits';
                  result._tilesUsed = 3;
                  results.push(result);
                }
              }
              if (results.length > 50) break;
            }
            if (results.length > 50) break;
          }
          mulTile.assigned = origMulAssign;
        }
      }
    }

    // Phase 3: Append just digits after existing ×0×N (dump 1-2 tiles)
    // Look for ...×digit positions with empty cells after
    if (digits.length > 0) {
      const digitEnds = findDigitAfterMulEnds(board);
      for (const de of digitEnds) {
        for (const dTile of digits) {
          if (de.cells.length < 1) continue;
          const placements = [
            { row: de.cells[0].row, col: de.cells[0].col, tile: dTile },
          ];
          const result = tryPlay(board, placements, false);
          if (result) {
            result._chainType = 'phase3_append_digit';
            result._tilesUsed = 1;
            results.push(result);
          }
        }
      }
    }

    // Sort: most tiles dumped first, then by score
    results.sort((a, b) => (b._tilesUsed || 0) - (a._tilesUsed || 0) || b.score - a.score);
    return results;
  }

  /**
   * Find all positions where a line of tiles ends and has 2+ empty cells extending.
   * Returns array of { cells: [{row,col}, {row,col}, ...], preferMinus }
   */
  function findLineEnds(board) {
    const ends = [];
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];

    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        if (Board.isCellEmpty(board, r, c)) continue; // need a tile here

        for (const [dr, dc] of dirs) {
          // Check if next cell in this direction is empty (this is a line end)
          const nr = r + dr, nc = c + dc;
          if (!Board.inBounds(nr, nc) || !Board.isCellEmpty(board, nr, nc)) continue;

          // Check if previous cell in opposite direction has a tile (confirming a line)
          const pr = r - dr, pc = c - dc;
          const hasLine = Board.inBounds(pr, pc) && !Board.isCellEmpty(board, pr, pc);
          if (!hasLine) {
            // Single tile — check if it could be part of a cross
            // Skip for now; we need at least a 2-tile line to append to
            continue;
          }

          // Collect empty cells extending from this end (up to 4)
          const cells = [];
          let cr = nr, cc = nc;
          while (cells.length < 4 && Board.inBounds(cr, cc) && Board.isCellEmpty(board, cr, cc)) {
            cells.push({ row: cr, col: cc });
            cr += dr; cc += dc;
          }

          if (cells.length >= 2) {
            ends.push({ cells: cells, preferMinus: false });
          }
        }
      }
    }
    return ends;
  }

  /**
   * Find positions where a 0 tile is at the end of a line with empty cells after.
   * Used for Phase 2 (appending ×digit after +0).
   */
  function findZeroEnds(board) {
    const ends = [];
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];

    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = board.cells[r][c];
        if (!cell.tile) continue;
        const face = cell.tile.assigned || cell.tile.face;
        if (face !== '0') continue;

        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (!Board.inBounds(nr, nc) || !Board.isCellEmpty(board, nr, nc)) continue;

          // Verify the 0 has a +/- before it (confirming +0 pattern)
          const pr = r - dr, pc = c - dc;
          if (!Board.inBounds(pr, pc)) continue;
          const prevCell = board.cells[pr][pc];
          if (!prevCell.tile) continue;
          const prevFace = prevCell.tile.assigned || prevCell.tile.face;
          if (prevFace !== '+' && prevFace !== '-') continue;

          const cells = [];
          let cr = nr, cc = nc;
          while (cells.length < 4 && Board.inBounds(cr, cc) && Board.isCellEmpty(board, cr, cc)) {
            cells.push({ row: cr, col: cc });
            cr += dr; cc += dc;
          }
          if (cells.length >= 2) {
            ends.push({ cells: cells });
          }
        }
      }
    }
    return ends;
  }

  /**
   * Find positions where a digit after × is at the end of a line.
   * Used for Phase 3 (appending more digits to ×0×N...).
   */
  function findDigitAfterMulEnds(board) {
    const ends = [];
    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];

    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = board.cells[r][c];
        if (!cell.tile) continue;
        if (cell.tile.type !== 'digit' && cell.tile.type !== 'twodigit') continue;

        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (!Board.inBounds(nr, nc) || !Board.isCellEmpty(board, nr, nc)) continue;

          // Check that the cell behind this digit is × (confirming ×digit pattern)
          const pr = r - dr, pc = c - dc;
          if (!Board.inBounds(pr, pc)) continue;
          const prevCell = board.cells[pr][pc];
          if (!prevCell.tile) continue;
          const prevFace = prevCell.tile.assigned || prevCell.tile.face;
          if (prevFace !== '×' && prevFace !== '÷') continue;

          // And the cell before × should be 0 (confirming +0× pattern)
          const ppr = pr - dr, ppc = pc - dc;
          if (Board.inBounds(ppr, ppc)) {
            const ppCell = board.cells[ppr][ppc];
            if (ppCell.tile) {
              const ppFace = ppCell.tile.assigned || ppCell.tile.face;
              if (ppFace !== '0') continue; // Not a ×0 chain
            }
          }

          const cells = [];
          let cr = nr, cc = nc;
          while (cells.length < 3 && Board.inBounds(cr, cc) && Board.isCellEmpty(board, cr, cc)) {
            cells.push({ row: cr, col: cc });
            cr += dr; cc += dc;
          }
          if (cells.length >= 1) {
            ends.push({ cells: cells });
          }
        }
      }
    }
    return ends;
  }

  // ============================================================================
  // END OF ×0 CHAIN STRATEGY
  // ============================================================================

  function tryPlay(board, placements, isFirstMove) {
    // Track which placements actually made it onto the board so we can ALWAYS
    // remove them in `finally`, even if Board.placeTile / validatePlay /
    // scorePlay throws partway through. Without this guard, a throw between
    // the place loop and the remove loop would leave phantom tiles on the
    // live board, silently corrupting later searches.
    const applied = [];
    try {
      for (const p of placements) {
        Board.placeTile(board, p.row, p.col, p.tile);
        applied.push(p);
      }

      const validate = Placement.validatePlay(board, placements, isFirstMove);
      if (!validate.ok) return null;

      const scoreResult = Scoring.scorePlay(validate.equations, board, placements.length);

      return {
        placements: placements.map((p) => ({
          row: p.row, col: p.col, tile: p.tile, assigned: p.tile.assigned,
        })),
        equations: validate.equations,
        score: scoreResult.total,
      };
    } finally {
      // Remove only what we actually placed — leaves the board exactly as it
      // was on entry, no matter which line above threw.
      for (const p of applied) Board.removeTile(board, p.row, p.col);
    }
  }

  window.AMath = window.AMath || {};
  /**
   * Predict what tiles remain in the bag.
   * Since we know: total inventory − board tiles − AI rack − (opponent rack estimated) = bag
   * We can compute exact bag contents when bag is small.
   */
  function predictBagContents(state) {
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    const counts = {};
    for (const def of inventory) {
      counts[def.face] = { count: def.count, type: def.type, points: def.points };
    }

    // Helper: get the inventory key for a tile.
    // Inventory is keyed by the ORIGINAL face — 'BLANK', '+/-', '×/÷', '5', '+', etc.
    // For a played blank (face='BLANK', assigned='5'), we must subtract from
    // the BLANK slot, NOT the '5' slot. Same for choice tiles. Using
    // `tile.assigned || tile.face` is wrong here (it was a bug — would
    // miscount the bag composition by attributing played blanks/choices to
    // the assigned face's inventory slot).
    function inventoryKey(tile) {
      return tile.face;
    }

    // Subtract board tiles
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = state.board.cells[r][c];
        if (cell.tile) {
          const face = inventoryKey(cell.tile);
          if (counts[face]) counts[face].count--;
        }
      }
    }

    // Subtract AI rack
    for (const t of state.aiRack.tiles) {
      const face = inventoryKey(t);
      if (counts[face]) counts[face].count--;
    }

    // Subtract opponent rack (if known)
    if (state.opponentRack && state.opponentRack.tiles) {
      for (const t of state.opponentRack.tiles) {
        const face = inventoryKey(t);
        if (counts[face]) counts[face].count--;
      }
    }

    // Remaining = bag contents
    const bagTiles = [];
    for (const face in counts) {
      for (let i = 0; i < Math.max(0, counts[face].count); i++) {
        bagTiles.push({ face: face, type: counts[face].type, points: counts[face].points });
      }
    }
    return bagTiles;
  }

  /**
   * Check if a set of tiles is likely playable on the board.
   * "Playable" = has at least 1 number + 1 operator/equals to form a minimal equation,
   * AND there are anchor cells available to place next to.
   */
  function isLikelyPlayable(tiles, board) {
    if (!tiles || tiles.length === 0) return false;

    let hasNumber = false, hasOp = false, hasEquals = false, hasBlank = false;
    for (const t of tiles) {
      if (t.type === 'digit' || t.type === 'twodigit') hasNumber = true;
      else if (t.type === 'op' || t.type === 'choice') hasOp = true;
      else if (t.type === 'equals') hasEquals = true;
      else if (t.type === 'blank') { hasBlank = true; hasNumber = true; hasOp = true; }
    }

    // Need at least: a number AND (an operator or equals or blank) to extend existing equations
    if (!hasNumber) return false;
    if (!hasOp && !hasEquals && !hasBlank) return false;

    // Also check there are anchor cells on the board (empty cells adjacent to tiles)
    let anchors = 0;
    for (let r = 0; r < C.BOARD_SIZE && anchors < 3; r++) {
      for (let c = 0; c < C.BOARD_SIZE && anchors < 3; c++) {
        if (board.cells[r][c].tile) continue;
        const adj = Board.getAdjacentTiles(board, r, c);
        if (adj.length > 0) anchors++;
      }
    }

    return anchors > 0;
  }

  window.AMath.aiPlayer = {
    decideMove: decideMove,
    resetPlayCount: resetPlayCount,
    getLastTopPlays: function () { return _lastTopPlays || []; },
    // Beginning strategy helpers (exposed for testing)
    _isOpponentReadyForBingo: isOpponentReadyForBingo,
    _isHandBadForShortPlay: isHandBadForShortPlay,
    _findBlockingPlay: findBlockingPlay,
  };
})();
