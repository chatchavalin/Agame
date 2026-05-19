/**
 * A-Math Game — AI Player (Phase 6c+ with YoYo + ×9 Strategy)
 *
 * Decision tree:
 *   1. Check ×9 threat → defend if best play ≤ 100
 *   2. Behind 140+ → try ×9 offense
 *   3. Bingo/YoYo-only mode (first 4 turns OR behind 100+) → play Bingo/YoYo
 *   4. Normal → play highest of Bingo/YoYo/regular
 *   5. Lead 150+ → close-board strategy
 */

(function () {
  const C = window.AMath.constants;
  const Bag = window.AMath.bag;
  const Board = window.AMath.board;
  const Placement = window.AMath.placement;
  const Scoring = window.AMath.scoring;

  const TIME_BUDGET_MS = 60000;            // 1 minute hard cap per spec
  const MAX_CANDIDATES_PER_STAGE = 200000;

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
    const brain = (window.AMath.settings && window.AMath.settings.get)
      ? (window.AMath.settings.get('aiSwapBrain') || 'brain1')
      : 'brain1';

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
   * @returns true if AI would lose or tie by passing
   */
  function wouldPassLoseGame(state) {
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

  function decideMove(state) {
    const startTime = Date.now();

    // Identify which rack is playing (for play-count tracking)
    const rackOwner = (state.aiRack && state.aiRack.owner) || 'ai';

    // Determine AI vs opponent score difference
    const myScore = state.aiScore !== undefined ? state.aiScore : 0;
    const oppScore = state.playerScore !== undefined ? state.playerScore : 0;
    const deficit = oppScore - myScore;        // positive = AI behind
    const lead = -deficit;                     // positive = AI ahead

    const isFirstFourPlays = getPlayCount(rackOwner) < C.AI_BINGO_MODE_TURNS;
    const isBehind100 = deficit > C.AI_BEHIND_FOR_BINGO_MODE;
    const isBehind140 = deficit >= C.AI_LEAD_FOR_OFFENSE;
    const isLead150 = lead >= C.AI_LEAD_FOR_CLOSE;
    const bingoYoyoOnlyMode = (isFirstFourPlays || isBehind100) && lead <= C.AI_LEAD_FOR_CLOSE;
    const bagSize = Bag.bagSize(state.bag);

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

    // === 3. Search Bingo + YoYo + Regular plays ===
    const bingoPlay = findBestPlay(state.board, state.aiRack, state.isFirstMove, startTime);
    let yoyoPlay = null;
    if (window.AMath.aiYoyo && (Date.now() - startTime) < TIME_BUDGET_MS - 5000) {
      yoyoPlay = window.AMath.aiYoyo.findBestYoYo({
        board: state.board,
        aiRack: state.aiRack,
        isFirstMove: state.isFirstMove,
      });
    }

    // Identify the "best non-defense play"
    let bestPlay = pickBetterPlay(bingoPlay, yoyoPlay);

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

    // === 4. ×9 defense check ===
    // If threat exists and our best play ≤ 100, we should defend
    if (worstThreat && bestPlay && bestPlay.score <= C.AI_DEFEND_X9_SKIP_THRESHOLD) {
      // Look for a defensive play
      // Check if best play already blocks the threat (great — use it)
      if (window.AMath.aiX9.playBlocksThreat(bestPlay.placements, worstThreat)) {
        // Already defends — proceed
      } else {
        // Try to find a defensive alternative
        // For Phase 1, we just play the bestPlay (defense may not be perfect)
        // Future: implement explicit defensive play search
      }
    }

    // === 5. Bingo/YoYo-only mode ===
    if (bingoYoyoOnlyMode) {
      // Only allow Bingo or YoYo plays
      if (bestPlay && (bestPlay.type === 'bingo' || bestPlay.type === 'yoyo' ||
                       bestPlay.placements.length === 8)) {
        recordPlay(rackOwner);
        return {
          type: 'play',
          placements: bestPlay.placements,
          score: bestPlay.score,
          equations: bestPlay.equations,
        };
      }
      // No Bingo/YoYo found — swap if possible, otherwise pass (skip normal-play fallthrough)
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

    // === 6. Lead 150+ closing mode (Feature G) ===
    // Goal: maintain the lead by playing safe + offload hard tiles.
    // Priority: Score > Safety (no new ×9) > Rack management > Bag prediction
    if (isLead150 && bestPlay) {
      // Check if best play creates a new ×9 threat (Safety check)
      const createsNewX9 = wouldCreateX9Threat(state.board, bestPlay.placements);

      if (createsNewX9) {
        // Try non-rim alternative from bingoPlay's tracking, or fallback to yoyoPlay
        const nonRimAlt = bingoPlay ? bingoPlay._bestNonRim : null;
        const safeAlt = pickBetterPlay(nonRimAlt, yoyoPlay);
        if (safeAlt && !wouldCreateX9Threat(state.board, safeAlt.placements)) {
          bestPlay = safeAlt;
        }
        // If still unsafe, play anyway — score matters most per user priority
      }

      // Check rack management: count hard tiles AFTER this play
      const tileSet = window.AMath.settings ? window.AMath.settings.get('tileSet') : 'prathom';
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

    // === 7. Normal mode ===
    if (bestPlay) {
      recordPlay(rackOwner);
      return {
        type: 'play',
        placements: bestPlay.placements,
        score: bestPlay.score,
        equations: bestPlay.equations,
      };
    }

    // Strategic swap
    if (bagSize > 15) {
      const STRATEGIC_SWAP_THRESHOLD = 5;
      if (bingoPlay && bingoPlay.score < STRATEGIC_SWAP_THRESHOLD) {
        return smartSwap(state);
      }
    }

    if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
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

  function findBestPlay(board, aiRack, isFirstMove, startTime) {
    let bestPlay = null;
    let bestNonRimPlay = null;  // Best play that doesn't violate rim rule
    const rack = aiRack.tiles;
    if (rack.length === 0) return null;

    const anchors = findAnchorCells(board, isFirstMove);
    const counter = { count: 0, abort: false };
    const maxTiles = Math.min(rack.length, 8);

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
    };

    // Search plan: each stage gets an ABSOLUTE time budget in ms (not fractions),
    // so that smaller sizes always get a guaranteed window even if Bingo took long.
    //
    // Bingo: 1500ms (1.5s) — give it a real chance but don't starve smaller sizes
    // Each smaller size: 500ms guaranteed
    // Single tile: 200ms (rare)
    const searchPlan = [];

    if (maxTiles === 8) {
      searchPlan.push({ size: 8, budgetMs: 6000 }); // 6 seconds for Bingo search
    }
    for (let n = 7; n >= 2; n--) {
      if (n <= maxTiles) searchPlan.push({ size: n, budgetMs: 1200 });
    }
    if (!isFirstMove && maxTiles >= 1) {
      searchPlan.push({ size: 1, budgetMs: 400 });
    }

    // Execute search plan
    const stageLogs = [];
    let totalCandidates = 0;
    for (const stage of searchPlan) {
      const stageStart = Date.now();
      const stageDeadline = stageStart + stage.budgetMs;
      const startBest = bestPlay ? bestPlay.score : -1;

      // Reset abort flag AND counter at each stage (per-stage budget, not global)
      counter.abort = false;
      counter.count = 0;

      for (const anchor of anchors) {
        if (counter.abort) break;
        if (Date.now() > stageDeadline) {
          counter.abort = true;
          break;
        }

        for (const direction of ['horizontal', 'vertical']) {
          if (counter.abort) break;
          if (Date.now() > stageDeadline) {
            counter.abort = true;
            break;
          }
          searchAtAnchor(
            board, aiRack, anchor, direction, stage.size, isFirstMove,
            onValidPlay, counter, stageStart, stage.budgetMs
          );
        }
      }

      const stageElapsed = Date.now() - stageStart;
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
      if (Date.now() - startTime > TIME_BUDGET_MS + 1000) {
        console.log('[AI] Hard total time cap reached');
        break;
      }
    }

    console.log(
      '[AI] Total candidates:', totalCandidates,
      '| Best:', bestPlay ? bestPlay.score + ' pts (' + bestPlay.placements.length + ' tiles)' : 'none',
      '| Best non-rim:', bestNonRimPlay ? bestNonRimPlay.score + ' pts' : 'none',
      '| Stages:', stageLogs.join(' | ')
    );

    // Attach non-rim alternative for caller's use
    if (bestPlay) {
      bestPlay._bestNonRim = bestNonRimPlay;
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

  /** Returns true if any placement is on a 3E square. */
  function playHits3E(placements) {
    for (const p of placements) {
      for (const sq of C.THREE_E_SQUARES) {
        if (sq[0] === p.row && sq[1] === p.col) return true;
      }
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

  /**
   * Check if a play would create a new ×9 threat by leaving 2 empty 3E squares
   * exposed on a line with an adjacent tile.
   *
   * Simplified version: check if play results in a board state where any
   * ×9-line has both endpoints empty + adjacent tile + ≤5 cells between.
   */
  function wouldCreateX9Threat(board, placements) {
    if (!window.AMath.aiX9) return false;

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
      return threatsAfter && threatsAfter.length > 0;
    } catch (err) {
      console.error('[AI] wouldCreateX9Threat error:', err);
      return false;
    } finally {
      // Always restore the board, even on error
      for (const pa of placedAt) {
        window.AMath.board.removeTile(board, pa.row, pa.col);
      }
    }
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
    return anchors;
  }

  function searchAtAnchor(
    board, aiRack, anchor, direction, numTiles, isFirstMove,
    onValidPlay, counter, stageStart, stageBudgetMs
  ) {
    const cellPositions = collectPlacementCells(board, anchor, direction, numTiles);
    if (!cellPositions) return;

    const rack = aiRack.tiles;
    const used = new Array(rack.length).fill(false);
    const sequence = [];

    permuteAndTry(
      rack, used, sequence, cellPositions, numTiles, board,
      isFirstMove, onValidPlay, counter, stageStart, stageBudgetMs
    );
  }

  function collectPlacementCells(board, anchor, direction, numTiles) {
    const positions = [];
    let r = anchor.row;
    let c = anchor.col;

    if (!Board.isCellEmpty(board, r, c)) return null;

    while (positions.length < numTiles) {
      if (!Board.inBounds(r, c)) return null;
      if (Board.isCellEmpty(board, r, c)) {
        positions.push({ row: r, col: c });
      }
      if (direction === 'horizontal') c++;
      else r++;
    }
    return positions;
  }

  function permuteAndTry(
    rack, used, sequence, cellPositions, numTiles, board,
    isFirstMove, onValidPlay, counter, stageStart, stageBudgetMs
  ) {
    if (counter.abort) return;
    if (counter.count >= MAX_CANDIDATES_PER_STAGE) {
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

    for (let i = 0; i < rack.length; i++) {
      if (counter.abort) return;
      if (used[i]) continue;
      const tile = rack[i];
      const assignedValues = getCandidateAssignments(tile);

      for (const assigned of assignedValues) {
        if (counter.abort) return;
        const originalAssigned = tile.assigned;
        tile.assigned = assigned;
        used[i] = true;
        sequence.push(i);

        permuteAndTry(
          rack, used, sequence, cellPositions, numTiles, board,
          isFirstMove, onValidPlay, counter, stageStart, stageBudgetMs
        );

        sequence.pop();
        used[i] = false;
        tile.assigned = originalAssigned;
      }
    }
  }

  function getCandidateAssignments(tile) {
    if (tile.type === 'choice') return tile.face.split('/');
    if (tile.type === 'blank') {
      return (C.getBlankChoices ? C.getBlankChoices() : C.BLANK_CHOICES);
    }
    return [null];
  }

  function tryPlay(board, placements, isFirstMove) {
    for (const p of placements) Board.placeTile(board, p.row, p.col, p.tile);

    const validate = Placement.validatePlay(board, placements, isFirstMove);

    if (!validate.ok) {
      for (const p of placements) Board.removeTile(board, p.row, p.col);
      return null;
    }

    const scoreResult = Scoring.scorePlay(validate.equations, board, placements.length);

    for (const p of placements) Board.removeTile(board, p.row, p.col);

    return {
      placements: placements.map((p) => ({
        row: p.row, col: p.col, tile: p.tile, assigned: p.tile.assigned,
      })),
      equations: validate.equations,
      score: scoreResult.total,
    };
  }

  window.AMath = window.AMath || {};
  window.AMath.aiPlayer = {
    decideMove: decideMove,
    resetPlayCount: resetPlayCount,
  };
})();
