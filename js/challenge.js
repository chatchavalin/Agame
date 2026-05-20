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

  window.AMath = window.AMath || {};
  window.AMath.challenge = {
    verifyPlay: verifyPlay,
    revertPlay: revertPlay,
  };
})();
