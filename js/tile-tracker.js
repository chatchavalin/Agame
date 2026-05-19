/**
 * A-Math Game — Tile Tracker
 *
 * Shows the player how many tiles of each face are still unseen
 * (in the bag + opponent's rack). Helps with strategic planning.
 *
 * "Unseen tiles" = TOTAL inventory − (your rack) − (tiles on board)
 */

(function () {
  const C = window.AMath.constants;

  /**
   * Compute the count of unseen tiles by face.
   * Returns { '0': 3, '1': 5, ..., '=': 7, 'BLANK': 2 }
   */
  function computeUnseenCounts(state) {
    const inventory = C.getActiveInventory ? C.getActiveInventory() : C.TILE_INVENTORY;
    // Start with total inventory counts
    const counts = {};
    for (const def of inventory) {
      counts[def.face] = def.count;
    }

    // Subtract tiles in player rack
    for (const t of state.playerRack.tiles) {
      counts[t.face] = (counts[t.face] || 0) - 1;
    }

    // Subtract tiles on board
    for (let r = 0; r < C.BOARD_SIZE; r++) {
      for (let c = 0; c < C.BOARD_SIZE; c++) {
        const cell = state.board.cells[r][c];
        if (cell.tile) {
          // For blanks placed with assigned value, the original face is BLANK
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
    title.textContent = 'Tiles Remaining (in bag + opponent)';
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
