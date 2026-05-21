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

  async function decideMove(state) {
    const startTime = Date.now();

    // Worker-compatibility: pick up settings from state if passed
    _stateSettings = state._settings || null;

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

    // Bot level affects bingo enforcement:
    //   easy: no bingo enforcement (play any equation)
    //   normal: first 2 turns only
    //   hard: first 4 turns (full enforcement)
    const bingoTurns = botLevel === 'easy' ? 0 : botLevel === 'normal' ? 2 : C.AI_BINGO_MODE_TURNS;
    const isFirstFewPlays = aiPlayCount < bingoTurns;
    const isBehind100 = deficit > C.AI_BEHIND_FOR_BINGO_MODE;
    const isBehind140 = deficit >= C.AI_LEAD_FOR_OFFENSE;
    const isLead150 = lead >= C.AI_LEAD_FOR_CLOSE;
    const bingoYoyoOnlyMode = botLevel !== 'easy' && (isFirstFewPlays || isBehind100) && lead <= C.AI_LEAD_FOR_CLOSE;
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

    // === 2a. Bingo Feasibility Check ===
    // A valid 8-tile equation needs AT MINIMUM:
    //   - 2 numbers (one per side of =), or blanks substituting
    //   - 1 operator (to form an expression), or blank/choice substituting
    //   - 1 equals sign, or blank substituting
    // If the rack can't possibly meet these requirements, skip ALL bingo
    // searches (fast, grammar, and brute-force bingo stage). This saves
    // 3-12 seconds of wasted computation.
    let bingoFeasible = false;
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
      fastBingoPlay = window.AMath.aiBingoFast.findFastBingo(state, 5000);
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

    const bingoPlay = await findBestPlay(state.board, state.aiRack, state.isFirstMove, startTime, threats, bingoFeasible);
    const timeBudget = getTimeBudgetMs();
    let yoyoPlay = null;
    if (window.AMath.aiYoyo && (Date.now() - startTime) < timeBudget - 5000) {
      const baseRemaining = Math.max(2000, timeBudget - (Date.now() - startTime));
      // With 2+ blanks: give yoyo 50% more time — it's the priority play type
      // Cap at total remaining so we don't exceed AI time budget
      const yoyoBudget = hasMultiBlanks
        ? Math.min(baseRemaining * 1.5, timeBudget - (Date.now() - startTime))
        : baseRemaining;
      yoyoPlay = window.AMath.aiYoyo.findBestYoYo({
        board: state.board,
        aiRack: state.aiRack,
        isFirstMove: state.isFirstMove,
        _maxTimeMs: yoyoBudget,
      });
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
      // IMPORTANT: This override is DISABLED during the first 4 actual turns.
      // The strategy spec is strict: first 4 turns → bingo/yoyo or SWAP.
      // Playing a short 10-pt equation when you should be fishing for bingo
      // is a strategic disaster. The override only applies when bingoYoyoOnly
      // mode was triggered by being behind 100+ points (after turn 4).
      const allowOverride = !isFirstFewPlays;   // only for isBehind100 mode
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

      // No Bingo/YoYo found — swap if possible, otherwise pass
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
      // Close-board preference: when leading big, prefer plays that REDUCE
      // the opponent's available positions rather than maximizing score.
      // A "closing" play fills cells in tight spaces where there are few
      // empty neighbors — this reduces the number of anchor cells available
      // for the opponent's next play.
      if (bestPlay.score < 80) {  // don't override very high scoring plays
        const candidates = [bestPlay, bingoPlay && bingoPlay._bestNonRim,
                            bingoPlay && bingoPlay._bestNoBlank, yoyoPlay].filter(Boolean);
        let bestClosing = null;
        let bestCloseScore = -Infinity;

        for (const play of candidates) {
          if (play.score < 5) continue;
          // Count how many new anchor cells this play would create for opponent
          // (fewer = more closing = better when ahead)
          let newAnchors = 0;
          for (const p of play.placements) {
            const adj = [[0,1],[0,-1],[1,0],[-1,0]];
            for (const [dr,dc] of adj) {
              const nr = p.row + dr, nc = p.col + dc;
              if (Board.inBounds(nr, nc) && Board.isCellEmpty(state.board, nr, nc)) {
                // Check if this empty cell is already an anchor (adjacent to existing tile)
                const existingAdj = Board.getAdjacentTiles(state.board, nr, nc);
                if (existingAdj.length === 0) newAnchors++; // new anchor created
              }
            }
          }
          // Closing score: prefer fewer new anchors, higher play score, more tiles used
          const closeScore = play.score * 0.3 + play.placements.length * 3 - newAnchors * 5;
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
    if (bagSize > 0 && bagSize <= 15 && !state.isFirstMove && !bingoYoyoOnlyMode && botLevel !== 'easy') {
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
      const isEndgame = bagSize <= 15 && !state.isFirstMove;

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

    // === LAST RESORT: ×0 chain ===
    // If we're about to pass and the bag is small (≤ 15), try a ×0 chain play.
    // Even a 2-point dump is better than passing when the alternative is
    // the 6-pass death spiral or losing the endgame race.
    if (bagSize <= 15 && !state.isFirstMove) {
      const zeroChains = findZeroChainPlays(state.board, state.aiRack.tiles, false);
      if (zeroChains.length > 0) {
        const best = zeroChains[0]; // sorted by tiles used desc
        console.log('[AI] ×0 chain last resort: ' + best.score + ' pts, ' +
                    best.placements.length + ' tiles (' + (best._chainType || '') + ')');
        recordPlay(rackOwner);
        return {
          type: 'play',
          placements: best.placements,
          score: best.score,
          equations: best.equations,
        };
      }
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

  async function findBestPlay(board, aiRack, isFirstMove, startTime, threats, bingoFeasible) {
    let bestPlay = null;
    let bestNonRimPlay = null;  // Best play that doesn't violate rim rule
    let bestSafePlay = null;    // Best play by adjusted score (penalizing rim hooks)
    // Best play that blocks each detected threat at MEDIUM+ quality.
    // Without this, the candidate pool in section 4 only sees top-1 results
    // and may have nothing that blocks. By tracking blocking plays during the
    // main search, section 4 always has options to consider.
    let bestBlockingPlay = null;
    let bestBlockingDefValue = -1;
    let bestNoBlankPlay = null;   // Best play that uses zero BLANK tiles
    let bestMinBlankPlay = null;  // Best play using minimum number of blanks
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
    const bingoStageMs = Math.floor(totalBudgetMs * 0.33 * Math.min(candidateMultiplier, 1.5));
    const otherStageMs = Math.floor(totalBudgetMs * 0.08 * Math.min(candidateMultiplier, 1.5));
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
    let lastYieldTime = Date.now();
    const YIELD_INTERVAL_MS = 30;  // yield to browser every ~30ms for responsive UI

    for (const stage of searchPlan) {
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
        if (counter.abort) break;
        if (Date.now() > stageDeadline) {
          counter.abort = true;
          break;
        }

        // Yield periodically so timer can tick. Cheap check; ~150ms granularity.
        if (Date.now() - lastYieldTime > YIELD_INTERVAL_MS) {
          await yieldToBrowser();
          lastYieldTime = Date.now();
        }

        for (const direction of ['horizontal', 'vertical']) {
          if (counter.abort) break;
          if (Date.now() > stageDeadline) {
            counter.abort = true;
            break;
          }
          searchAtAnchor(
            board, aiRack, anchor, direction, stage.size, isFirstMove,
            onValidPlay, counter, stageStart, stage.budgetMs, maxCandidatesThisRack
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
    if (bagSize <= 15) {
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
        // Excess operators (>2 in rack)
        if ((p.tile.type === 'op' || p.tile.type === 'choice') && rackInfo.ops + rackInfo.choices > 2) dumpScore += 2;
        // Excess equals (>1 in rack)
        if (p.tile.type === 'equals' && rackInfo.eq > 1) dumpScore += 2;
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

    // OPTIMIZATION: order anchors by "promise" — premium-adjacent first.
    // Anchors near 3E/2E squares often yield higher-scoring plays.
    // We compute a simple heuristic score per anchor and sort descending.
    anchors.forEach(function (a) {
      let promise = 0;
      // Walk up to 7 cells in each direction; bonus for premium cells nearby
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dr, dc] of dirs) {
        for (let d = 1; d <= 7; d++) {
          const nr = a.row + dr * d;
          const nc = a.col + dc * d;
          if (!Board.inBounds(nr, nc)) break;
          const cell = board.cells[nr][nc];
          if (cell && !cell.tile) {
            // Empty cell — could be part of placement; weight by distance
            const w = 1 / d;
            const prem = cell.premium;
            if (prem === '3E') promise += 5 * w;
            else if (prem === '2E') promise += 2 * w;
            else if (prem === '3T') promise += 1 * w;
            else if (prem === '2T') promise += 0.5 * w;
          } else if (cell && cell.tile) {
            // Existing tile — slight bonus (more equation context)
            promise += 0.3 * (1 / d);
            // (don't break; keep walking past)
          }
        }
      }
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

    for (let i = 0; i < rack.length; i++) {
      if (counter.abort) return;
      if (used[i]) continue;
      const tile = rack[i];
      const assignedValues = getCandidateAssignments(tile, rack, isFirstMove);

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

  function getCandidateAssignments(tile, rack, isFirstMove) {
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
      if (rackBlankCount <= 1) return fullChoices;

      const rackFaces = new Set();
      for (const t of rack) {
        if (!t || t.type === 'blank') continue;
        rackFaces.add(t.assigned || t.face);
      }

      // Has = already?
      const hasEquals = rackFaces.has('=');
      // Has operator?
      const hasOp = ['+', '-', '×', '÷'].some(o => rackFaces.has(o));

      // Build pruned set based on what the rack needs
      const needed = [];
      // Top priority: = if missing
      if (!hasEquals) needed.push('=');
      // Operators if missing or only one
      if (!hasOp) needed.push('+', '-');
      // Always useful: 0, 1 (small numbers, common in equations)
      if (!rackFaces.has('0')) needed.push('0');
      if (!rackFaces.has('1')) needed.push('1');
      if (!rackFaces.has('5')) needed.push('5');

      // For 2 BLANKs: add more variety
      if (rackBlankCount === 2) {
        // Add all operators if not present
        for (const op of ['+', '-', '×', '÷']) {
          if (!needed.includes(op) && !rackFaces.has(op)) needed.push(op);
        }
        // Add small digits not in rack
        for (const d of ['2', '3', '4', '6', '7', '8', '9']) {
          if (!rackFaces.has(d) && needed.length < 12) needed.push(d);
        }
        // Always include = for safety
        if (!needed.includes('=')) needed.push('=');
      }

      // For 3+ BLANKs: keep it lean — only 4 most useful choices
      // (combinatorial: 4^3 = 64 × permutations, manageable)
      if (rackBlankCount >= 3) {
        // Most useful 4: =, +, 0, 1 — these enable most patterns
        const top4 = [];
        if (!hasEquals) top4.push('=');
        if (!hasOp) top4.push('+');
        if (!rackFaces.has('0')) top4.push('0');
        if (!rackFaces.has('1')) top4.push('1');
        // If we have everything, pick 4 generally useful
        while (top4.length < 4) {
          for (const c of ['=', '+', '-', '0', '1', '2', '5']) {
            if (!top4.includes(c)) { top4.push(c); break; }
          }
        }
        return top4.slice(0, 4);
      }

      // Filter to valid faces in active inventory
      const valid = new Set(fullChoices);
      const result = needed.filter(c => valid.has(c));
      return result.length > 0 ? result : fullChoices.slice(0, 5); // safety floor
    }
    return [null];
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
      // Avoid duplicates
      const dominated = allPlays.some(p =>
        p.placements.length >= zp.placements.length &&
        p.score >= zp.score &&
        p.placements.every((pp, i) => pp.row === zp.placements[i].row && pp.col === zp.placements[i].col)
      );
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
