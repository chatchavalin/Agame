/**
 * A-Math — In-Browser Puzzle Generator
 *
 * Runs the same game logic the live game uses, simulates N full PvA games,
 * and captures puzzles directly into localStorage. No Node.js required.
 *
 * Same capture criteria as puzzle-recorder.js: bag<25, at least one of
 * top-3 plays is BINGO or YOYO, missed by 5+ points.
 *
 * Usage from puzzle.html UI:
 *   await window.AMath.puzzleGenerator.generate(numGames, onProgress);
 *
 * Progress callback receives: { gameIdx, totalGames, captures, currentTurn,
 *                                elapsedMs, etag: 'simulating'|'done'|'error' }
 *
 * IMPORTANT: This runs in the SAME tab as the UI, so each AI search blocks
 * the main thread (180s per turn worst case). We let the UI breathe by
 * awaiting Promise.resolve() between turns so progress updates render.
 */
(function () {
  'use strict';

  if (!window.AMath || !window.AMath.aiPlayer) {
    console.warn('[puzzle-generator] AMath modules not loaded — skipping');
    return;
  }

  const { constants: C, bag: Bag, rack: Rack, board: Board, scoring: Scoring,
          placement: Placement, aiPlayer: AI } = window.AMath;

  const STORAGE_KEY = 'amath_puzzle_bank';

  function loadBank() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveBank(bank) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bank));
      return true;
    } catch (e) {
      try {
        const drop = Math.max(1, Math.floor(bank.length * 0.1));
        bank.splice(0, drop);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bank));
        return true;
      } catch (e2) { return false; }
    }
  }

  // Append a single new puzzle to the bank IMMEDIATELY.
  // Used during generation so progress is never lost on cancel/refresh/crash.
  function appendCapture(puzzle) {
    const bank = loadBank();
    // Skip if ID already exists (shouldn't happen with Date.now()+random, but defensive)
    if (bank.some(p => p.id === puzzle.id)) return false;
    bank.push(puzzle);
    return saveBank(bank);
  }

  function newGameState() {
    const bag = Bag.createBag();
    const board = Board.createBoard();
    const p1 = Rack.createRack('player');
    const p2 = Rack.createRack('ai');
    for (let i = 0; i < 8; i++) {
      const t1 = Bag.drawTile(bag); if (t1) Rack.addTile(p1, t1);
      const t2 = Bag.drawTile(bag); if (t2) Rack.addTile(p2, t2);
    }
    return {
      board, bag, playerRack: p1, aiRack: p2,
      playerScore: 0, aiScore: 0,
      isPlayerTurn: true, isFirstMove: true,
      consecutiveNonScoringTurns: 0,
      opponentSwapHistory: [], aiActualPlayCount: 0, aiConsecutiveSwaps: 0,
    };
  }

  function applyPlacements(state, placements, isPlayer) {
    const rack = isPlayer ? state.playerRack : state.aiRack;
    const safePlacements = [];
    const commits = [];
    for (const p of placements) {
      if (!p) continue;
      let liveTile = p.tile;
      if (!liveTile && p.tileId) {
        liveTile = rack.tiles.find(t => t && t.id === p.tileId);
      }
      if (!liveTile) {
        const wantFace = p.face;
        liveTile = rack.tiles.find(t => t && (t.face === wantFace || t.assigned === wantFace));
      }
      if (!liveTile) return { ok: false, reason: 'cant resolve tile' };
      const wantAssigned = (p.tile && p.tile.assigned) || p.assigned || liveTile.assigned || null;
      const shadow = { id: liveTile.id, face: liveTile.face, type: liveTile.type, points: liveTile.points, assigned: wantAssigned };
      safePlacements.push({ row: p.row, col: p.col, tile: shadow });
      commits.push({ liveTile, assigned: wantAssigned });
    }
    for (const p of safePlacements) Board.placeTile(state.board, p.row, p.col, p.tile);
    const result = Placement.validatePlay(state.board, safePlacements, state.isFirstMove);
    if (!result.ok) {
      for (const p of safePlacements) Board.removeTile(state.board, p.row, p.col);
      return { ok: false, reason: result.reason };
    }
    for (let i = 0; i < safePlacements.length; i++) {
      const sp = safePlacements[i];
      commits[i].liveTile.assigned = commits[i].assigned;
      Board.removeTile(state.board, sp.row, sp.col);
      Board.placeTile(state.board, sp.row, sp.col, commits[i].liveTile);
    }
    const scoreRes = Scoring.scorePlay(result.equations, state.board, safePlacements.length);
    for (let i = 0; i < safePlacements.length; i++) {
      Board.markPremiumUsed(state.board, safePlacements[i].row, safePlacements[i].col);
      Rack.removeTile(rack, commits[i].liveTile.id);
    }
    while (rack.tiles.length < 8) {
      const t = Bag.drawTile(state.bag);
      if (!t) break;
      Rack.addTile(rack, t);
    }
    if (isPlayer) state.playerScore += scoreRes.total;
    else state.aiScore += scoreRes.total;
    state.isFirstMove = false;
    state.consecutiveNonScoringTurns = 0;
    return { ok: true, score: scoreRes.total };
  }

  function isBingo(p) { return p && p.placements && p.placements.length >= 8; }
  function isYoyo(state, p) {
    if (!p || !p.placements || p.placements.length === 0) return false;
    const occ = {};
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
      if (state.board.cells[r][c].tile) occ[r + ',' + c] = true;
    }
    p.placements.forEach(pp => { occ[pp.row + ',' + pp.col] = true; });
    const rows = {}, cols = {};
    p.placements.forEach(pp => { rows[pp.row] = true; cols[pp.col] = true; });
    for (const rk in rows) {
      let ok = true; for (let cc = 0; cc < 15; cc++) if (!occ[rk + ',' + cc]) { ok = false; break; }
      if (ok) return true;
    }
    for (const ck in cols) {
      let ok = true; for (let rr = 0; rr < 15; rr++) if (!occ[rr + ',' + ck]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  function snapshotBoard(state) {
    const tiles = [];
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
      const cell = state.board.cells[r][c];
      if (!cell.tile) continue;
      const a = cell.tile.assigned || null;
      if (a) tiles.push([r, c, cell.tile.face, a]);
      else tiles.push([r, c, cell.tile.face]);
    }
    return tiles;
  }

  function computeBagComp(state) {
    const inv = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    const counts = {};
    inv.forEach(d => counts[d.face] = d.count);
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
      const t = state.board.cells[r][c].tile;
      if (t) counts[t.face] = (counts[t.face] || 0) - 1;
    }
    state.playerRack.tiles.forEach(t => { if (t) counts[t.face] = (counts[t.face] || 0) - 1; });
    state.aiRack.tiles.forEach(t => { if (t) counts[t.face] = (counts[t.face] || 0) - 1; });
    const result = {};
    for (const f in counts) if (counts[f] > 0) result[f] = counts[f];
    return result;
  }

  function convertPlay(p) {
    return {
      score: p.score, tilesUsed: p.placements.length,
      placements: p.placements.map(x => ({
        row: x.row, col: x.col,
        face: (x.tile && (x.tile.assigned || x.tile.face)) || x.face || '?',
      })),
      createsX9: false,
    };
  }

  // Yield to the browser between turns so the UI can update
  function yieldToUI() { return new Promise(r => setTimeout(r, 0)); }

  let _cancelled = false;

  async function simulateOneGame(captures, onProgress, gameIdx, totalGames, t0) {
    const state = newGameState();
    let turn = 0;
    while (turn < 50) {
      if (_cancelled) return;
      turn++;
      await yieldToUI();

      if (onProgress) {
        onProgress({
          gameIdx, totalGames, captures: captures.length,
          currentTurn: turn, elapsedMs: Date.now() - t0,
          stage: 'simulating',
        });
      }

      const aiState = {
        board: state.board, bag: state.bag,
        aiRack: state.isPlayerTurn ? state.playerRack : state.aiRack,
        opponentRack: state.isPlayerTurn ? state.aiRack : state.playerRack,
        aiScore: state.isPlayerTurn ? state.playerScore : state.aiScore,
        playerScore: state.isPlayerTurn ? state.aiScore : state.playerScore,
        consecutiveNonScoringTurns: state.consecutiveNonScoringTurns,
        isFirstMove: state.isFirstMove,
        opponentSwapHistory: state.opponentSwapHistory,
        aiActualPlayCount: state.aiActualPlayCount,
        aiConsecutiveSwaps: state.aiConsecutiveSwaps || 0,
        lastOpponentAction: state.lastOpponentAction || null,
        _settings: { aiThinkSeconds: 180 },  // full PvA-quality search
      };

      let decision;
      try { decision = await AI.decideMove(aiState); }
      catch (e) { console.warn('[gen] decideMove threw', e); break; }
      if (!decision) break;

      const topPlays = AI.getLastTopPlays ? AI.getLastTopPlays() : [];

      // Upgrade swap/pass → play if a real play exists, to keep games progressing
      try {
        if ((decision.type === 'swap' || decision.type === 'pass') && topPlays.length > 0) {
          const t0p = topPlays[0];
          if (t0p && t0p.placements && t0p.placements.length > 0) {
            const valid = t0p.placements.every(p => p && p.tile && p.row != null && p.col != null);
            if (valid) {
              decision = { type: 'place', placements: t0p.placements, score: t0p.score, equations: t0p.equations };
            }
          }
        }
      } catch (e) {}

      if ((decision.type === 'place' || decision.type === 'play') && decision.placements) {
        const bagCount = state.bag.tiles.length;

        // CAPTURE PHASE: only on player turns, late game, with bingo/yoyo available
        if (state.isPlayerTurn && bagCount < 25) {
          const allPlays = [];
          const seen = new Set();
          const addP = (p) => {
            if (!p || !p.placements) return;
            const k = p.placements.map(x => x.row + ',' + x.col).sort().join('|');
            if (seen.has(k)) return;
            seen.add(k);
            allPlays.push(p);
          };
          addP(decision);
          topPlays.forEach(addP);
          allPlays.sort((a, b) => (b.score || 0) - (a.score || 0));
          const top3 = allPlays.slice(0, 3);
          const best = top3[0];

          let hasBig = false;
          for (const pl of top3) if (isBingo(pl) || isYoyo(state, pl)) { hasBig = true; break; }

          if (hasBig && best && best.score >= 8 && allPlays.length >= 2) {
            // weak = a lower-scoring alternative (not best)
            const weakIdx = Math.min(allPlays.length - 1, 1 + Math.floor(Math.random() * (allPlays.length - 1)));
            const weak = allPlays[weakIdx];
            if (weak !== best) {
              const diff = best.score - weak.score;
              if (diff >= 5) {
                const bestPlays = top3.map(p => {
                  const c = convertPlay(p);
                  c.isBingo = isBingo(p);
                  c.isYoyo = isYoyo(state, p);
                  return c;
                });
                const puzzle = {
                  id: Date.now() + Math.floor(Math.random() * 1e9),
                  capturedAt: new Date().toISOString(),
                  scoreYou: state.playerScore,
                  scoreOpp: state.aiScore,
                  bagCount,
                  board: snapshotBoard(state),
                  rack: state.playerRack.tiles.filter(t => t).map(t => t.face),
                  bagComp: computeBagComp(state),
                  playerPlay: {
                    score: weak.score,
                    placements: weak.placements.map(p => ({ row: p.row, col: p.col, face: (p.tile.assigned || p.tile.face) })),
                  },
                  bestPlays,
                  hint: 'Auto-generated (best ' + best.score + ' vs weak ' + weak.score + ', bag ' + bagCount + ').',
                  _source: 'browser-generator',
                };
                captures.push(puzzle);
                appendCapture(puzzle);  // ★ persist IMMEDIATELY so progress is safe
                // Continue with WEAK play so game stays realistic
                const r = applyPlacements(state, weak.placements, true);
                if (!r.ok) applyPlacements(state, decision.placements, true);
                state.isPlayerTurn = !state.isPlayerTurn;
                continue;
              }
            }
          }
        }
        const r = applyPlacements(state, decision.placements, state.isPlayerTurn);
        if (!r.ok) break;
        if (!state.isPlayerTurn) state.aiConsecutiveSwaps = 0;
      } else if (decision.type === 'swap' && decision.tileIds) {
        const rack = state.isPlayerTurn ? state.playerRack : state.aiRack;
        const swapped = [];
        for (const id of decision.tileIds) {
          const idx = rack.tiles.findIndex(t => t && t.id === id);
          if (idx !== -1) {
            swapped.push(rack.tiles[idx]);
            Rack.removeTile(rack, rack.tiles[idx].id);
          }
        }
        while (rack.tiles.length < 8) {
          const t = Bag.drawTile(state.bag);
          if (!t) break;
          Rack.addTile(rack, t);
        }
        if (swapped.length) Bag.returnTiles(state.bag, swapped);
        if (state.isPlayerTurn) state.opponentSwapHistory.push({ type: 'swap', tileCount: swapped.length });
        else state.aiConsecutiveSwaps = (state.aiConsecutiveSwaps || 0) + 1;
        state.consecutiveNonScoringTurns++;
        if (state.consecutiveNonScoringTurns >= 6) break;
      } else {
        state.consecutiveNonScoringTurns++;
        if (state.consecutiveNonScoringTurns >= 6) break;
      }
      state.isPlayerTurn = !state.isPlayerTurn;
      if (state.bag.tiles.length === 0 &&
          state.playerRack.tiles.length === 0 &&
          state.aiRack.tiles.length === 0) break;
    }
  }

  async function generate(numGames, onProgress) {
    _cancelled = false;
    const t0 = Date.now();
    const newCaptures = [];
    for (let g = 0; g < numGames; g++) {
      if (_cancelled) break;
      try {
        await simulateOneGame(newCaptures, onProgress, g, numGames, t0);
      } catch (e) {
        console.warn('[gen] Game ' + g + ' failed:', e);
      }
    }
    // Each puzzle was already saved as it was captured (appendCapture above),
    // so nothing to merge here. We still count for the final summary.
    const added = newCaptures.length;
    if (onProgress) {
      onProgress({
        gameIdx: numGames, totalGames: numGames,
        captures: newCaptures.length, currentTurn: 0,
        elapsedMs: Date.now() - t0, stage: 'done', added,
      });
    }
    return { added, totalGenerated: newCaptures.length, cancelled: _cancelled };
  }

  function cancel() { _cancelled = true; }

  window.AMath.puzzleGenerator = {
    generate: generate,
    cancel: cancel,
  };
})();
