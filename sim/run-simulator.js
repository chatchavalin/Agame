#!/usr/bin/env node
/**
 * Headless A-Math game simulator — captures puzzles into the same format
 * that puzzle-recorder.js writes to localStorage.
 *
 * Usage:
 *   node sim/run-simulator.js [numGames=20] > captured.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  Date, Math,
  setTimeout, clearTimeout, setInterval, clearInterval,
  setImmediate, queueMicrotask,
  Promise, Symbol, Error, JSON, RegExp, Array, Object, String, Number, Boolean,
  performance: { now: () => Date.now() },
  process,  // some modules might use process.nextTick
};
sandbox.window = sandbox;
sandbox.document = {
  createElement: () => ({ classList: { add(){}, remove(){}, contains(){return false;} }, style: {}, appendChild(){}, addEventListener(){} }),
  getElementById: () => null,
  querySelector: () => null,
  body: { appendChild(){}, classList: { add(){}, remove(){} } },
  addEventListener(){},
};
sandbox.localStorage = { _data: {}, getItem(k){return this._data[k]||null;}, setItem(k,v){this._data[k]=v;}, removeItem(k){delete this._data[k];}};
sandbox.navigator = { userAgent: 'node-sim' };
vm.createContext(sandbox);

const MODULE_ORDER = [
  'constants.js', 'utils.js', 'evaluator.js', 'bag.js', 'rack.js',
  'board.js', 'scoring.js', 'placement.js',
  'ai-x9.js', 'ai-x4.js', 'ai-bingo-fast.js', 'ai-bingo-grammar.js',
  'ai-yoyo.js', 'ai-patterns-data.js', 'ai-patterns-engine.js',
  'ai-swap.js', 'ai-swap-brain2.js', 'ai-player.js',
];

const jsDir = path.join(__dirname, '..', 'js');
for (const file of MODULE_ORDER) {
  const fp = path.join(jsDir, file);
  if (!fs.existsSync(fp)) continue;
  try {
    vm.runInContext(fs.readFileSync(fp, 'utf8'), sandbox, { filename: file });
  } catch (e) {
    process.stderr.write(`[sim] FAILED loading ${file}: ${e.message}\n`);
    throw e;
  }
}

const AMath = sandbox.window.AMath;
const { constants: C, bag: Bag, rack: Rack, board: Board, scoring: Scoring,
        placement: Placement, aiPlayer: AI } = AMath;

// AI budget is set per-decideMove call via state._settings.aiThinkSeconds below.
// We use the full 180s budget — same as a real PvA turn — so the puzzles
// capture the OBJECTIVE best plays, not corner-cut approximations.

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
  // Defensively reconstruct each placement.tile from the live rack by id.
  // The AI search clones tiles and sometimes returns placements whose
  // .tile is null (CHOICE tile post-search). Rebind to the real rack tile,
  // copying any 'assigned' value the AI picked.
  // Build safe placements without mutating live rack tiles. We use a SHADOW
  // tile (a copy with a fresh assigned value) for validation. Only after
  // validation succeeds do we commit the .assigned to the real rack tile
  // and place it on the board.
  const safePlacements = [];
  const liveTilesToCommit = [];   // [{tile: realRackTile, assigned: 'face'}]
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
    if (!liveTile) {
      return { ok: false, reason: `cant resolve tile for placement at (${p.row},${p.col})` };
    }
    // Determine assigned face from the placement (without mutating yet)
    const wantAssigned = (p.tile && p.tile.assigned) || p.assigned || liveTile.assigned || null;
    // Build a shadow tile for validation (don't share reference with real rack)
    const shadowTile = {
      id: liveTile.id, face: liveTile.face, type: liveTile.type,
      points: liveTile.points, assigned: wantAssigned,
    };
    safePlacements.push({ row: p.row, col: p.col, tile: shadowTile });
    liveTilesToCommit.push({ tile: liveTile, assigned: wantAssigned });
  }
  // validatePlay expects the new tiles to be ON THE BOARD already.
  // Place SHADOW tiles, validate, roll back on failure.
  for (const p of safePlacements) {
    Board.placeTile(state.board, p.row, p.col, p.tile);
  }
  const result = Placement.validatePlay(state.board, safePlacements, state.isFirstMove);
  if (!result.ok) {
    for (const p of safePlacements) Board.removeTile(state.board, p.row, p.col);
    return { ok: false, reason: result.reason };
  }
  // Validation passed: commit assigned values onto the real rack tiles
  // and swap shadow tiles for real ones on the board.
  for (let i = 0; i < safePlacements.length; i++) {
    const sp = safePlacements[i];
    const realTile = liveTilesToCommit[i].tile;
    realTile.assigned = liveTilesToCommit[i].assigned;
    Board.removeTile(state.board, sp.row, sp.col);
    Board.placeTile(state.board, sp.row, sp.col, realTile);
  }
  placements = safePlacements;
  const scoreRes = Scoring.scorePlay(result.equations, state.board, placements.length);
  // Mark premiums used and remove placed tiles from rack
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    Board.markPremiumUsed(state.board, p.row, p.col);
    const realTileId = liveTilesToCommit[i].tile.id;
    Rack.removeTile(rack, realTileId);
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
    const face = cell.tile.face;
    const assigned = cell.tile.assigned || null;
    if (assigned) tiles.push([r, c, face, assigned]); else tiles.push([r, c, face]);
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

async function simulateOneGame(captures) {
  const state = newGameState();
  let turn = 0;
  while (turn < 50) {
    turn++;
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
      _settings: { aiThinkSeconds: 180 },  // FULL search depth — same as live PvA
    };
    let decision;
    try { decision = await AI.decideMove(aiState); }
    catch (e) { break; }
    if (!decision) break;

    const topPlays = AI.getLastTopPlays ? AI.getLastTopPlays() : [];

    // If AI chose to swap or pass but a real play exists in its top-plays,
    // upgrade the decision to a 'play' so the simulated game progresses.
    try {
      if ((decision.type === 'swap' || decision.type === 'pass') &&
          AI.getLastTopPlays) {
        const tops = AI.getLastTopPlays();
        // Validate: top play must have all real tile objects
        if (tops && tops.length > 0 && tops[0].placements && tops[0].placements.length > 0) {
          const valid = tops[0].placements.every(p => p && p.tile && p.row != null && p.col != null);
          if (valid) {
            decision = {
              type: 'place',
              placements: tops[0].placements,
              score: tops[0].score,
              equations: tops[0].equations,
            };
          }
        }
      }
    } catch (e) {}

    if ((decision.type === 'place' || decision.type === 'play') && decision.placements) {
      const bagCount = state.bag.tiles.length;
      if (state.isPlayerTurn && bagCount < 25) {
        // Build top-3 list
        const allPlays = [];
        const seen = new Set();
        function addP(p) {
          if (!p || !p.placements) return;
          const k = p.placements.map(x => x.row + ',' + x.col).sort().join('|');
          if (seen.has(k)) return;
          seen.add(k);
          allPlays.push(p);
        }
        addP(decision);
        topPlays.forEach(addP);
        allPlays.sort((a, b) => (b.score || 0) - (a.score || 0));
        const top3 = allPlays.slice(0, 3);
        const best = top3[0];
        let hasBig = false;
        for (const pl of top3) if (isBingo(pl) || isYoyo(state, pl)) { hasBig = true; break; }
        if (hasBig && best && best.score >= 8 && allPlays.length >= 2) {
          // Weak player = pick a lower-scoring play
          const weak = allPlays[Math.min(allPlays.length - 1, 1 + Math.floor(Math.random() * (allPlays.length - 1)))];
          const diff = best.score - (weak ? weak.score : 0);
          if (diff >= 5) {
            const bestPlays = top3.map(p => {
              const c = convertPlay(p);
              c.isBingo = isBingo(p);
              c.isYoyo = isYoyo(state, p);
              return c;
            });
            captures.push({
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
              hint: `Simulated — best ${best.score}, weak ${weak.score} (bag ${bagCount}).`,
              _source: 'simulator',
            });
            // Continue game with WEAK play
            const r = applyPlacements(state, weak.placements, true);
            if (!r.ok) applyPlacements(state, decision.placements, true);
            state.isPlayerTurn = !state.isPlayerTurn;
            continue;
          }
        }
      }
      const r = applyPlacements(state, decision.placements, state.isPlayerTurn);
      if (!r.ok) break;
      if (!state.isPlayerTurn) state.aiConsecutiveSwaps = 0;
    } else if (decision.type === 'swap' && decision.tileIds) {
      // Real swap: remove those tiles from rack, return to bag, draw new ones
      const rack = state.isPlayerTurn ? state.playerRack : state.aiRack;
      const swappedTiles = [];
      for (const id of decision.tileIds) {
        const idx = rack.tiles.findIndex(t => t && t.id === id);
        if (idx !== -1) {
          swappedTiles.push(rack.tiles[idx]);
          Rack.removeTile(rack, rack.tiles[idx].id);
        }
      }
      // Draw replacements FIRST so we don't immediately re-draw the same tiles
      const replacements = [];
      while (rack.tiles.length < 8) {
        const t = Bag.drawTile(state.bag);
        if (!t) break;
        Rack.addTile(rack, t);
        replacements.push(t);
      }
      // Return swapped tiles to bag
      if (swappedTiles.length) Bag.returnTiles(state.bag, swappedTiles);
      // Track swap history (the AI uses opponentSwapHistory)
      if (state.isPlayerTurn) {
        // Player swap — opponent's view sees this in opponentSwapHistory
        state.opponentSwapHistory.push({ type: 'swap', tileCount: swappedTiles.length });
      } else {
        state.aiConsecutiveSwaps = (state.aiConsecutiveSwaps || 0) + 1;
      }
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

const numGames = parseInt(process.argv[2] || '20', 10);
const captures = [];
process.stderr.write(`[sim] Running ${numGames} games...\n`);
const t0 = Date.now();
(async function main() {
  for (let g = 0; g < numGames; g++) {
    try { await simulateOneGame(captures); } catch (e) {
      process.stderr.write(`[sim] Game ${g} failed: ${e.message}\n${e.stack}\n`);
    }
    if (g % 5 === 4) {
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      process.stderr.write(`[sim] ${g + 1}/${numGames} games (${dt}s), ${captures.length} captures\n`);
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`[sim] Done in ${dt}s. ${captures.length} captures.\n`);
  process.stdout.write(JSON.stringify(captures));
})();
