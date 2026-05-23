/**
 * A-Math Game — Challenge Mechanic
 *
 * Per Master Spec §11:
 *   - After opponent plays, the other player can challenge
 *   - If challenge succeeds (play was invalid):
 *       - Played tiles return to opponent's rack
 *       - Opponent's score reverts (this play's points removed)
 *       - Premium squares "un-used"
 *       - Challenger's turn starts
 *   - If challenge fails (play was valid): no penalty in Hard mode (default)
 *
 * For player challenges of AI: show a Challenge button for ~5 seconds after AI plays.
 * For AI challenges of player: AI decides based on difficulty (Easy 50% / Medium 80% / Hard 100%).
 *
 * NOTE: Since AI in this build only generates valid plays, AI challenges
 * would always fail. But we implement the mechanic for completeness.
 */

(function () {
  const Board = window.AMath.board;
  const Rack = window.AMath.rack;
  const Placement = window.AMath.placement;
  const Evaluator = window.AMath.evaluator;
  const C = window.AMath.constants;

  /**
   * Verify whether a play was legitimate by re-running validation on a snapshot.
   * Used by the challenger after a play has been committed.
   *
   * @param boardSnapshot: the board state AFTER the play was committed
   * @param placements: array of {row, col, tile} - the new tiles placed in that play
   * @param wasFirstMove: was this the first move of the game?
   * @returns { valid, reason }
   */
  function verifyPlay(boardSnapshot, placements, wasFirstMove) {
    // The placements are already on the board. Re-validate them.
    // To re-validate, we treat the placements as "new" and the rest as existing.
    return Placement.validatePlay(boardSnapshot, placements, wasFirstMove);
  }

  /**
   * Revert a play that was successfully challenged.
   *
   * @param state: session state
   * @param playRecord: {
   *   placements: array of {row, col, tile},
   *   score: number,
   *   premiumCellsUsed: array of {row, col} that had their premiumUsed flipped,
   *   wasOpponent: 'player' | 'ai'  - who was the player whose move is being reverted
   * }
   */
  function revertPlay(state, playRecord) {
    // Remove tiles from board, return to opponent's rack
    const targetRack = playRecord.wasOpponent === 'player' ? state.playerRack : state.aiRack;
    const Bag = window.AMath.bag;

    // If rack is full (was refilled after the play), return excess tiles to bag first
    // to make room for the reverted tiles
    const tilesNeeded = playRecord.placements.length;
    const excessTiles = [];
    while (targetRack.tiles.length + tilesNeeded > C.RACK_SIZE && targetRack.tiles.length > 0) {
      const excessTile = targetRack.tiles.pop();
      // Remove from slotMap
      if (targetRack.slotMap) delete targetRack.slotMap[excessTile.id];
      excessTiles.push(excessTile);
    }
    // Return excess tiles to bag
    if (excessTiles.length > 0 && Bag && state.bag) {
      Bag.returnTiles(state.bag, excessTiles);
    }

    for (const p of playRecord.placements) {
      const tile = Board.removeTile(state.board, p.row, p.col);
      if (tile) {
        tile.assigned = null;
        Rack.addTile(targetRack, tile);
      }
    }
    // Revert score
    if (playRecord.wasOpponent === 'player') {
      state.playerScore -= playRecord.score;
    } else {
      state.aiScore -= playRecord.score;
    }
    // Un-mark premium squares
    for (const cell of playRecord.premiumCellsUsed) {
      const c = Board.getCell(state.board, cell.row, cell.col);
      if (c) c.premiumUsed = false;
    }
  }

  /**
   * Decide whether the AI should challenge the player's just-submitted play.
   *
   * Returns { challenge: bool, reason: string }
   * - `challenge: true` → AI will raise the challenge (trash-talk sequence follows)
   * - `challenge: false` → AI lets the play stand (rare; only on HARD if error
   *    is hard to spot)
   *
   * Miss rates by difficulty:
   *   EASY:   30% miss baseline
   *   MEDIUM: 10% miss baseline
   *   HARD:   1% miss, and ONLY on hard-to-spot errors (math errors)
   *
   * "Easy to spot" errors are NEVER missed (e.g., not a line, disconnected,
   * missing center for first move). These are visually obvious.
   * "Hard to spot" errors are math errors (e.g., 5+3=9) that require
   * computation to catch.
   */
  function decideAiChallenge(validationResult, difficulty) {
    if (validationResult.ok) {
      return { challenge: false, reason: 'play was valid' };
    }
    difficulty = (difficulty || 'HARD').toUpperCase();
    const reason = validationResult.reason || '';

    // Classify: is this error easy to spot or hard?
    // Hard-to-spot = math reasoning required (the "equation invalid" kind).
    const isHardToSpot = /invalid|does not equal|equation|math|evaluate/i.test(reason);

    let missChance;
    if (difficulty === 'EASY') {
      missChance = isHardToSpot ? 0.40 : 0.20;
    } else if (difficulty === 'MEDIUM') {
      missChance = isHardToSpot ? 0.15 : 0.05;
    } else { // HARD (default)
      // Easy errors: never missed. Hard errors: 1% miss.
      missChance = isHardToSpot ? 0.01 : 0.00;
    }

    const miss = Math.random() < missChance;
    return {
      challenge: !miss,
      isHardToSpot: isHardToSpot,
      reason: reason,
    };
  }

  window.AMath = window.AMath || {};
  window.AMath.challenge = {
    verifyPlay: verifyPlay,
    revertPlay: revertPlay,
    decideAiChallenge: decideAiChallenge,
  };
})();
