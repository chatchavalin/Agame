/**
 * A-Math Game — Tile Tracker
 *
 * Shows the player how many tiles of each face remain UNSEEN —
 * i.e., not on the board and not in the player's own rack.
 *
 * "Unseen tiles" = TOTAL inventory − (tiles on board) − (player rack)
 *
 * This tells the player what tiles are in the bag + opponent's rack.
 * The player already knows their own rack, so those are excluded.
 */

(function () {
  const C = window.AMath.constants;

  /**
   * Compute tiles remaining: total minus board minus AI/opponent rack.
   * Player tracks their own hand — not subtracted here.
   * Result = bag + player hand.
   */
  function computeUnseenCounts(state) {
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    const counts = {};
    for (const def of inventory) {
      counts[def.face] = def.count;
    }

    // Subtract tiles ON THE BOARD only
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = state.board.cells[r][c];
        if (cell.tile) {
          counts[cell.tile.face] = (counts[cell.tile.face] || 0) - 1;
        }
      }
    }

    return counts;
  }

  /**
   * Render the tracker UI inside the given container.
   * Re-renders from scratch — call on every state change.
   */
  function render(container, state) {
    const counts = computeUnseenCounts(state);

    container.innerHTML = '';
    container.className = 'tile-tracker';

    const title = document.createElement('div');
    title.className = 'tracker-title';
    title.textContent = 'TILES NOT ON BOARD';
    container.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'tracker-grid';

    // Build entries in the order of the inventory
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    for (const def of inventory) {
      const count = counts[def.face] || 0;
      const item = document.createElement('div');
      item.className = 'tracker-item';
      if (count === 0) item.classList.add('tracker-item-empty');

      const face = document.createElement('span');
      face.className = 'tracker-face';
      face.textContent = def.face === 'BLANK' ? '?' : def.face;

      const num = document.createElement('span');
      num.className = 'tracker-count';
      num.textContent = count;

      item.appendChild(face);
      item.appendChild(num);
      grid.appendChild(item);
    }

    container.appendChild(grid);

    // Bag count info
    const Bag = window.AMath.bag;
    const info = document.createElement('div');
    info.className = 'tracker-info';
    info.textContent = 'Bag: ' + Bag.bagSize(state.bag) + ' tiles';
    container.appendChild(info);
  }

  window.AMath = window.AMath || {};
  window.AMath.tileTracker = {
    computeUnseenCounts: computeUnseenCounts,
    render: render,
  };
})();
