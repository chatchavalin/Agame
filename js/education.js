/**
 * A-Math — Education Mode Advisor
 *
 * When education mode is enabled, this module intercepts the player's
 * submit/swap/pass actions and checks if there's a significantly better
 * move available. If so, it undoes the action and shows the top 3 plays
 * with an explanation, letting the player choose.
 */
(function () {
  'use strict';

  const Board = window.AMath.board;

  /**
   * Find the best plays for the player's rack on the current board.
   * Uses the AI search engine (same as the AI opponent).
   * Returns a promise that resolves to an array of top plays (up to 3).
   */
  async function findBestPlays(session) {
    const AI = window.AMath.aiPlayer;
    if (!AI || !AI.decideMove) return [];

    // Build a complete rack including tentative tiles (which are on the board
    // but still belong to the player). Without this, the advisor searches
    // with a depleted rack and misses the player's best options.
    const Rack = window.AMath.rack;
    const Board = window.AMath.board;
    const virtualRack = { owner: 'player', tiles: session.playerRack.tiles.slice() };

    // Add back tentative tiles
    if (session.tentativePlacements) {
      for (const p of session.tentativePlacements) {
        const cell = session.board.cells[p.row][p.col];
        if (cell && cell.tile) {
          virtualRack.tiles.push(cell.tile);
        }
      }
    }

    // Clone board WITHOUT tentative tiles (so the AI search sees a clean board)
    const cleanBoard = { cells: [] };
    const tentativeIds = new Set(
      (session.tentativePlacements || [])
        .map(function (p) { return session.board.cells[p.row][p.col].tile; })
        .filter(Boolean)
        .map(function (t) { return t.id; })
    );

    for (let r = 0; r < 15; r++) {
      cleanBoard.cells[r] = [];
      for (let c = 0; c < 15; c++) {
        const cell = session.board.cells[r][c];
        const tile = cell.tile;
        const isTentative = tile && tentativeIds.has(tile.id);
        cleanBoard.cells[r][c] = {
          premium: cell.premium,
          premiumUsed: cell.premiumUsed,
          tile: isTentative ? null : (tile ? { face: tile.face, type: tile.type,
                                               points: tile.points, assigned: tile.assigned,
                                               id: tile.id } : null),
        };
      }
    }

    const state = {
      board: cleanBoard,
      aiRack: virtualRack,
      bag: session.bag,
      isFirstMove: session.isFirstMove,
      playerScore: session.aiScore,
      aiScore: session.playerScore,
      aiActualPlayCount: 99,
      consecutiveNonScoringTurns: session.consecutiveNonScoringTurns || 0,
      opponentRack: session.aiRack,
    };

    try {
      const decision = await AI.decideMove(state);
      if (!decision || decision.type !== 'play') return [];
      return [{
        placements: decision.placements,
        score: decision.score,
        equations: decision.equations,
      }];
    } catch (e) {
      console.error('[Education] AI search failed:', e);
      return [];
    }
  }

  /**
   * Format a play for display in the advice popup.
   */
  function formatPlay(play, idx) {
    if (!play) return '';
    const tiles = play.placements.map(function (p) {
      const face = (p.assigned || (p.tile && (p.tile.assigned || p.tile.face)) || '?');
      return face;
    }).join(' ');
    const pos = play.placements.map(function (p) {
      return '(' + p.row + ',' + p.col + ')';
    }).join(' ');
    return tiles + ' → ' + play.score + ' pts';
  }

  /**
   * Show the education advice popup.
   * @param playerAction  - 'play' | 'swap' | 'pass'
   * @param playerScore   - score of the player's move (0 for swap/pass)
   * @param bestPlays     - array of AI-found plays [{placements, score, equations}]
   * @param onKeep        - callback: player keeps their original move
   * @param onUse         - callback(play): player uses a suggested play
   */
  function showAdvicePopup(playerAction, playerScore, bestPlays, onKeep, onUse) {
    // Remove existing popup if any
    const existing = document.querySelector('.education-popup-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'education-popup-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);' +
      'display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px;';

    const popup = document.createElement('div');
    popup.style.cssText =
      'background:var(--popup-bg,#fffdf5);color:var(--text-primary,#1e293b);' +
      'border-radius:16px;padding:20px;max-width:380px;width:100%;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.3);font-family:inherit;';

    // Title
    const title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 12px;font-size:18px;color:#dc2626;';
    title.textContent = '📚 Education Mode';
    popup.appendChild(title);

    // Player's move description
    const playerDesc = document.createElement('div');
    playerDesc.style.cssText = 'margin-bottom:16px;padding:10px;background:rgba(0,0,0,0.05);border-radius:8px;font-size:14px;';
    if (playerAction === 'pass') {
      playerDesc.innerHTML = '<b>Your move:</b> Pass (0 pts)';
    } else if (playerAction === 'swap') {
      playerDesc.innerHTML = '<b>Your move:</b> Swap tiles (0 pts)';
    } else {
      playerDesc.innerHTML = '<b>Your move:</b> Play for <b>' + playerScore + '</b> pts';
    }
    popup.appendChild(playerDesc);

    // Best plays
    if (bestPlays.length > 0) {
      const betterLabel = document.createElement('div');
      betterLabel.style.cssText = 'font-size:14px;font-weight:bold;margin-bottom:8px;color:#059669;';
      betterLabel.textContent = bestPlays[0].score > playerScore
        ? '💡 Better move' + (bestPlays.length > 1 ? 's' : '') + ' available:'
        : '💡 Best found play:';
      popup.appendChild(betterLabel);

      bestPlays.forEach(function (play, idx) {
        const row = document.createElement('div');
        row.style.cssText =
          'display:flex;align-items:center;justify-content:space-between;' +
          'padding:8px 10px;margin-bottom:6px;background:rgba(5,150,105,0.08);' +
          'border-radius:8px;border:1px solid rgba(5,150,105,0.2);cursor:pointer;';

        const info = document.createElement('div');
        info.style.cssText = 'font-size:14px;';
        info.innerHTML = '<b>#' + (idx + 1) + ':</b> ' + formatPlay(play, idx);

        const useBtn = document.createElement('button');
        useBtn.style.cssText =
          'background:#059669;color:white;border:none;border-radius:6px;' +
          'padding:6px 12px;font-size:13px;cursor:pointer;white-space:nowrap;';
        useBtn.textContent = 'Use this';
        useBtn.onclick = function () {
          overlay.remove();
          onUse(play);
        };

        row.appendChild(info);
        row.appendChild(useBtn);
        popup.appendChild(row);
      });
    } else {
      const noPlays = document.createElement('div');
      noPlays.style.cssText = 'font-size:14px;color:#6b7280;margin-bottom:12px;';
      noPlays.textContent = 'No better plays found. Your move may be the best option.';
      popup.appendChild(noPlays);
    }

    // Keep original button
    const keepBtn = document.createElement('button');
    keepBtn.style.cssText =
      'display:block;width:100%;margin-top:12px;padding:10px;' +
      'background:#6b7280;color:white;border:none;border-radius:8px;' +
      'font-size:14px;cursor:pointer;';
    keepBtn.textContent = playerAction === 'pass' ? 'Keep Pass'
                        : playerAction === 'swap' ? 'Keep Swap'
                        : 'Keep my move (' + playerScore + ' pts)';
    keepBtn.onclick = function () {
      overlay.remove();
      onKeep();
    };
    popup.appendChild(keepBtn);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
  }

  /**
   * Check if education mode should intervene.
   * @param playerAction  - 'play' | 'swap' | 'pass'
   * @param playerScore   - score of the player's play (0 for swap/pass)
   * @param session       - current game session
   * @param onProceed     - callback: proceed with original action
   * @param onUsePlay     - callback(play): use a suggested play instead
   * @returns true if advisor is showing (caller should NOT proceed yet)
   */
  async function checkAndAdvise(playerAction, playerScore, session, onProceed, onUsePlay) {
    const Settings = window.AMath.settings;
    if (!Settings || !Settings.get('educationMode')) return false;

    // Don't advise in AI vs AI mode
    if (session.isAiVsAi) return false;

    // Show thinking indicator
    const status = document.getElementById('status-bar');
    const origStatus = status ? status.textContent : '';
    if (status) status.textContent = '📚 Analyzing your move...';

    try {
      const bestPlays = await findBestPlays(session);

      // Restore status
      if (status) status.textContent = origStatus;

      if (bestPlays.length === 0) {
        // No plays found — let the action through
        return false;
      }

      const bestScore = bestPlays[0].score;

      // Decision: should we intervene?
      let shouldAdvise = false;

      if (playerAction === 'pass' || playerAction === 'swap') {
        // Always advise on pass/swap if there's a playable move
        if (bestScore > 0) shouldAdvise = true;
      } else {
        // Player submitted a play — advise if it's significantly suboptimal
        // "Significantly" = best available is at least 20 pts more AND at least 50% better
        if (bestScore > playerScore + 20 && bestScore > playerScore * 1.5) {
          shouldAdvise = true;
        }
      }

      if (!shouldAdvise) return false;

      // Show advice popup
      showAdvicePopup(playerAction, playerScore, bestPlays, onProceed, onUsePlay);
      return true;
    } catch (e) {
      console.error('[Education] Advisor error:', e);
      if (status) status.textContent = origStatus;
      return false;
    }
  }

  window.AMath = window.AMath || {};
  window.AMath.education = {
    checkAndAdvise: checkAndAdvise,
  };
})();
