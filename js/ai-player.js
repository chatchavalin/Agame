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

    // === 2b. Fast Bingo Pattern Search ===
    // Try pattern-based Bingo BEFORE expensive brute force.
    // This handles 3-BLANK racks that brute force can't solve in time.
    let fastBingoPlay = null;
    if (window.AMath.aiBingoFast && state.aiRack.tiles.length === 8 && !state.isFirstMove) {
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
    if (window.AMath.aiBingoGrammar && state.aiRack.tiles.length === 8) {
      const grammarStart = Date.now();
      // Adaptive budget based on rack difficulty:
      //   - First move (no anchor): 8s base, +2s per BLANK over 2
      //   - With anchor:            4s base, +1.5s per BLANK over 2
      // Hard racks (3-4 BLANKs) need more time but we cap at 12s to keep AI responsive.
      const blankCount = state.aiRack.tiles.filter(t => t.type === 'blank').length;
      const extraBlanks = Math.max(0, blankCount - 2);
      let grammarBudget;
      if (state.isFirstMove) {
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
    const bingoPlay = await findBestPlay(state.board, state.aiRack, state.isFirstMove, startTime, threats);
    const timeBudget = getTimeBudgetMs();
    let yoyoPlay = null;
    if (window.AMath.aiYoyo && (Date.now() - startTime) < timeBudget - 5000) {
      // Pass remaining time so YoYo respects the total AI budget rather than
      // using its own 20-30s budget on top of whatever findBestPlay already consumed.
      const remainingMs = Math.max(2000, timeBudget - (Date.now() - startTime));
      yoyoPlay = window.AMath.aiYoyo.findBestYoYo({
        board: state.board,
        aiRack: state.aiRack,
        isFirstMove: state.isFirstMove,
        _maxTimeMs: remainingMs,
      });
    }

    // Identify the "best non-defense play" — compare all search results
    let bestPlay = pickBetterPlay(bingoPlay, yoyoPlay);
    if (fastBingoPlay && (!bestPlay || fastBingoPlay.score > bestPlay.score)) {
      console.log('[AI] Using fast pattern Bingo (' + fastBingoPlay.score + ' pts) over best so far (' + (bestPlay ? bestPlay.score : 'none') + ')');
      bestPlay = fastBingoPlay;
    }
    if (grammarBingoPlay && (!bestPlay || grammarBingoPlay.score > bestPlay.score)) {
      console.log('[AI] Using grammar Bingo (' + grammarBingoPlay.score + ' pts) over best so far (' + (bestPlay ? bestPlay.score : 'none') + ')');
      bestPlay = grammarBingoPlay;
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
      // AND the best play is worth its BLANK cost
      const shouldOverride = bestPlay && bestPlay.score >= scoreThreshold &&
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

      // Did not meet threshold — log why and fall through to swap
      if (bestPlay && blanksInRack >= 2) {
        console.log('[AI] Bingo-only mode: best play scored ' + bestPlay.score +
                    ' pts using ' + blanksUsedInPlay + ' BLANKs — below threshold ' + scoreThreshold +
                    '. Swapping non-BLANKs to preserve BLANKs.');
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

    // === 6. Lead 150+ closing mode (Feature G) ===
    // Goal: maintain the lead by playing safe + offload hard tiles.
    // Priority: Defend existing ×9 > Score > Safety (no new ×9 or ×4) > Rack mgmt
    //
    // Note: ×9 DEFENSE for existing threats already happened in section 4 above.
    // This section handles: don't CREATE new ×9/×4 threats with our play.
    if (isLead150 && bestPlay) {
      // Check if best play creates a new ×9 threat (Safety check)
      const createsNewX9 = wouldCreateX9Threat(state.board, bestPlay.placements);
      const createsNewX4 = wouldCreateX4Threat(state.board, bestPlay.placements);

      if (createsNewX9 || createsNewX4) {
        // Try non-rim alternative from bingoPlay's tracking, or fallback to yoyoPlay
        const nonRimAlt = bingoPlay ? bingoPlay._bestNonRim : null;
        const safeAlt = pickBetterPlay(nonRimAlt, yoyoPlay);
        if (safeAlt &&
            !wouldCreateX9Threat(state.board, safeAlt.placements) &&
            !wouldCreateX4Threat(state.board, safeAlt.placements)) {
          // Don't downgrade if the swap loses too much score relative to the threat.
          // Creating a ×9 is roughly worth ~80-150 pts to opponent.
          const lossIfSwap = bestPlay.score - safeAlt.score;
          const threatCost = createsNewX9 ? 100 : 30;
          if (lossIfSwap < threatCost) {
            console.log('[AI] Lead-150 mode: switched to safer alt (avoiding ' +
                        (createsNewX9 ? '×9' : '×4') + ' threat); lost ' +
                        lossIfSwap + ' pts to prevent ~' + threatCost + ' pt threat');
            bestPlay = safeAlt;
          } else {
            console.log('[AI] Lead-150 mode: kept higher-scoring play despite ' +
                        (createsNewX9 ? '×9' : '×4') + ' threat (gain ' +
                        bestPlay.score + ' > threat cost ' + threatCost + ')');
          }
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

    // === 7. Normal mode ===
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

      // BLANK preservation check — never burn BLANKs on low-value plays
      const blanksUsed = bestPlay.placements.filter(p => p.tile && p.tile.type === 'blank').length;
      const blanksLeftInRack = state.aiRack.tiles.filter(t => t.type === 'blank').length;

      let minScoreForBlanks = 0;
      if (blanksUsed === 1) minScoreForBlanks = 20;       // 1 BLANK: needs 20+ pts
      else if (blanksUsed === 2) minScoreForBlanks = 45;  // 2 BLANKs: needs 45+ pts
      else if (blanksUsed >= 3) minScoreForBlanks = 75;   // 3+ BLANKs: nearly Bingo only

      if (blanksUsed > 0 && bestPlay.score < minScoreForBlanks) {
        // Best play wastes BLANKs. Consider alternatives:
        // 1. If we have a non-BLANK alternative, use it
        // 2. Otherwise, swap non-BLANKs to find better tiles next turn
        console.log('[AI] BLANK protection: best play uses ' + blanksUsed + ' BLANK(s) for only ' +
                    bestPlay.score + ' pts (threshold ' + minScoreForBlanks + ').');

        // Try the non-rim alternative if it doesn't use BLANKs heavily
        const nonRimAlt = bingoPlay && bingoPlay._bestNonRim;
        if (nonRimAlt) {
          const altBlanks = nonRimAlt.placements.filter(p => p.tile && p.tile.type === 'blank').length;
          if (altBlanks < blanksUsed && nonRimAlt.score >= 5) {
            console.log('[AI] Using alternative play with fewer BLANKs: ' + nonRimAlt.score + ' pts, ' + altBlanks + ' BLANKs');
            recordPlay(rackOwner);
            return {
              type: 'play',
              placements: nonRimAlt.placements,
              score: nonRimAlt.score,
              equations: nonRimAlt.equations,
            };
          }
        }

        // No good alternative — swap non-BLANK tiles if bag allows, keeping BLANKs
        if (bagSize > C.SWAP_FORBIDDEN_BAG_THRESHOLD) {
          console.log('[AI] Swapping non-BLANKs to preserve BLANKs for a future Bingo');
          return smartSwap(state);  // smart swap already protects BLANKs
        }
        // Bag too small — must play the bestPlay anyway
        console.log('[AI] Bag too small to swap, playing the BLANK-heavy play anyway');
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

  async function findBestPlay(board, aiRack, isFirstMove, startTime, threats) {
    let bestPlay = null;
    let bestNonRimPlay = null;  // Best play that doesn't violate rim rule
    let bestSafePlay = null;    // Best play by adjusted score (penalizing rim hooks)
    // Best play that blocks each detected threat at MEDIUM+ quality.
    // Without this, the candidate pool in section 4 only sees top-1 results
    // and may have nothing that blocks. By tracking blocking plays during the
    // main search, section 4 always has options to consider.
    let bestBlockingPlay = null;
    let bestBlockingDefValue = -1;
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

    if (maxTiles === 8) {
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
    const YIELD_INTERVAL_MS = 150;  // yield to browser every ~150ms

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
