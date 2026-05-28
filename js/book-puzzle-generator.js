/**
 * A-Math — Book Puzzle Generator
 *
 * Computes best plays for book-source puzzles (ตอน 1, 2, 3) by running the
 * AI solver against an empty board with the given rack. Results cached
 * per-ตอน in localStorage under: amath_book_<sectionId>_bank.
 *
 * Also handles ตอน 4's target-drill mode where we solve for each
 * specific target (0-20, op tiles).
 */
(function () {
  'use strict';

  if (!window.AMath || !window.AMath.aiPlayer) {
    console.warn('[book-gen] AMath not loaded — skipping');
    return;
  }

  const { constants: C, bag: Bag, rack: Rack, board: Board, scoring: Scoring,
          placement: Placement, aiPlayer: AI } = window.AMath;

  // Cache key per section
  function bankKey(sectionId) { return 'amath_book_' + sectionId + '_bank'; }
  function ton4Key() { return 'amath_book_ton4_cache'; }

  function loadBookData() {
    // Cached JSON fetched once
    if (window.AMath._bookData) return Promise.resolve(window.AMath._bookData);
    return fetch('sim/book-data.json?v=v58-fixpuzzles-2026-05-28')
      .then(r => r.json())
      .then(d => { window.AMath._bookData = d; return d; });
  }

  function loadCache(sectionId) {
    try {
      const raw = localStorage.getItem(bankKey(sectionId));
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveCache(sectionId, list) {
    try {
      localStorage.setItem(bankKey(sectionId), JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn('[book-gen] save failed:', e);
      return false;
    }
  }

  // Build a tile object from a face string. Must match the inventory.
  function makeTile(face) {
    const inv = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    const def = inv.find(x => x.face === face);
    if (!def) {
      console.warn('[book-gen] unknown face:', face);
      return null;
    }
    return {
      id: 'bg' + Math.random().toString(36).slice(2, 9),
      face: face,
      type: def.type,
      points: def.points || 0,
      assigned: null,
    };
  }

  // Build a Rack object containing exactly these faces
  function makeRack(faces) {
    const rack = Rack.createRack('player');
    for (const f of faces) {
      const t = makeTile(f);
      if (t) Rack.addTile(rack, t);
    }
    return rack;
  }

  // Yield to UI between heavy work
  function yieldToUI() { return new Promise(r => setTimeout(r, 0)); }

  let _cancelled = false;

  /**
   * Solve a single rack against an empty board. Returns the top-3 plays
   * found by the AI (filtered to BINGOs only — 8-tile plays).
   */
  async function solveOneRack(faces) {
    // For 8-tile racks (ton1): use the main AI solver on an empty board.
    // Throws if faces.length > 8 since the rack object enforces 8-tile limit.
    if (faces.length > 8) {
      console.warn('[book-gen] solveOneRack received >8 tiles; use solveEquationTokens instead');
      return [];
    }
    const board = Board.createBoard();
    const rack = makeRack(faces);

    const aiState = {
      board: board,
      bag: { tiles: [] },
      aiRack: rack,
      opponentRack: { tiles: [] },
      aiScore: 0, playerScore: 0,
      consecutiveNonScoringTurns: 0,
      isFirstMove: true,
      opponentSwapHistory: [],
      aiActualPlayCount: 0,
      aiConsecutiveSwaps: 0,
      lastOpponentAction: null,
      _settings: { aiThinkSeconds: 30 },  // 30s plenty for empty-board bingo
    };

    let decision;
    try { decision = await AI.decideMove(aiState); }
    catch (e) { console.warn('[book-gen] solver threw:', e); return []; }

    const topPlays = (AI.getLastTopPlays ? AI.getLastTopPlays() : []) || [];
    const allPlays = [];
    const seen = new Set();
    const add = (p) => {
      if (!p || !p.placements || p.placements.length === 0) return;
      const k = p.placements.map(x => x.row + ',' + x.col).sort().join('|');
      if (seen.has(k)) return;
      seen.add(k);
      allPlays.push(p);
    };
    if (decision && decision.placements) add(decision);
    topPlays.forEach(add);

    const bingos = allPlays.filter(p => p.placements.length >= 8);
    bingos.sort((a, b) => (b.score || 0) - (a.score || 0));
    return bingos.slice(0, 3);
  }

  /**
   * For ton2/ton3: 9-token equations. Treat tokens as a flat list (no board play).
   * Calls ton4Solver.findFullEquation under the hood (which is actually a generic
   * full-tile-list equation solver).
   */
  function solveEquationTokens(faces) {
    if (!window.AMath.ton4Solver || !window.AMath.ton4Solver.findEquationFromTokens) {
      console.warn('[book-gen] ton4Solver.findEquationFromTokens not loaded');
      return null;
    }
    if (faces.length < 3) return null;
    const matches = window.AMath.ton4Solver.findEquationFromTokens(faces, 1);
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * Convert a solver play into the puzzle-bank's bestPlay shape.
   */
  function playToBest(p) {
    return {
      score: p.score,
      tilesUsed: p.placements.length,
      placements: p.placements.map(x => ({
        row: x.row, col: x.col,
        face: (x.tile && (x.tile.assigned || x.tile.face)) || '?',
      })),
      createsX9: false,
      isBingo: p.placements.length >= 8,
      isYoyo: false,  // empty-board bingos can't be yoyos
    };
  }

  /**
   * Generate puzzles for an entire ตอน (one or more patterns).
   * sectionId = 'ton1', 'ton2', or 'ton3'
   * onProgress({ done, total, currentLabel, captures, found, stage })
   */
  async function generateSection(sectionId, onProgress) {
    _cancelled = false;
    const data = await loadBookData();
    const section = data[sectionId];
    if (!section || !section.patterns) {
      console.warn('[book-gen] unknown section:', sectionId);
      return { added: 0, total: 0 };
    }

    // Total puzzles to solve
    const allPuzzles = [];
    for (const pat of section.patterns) {
      for (const pz of pat.puzzles) {
        allPuzzles.push({ pattern: pat, source: pz });
      }
    }
    const total = allPuzzles.length;

    // Build new list (we replace the cache fully each time for this section)
    const newBank = [];
    let added = 0;
    const t0 = Date.now();

    // ALL sections (ton1, ton2, ton3) use the equation-token solver — no board play,
    // no main-AI dependency, no rack-size limit. Faster + uniform.
    for (let i = 0; i < allPuzzles.length; i++) {
      if (_cancelled) break;
      await yieldToUI();
      const { pattern, source } = allPuzzles[i];

      if (onProgress) {
        onProgress({
          done: i, total, currentLabel: pattern.label,
          captures: added, stage: 'solving',
          elapsedMs: Date.now() - t0,
        });
      }

      const eq = solveEquationTokens(source.rack);
      const entry = {
        id: Date.now() + Math.floor(Math.random() * 1e9),
        capturedAt: new Date().toISOString(),
        sectionId, patternId: pattern.id, patternLabel: pattern.label,
        tokens: source.rack.slice(),
        equation: eq ? eq.tokens : null,
        hasSolution: !!eq,
        _source: 'book-' + sectionId,
      };
      newBank.push(entry);
      added++;
      saveCache(sectionId, newBank);
    }

    if (onProgress) {
      onProgress({
        done: allPuzzles.length, total, currentLabel: '',
        captures: added, stage: 'done',
        elapsedMs: Date.now() - t0,
      });
    }
    return { added, total, cancelled: _cancelled };
  }

  /**
   * ตอน 4 solver: for a fixed rack, find ANY equation that evaluates to each target.
   * Uses the full AI solver — it'll find equations regardless of score.
   * 
   * For now we just call the full solver once on the rack against an empty board.
   * The solver returns the best-scoring play; we then check if any of the top plays
   * produces the target value. (For a real ตอน-4 implementation we'd want a more
   * targeted search, but this proof-of-concept works for many targets.)
   */
  async function solveTon4Target(rack, target) {
    // For ตอน 4 we just return the AI's top plays — the user can inspect each
    // and see if any forms the target. Future: targeted search.
    return await solveOneRack(rack);
  }

  function cancel() { _cancelled = true; }

  window.AMath.bookGenerator = {
    loadBookData: loadBookData,
    loadCache: loadCache,
    generateSection: generateSection,
    solveOneRack: solveOneRack,
    solveEquationTokens: solveEquationTokens,
    solveTon4Target: solveTon4Target,
    cancel: cancel,
  };
})();
