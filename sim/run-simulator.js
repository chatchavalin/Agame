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

// Silence game-internal console.log spam during sim
const realLog = console.log;
const realWarn = console.warn;
console.log = () => {};
console.warn = () => {};

const sandbox = {
  console: { log: (...a) => process.stderr.write('[AI] '+a.join(' ')+'\n'), warn: (...a) => process.stderr.write('[AI WARN] '+a.join(' ')+'\n'), error: (...a) => process.stderr.write('[AI ERR] '+a.join(' ')+'\n') },
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

// Speed up AI: 5-second budget instead of 180s. We inject into the same
// _stateSettings object the ai-player module reads from getTimeBudgetMs().
// We also force getBotLevel to return null so the bot-level branch is skipped.
if (AMath.aiPlayer && AMath.aiPlayer._setStateSettings) {
  AMath.aiPlayer._setStateSettings({ aiThinkSeconds: 5 });
} else {
  // Fallback: write into the module-private variable via a global setter if any
  try {
    sandbox.window.AMath.settings = sandbox.window.AMath.settings || {
      get: (k) => (k === 'aiThinkSeconds' ? 5 : null),
      set: () => {},
    };
  } catch (e) {}
}

// Trim AI search budget so games finish quickly


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
  const result = Placement.validatePlay(state.board, placements, state.isFirstMove);
  if (!result.ok) return { ok: false, reason: result.reason };
  const scoreRes = Scoring.scorePlay(result.equations, state.board, placements.length);
  for (const p of placements) {
    Board.placeTile(state.board, p.row, p.col, p.tile);
    Board.markPremiumUsed(state.board, p.row, p.col);
  }
  for (const p of placements) {
    if (p.tile && p.tile.id) {
      const idx = rack.tiles.findIndex(t => t && t.id === p.tile.id);
      if (idx !== -1) Rack.removeTileAtSlot(rack, idx);
    }
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
    const rackStr = aiState.aiRack.tiles.filter(t=>t).map(t=>t.face).join(',');
    process.stderr.write(`[sim t${turn}] ${state.isPlayerTurn?'P':'AI'} rack: [${rackStr}] firstMove=${state.isFirstMove}\n`);
    let decision;
    try { decision = await AI.decideMove(aiState); }
    catch (e) {
      process.stderr.write(`[sim t${turn}] decideMove threw: ${e.message}\n`);
      break;
    }
    if (!decision) {
      process.stderr.write(`[sim t${turn}] decideMove returned null/falsy\n`);
      break;
    }
    process.stderr.write(`[sim t${turn}] ${state.isPlayerTurn?"P":"AI"} decision: type=${decision.type} placements=${decision.placements ? decision.placements.length : 0} score=${decision.score || 0} bag=${state.bag.tiles.length}\n`);
    const topPlays = AI.getLastTopPlays ? AI.getLastTopPlays() : [];

    if (decision.type === 'place' && decision.placements) {
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
        process.stderr.write(`[sim t${turn}] bag=${bagCount} topPlays=${topPlays.length} allPlays=${allPlays.length} bestScore=${best ? best.score : 'n/a'} hasBig=${hasBig}\n`);
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
      process.stderr.write(`[sim] Game ${g} failed: ${e.message}\n`);
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
