/**
 * A-Math Game — AI Player (Phase 6c: Best-Move Selection)
 *
 * Improvements over 6a:
 *   - Searches for ALL valid plays (up to a budget)
 *   - Scores each, picks the HIGHEST-scoring move
 *   - Time-budgeted (default 5 seconds)
 *   - Tries hooks (plays that pass through existing tiles)
 *
 * Still brute-force; Pattern Library integration comes in 6b later.
 */

(function () {
  const C = window.AMath.constants;
  const Bag = window.AMath.bag;
  const Board = window.AMath.board;
  const Placement = window.AMath.placement;
  const Scoring = window.AMath.scoring;

  const TIME_BUDGET_MS = 15000;            // Hard cap: 15 seconds per turn
  const MAX_CANDIDATES_PER_STAGE = 200000; // High per-stage cap

  function decideMove(state) {
    const startTime = Date.now();
    const bestPlay = findBestPlay(state.board, state.aiRack, state.isFirstMove, startTime);

    // Strategic swap: if best play is very weak AND bag is healthy AND not first move,
    // swap is often better than playing junk (better tiles incoming)
    const bagSize = Bag.bagSize(state.bag);
    if (bestPlay && !state.isFirstMove && bagSize > 15) {
      const STRATEGIC_SWAP_THRESHOLD = 5; // swap if best play scores < 5
      if (bestPlay.score < STRATEGIC_SWAP_THRESHOLD) {
        // Swap our worst tiles (keep ones with low points and useful types)
        return { type: 'swap', tileIds: state.aiRack.tiles.map((t) => t.id) };
      }
    }

    if (bestPlay) {
      return {
        type: 'play',
        placements: bestPlay.placements,
        score: bestPlay.score,
        equations: bestPlay.equations,
      };
    }

    if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
      return { type: 'swap', tileIds: state.aiRack.tiles.map((t) => t.id) };
    }

    return { type: 'pass' };
  }

  function findBestPlay(board, aiRack, isFirstMove, startTime) {
    let bestPlay = null;
    const rack = aiRack.tiles;
    if (rack.length === 0) return null;

    const anchors = findAnchorCells(board, isFirstMove);
    const counter = { count: 0, abort: false };
    const maxTiles = Math.min(rack.length, 8);

    const onValidPlay = (play) => {
      if (!bestPlay || play.score > bestPlay.score) bestPlay = play;
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
      '| Stages:', stageLogs.join(' | ')
    );

    return bestPlay;
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
      return ['=', '+', '-', '×', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
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
  window.AMath.aiPlayer = { decideMove: decideMove };
})();
